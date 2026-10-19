import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef } from 'react';
import { Icon, type IconName } from '../../components/Icon';
import { db } from '../../db/db';
import type { Block } from '../../db/schema';
import { normTitle } from '../links/links';
import { TYPE_ICON } from './docIcons';
import { rankMatch, type Trigger } from './trigger';

export interface SuggestItem {
  key: string;
  label: string;
  hint?: string;
  icon?: IconName;
  apply: () => void | Promise<void>;
}

/** Команды слэш-меню (действие выполняет редактор). */
export type SlashCommand =
  | 'image'
  | 'code'
  | 'draw'
  | 'portal'
  | 'link'
  | 'template'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'number'
  | 'props'
  | 'math'
  | 'chem'
  | 'camera'
  | 'card'
  | 'pdf';

const SLASH: { cmd: SlashCommand; label: string; icon: IconName; kw: string }[] = [
  { cmd: 'image', label: 'Картинка', icon: 'image', kw: 'картинка фото изображение рисунок image photo' },
  { cmd: 'camera', label: 'Фото с камеры', icon: 'camera', kw: 'камера фото снять сфотографировать camera доска' },
  { cmd: 'code', label: 'Блок кода', icon: 'code', kw: 'код программа code python c++ java matlab' },
  { cmd: 'draw', label: 'Рукописный блок', icon: 'pen', kw: 'рисунок рукописный pencil draw ink' },
  { cmd: 'portal', label: 'Портал (блок из другого места)', icon: 'portal', kw: 'портал portal вставить блок' },
  { cmd: 'link', label: 'Ссылка на документ', icon: 'link', kw: 'ссылка link документ' },
  { cmd: 'template', label: 'Вставить шаблон', icon: 'template', kw: 'шаблон template' },
  { cmd: 'h1', label: 'Заголовок 1', icon: 'heading', kw: 'заголовок h1 heading' },
  { cmd: 'h2', label: 'Заголовок 2', icon: 'heading', kw: 'заголовок h2 heading' },
  { cmd: 'h3', label: 'Заголовок 3', icon: 'heading', kw: 'заголовок h3 heading' },
  { cmd: 'number', label: 'Нумерованный пункт', icon: 'listNumber', kw: 'список нумерация number list' },
  { cmd: 'props', label: 'Свойства блока', icon: 'props', kw: 'свойство свойства поле property' },
  { cmd: 'math', label: 'Формула (блочная)', icon: 'sigma', kw: 'формула latex math tex' },
  { cmd: 'chem', label: 'Химическая формула или реакция', icon: 'flask', kw: 'химия формула реакция вещество chem ce mhchem' },
  { cmd: 'card', label: 'Карточка вопрос >> ответ', icon: 'card', kw: 'карточка вопрос ответ card flashcard' },
  { cmd: 'pdf', label: 'Импорт PDF (ссылка на него)', icon: 'pdf', kw: 'pdf пдф файл документ учебник' },
];

interface Ops {
  replace: (start: number, insert: string) => void;
  slash: (cmd: SlashCommand, start: number) => void;
  portal: (target: Block, start: number) => void;
  createAndLink: (title: string, start: number) => void;
}

/** Подсказки для текущего триггера. */
export function useSuggestions(trig: Trigger | null, block: Block, ops: Ops): SuggestItem[] {
  const kind = trig?.kind;
  const q = trig?.query ?? '';

  const docs = useLiveQuery(() => (kind === 'link' ? db.docs.filter((d) => d.type !== 'folder' && !d.deletedAt).toArray() : []), [kind]);
  const tags = useLiveQuery(async () => (kind === 'tag' ? ((await db.blocks.orderBy('tags').uniqueKeys()) as string[]) : []), [kind]);
  const blocks = useLiveQuery(async () => {
    if (kind !== 'portal' || q.trim().length < 2) return [];
    const needle = q.trim().toLowerCase();
    const found = await db.blocks
      .filter((b) => b.kind === 'text' && b.id !== block.id && b.text.toLowerCase().includes(needle))
      .limit(8)
      .toArray();
    const titles = new Map((await db.docs.bulkGet([...new Set(found.map((b) => b.docId))])).filter(Boolean).map((d) => [d!.id, d!.title]));
    return found.map((b) => ({ b, title: titles.get(b.docId) ?? '' }));
  }, [kind, q, block.id]);

  if (!trig) return [];
  const start = trig.start;

  if (kind === 'slash') {
    return SLASH.map((c) => ({ c, r: Math.max(rankMatch(c.label, q), rankMatch(c.kw, q)) }))
      .filter((x) => x.r > 0)
      .sort((a, b) => b.r - a.r)
      .map(({ c }) => ({ key: c.cmd, label: c.label, icon: c.icon, apply: () => ops.slash(c.cmd, start) }));
  }

  if (kind === 'link') {
    const list = (docs ?? [])
      .map((d) => ({ d, r: rankMatch(d.title, q) }))
      .filter((x) => x.r > 0)
      .sort((a, b) => b.r - a.r || b.d.updatedAt - a.d.updatedAt)
      .slice(0, 8)
      .map(({ d }) => ({ key: d.id, label: d.title, icon: TYPE_ICON[d.type], apply: () => ops.replace(start, `[[${d.title}]]`) }) as SuggestItem);
    const title = q.trim();
    if (title && !(docs ?? []).some((d) => normTitle(d.title) === normTitle(title))) {
      list.push({ key: 'new', label: `Создать «${title}»`, icon: 'plus', apply: () => ops.createAndLink(title, start) });
    }
    return list;
  }

  if (kind === 'tag') {
    const nq = q.toLowerCase();
    const list: SuggestItem[] = (tags ?? [])
      .filter((t) => t.startsWith(nq) && t !== nq)
      .slice(0, 8)
      .map((t) => ({ key: t, label: '#' + t, icon: 'tag', apply: () => ops.replace(start, `#${t} `) }));
    return list;
  }

  // портал
  return (blocks ?? []).map(({ b, title }) => ({
    key: b.id,
    label: b.text.length > 70 ? b.text.slice(0, 70) + '…' : b.text,
    hint: title,
    icon: 'portal',
    apply: () => ops.portal(b, start),
  }));
}

export function SuggestPopup({ items, active, onPick, hint }: { items: SuggestItem[]; active: number; onPick: (i: number) => void; hint?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  if (!items.length && !hint) return null;
  return (
    <div ref={ref} className="suggest" onPointerDown={(e) => e.preventDefault()}>
      {items.length === 0 && <div className="suggest-hint">{hint}</div>}
      {items.map((it, i) => (
        <button key={it.key} className={'suggest-item' + (i === active ? ' active' : '')} onClick={() => onPick(i)}>
          {it.icon && <Icon name={it.icon} size={18} />}
          <span className="suggest-label">{it.label}</span>
          {it.hint && <small>{it.hint}</small>}
        </button>
      ))}
    </div>
  );
}
