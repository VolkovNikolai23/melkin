import { db, getMeta, SCHEMA_VERSION, setMeta, TABLES, type TableName } from './db';
import type { Block, CardRow, Doc, Page } from './schema';

export const BACKUP_FORMAT = 'melkin-backup';
export const BACKUP_REMIND_DAYS = 7;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  data: Record<TableName, unknown[]>;
}

export async function exportAll(): Promise<BackupFile> {
  const data = {} as Record<TableName, unknown[]>;
  await db.transaction('r', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) data[t] = await db.table(t).toArray();
  });
  return { format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data };
}

export function backupFileName(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `melkin-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

export async function makeBackupFile(): Promise<File> {
  const json = JSON.stringify(await exportAll());
  return new File([json], backupFileName(), { type: 'application/json' });
}

export async function markBackupDone() {
  await setMeta('lastBackupAt', Date.now());
}

export function getLastBackup() {
  return getMeta<number | null>('lastBackupAt', null);
}

/**
 * Отдаёт файл пользователю: на iPad — через системное меню «Поделиться» (там есть «Сохранить в Файлы»),
 * иначе — обычной загрузкой. Возвращает 'shared' | 'downloaded' | 'cancelled' | 'needs-gesture'.
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

export function parseBackup(text: string): BackupFile {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('Файл не является JSON.');
  }
  const b = obj as Partial<BackupFile>;
  if (!b || b.format !== BACKUP_FORMAT || typeof b.data !== 'object' || !b.data) {
    throw new Error('Это не резервная копия Мелькина.');
  }
  if ((b.schemaVersion ?? 0) > SCHEMA_VERSION) {
    throw new Error('Копия создана более новой версией приложения. Обновите приложение и повторите.');
  }
  for (const t of TABLES) if (!Array.isArray(b.data[t] ?? [])) throw new Error(`Повреждена таблица «${t}».`);
  return migrateBackup(b as BackupFile);
}

/** Здесь будут преобразования старых копий при изменении схемы (schemaVersion < текущей). */
function migrateBackup(b: BackupFile): BackupFile {
  return b;
}

const newer = <T extends { updatedAt?: number }>(a: T, b: T) => ((b.updatedAt ?? 0) > (a.updatedAt ?? 0) ? b : a);

export async function importBackup(b: BackupFile, mode: 'replace' | 'merge') {
  const get = <T,>(t: TableName) => (b.data[t] ?? []) as T[];
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    if (mode === 'replace') {
      for (const t of TABLES) {
        await db.table(t).clear();
        await db.table(t).bulkAdd(get(t));
      }
      return;
    }
    // Слияние: при совпадении id оставляем более свежую версию.
    for (const t of ['docs', 'blocks', 'pages'] as const) {
      const incoming = get<Doc | Block | Page>(t);
      const existing = new Map((await db.table(t).bulkGet(incoming.map((r) => r.id))).filter(Boolean).map((r: Doc) => [r.id, r]));
      await db.table(t).bulkPut(incoming.map((r) => (existing.has(r.id) ? newer(existing.get(r.id)!, r as Doc) : r)));
    }
    const cards = get<CardRow>('cards');
    const exCards = new Map((await db.cards.bulkGet(cards.map((c) => c.id))).filter(Boolean).map((c) => [c!.id, c!]));
    await db.cards.bulkPut(
      cards.map((c) => {
        const e = exCards.get(c.id);
        return e && (e.last_review ?? 0) > (c.last_review ?? 0) ? e : c;
      }),
    );
    await db.reviewLogs.bulkPut(get('reviewLogs') as never[]);
    // meta (настройки, дата копии) берём только если своих нет
    for (const m of get<{ key: string; value: unknown }>('meta')) {
      if (!(await db.meta.get(m.key))) await db.meta.put(m);
    }
  });
}
