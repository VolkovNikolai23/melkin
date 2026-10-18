import { db, getMeta, setMeta } from '../../db/db';
import type { Doc } from '../../db/schema';
import { createDoc, purgeDoc } from './docs';

const DAILY_FOLDER = 'Ежедневные заметки';

/** Ключ дня по местному времени: YYYY-MM-DD. */
export function dailyKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function dailyTitle(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const s = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
  // «суббота, 17 октября 2026 г.» → «17 октября 2026, суббота»
  const [weekday, rest] = s.split(', ');
  return rest ? `${rest.replace(/\s*г\.$/, '')}, ${weekday}` : s;
}

async function dailyFolder(): Promise<string> {
  const saved = await getMeta<string | null>('dailyFolderId', null);
  const savedDoc = saved ? await db.docs.get(saved) : undefined;
  if (savedDoc && !savedDoc.deletedAt) return savedDoc.id;
  const existing = await db.docs.filter((d) => d.type === 'folder' && d.parentId === null && !d.deletedAt && d.title === DAILY_FOLDER).first();
  const id = existing?.id ?? (await createDoc('folder', null, DAILY_FOLDER)).id;
  await setMeta('dailyFolderId', id);
  return id;
}

// Одновременные вызовы (экран «Сегодня», старт приложения, кнопки) ждут одно и то же создание,
// иначе получалось несколько заметок и папок на один день.
const inflight = new Map<string, Promise<Doc>>();

/** Ежедневная заметка на день (создаётся при первом обращении). Новые дни — сверху. */
export function getOrCreateDaily(key = dailyKey()): Promise<Doc> {
  let p = inflight.get(key);
  if (!p) {
    p = createDaily(key).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

async function createDaily(key: string): Promise<Doc> {
  const found = await db.docs.where('dailyDate').equals(key).first();
  if (found && !found.deletedAt) return found;
  if (found) {
    // заметку дня удалили в корзину — для «Сегодня» она нужна, возвращаем
    await db.docs.update(found.id, { deletedAt: undefined, trashRoot: undefined, parentId: await dailyFolder() });
    return { ...found, deletedAt: undefined };
  }
  const folder = await dailyFolder();
  const doc = await createDoc('daily', folder, dailyTitle(key));
  const order = -Number(key.replace(/-/g, ''));
  await db.docs.update(doc.id, { dailyDate: key, order });
  return { ...doc, dailyDate: key, order };
}

/**
 * Убирает дубликаты: несколько заметок на один день или несколько папок «Ежедневные заметки»
 * (могли появиться при одновременном открытии в двух вкладках). Содержимое не теряется — переносится.
 */
export async function dedupeDaily() {
  const docs = await db.docs.filter((d) => !d.deletedAt).toArray();
  const blockCount = new Map<string, number>();
  for (const b of await db.blocks.toArray()) blockCount.set(b.docId, (blockCount.get(b.docId) ?? 0) + 1);

  // папки: оставляем запомненную (или самую старую), остальное содержимое переносим в неё
  const saved = await getMeta<string | null>('dailyFolderId', null);
  const folders = docs.filter((d) => d.type === 'folder' && d.parentId === null && d.title === DAILY_FOLDER).sort((a, b) => a.createdAt - b.createdAt);
  if (folders.length > 1) {
    const keep = folders.find((f) => f.id === saved) ?? folders[0];
    for (const f of folders) {
      if (f.id === keep.id) continue;
      await db.docs.where('parentId').equals(f.id).modify({ parentId: keep.id });
      await purgeDoc(f.id);
    }
    await setMeta('dailyFolderId', keep.id);
  }

  // заметки одного дня: оставляем ту, где больше записей, блоки остальных переносим
  const byDay = new Map<string, Doc[]>();
  for (const d of docs) if (d.type === 'daily' && d.dailyDate) byDay.set(d.dailyDate, [...(byDay.get(d.dailyDate) ?? []), d]);
  for (const list of byDay.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => (blockCount.get(b.id) ?? 0) - (blockCount.get(a.id) ?? 0) || a.createdAt - b.createdAt);
    const [keep, ...rest] = list;
    for (const d of rest) {
      await db.blocks.where('docId').equals(d.id).modify({ docId: keep.id });
      await db.cards.where('docId').equals(d.id).modify({ docId: keep.id });
      await purgeDoc(d.id);
    }
  }
}
