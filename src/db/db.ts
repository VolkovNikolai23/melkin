import Dexie, { type EntityTable } from 'dexie';
import type { AiCacheRow, Annotation, Block, CardRow, Doc, FileRow, MetaRow, Page, ReviewLogRow, Settings, TestAttempt, TestRow } from './schema';
import { DEFAULT_SETTINGS } from './schema';
import { migrateBlockV1, migrateCardIdV1, migrateCardV1 } from './migrations';
import { migrateCardToLadder } from '../features/review/ladder';

export class MelkinDB extends Dexie {
  docs!: EntityTable<Doc, 'id'>;
  blocks!: EntityTable<Block, 'id'>;
  pages!: EntityTable<Page, 'id'>;
  files!: EntityTable<FileRow, 'id'>;
  annotations!: EntityTable<Annotation, 'id'>;
  tests!: EntityTable<TestRow, 'id'>;
  testAttempts!: EntityTable<TestAttempt, 'id'>;
  cards!: EntityTable<CardRow, 'id'>;
  reviewLogs!: EntityTable<ReviewLogRow, 'id'>;
  meta!: EntityTable<MetaRow, 'key'>;
  aiCache!: EntityTable<AiCacheRow, 'key'>;

  constructor(name = 'melkin') {
    super(name);
    // Схема версионируется. Чтобы изменить её, НЕ правьте существующие версии, а добавьте
    // следующую: version(N).stores({...}).upgrade(tx => ...) — Dexie сам перенесёт данные.
    // Тот же перенос нужно добавить в db/migrations.ts для импорта старых копий.
    this.version(1).stores({
      docs: 'id, parentId, type, updatedAt',
      blocks: 'id, docId, parentId, updatedAt',
      pages: 'id, docId',
      cards: 'id, blockId, docId, due, state',
      reviewLogs: 'id, cardId, review',
      meta: 'key',
    });
    // v2: файлы (картинки, PDF), аннотации PDF, теги/ссылки/порталы у блоков,
    // ежедневные заметки; синтаксис карточек как в RemNote.
    this.version(2)
      .stores({
        docs: 'id, parentId, type, updatedAt, dailyDate',
        blocks: 'id, docId, parentId, updatedAt, *tags, *links, portalOf',
        pages: 'id, docId',
        files: 'id, kind',
        annotations: 'id, docId, [docId+page], blockId',
        cards: 'id, blockId, docId, due, state',
        reviewLogs: 'id, cardId, review',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx.table('blocks').toCollection().modify((b: Record<string, unknown>) => Object.assign(b, migrateBlockV1(b)));
        const cards = tx.table('cards');
        for (const c of await cards.toArray()) {
          const m = migrateCardV1(c);
          if (m.id !== c.id) {
            await cards.delete(c.id);
            await cards.put(m);
          } else if (m.kind !== c.kind) await cards.put(m);
        }
        await tx.table('reviewLogs').toCollection().modify((l: { cardId: string }) => {
          l.cardId = migrateCardIdV1(l.cardId);
        });
        // Содержимое карточек пересоберём новым парсером при запуске (см. main.tsx)
        await tx.table('meta').put({ key: 'resyncCards', value: true });
      });
    // v3 (SPEC.md): лекции, роли и иконки папок, корзина, тесты. Новые поля необязательные —
    // существующие записи переносить не нужно, добавляются только таблицы и индексы.
    this.version(3).stores({
      docs: 'id, parentId, type, updatedAt, dailyDate, deletedAt',
      blocks: 'id, docId, parentId, updatedAt, *tags, *links, portalOf',
      pages: 'id, docId',
      files: 'id, kind',
      annotations: 'id, docId, [docId+page], blockId',
      cards: 'id, blockId, docId, due, state',
      reviewLogs: 'id, cardId, review',
      tests: 'id, docId, updatedAt',
      testAttempts: 'id, testId, docId, at',
      meta: 'key',
    });
    // v4: повторение по лестнице интервалов вместо FSRS. История FSRS переводится в ступени
    // (сроки повторения сохраняются); признак «двусторонняя» проставит пересборка карточек.
    this.version(4)
      .stores({
        docs: 'id, parentId, type, updatedAt, dailyDate, deletedAt',
        blocks: 'id, docId, parentId, updatedAt, *tags, *links, portalOf',
        pages: 'id, docId',
        files: 'id, kind',
        annotations: 'id, docId, [docId+page], blockId',
        cards: 'id, blockId, docId, due, state',
        reviewLogs: 'id, cardId, review',
        tests: 'id, docId, updatedAt',
        testAttempts: 'id, testId, docId, at',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx.table('cards').toCollection().modify((c: CardRow) => Object.assign(c, migrateCardToLadder(c)));
        await tx.table('meta').put({ key: 'resyncCards', value: true });
      });
    // v5: тетради — индекс [docId+order], чтобы список страниц читался без самих штрихов
    // (у больших тетрадей это мегабайты). Новые поля листа (бумага, объекты) необязательные.
    this.version(5).stores({
      docs: 'id, parentId, type, updatedAt, dailyDate, deletedAt',
      blocks: 'id, docId, parentId, updatedAt, *tags, *links, portalOf',
      pages: 'id, docId, [docId+order]',
      files: 'id, kind',
      annotations: 'id, docId, [docId+page], blockId',
      cards: 'id, blockId, docId, due, state',
      reviewLogs: 'id, cardId, review',
      tests: 'id, docId, updatedAt',
      testAttempts: 'id, testId, docId, at',
      meta: 'key',
    });
    // v6: кэш ответов ИИ (не входит в резервную копию — он пересоздаётся)
    this.version(6).stores({
      docs: 'id, parentId, type, updatedAt, dailyDate, deletedAt',
      blocks: 'id, docId, parentId, updatedAt, *tags, *links, portalOf',
      pages: 'id, docId, [docId+order]',
      files: 'id, kind',
      annotations: 'id, docId, [docId+page], blockId',
      cards: 'id, blockId, docId, due, state',
      reviewLogs: 'id, cardId, review',
      tests: 'id, docId, updatedAt',
      testAttempts: 'id, testId, docId, at',
      meta: 'key',
      aiCache: 'key, createdAt',
    });
  }
}

export const SCHEMA_VERSION = 6;

export const db = new MelkinDB();

export const TABLES = ['docs', 'blocks', 'pages', 'files', 'annotations', 'cards', 'reviewLogs', 'tests', 'testAttempts', 'meta'] as const;
export type TableName = (typeof TABLES)[number];

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return row ? (row.value as T) : fallback;
}

export function setMeta(key: string, value: unknown) {
  return db.meta.put({ key, value });
}

export async function getSettings(): Promise<Settings> {
  const saved = await getMeta<Partial<Settings>>('settings', {});
  return { ...DEFAULT_SETTINGS, ...saved, aiModel: { ...DEFAULT_SETTINGS.aiModel, ...saved.aiModel } };
}

/** Ключи ИИ живут только на этом устройстве: в резервную копию не попадают. */
export const AI_KEYS_META = 'aiKeys';

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
