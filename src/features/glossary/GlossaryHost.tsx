import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/Icon';
import { dialog } from '../../components/dialog';
import { db } from '../../db/db';
import { navigate } from '../../lib/router';
import { renderText } from '../notes/render';
import { allTerms, buildIndex, upsertTerm, type Term, type TermIndex } from './glossary';

// Индекс терминов общий для всех блоков: пересобирается при изменении словаря или карточек
let index: TermIndex = { re: null, byKey: new Map() };
const listeners = new Set<() => void>();
export function useTermIndex(): TermIndex {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => index,
  );
}

/** Перевод термина на китайский через ИИ (сохраняется в словарь). */
async function translateTerm(t: Term): Promise<void> {
  const { askJson, aiErrorText } = await import('../ai/client');
  try {
    const r = await askJson<{ zh?: string; pinyin?: string }>(
      {
        system: 'Переведи учебный термин на китайский (упрощённые иероглифы) и дай пиньинь с тонами. Ответ только JSON: {"zh":"…","pinyin":"…"}',
        parts: [{ text: `Термин: ${t.term}\nОпределение: ${t.definition}` }],
        temperature: 0,
      },
      (v) => typeof v.zh === 'string' && !!v.zh,
    );
    await upsertTerm({ term: t.term, definition: t.definition, docId: t.docId, zh: r.zh, pinyin: r.pinyin }, t.entryId ? ((await db.glossary.get(t.entryId))?.source ?? 'user') : 'user');
  } catch (e) {
    await dialog.alert('Не удалось перевести', aiErrorText(e));
  }
}

function Popover({ term, rect, onClose }: { term: Term; rect: DOMRect; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const on = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', on, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', on, true);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  const below = rect.bottom + 260 < window.innerHeight;
  return createPortal(
    <div
      ref={ref}
      className="gl-pop"
      role="dialog"
      aria-label={term.term}
      style={{ left: Math.max(8, Math.min(rect.left, window.innerWidth - 348)), ...(below ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 }) }}
    >
      <div className="gl-term-title">{term.term}</div>
      <div className="gl-def" dangerouslySetInnerHTML={{ __html: renderText(term.definition) }} />
      {term.zh ? (
        <div className="gl-zh">
          <span lang="zh">{term.zh}</span> {term.pinyin && <span className="muted">{term.pinyin}</span>}
        </div>
      ) : (
        <button
          className="btn small ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await translateTerm(term);
            setBusy(false);
          }}
        >
          <Icon name="globe" size={16} /> {busy ? 'Перевожу…' : 'Перевод на китайский (ИИ)'}
        </button>
      )}
      <div className="gl-actions">
        {term.docId && (
          <button className="btn small ghost" onClick={() => (onClose(), navigate(`doc/${term.docId}${term.blockId ? `?b=${term.blockId}` : ''}`))}>
            <Icon name="note" size={16} /> Источник
          </button>
        )}
        <button className="btn small ghost" onClick={() => (onClose(), navigate(`glossary?q=${encodeURIComponent(term.term)}`))}>
          <Icon name="book" size={16} /> Словарь
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** Следит за словарём и открывает определение по нажатию на термин в любом тексте. */
export function GlossaryHost() {
  const terms = useLiveQuery(allTerms, []);
  const [open, setOpen] = useState<{ key: string; rect: DOMRect } | null>(null);

  useEffect(() => {
    if (!terms) return;
    index = buildIndex(terms);
    listeners.forEach((l) => l());
  }, [terms]);

  useEffect(() => {
    // перехватываем раньше React: иначе нажатие откроет редактирование блока
    const on = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('.gl-term');
      if (!el?.dataset.term) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen({ key: el.dataset.term, rect: el.getBoundingClientRect() });
    };
    window.addEventListener('click', on, true);
    return () => window.removeEventListener('click', on, true);
  }, []);

  const term = open ? index.byKey.get(open.key) : undefined;
  if (!open || !term) return null;
  return <Popover key={open.key} term={term} rect={open.rect} onClose={() => setOpen(null)} />;
}
