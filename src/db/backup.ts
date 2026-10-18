import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { resyncAllCards } from '../features/cards/sync';
import { AI_KEYS_META, db, getMeta, SCHEMA_VERSION, setMeta, TABLES, type TableName } from './db';
import { migrateBlockV1, migrateCardIdV1, migrateCardV1 } from './migrations';
import type { CardRow, FileRow, ReviewLogRow } from './schema';

export const BACKUP_FORMAT = 'melkin-backup';
export const BACKUP_REMIND_DAYS = 7;

/** Строка таблицы files в копии: вместо Blob — путь к файлу внутри zip. */
type FileMeta = Omit<FileRow, 'blob'> & { path: string };

export interface BackupData {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  data: Partial<Record<TableName, unknown[]>>;
}

/** Разобранная копия: данные + двоичные файлы по id. */
export interface Backup extends BackupData {
  blobs: Map<string, Blob>;
}

export function backupFileName(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `melkin-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.zip`;
}

/** Собирает .zip: data.json + files/<id> (картинки и PDF кладём без сжатия — они и так сжаты). */
export async function makeBackupFile(): Promise<File> {
  const data = {} as Record<TableName, unknown[]>;
  let files: FileRow[] = [];
  await db.transaction('r', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      if (t === 'files') files = await db.files.toArray();
      // ключи ИИ не кладём в копию: файл может оказаться в iCloud или у других людей
      else if (t === 'meta') data[t] = (await db.meta.toArray()).filter((m) => m.key !== AI_KEYS_META);
      else data[t] = await db.table(t).toArray();
    }
  });
  const zip: Zippable = {};
  data.files = files.map(({ blob: _blob, ...meta }) => ({ ...meta, path: `files/${meta.id}` }) satisfies FileMeta);
  for (const f of files) zip[`files/${f.id}`] = [new Uint8Array(await f.blob.arrayBuffer()), { level: 0 }];
  const json: BackupData = { format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data };
  zip['data.json'] = [strToU8(JSON.stringify(json)), { level: 6 }];
  return new File([zipSync(zip) as Uint8Array<ArrayBuffer>], backupFileName(), { type: 'application/zip' });
}

export async function markBackupDone() {
  await setMeta('lastBackupAt', Date.now());
}

export function getLastBackup() {
  return getMeta<number | null>('lastBackupAt', null);
}

/**
 * Отдаёт файл пользователю: на iPad — через системное меню «Поделиться» (там есть «Сохранить в Файлы»),
 * иначе — обычной загрузкой.
 */
export async function deliverFile(file: File): Promise<'shared' | 'downloaded' | 'cancelled' | 'needs-gesture'> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return 'shared';
    } catch (e) {
      const name = (e as DOMException)?.name;
      if (name === 'AbortError') return 'cancelled';
      // Safari требует свежий жест пользователя — попросим нажать ещё раз
      if (name === 'NotAllowedError') return 'needs-gesture';
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

function validate(obj: unknown): BackupData {
  const b = obj as Partial<BackupData>;
  if (!b || b.format !== BACKUP_FORMAT || typeof b.data !== 'object' || !b.data) throw new Error('Это не резервная копия Мелькина.');
  if ((b.schemaVersion ?? 0) > SCHEMA_VERSION) throw new Error('Копия создана более новой версией приложения. Обновите приложение и повторите.');
  for (const t of TABLES) if (!Array.isArray(b.data[t] ?? [])) throw new Error(`Повреждена таблица «${t}».`);
  return b as BackupData;
}

/** Читает копию: .zip (текущий формат) или .json (копии первой версии). */
export async function readBackup(file: Blob): Promise<Backup> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // «PK»
  if (!isZip) return parseBackup(new TextDecoder().decode(bytes));
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error('Архив повреждён.');
  }
  if (!entries['data.json']) throw new Error('В архиве нет data.json — это не копия Мелькина.');
  const data = validate(JSON.parse(strFromU8(entries['data.json'])));
  const blobs = new Map<string, Blob>();
  for (const f of (data.data.files ?? []) as FileMeta[]) {
    const raw = entries[f.path];
    if (raw) blobs.set(f.id, new Blob([raw as Uint8Array<ArrayBuffer>], { type: f.mime }));
  }
  return migrateBackup({ ...data, blobs });
}

export function parseBackup(text: string): Backup {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('Файл не является резервной копией (ни .zip, ни JSON).');
  }
  return migrateBackup({ ...validate(obj), blobs: new Map() });
}

/** Приводит старую копию к текущей схеме (те же преобразования, что и у Dexie upgrade). */
function migrateBackup(b: Backup): Backup {
  if (b.schemaVersion >= SCHEMA_VERSION) return b;
  const d = { ...b.data };
  if (b.schemaVersion < 2) {
    d.blocks = (d.blocks ?? []).map((x) => migrateBlockV1(x as Record<string, unknown>));
    d.cards = (d.cards ?? []).map((x) => migrateCardV1(x as Record<string, unknown>));
    d.reviewLogs = (d.reviewLogs ?? []).map((l) => ({ ...(l as ReviewLogRow), cardId: migrateCardIdV1((l as ReviewLogRow).cardId) }));
  }
  return { ...b, schemaVersion: SCHEMA_VERSION, data: d };
}

function fileRows(b: Backup): FileRow[] {
  return ((b.data.files ?? []) as FileMeta[])
    .filter((f) => b.blobs.has(f.id))
    .map(({ path: _path, ...meta }) => ({ ...meta, blob: b.blobs.get(meta.id)! }));
}

const newer = <T extends { updatedAt?: number }>(a: T, b: T) => ((b.updatedAt ?? 0) > (a.updatedAt ?? 0) ? b : a);

export async function importBackup(b: Backup, mode: 'replace' | 'merge') {
  const get = <T,>(t: TableName) => (t === 'files' ? fileRows(b) : (b.data[t] ?? [])) as T[];
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    if (mode === 'replace') {
      const keys = await db.meta.get(AI_KEYS_META); // ключи этого устройства не теряем
      for (const t of TABLES) {
        await db.table(t).clear();
        await db.table(t).bulkAdd(get(t));
      }
      if (keys) await db.meta.put(keys);
      return;
    }
    // Слияние: при совпадении id оставляем более свежую версию.
    for (const t of ['docs', 'blocks', 'pages', 'annotations', 'tests'] as const) {
      const incoming = get<{ id: string; updatedAt?: number }>(t);
      const ex = await db.table(t).bulkGet(incoming.map((r) => r.id));
      await db.table(t).bulkPut(incoming.map((r, i) => (ex[i] ? newer(ex[i], r) : r)));
    }
    const files = get<FileRow>('files');
    const exFiles = await db.files.bulkGet(files.map((f) => f.id));
    await db.files.bulkPut(files.filter((_, i) => !exFiles[i]));
    const cards = get<CardRow>('cards');
    const exCards = await db.cards.bulkGet(cards.map((c) => c.id));
    await db.cards.bulkPut(cards.map((c, i) => (exCards[i] && (exCards[i]!.last_review ?? 0) > (c.last_review ?? 0) ? exCards[i]! : c)));
    await db.reviewLogs.bulkPut(get<ReviewLogRow>('reviewLogs'));
    await db.testAttempts.bulkPut(get('testAttempts'));
    // meta (настройки, дата копии) берём только если своих нет
    for (const m of get<{ key: string; value: unknown }>('meta')) {
      if (!(await db.meta.get(m.key))) await db.meta.put(m);
    }
  });
  // Карточки пересобираем текущим парсером — на случай копии из старой версии
  await resyncAllCards();
}
