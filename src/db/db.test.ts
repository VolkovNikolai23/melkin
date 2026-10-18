import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { db, MelkinDB } from './db';
import { importBackup, makeBackupFile, readBackup } from './backup';
import { resyncAllCards } from '../features/cards/sync';

const now = Date.now();
const block = (id: string, text: string, parentId: string | null = null) => ({
  id, docId: 'd1', parentId, order: 0, kind: 'text', text, createdAt: now, updatedAt: now,
});

describe('миграция IndexedDB v1 → v2', () => {
  it('сохраняет данные, переписывает синтаксис и историю карточек', async () => {
    const name = 'migr-test';
    const v1 = new Dexie(name);
    v1.version(1).stores({
      docs: 'id, parentId, type, updatedAt', blocks: 'id, docId, parentId, updatedAt', pages: 'id, docId',
      cards: 'id, blockId, docId, due, state', reviewLogs: 'id, cardId, review', meta: 'key',
    });
    await v1.table('docs').add({ id: 'd1', parentId: null, type: 'note', title: 'Линал', order: 0, createdAt: now, updatedAt: now });
    await v1.table('blocks').bulkAdd([block('b1', 'Ранг ;; размерность #линал'), block('b2', 'q :: a')]);
    await v1.table('cards').bulkAdd([
      { id: 'b1#fwd', blockId: 'b1', docId: 'd1', kind: 'forward', front: 'Ранг', back: 'размерность', reps: 4, state: 2, due: now },
      { id: 'b1#rev', blockId: 'b1', docId: 'd1', kind: 'reverse', front: 'размерность', back: 'Ранг', reps: 7, state: 2, due: now },
    ]);
    await v1.table('reviewLogs').add({ id: 'l1', cardId: 'b1#rev', review: now });
    v1.close();

    const v2 = new MelkinDB(name);
    const blocks = await v2.blocks.toArray();
    expect(blocks.find((b) => b.id === 'b1')).toMatchObject({ text: 'Ранг <> размерность #линал', tags: ['линал'], links: [] });
    expect(blocks.find((b) => b.id === 'b2')!.text).toBe('q >> a');
    expect(await v2.cards.get('b1#bwd')).toMatchObject({ kind: 'backward', reps: 7 });
    expect(await v2.cards.get('b1#rev')).toBeUndefined();
    expect((await v2.reviewLogs.get('l1'))!.cardId).toBe('b1#bwd');
    expect((await v2.meta.get('resyncCards'))?.value).toBe(true);
    expect(await v2.blocks.where('tags').equals('линал').count()).toBe(1);
    v2.close();
  });
});

describe('миграция IndexedDB v2 → v3', () => {
  it('данные v2 открываются в v3 без изменений, появляются новые таблицы', async () => {
    const name = 'migr-v3';
    const v2 = new Dexie(name);
    v2.version(2).stores({
      docs: 'id, parentId, type, updatedAt, dailyDate', blocks: 'id, docId, parentId, updatedAt, *tags, *links, portalOf',
      pages: 'id, docId', files: 'id, kind', annotations: 'id, docId, [docId+page], blockId',
      cards: 'id, blockId, docId, due, state', reviewLogs: 'id, cardId, review', meta: 'key',
    });
    await v2.table('docs').add({ id: 'd', parentId: null, type: 'note', title: 'Старая', order: 0, createdAt: now, updatedAt: now });
    await v2.table('cards').add({ id: 'c', blockId: 'b', docId: 'd', kind: 'forward', front: 'q', back: 'a', reps: 3, state: 2, due: now });
    v2.close();
    const v3 = new MelkinDB(name);
    expect((await v3.docs.get('d'))!.title).toBe('Старая');
    expect((await v3.cards.get('c'))!.reps).toBe(3);
    expect(await v3.tests.count()).toBe(0);
    expect(await v3.docs.where('deletedAt').above(0).count()).toBe(0);
    v3.close();
  });
});

describe('резервная копия .zip', () => {
  it('экспорт → импорт с заменой возвращает те же данные, включая файлы', async () => {
    await db.docs.add({ id: 'd1', parentId: null, type: 'note', title: 'Матан', order: 0, createdAt: now, updatedAt: now });
    await db.blocks.bulkAdd([
      { ...block('p', 'Предел :: число, к которому…'), kind: 'text', tags: [], links: [] },
      { ...block('c', 'ε-δ ;; для любого ε…', 'p'), kind: 'text', tags: [], links: [] },
    ]);
    await db.files.add({ id: 'f1', kind: 'image', mime: 'image/png', name: 'a.png', size: 3, blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), createdAt: now });
    await resyncAllCards();
    expect(await db.cards.count()).toBe(3); // понятие (2) + описание (1)
    expect((await db.cards.get('c#fwd'))!.front).toBe('Предел → ε-δ');

    const file = await makeBackupFile();
    expect(file.name).toMatch(/\.zip$/);
    await db.delete();
    await db.open();
    expect(await db.docs.count()).toBe(0);

    await importBackup(await readBackup(file), 'replace');
    expect(await db.docs.count()).toBe(1);
    expect(await db.cards.count()).toBe(3);
    const f = await db.files.get('f1');
    expect(new Uint8Array(await f!.blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));

    // повторный импорт со слиянием ничего не дублирует
    await importBackup(await readBackup(file), 'merge');
    expect(await db.blocks.count()).toBe(2);
  });

  it('старая копия .json (v1) импортируется с миграцией', async () => {
    const json = JSON.stringify({
      format: 'melkin-backup', schemaVersion: 1, exportedAt: new Date().toISOString(),
      data: { docs: [], blocks: [block('x', 'a :: b')], pages: [], cards: [], reviewLogs: [], meta: [] },
    });
    const b = await readBackup(new Blob([json]));
    expect((b.data.blocks![0] as { text: string }).text).toBe('a >> b');
  });

  it('ключи ИИ не попадают в копию и не стираются при восстановлении', async () => {
    await db.meta.put({ key: 'aiKeys', value: { gemini: 'секрет' } });
    const file = await makeBackupFile();
    const b = await readBackup(file);
    expect((b.data.meta as { key: string }[]).some((m) => m.key === 'aiKeys')).toBe(false);
    await importBackup(b, 'replace');
    expect((await db.meta.get('aiKeys'))?.value).toEqual({ gemini: 'секрет' });
  });

  it('чужой файл отклоняется', async () => {
    await expect(readBackup(new Blob(['{"x":1}']))).rejects.toThrow('не резервная копия');
  });
});
