import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/db';
import { appendBlock, childrenMap, indent } from './blocks';
import { dailyKey, dailyTitle, getOrCreateDaily } from './daily';
import { createDoc } from './docs';
import { insertTemplate } from './templates';
import { resyncAllCards } from '../cards/sync';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('ежедневные заметки', () => {
  it('ключ и название дня', () => {
    expect(dailyKey(new Date(2026, 9, 17, 23, 50))).toBe('2026-10-17');
    expect(dailyTitle('2026-10-17')).toBe('17 октября 2026, суббота');
  });

  it('одна заметка на день, в общей папке', async () => {
    const a = await getOrCreateDaily('2026-10-17');
    const b = await getOrCreateDaily('2026-10-17');
    const c = await getOrCreateDaily('2026-10-18');
    expect(a.id).toBe(b.id);
    expect(a.parentId).toBe(c.parentId);
    expect(c.order).toBeLessThan(a.order); // новые дни выше
    expect(await db.docs.where('type').equals('daily').count()).toBe(2);
  });
});

describe('шаблоны', () => {
  it('копируют структуру после текущего блока; карточки шаблона отключены', async () => {
    const tpl = await createDoc('note', null, 'Шаблон лекции');
    await db.docs.update(tpl.id, { isTemplate: true });
    await appendBlock(tpl.id, 'text', 'Определения');
    const d = await appendBlock(tpl.id, 'text', 'Термин :: ');
    await indent(d);
    await resyncAllCards();
    expect((await db.cards.where('docId').equals(tpl.id).toArray()).every((c) => c.disabled)).toBe(true);

    const note = await createDoc('note', null, 'Лекция 1');
    const first = await appendBlock(note.id, 'text', 'Начало');
    await appendBlock(note.id, 'text', 'Конец');
    await insertTemplate(tpl.id, note.id, first);

    const kids = childrenMap(await db.blocks.where('docId').equals(note.id).toArray());
    expect((kids.get(null) ?? []).map((b) => b.text)).toEqual(['Начало', 'Определения', 'Конец']);
    const defs = kids.get(null)![1];
    expect((kids.get(defs.id) ?? []).map((b) => b.text)).toEqual(['Термин :: ']);
    const noteCards = await db.cards.where('docId').equals(note.id).toArray();
    expect(noteCards.length).toBe(1);
    expect(noteCards[0].disabled).toBeFalsy();
  });
});

describe('сброс карточки', () => {
  it('карточка снова новая, журнал повторений остаётся', async () => {
    const { answerCard } = await import('../review/data');
    const { resetCard } = await import('../cards/sync');
    const note = await createDoc('note', null, 'Н');
    await appendBlock(note.id, 'text', 'q >> a');
    const c = (await db.cards.toArray())[0];
    await answerCard(c, 3);
    expect((await db.cards.get(c.id))!.reps).toBe(1);
    await resetCard(c.id);
    expect(await db.cards.get(c.id)).toMatchObject({ reps: 0, state: 0, last_review: null });
    expect(await db.reviewLogs.where('cardId').equals(c.id).count()).toBe(1);
  });
});
