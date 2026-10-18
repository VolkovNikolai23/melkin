import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/db';
import { appendBlock } from './blocks';
import { createDoc, createFolder, emptyTrash, liveDocs, purgeExpired, restoreDoc, trashDoc, trashedDocIds } from './docs';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('структура Предмет → Тема → Лекция', () => {
  it('у лекции сразу есть конспект-тетрадка', async () => {
    const subj = await createFolder('subject', null, 'Биология');
    const topic = await createFolder('topic', subj.id, 'Клетка');
    const lec = await createDoc('lecture', topic.id, 'Лекция 1. Мембрана');
    const fresh = (await db.docs.get(lec.id))!;
    const nb = await db.docs.get(fresh.lecture!.notebookId!);
    expect(subj).toMatchObject({ type: 'folder', role: 'subject', icon: 'book' });
    expect(nb).toMatchObject({ type: 'notebook', parentId: lec.id, title: 'Конспект' });
    expect(await db.pages.where('docId').equals(nb!.id).count()).toBe(1);
  });
});

describe('корзина', () => {
  it('удаление прячет документ с вложенными, восстановление возвращает', async () => {
    const f = await createFolder('topic', null, 'Тема');
    const n = await createDoc('note', f.id, 'Заметка');
    await appendBlock(n.id, 'text', 'q >> a');
    await trashDoc(f.id);
    expect((await liveDocs()).map((d) => d.title)).toEqual([]);
    expect(await trashedDocIds()).toEqual(new Set([f.id, n.id]));
    expect(await db.cards.count()).toBe(1); // карточки и история не теряются
    await restoreDoc(f.id);
    expect((await liveDocs()).length).toBe(2);
    expect((await trashedDocIds()).size).toBe(0);
  });

  it('восстанавливается только то, что удалено тем же действием', async () => {
    const f = await createFolder('topic', null, 'Тема');
    const a = await createDoc('note', f.id, 'A');
    await trashDoc(a.id); // сначала удалили одну заметку
    await new Promise((r) => setTimeout(r, 5));
    await trashDoc(f.id); // потом всю тему
    await restoreDoc(f.id);
    expect((await db.docs.get(a.id))!.deletedAt).toBeTruthy(); // A осталась в корзине
    await restoreDoc(a.id);
    expect((await db.docs.get(a.id))!.deletedAt).toBeUndefined();
  });

  it('через 30 дней удаляется насовсем вместе с карточками', async () => {
    const n = await createDoc('note', null, 'Старое');
    await appendBlock(n.id, 'text', 'q >> a');
    await trashDoc(n.id);
    await purgeExpired(Date.now() + 29 * 86400000);
    expect(await db.docs.count()).toBe(1);
    await purgeExpired(Date.now() + 31 * 86400000);
    expect(await db.docs.count()).toBe(0);
    expect(await db.cards.count()).toBe(0);
    expect(await db.blocks.count()).toBe(0);
  });

  it('очистка корзины', async () => {
    await trashDoc((await createDoc('note', null, 'x')).id);
    await createDoc('note', null, 'y');
    await emptyTrash();
    expect((await db.docs.toArray()).map((d) => d.title)).toEqual(['y']);
  });
});
