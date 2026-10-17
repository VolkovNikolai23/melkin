import { db, getMeta, setMeta } from '../../db/db';
import type { Doc } from '../../db/schema';
import { createDoc } from './docs';

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
  if (saved && (await db.docs.get(saved))) return saved;
  const existing = await db.docs.filter((d) => d.type === 'folder' && d.parentId === null && d.title === DAILY_FOLDER).first();
  const id = existing?.id ?? (await createDoc('folder', null, DAILY_FOLDER)).id;
  await setMeta('dailyFolderId', id);
  return id;
}

/** Ежедневная заметка на день (создаётся при первом обращении). Новые дни — сверху. */
export async function getOrCreateDaily(key = dailyKey()): Promise<Doc> {
  const found = await db.docs.where('dailyDate').equals(key).first();
  if (found) return found;
  const folder = await dailyFolder();
  const doc = await createDoc('daily', folder, dailyTitle(key));
  const order = -Number(key.replace(/-/g, ''));
  await db.docs.update(doc.id, { dailyDate: key, order });
  return { ...doc, dailyDate: key, order };
}
