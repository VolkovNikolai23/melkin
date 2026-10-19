import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/Icon';
import { aiErrorText, ask } from '../ai/client';
import { renderText } from '../notes/render';
import { lookup, trainchineseUrl, type WordHit } from './dict';
import { hasHan, isSentence } from './parse';

interface Sel {
  text: string;
  rect: DOMRect;
}

/** Выделили китайский текст (заметка, сводка, PDF) → кнопка «汉 Перевод» → слова по словарю, предложение — ИИ. */
export function ZhSelectHost() {
  const [sel, setSel] = useState<Sel | null>(null);
  const [open, setOpen] = useState<Sel | null>(null);
  const [hits, setHits] = useState<WordHit[] | null>(null);
  const [ai, setAi] = useState<{ loading: boolean; text?: string; error?: string } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let t = 0;
    const on = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const s = window.getSelection();
        const text = s?.toString().trim() ?? '';
        if (!s || s.isCollapsed || !text || text.length > 300 || !hasHan(text) || !s.anchorNode?.isConnected) return setSel(null);
        const r = s.getRangeAt(0).getBoundingClientRect();
        if (!r.width && !r.height) return setSel(null);
        setSel({ text, rect: r });
      }, 250);
    };
    // перешли на другой экран — выделение уже не актуально
    const away = () => {
      setSel(null);
      setOpen(null);
    };
    document.addEventListener('selectionchange', on);
    window.addEventListener('hashchange', away);
    return () => {
      document.removeEventListener('selectionchange', on);
      window.removeEventListener('hashchange', away);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const on = (e: PointerEvent) => !popRef.current?.contains(e.target as Node) && setOpen(null);
    window.addEventListener('pointerdown', on, true);
    return () => window.removeEventListener('pointerdown', on, true);
  }, [open]);

  const show = async (s: Sel) => {
    setOpen(s);
    setHits(null);
    setAi(null);
    setHits(await lookup(s.text));
  };

  const translate = async (text: string, what: 'sentence' | 'defs') => {
    setAi({ loading: true });
    try {
      const out = await ask({
        system:
          what === 'sentence'
            ? 'Переведи китайский текст на русский. Формат: первая строка — иероглифы, вторая — пиньинь с тонами, третья — перевод. Затем 1–3 строки с важными словами «слово (пиньинь) — значение».'
            : 'Переведи английские словарные определения китайских слов на русский, кратко. Формат: по строке на слово «слово (пиньинь) — значения по-русски».',
        parts: [{ text }],
        temperature: 0.2,
      });
      setAi({ loading: false, text: out });
    } catch (e) {
      setAi({ loading: false, error: aiErrorText(e) });
    }
  };

  const btn = sel && !open && (
    <button
      className="zh-btn"
      style={{ left: Math.max(8, Math.min(sel.rect.left, window.innerWidth - 140)), top: Math.max(8, sel.rect.top - 52) }}
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => show(sel)}
    >
      汉 Перевод
    </button>
  );

  const found = hits?.filter((h) => h.entries.length) ?? [];
  const pop = open && (
    <div
      ref={popRef}
      className="gl-pop zh-pop"
      role="dialog"
      aria-label="Перевод"
      style={{ left: Math.max(8, Math.min(open.rect.left, window.innerWidth - 368)), ...(open.rect.bottom + 320 < window.innerHeight ? { top: open.rect.bottom + 8 } : { bottom: window.innerHeight - open.rect.top + 8 }) }}
    >
      <div className="zh-src" lang="zh">
        {open.text}
      </div>
      {hits === null ? (
        <p className="muted small">Ищу в словаре…</p>
      ) : !found.length ? (
        <p className="muted small">В словаре не нашлось. Загрузите словарь в «Словарь терминов» → «Китайский словарь» или переведите через ИИ.</p>
      ) : (
        <div className="zh-words">
          {found.map((h) => (
            <div key={h.word} className="zh-word">
              <div>
                <span className="zh-hanzi" lang="zh">
                  {h.word}
                </span>{' '}
                <span className="muted">{[...new Set(h.entries.map((e) => e.p).filter(Boolean))].join(' / ')}</span>
                <a className="zh-tc" href={trainchineseUrl(h.word)} target="_blank" rel="noreferrer" title="Открыть в Trainchinese">
                  Trainchinese ↗
                </a>
              </div>
              <div className="small">{h.entries.flatMap((e) => e.d).slice(0, 6).join('; ')}</div>
            </div>
          ))}
        </div>
      )}
      <div className="gl-actions">
        {isSentence(open.text) ? (
          <button className="btn small" onClick={() => translate(open.text, 'sentence')}>
            <Icon name="sparkle" size={16} /> Перевести предложение (ИИ)
          </button>
        ) : (
          found.some((h) => h.entries.some((e) => e.src === 'cedict')) && (
            <button className="btn small ghost" onClick={() => translate(found.map((h) => `${h.word} (${h.entries[0].p}): ${h.entries.flatMap((e) => e.d).slice(0, 6).join('; ')}`).join('\n'), 'defs')}>
              <Icon name="sparkle" size={16} /> По-русски (ИИ)
            </button>
          )
        )}
      </div>
      {ai?.loading && (
        <p className="ai-thinking muted small">
          <span className="spinner" aria-hidden /> ИИ переводит…
        </p>
      )}
      {ai?.error && <p className="error small">{ai.error}</p>}
      {ai?.text && (
        <div className="zh-ai">
          {ai.text
            .split('\n')
            .filter((l) => l.trim())
            .map((l, i) => (
              <p key={i} dangerouslySetInnerHTML={{ __html: renderText(l.trim()) }} />
            ))}
        </div>
      )}
    </div>
  );

  return createPortal(
    <>
      {btn}
      {pop}
    </>,
    document.body,
  );
}
