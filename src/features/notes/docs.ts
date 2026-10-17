import { db } from '../../db/db';
import type { Doc, DocType } from '../../db/schema';
import { uid } from '../../lib/id';

export const DOC_LABEL: Record<DocType, string> = { folder: 'Папка', note: 'Заметка', notebook: 'Тетрадь', pdf: 'PDF', daily: 'Ежедневная заметка' };

export async function createDoc(type: DocType, parentId: string | null, title?: string): Promise<Doc> {
  const now = Date.now();
  // null не индексируется в IndexedDB, поэтому соседей ищем фильтром
  const siblings = await db.docs.filter((d) => d.parentId === parentId).toArray();
  const order = Math.max(-1, ...siblings.map((d) => d.order)) + 1;
  const doc: Doc = {
    id: uid(),
    parentId,
    type,
    title: title ?? (type === 'folder' ? 'Новая папка' : type === 'note' ? 'Без названия' : 'Новая тетрадь'),
    order,
    createdAt: now,
    updatedAt: now,
  };
  await db.transaction('rw', db.docs, db.pages, async () => {
    await db.docs.add(doc);
    if (parentId) await db.docs.update(parentId, { collapsed: false });
    if (type === 'notebook') {
      await db.pages.add({ id: uid(), docId: doc.id, order: 0, background: 'grid', strokes: [], createdAt: now, updatedAt: now });
    }
  });
  return doc;
}

export function renameDoc(id: string, title: string) {
  return db.docs.update(id, { title, updatedAt: Date.now() });
}

export function touchDoc(id: string) {
  return db.docs.update(id, { updatedAt: Date.now() });
}

/** Все потомки документа (включая его самого). */
export function collectSubtree(docs: Doc[], rootId: string): string[] {
  const res = [rootId];
  for (let i = 0; i < res.length; i++) for (const d of docs) if (d.parentId === res[i]) res.push(d.id);
  return res;
}

export async function deleteDoc(id: string) {
  await db.transaction('rw', [db.docs, db.blocks, db.pages, db.cards], async () => {
    const ids = collectSubtree(await db.docs.toArray(), id);
    await db.blocks.where('docId').anyOf(ids).delete();
    await db.pages.where('docId').anyOf(ids).delete();
    await db.cards.where('docId').anyOf(ids).delete();
    await db.docs.bulkDelete(ids);
  });
}

export async function moveDoc(id: string, newParentId: string | null) {
  const docs = await db.docs.toArray();
  if (newParentId && collectSubtree(docs, id).includes(newParentId)) return; // нельзя в самого себя
  const order = Math.max(-1, ...docs.filter((d) => d.parentId === newParentId).map((d) => d.order)) + 1;
  await db.docs.update(id, { parentId: newParentId, order });
  if (newParentId) await db.docs.update(newParentId, { collapsed: false });
}

export async function shiftDoc(id: string, dir: -1 | 1) {
  const doc = await db.docs.get(id);
  if (!doc) return;
  const sibs = (await db.docs.toArray()).filter((d) => d.parentId === doc.parentId).sort((a, b) => a.order - b.order);
  const i = sibs.findIndex((d) => d.id === id);
  const j = i + dir;
  if (j < 0 || j >= sibs.length) return;
  [sibs[i], sibs[j]] = [sibs[j], sibs[i]];
  await db.transaction('rw', db.docs, () => Promise.all(sibs.map((d, k) => db.docs.update(d.id, { order: k }))));
}

export function sortDocs(a: Doc, b: Doc) {
  return a.order - b.order || a.createdAt - b.createdAt;
}

/** Перенос документа перетаскиванием: перед/после другого или внутрь папки. */
export async function moveDocTo(id: string, targetId: string, pos: 'before' | 'after' | 'inside') {
  if (id === targetId) return;
  const docs = await db.docs.toArray();
  const target = docs.find((d) => d.id === targetId);
  if (!target || collectSubtree(docs, id).includes(targetId)) return;
  if (pos === 'inside') {
    if (target.type !== 'folder') return;
    return moveDoc(id, target.id);
  }
  const parentId = target.parentId;
  const sibs = docs.filter((d) => d.parentId === parentId && d.id !== id).sort(sortDocs);
  const i = sibs.findIndex((d) => d.id === targetId);
  sibs.splice(pos === 'before' ? i : i + 1, 0, { id } as Doc);
  await db.transaction('rw', db.docs, () =>
    Promise.all(sibs.map((d, k) => db.docs.update(d.id, d.id === id ? { order: k, parentId } : { order: k }))),
  );
}
