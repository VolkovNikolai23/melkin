import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/db';
import { childrenMap } from './blocks';
import { createDoc } from './docs';
import { BUILTIN_TEMPLATES, insertTemplate } from './templates';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('встроенные шаблоны', () => {
  it('«Лекция» вставляет структуру с заголовками и формулой, без карточек-пустышек', async () => {
    const note = await createDoc('note', null, 'Лекция 3');
    const ids = await insertTemplate('builtin:lecture', note.id, null);
    const blocks = await db.blocks.where('docId').equals(note.id).toArray();
    expect(blocks.length).toBe(ids.length);
    const roots = (childrenMap(blocks).get(null) ?? []).map((b) => [b.text, b.heading]);
    expect(roots[0]).toEqual(['Тема лекции', 1]);
    expect(roots.some((r) => String(r[0]).startsWith('Вопросы для повторения'))).toBe(true);
    expect(blocks.some((b) => b.text === '$\\ce{}$')).toBe(true);
    // шаблон не создаёт пустых карточек
    expect(await db.cards.where('docId').equals(note.id).count()).toBe(0);
  });

  it('у каждого встроенного шаблона уникальный id', () => {
    expect(new Set(BUILTIN_TEMPLATES.map((t) => t.id)).size).toBe(BUILTIN_TEMPLATES.length);
  });
});
