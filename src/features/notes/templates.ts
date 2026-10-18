import { db } from '../../db/db';
import type { Block } from '../../db/schema';
import { orderBetween, uid } from '../../lib/id';
import { syncBlockCards } from '../cards/sync';
import { linksFor } from '../links/links';
import { byOrder, childrenMap } from './blocks';

/**
 * Вставляет копию всех блоков документа-шаблона после блока `after` (или в конец документа).
 * Копируется вся структура; картинки ссылаются на тот же файл (он не удалится, пока используется).
 */
export async function insertTemplate(templateDocId: string, targetDocId: string, after: Block | null): Promise<string[]> {
  const src = await db.blocks.where('docId').equals(templateDocId).toArray();
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

export function listTemplates() {
  return db.docs.filter((d) => !!d.isTemplate && !d.deletedAt).toArray();
}

/** Отметить документ как шаблон (его карточки отключаются) или снять отметку. */
export async function setTemplate(docId: string, on: boolean) {
  await db.docs.update(docId, { isTemplate: on || undefined });
  const ids = await db.blocks.where('docId').equals(docId).primaryKeys();
  for (const id of ids) await syncBlockCards(id as string);
}
