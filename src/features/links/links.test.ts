import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/db';
import { createDoc, renameDoc } from '../notes/docs';
import { appendBlock, setText } from '../notes/blocks';
import { normTitle, renameLinkInText, resolveLinks } from './links';

const docs = [
  { id: 'a', title: 'Ранг матрицы', type: 'note' as const },
  { id: 'f', title: 'Папка', type: 'folder' as const },
];

describe('ссылки — чистые функции', () => {
  it('находит документы по названию без учёта регистра и пробелов', () => {
    expect(resolveLinks('см. [[ранг  Матрицы]] и [[Нет такого]]', docs)).toEqual(['a']);
    expect(normTitle('  Ранг   Матрицы ')).toBe('ранг матрицы');
  });

  it('папки не являются целью ссылки, формулы и код не разбираются', () => {
    expect(resolveLinks('[[Папка]] `[[Ранг матрицы]]`', docs)).toEqual([]);
  });

  it('переименование ссылки в тексте', () => {
    expect(renameLinkInText('[[ранг матрицы]] и [[Другое]] $[[x]]$', 'Ранг матрицы', 'Ранг')).toBe('[[Ранг]] и [[Другое]] $[[x]]$');
  });
});

describe('ссылки и обратные ссылки в базе', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('ссылка на ещё не созданный документ привязывается после его создания', async () => {
    const src = await createDoc('note', null, 'Конспект');
    const b = await appendBlock(src.id, 'text', 'см. [[Ядро]]');
    expect((await db.blocks.get(b.id))!.links).toEqual([]);
    const target = await createDoc('note', null, 'Ядро');
    expect((await db.blocks.get(b.id))!.links).toEqual([target.id]);
    expect(await db.blocks.where('links').equals(target.id).count()).toBe(1);
  });

  it('переименование документа обновляет текст ссылок', async () => {
    const target = await createDoc('note', null, 'Ядро');
    const src = await createDoc('note', null, 'Конспект');
    const b = await appendBlock(src.id, 'text', 'x');
    await setText(b.id, 'см. [[ядро]] #линал');
    await renameDoc(target.id, 'Ядро отображения');
    const after = (await db.blocks.get(b.id))!;
    expect(after.text).toBe('см. [[Ядро отображения]] #линал');
    expect(after.links).toEqual([target.id]);
  });
});
