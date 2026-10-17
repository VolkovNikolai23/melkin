import Dexie, { type EntityTable } from 'dexie';
import type { Block, CardRow, Doc, MetaRow, Page, ReviewLogRow, Settings } from './schema';
import { DEFAULT_SETTINGS } from './schema';

export class MelkinDB extends Dexie {
  docs!: EntityTable<Doc, 'id'>;
  blocks!: EntityTable<Block, 'id'>;
  pages!: EntityTable<Page, 'id'>;
  cards!: EntityTable<CardRow, 'id'>;
  reviewLogs!: EntityTable<ReviewLogRow, 'id'>;
  meta!: EntityTable<MetaRow, 'key'>;

  constructor(name = 'melkin') {
    super(name);
    // Схема версионируется. Чтобы изменить её, НЕ правьте version(1), а добавьте
    // version(2).stores({...}).upgrade(tx => ...) — Dexie сам перенесёт данные.
    this.version(1).stores({
      docs: 'id, parentId, type, updatedAt',
      blocks: 'id, docId, parentId, updatedAt',
      pages: 'id, docId',
      cards: 'id, blockId, docId, due, state',
      reviewLogs: 'id, cardId, review',
      meta: 'key',
    });
  }
}

export const SCHEMA_VERSION = 1;

export const db = new MelkinDB();

export const TABLES = ['docs', 'blocks', 'pages', 'cards', 'reviewLogs', 'meta'] as const;
export type TableName = (typeof TABLES)[number];

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return row ? (row.value as T) : fallback;
}

export function setMeta(key: string, value: unknown) {
  return db.meta.put({ key, value });
}

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await getMeta<Partial<Settings>>('settings', {})) };
}

export async function saveSettings(patch: Partial<Settings>) {
  const cur = await getSettings();
  await setMeta('settings', { ...cur, ...patch });
}

/** Просим браузер не вычищать IndexedDB при нехватке места. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* браузер не поддерживает — ничего страшного */
  }
  return false;
}
