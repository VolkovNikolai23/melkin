import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/db';
import { appendBlock, childrenMap, indent, insertAfter, moveBlockTo, outdent } from './blocks';

const texts = async (parentId: string | null = null) =>
  (childrenMap(await db.blocks.toArray()).get(parentId) ?? []).map((b) => b.text);
const byText = async (t: string) => (await db.blocks.filter((b) => b.text === t).first())!;

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('операции с блоками', () => {
  it('Enter вставляет блок сразу после текущего', async () => {
    const a = await appendBlock('d', 'text', 'a');
    await appendBlock('d', 'text', 'c');
    await insertAfter(a, 'b');
    expect(await texts()).toEqual(['a', 'b', 'c']);
  });

  it('Tab / Shift+Tab', async () => {
    await appendBlock('d', 'text', 'a');
    const b = await appendBlock('d', 'text', 'b');
    await indent(b);
    const a = await byText('a');
    expect(await texts(a.id)).toEqual(['b']);
    await outdent(await byText('b'));
    expect(await texts()).toEqual(['a', 'b']);
  });

  it('перетаскивание: до, после и внутрь', async () => {
    for (const t of ['a', 'b', 'c']) await appendBlock('d', 'text', t);
    await moveBlockTo((await byText('a')).id, (await byText('c')).id, 'after');
    expect(await texts()).toEqual(['b', 'c', 'a']);
    await moveBlockTo((await byText('a')).id, (await byText('b')).id, 'before');
    expect(await texts()).toEqual(['a', 'b', 'c']);
    await moveBlockTo((await byText('c')).id, (await byText('a')).id, 'inside');
    expect(await texts()).toEqual(['a', 'b']);
    expect(await texts((await byText('a')).id)).toEqual(['c']);
  });

  it('нельзя перенести блок внутрь собственного потомка', async () => {
    await appendBlock('d', 'text', 'a');
    const b = await appendBlock('d', 'text', 'b');
    await indent(b);
    await moveBlockTo((await byText('a')).id, b.id, 'inside');
    expect(await texts()).toEqual(['a']);
  });

  it('работает даже при совпавших порядковых номерах', async () => {
    for (const t of ['a', 'b', 'c']) await appendBlock('d', 'text', t);
    await db.blocks.toCollection().modify({ order: 5 });
    await moveBlockTo((await byText('a')).id, (await byText('b')).id, 'after');
    expect(await texts()).toEqual(['b', 'a', 'c']);
  });
});
