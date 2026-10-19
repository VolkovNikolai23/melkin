import { db } from '../../db/db';
import type { Block } from '../../db/schema';
import { orderBetween, uid } from '../../lib/id';
import { syncBlockCards } from '../cards/sync';
import { linksFor } from '../links/links';
import { byOrder, childrenMap } from './blocks';

/** Встроенный шаблон: дерево пунктов. Без синтаксиса карточек — иначе в повторение попали бы пустышки. */
interface TplNode {
  text: string;
  heading?: 1 | 2 | 3;
  kids?: TplNode[];
}

export const BUILTIN_TEMPLATES: { id: string; title: string; nodes: TplNode[] }[] = [
  {
    id: 'builtin:lecture',
    title: 'Лекция (встроенный)',
    nodes: [
      { text: 'Тема лекции', heading: 1 },
      { text: 'Дата и преподаватель:' },
      { text: 'Главное за 1 минуту', heading: 2, kids: [{ text: '' }] },
      { text: 'Конспект по подтемам', heading: 2, kids: [{ text: 'Подтема 1', heading: 3, kids: [{ text: '' }] }, { text: 'Подтема 2', heading: 3, kids: [{ text: '' }] }] },
      { text: 'Термины — пишите «термин», два двоеточия, «определение»', heading: 2, kids: [{ text: '' }] },
      { text: 'Формулы и реакции', heading: 2, kids: [{ text: '$\\ce{}$' }] },
      { text: 'Вопросы для повторения — «вопрос», две стрелки >, «ответ»', heading: 2, kids: [{ text: '' }] },
      { text: 'Что непонятно — спросить', heading: 2, kids: [{ text: '' }] },
    ],
  },
  {
    id: 'builtin:topic',
    title: 'Сводка по теме (встроенный)',
    nodes: [
      { text: 'Тема', heading: 1 },
      { text: 'Ключевые понятия', heading: 2, kids: [{ text: '' }] },
      { text: 'Процессы по шагам', heading: 2, kids: [{ text: '' }] },
      { text: 'Сравнение', heading: 2, kids: [{ text: '' }] },
      { text: 'Частые ошибки', heading: 2, kids: [{ text: '' }] },
    ],
  },
];

function builtinBlocks(nodes: TplNode[]): Block[] {
  const out: Block[] = [];
  const now = Date.now();
  const walk = (list: TplNode[], parentId: string | null) =>
    list.forEach((n, i) => {
      const b: Block = { id: uid(), docId: '', parentId, order: i, kind: 'text', text: n.text, tags: [], links: [], createdAt: now, updatedAt: now, ...(n.heading ? { heading: n.heading } : {}) };
      out.push(b);
      if (n.kids) walk(n.kids, b.id);
    });
  walk(nodes, null);
  return out;
}

/**
 * Вставляет копию блоков-шаблона после блока `after` (или в конец документа).
 * Копируется вся структура; картинки ссылаются на тот же файл (он не удалится, пока используется).
 */
async function insertBlocks(src: Block[], targetDocId: string, after: Block | null): Promise<string[]> {
  const kids = childrenMap(src);
  const target = await db.blocks.where('docId').equals(targetDocId).toArray();
  const parentId = after ? after.parentId : null;
  const sibs = target.filter((b) => b.parentId === parentId).sort(byOrder);
  const i = after ? sibs.findIndex((b) => b.id === after.id) : sibs.length - 1;
  const lo = sibs[i]?.order;
  const hi = sibs[i + 1]?.order;
  const roots = kids.get(null) ?? [];
  const now = Date.now();
  const out: Block[] = [];

  const copy = (b: Block, newParent: string | null, order: number) => {
    const nb: Block = { ...b, id: uid(), docId: targetDocId, parentId: newParent, order, createdAt: now, updatedAt: now };
    out.push(nb);
    (kids.get(b.id) ?? []).forEach((k, j) => copy(k, nb.id, j));
  };
  // корневые блоки шаблона равномерно встают между соседями
  let prev = lo;
  roots.forEach((r, j) => {
    const o = hi === undefined ? (lo ?? -1) + j + 1 : orderBetween(prev, hi);
    prev = o;
    copy(r, parentId, o);
  });
  for (const b of out) b.links = await linksFor(b.text);
  await db.blocks.bulkAdd(out);
  for (const b of out) await syncBlockCards(b.id);
  await db.docs.update(targetDocId, { updatedAt: now });
  return out.map((b) => b.id);
}

/** Шаблон — свой документ (id документа) или встроенный (id «builtin:…»). */
export async function insertTemplate(templateId: string, targetDocId: string, after: Block | null): Promise<string[]> {
  const builtin = BUILTIN_TEMPLATES.find((t) => t.id === templateId);
  const src = builtin ? builtinBlocks(builtin.nodes) : await db.blocks.where('docId').equals(templateId).toArray();
  return insertBlocks(src, targetDocId, after);
}

export function listTemplates() {
  return db.docs.filter((d) => !!d.isTemplate && !d.deletedAt).toArray();
}

/** Отметить документ как шаблон (его карточки отключаются) или снять отметку. */
export async function setTemplate(docId: string, on: boolean) {
  await db.docs.update(docId, { isTemplate: on || undefined });
  const ids = await db.blocks.where('docId').equals(docId).primaryKeys();
  for (const id of ids) await syncBlockCards(id as string);
}
