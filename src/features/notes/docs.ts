import { db } from '../../db/db';
import type { Doc, DocType, FolderRole } from '../../db/schema';
import { uid } from '../../lib/id';
import { propagateRename, relinkTitle } from '../links/links';

export const DOC_LABEL: Record<DocType, string> = {
  folder: 'Папка',
  note: 'Заметка',
  notebook: 'Тетрадь',
  pdf: 'PDF',
  daily: 'Ежедневная заметка',
  lecture: 'Лекция',
};

export const ROLE_LABEL: Record<FolderRole, string> = { subject: 'Предмет', topic: 'Тема' };

/** Подпись типа документа с учётом роли папки. */
export const docLabel = (d: Pick<Doc, 'type' | 'role'>) => (d.type === 'folder' && d.role ? ROLE_LABEL[d.role] : DOC_LABEL[d.type]);

/** Документ не в корзине. */
export const isLive = (d: Pick<Doc, 'deletedAt'>) => !d.deletedAt;

/** Все документы, кроме лежащих в корзине. */
export const liveDocs = () => db.docs.filter(isLive).toArray();

/** id документов в корзине — чтобы скрыть их карточки, блоки и результаты поиска. */
export async function trashedDocIds(): Promise<Set<string>> {
  return new Set((await db.docs.where('deletedAt').above(0).primaryKeys()) as string[]);
}

/** Можно ли класть документы внутрь (папки и лекции). */
export const isContainer = (d: Pick<Doc, 'type'>) => d.type === 'folder' || d.type === 'lecture';

const DEFAULT_TITLE: Record<DocType, string> = {
  folder: 'Новая папка',
  note: 'Без названия',
  notebook: 'Новая тетрадь',
  pdf: 'PDF',
  daily: 'Сегодня',
  lecture: 'Новая лекция',
};

export async function createDoc(type: DocType, parentId: string | null, title?: string, extra: Partial<Doc> = {}): Promise<Doc> {
  const now = Date.now();
  // null не индексируется в IndexedDB, поэтому соседей ищем фильтром
  const siblings = await db.docs.filter((d) => d.parentId === parentId).toArray();
  const order = Math.max(-1, ...siblings.map((d) => d.order)) + 1;
  const doc: Doc = {
    id: uid(),
    parentId,
    type,
    title: title ?? (extra.role ? (extra.role === 'subject' ? 'Новый предмет' : 'Новая тема') : DEFAULT_TITLE[type]),
    order,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
  await db.transaction('rw', db.docs, db.pages, async () => {
    await db.docs.add(doc);
    if (parentId) await db.docs.update(parentId, { collapsed: false });
    if (type === 'notebook') {
      await db.pages.add({ id: uid(), docId: doc.id, order: 0, background: 'grid', strokes: [], createdAt: now, updatedAt: now });
    }
  });
  if (type !== 'folder') await relinkTitle(doc.title);
  // У лекции сразу есть свой конспект-тетрадка (вкладка «Конспект и презентация»)
  if (type === 'lecture') {
    const nb = await createDoc('notebook', doc.id, 'Конспект');
    doc.lecture = { notebookId: nb.id };
    await db.docs.update(doc.id, { lecture: doc.lecture });
  }
  return doc;
}

export function createFolder(role: FolderRole | undefined, parentId: string | null, title?: string) {
  const icon = role === 'subject' ? 'book' : undefined;
  return createDoc('folder', parentId, title, { role, icon });
}

export async function renameDoc(id: string, title: string) {
  const old = await db.docs.get(id);
  await db.docs.update(id, { title, updatedAt: Date.now() });
  if (old && old.type !== 'folder') await propagateRename(id, old.title, title);
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

// ---------- Корзина ----------

export const TRASH_DAYS = 30;

/** Удалить в корзину: документ и всё вложенное прячутся, но 30 дней их можно вернуть. */
export async function trashDoc(id: string) {
  const now = Date.now();
  await db.transaction('rw', db.docs, async () => {
    const ids = collectSubtree(await db.docs.toArray(), id);
    for (const d of ids) {
      const doc = await db.docs.get(d);
      if (doc && !doc.deletedAt) await db.docs.update(d, { deletedAt: now, trashRoot: d === id || undefined });
    }
  });
}

/** Вернуть из корзины вместе с вложенными, удалёнными тем же действием. */
export async function restoreDoc(id: string) {
  await db.transaction('rw', db.docs, async () => {
    const all = await db.docs.toArray();
    const root = all.find((d) => d.id === id);
    if (!root?.deletedAt) return;
    const at = root.deletedAt;
    for (const d of collectSubtree(all, id)) {
      const doc = all.find((x) => x.id === d)!;
      if (doc.deletedAt === at) await db.docs.update(d, { deletedAt: undefined, trashRoot: undefined });
    }
    // если родитель тоже в корзине — возвращаем в корень, чтобы документ был виден
    const parent = all.find((d) => d.id === root.parentId);
    if (parent?.deletedAt) await db.docs.update(id, { parentId: null });
  });
}

/** Окончательно удалить всё, что лежит в корзине дольше 30 дней. */
export async function purgeExpired(now = Date.now()) {
  const limit = now - TRASH_DAYS * 86400000;
  const roots = await db.docs.filter((d) => !!d.trashRoot && !!d.deletedAt && d.deletedAt < limit).toArray();
  for (const r of roots) await purgeDoc(r.id);
}

export async function emptyTrash() {
  const roots = await db.docs.filter((d) => !!d.trashRoot).toArray();
  for (const r of roots) await purgeDoc(r.id);
}

/** Удалить насовсем (с блоками, карточками, страницами, аннотациями и файлами). */
export async function purgeDoc(id: string) {
  let fileIds: string[] = [];
  await db.transaction('rw', [db.docs, db.blocks, db.pages, db.cards, db.annotations], async () => {
    const all = await db.docs.toArray();
    const ids = collectSubtree(all, id);
    const blocks = await db.blocks.where('docId').anyOf(ids).toArray();
    const pages = await db.pages.where('docId').anyOf(ids).toArray();
    // файлы PDF и картинок этих документов — удалим, если больше нигде не используются
    fileIds = [
      ...all.filter((d) => ids.includes(d.id) && d.fileId).map((d) => d.fileId!),
      ...all.filter((d) => ids.includes(d.id) && d.source?.fileId).map((d) => d.source!.fileId!),
      ...blocks.flatMap((b) => (b.image?.fileId ? [b.image.fileId] : [])),
      ...pages.flatMap((p) => (p.items ?? []).flatMap((i) => (i.fileId ? [i.fileId] : []))),
    ];
    await db.blocks.where('docId').anyOf(ids).delete();
    await db.pages.where('docId').anyOf(ids).delete();
    await db.cards.where('docId').anyOf(ids).delete();
    await db.annotations.where('docId').anyOf(ids).delete();
    await db.docs.bulkDelete(ids);
  });
  if (fileIds.length) {
    const { cleanupFiles } = await import('./images');
    await cleanupFiles(fileIds);
  }
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
    if (!isContainer(target)) return;
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
