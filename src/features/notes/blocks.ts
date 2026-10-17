import { db } from '../../db/db';
import type { Block, BlockKind } from '../../db/schema';
import { orderBetween, uid } from '../../lib/id';
import { syncBlockCards } from '../cards/sync';
import { extractTags } from '../../lib/markup';

export const INK_WIDTH = 800;
export const INK_DEFAULT_HEIGHT = 320;

export const byOrder = (a: Block, b: Block) => a.order - b.order || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1);

/**
 * Соседи в порядке отображения. Если порядковые номера совпали или слишком сблизились
 * (дробные индексы исчерпались), перенумеровываем их — иначе вставка «между» не сработает.
 */
async function siblings(docId: string, parentId: string | null) {
  const list = (await db.blocks.where('docId').equals(docId).toArray()).filter((b) => b.parentId === parentId).sort(byOrder);
  if (list.some((b, i) => i > 0 && b.order - list[i - 1].order < 1e-6)) {
    list.forEach((b, i) => (b.order = i));
    await db.blocks.bulkUpdate(list.map((b) => ({ key: b.id, changes: { order: b.order } })));
  }
  return list;
}

function makeBlock(docId: string, parentId: string | null, order: number, kind: BlockKind, text = ''): Block {
  const now = Date.now();
  return {
    id: uid(),
    docId,
    parentId,
    order,
    kind,
    text,
    tags: extractTags(text),
    links: [],
    ink: kind === 'ink' ? { width: INK_WIDTH, height: INK_DEFAULT_HEIGHT, strokes: [] } : undefined,
    createdAt: now,
    updatedAt: now,
  };
}

async function touch(docId: string) {
  await db.docs.update(docId, { updatedAt: Date.now() });
}

export async function appendBlock(docId: string, kind: BlockKind = 'text', text = ''): Promise<Block> {
  const sibs = await siblings(docId, null);
  const b = makeBlock(docId, null, orderBetween(sibs.at(-1)?.order, undefined), kind, text);
  await db.blocks.add(b);
  await touch(docId);
  if (text) await syncBlockCards(b.id);
  return b;
}

/** Новый блок после данного (или первым ребёнком, если у данного есть раскрытые дети). */
export async function insertAfter(block: Block, text = '', kind: BlockKind = 'text', asChildIfOpen = true): Promise<Block> {
  const kids = await siblings(block.docId, block.id);
  let nb: Block;
  if (asChildIfOpen && kids.length && !block.collapsed) {
    nb = makeBlock(block.docId, block.id, orderBetween(undefined, kids[0].order), kind, text);
  } else {
    const sibs = await siblings(block.docId, block.parentId);
    const i = sibs.findIndex((s) => s.id === block.id);
    nb = makeBlock(block.docId, block.parentId, orderBetween(sibs[i].order, sibs[i + 1]?.order), kind, text);
  }
  await db.blocks.add(nb);
  await touch(block.docId);
  if (text) await syncBlockCards(nb.id);
  return nb;
}

export async function insertBefore(block: Block, text = ''): Promise<Block> {
  const sibs = await siblings(block.docId, block.parentId);
  const i = sibs.findIndex((s) => s.id === block.id);
  const nb = makeBlock(block.docId, block.parentId, orderBetween(sibs[i - 1]?.order, sibs[i].order), 'text', text);
  await db.blocks.add(nb);
  return nb;
}

export async function setText(id: string, text: string) {
  const b = await db.blocks.get(id);
  if (!b || b.text === text) return;
  await db.blocks.update(id, { text, tags: extractTags(text), updatedAt: Date.now() });
  await touch(b.docId);
  await syncBlockCards(id);
}

export async function indent(block: Block): Promise<boolean> {
  const sibs = await siblings(block.docId, block.parentId);
  const i = sibs.findIndex((s) => s.id === block.id);
  if (i <= 0) return false;
  const prev = sibs[i - 1];
  const kids = await siblings(block.docId, prev.id);
  await db.transaction('rw', db.blocks, async () => {
    await db.blocks.update(block.id, { parentId: prev.id, order: orderBetween(kids.at(-1)?.order, undefined) });
    await db.blocks.update(prev.id, { collapsed: false });
  });
  if (block.text.includes(';;')) await syncBlockCards(block.id);
  return true;
}

export async function outdent(block: Block): Promise<boolean> {
  if (!block.parentId) return false;
  const parent = await db.blocks.get(block.parentId);
  if (!parent) return false;
  const sibs = await siblings(block.docId, parent.parentId);
  const i = sibs.findIndex((s) => s.id === parent.id);
  await db.blocks.update(block.id, { parentId: parent.parentId, order: orderBetween(sibs[i].order, sibs[i + 1]?.order) });
  if (block.text.includes(';;')) await syncBlockCards(block.id);
  return true;
}

export async function moveBlock(block: Block, dir: -1 | 1) {
  const sibs = await siblings(block.docId, block.parentId);
  const i = sibs.findIndex((s) => s.id === block.id);
  const j = i + dir;
  if (j < 0 || j >= sibs.length) return;
  const other = sibs[j];
  await db.transaction('rw', db.blocks, async () => {
    await db.blocks.update(block.id, { order: other.order });
    await db.blocks.update(other.id, { order: sibs[i].order });
  });
}

export async function subtreeIds(block: Block): Promise<string[]> {
  const all = await db.blocks.where('docId').equals(block.docId).toArray();
  const ids = [block.id];
  for (let i = 0; i < ids.length; i++) for (const b of all) if (b.parentId === ids[i]) ids.push(b.id);
  return ids;
}

export async function deleteBlock(block: Block) {
  const ids = await subtreeIds(block);
  await db.transaction('rw', db.blocks, db.cards, async () => {
    await db.cards.where('blockId').anyOf(ids).delete();
    await db.blocks.bulkDelete(ids);
  });
  await touch(block.docId);
}

export function setBlockProps(id: string, patch: Partial<Pick<Block, 'heading' | 'list' | 'cardsOff'>>) {
  return db.blocks.update(id, { ...patch, updatedAt: Date.now() });
}

/** Перенос блока (перетаскиванием): перед/после другого блока или внутрь него. */
export async function moveBlockTo(id: string, targetId: string, pos: 'before' | 'after' | 'inside') {
  if (id === targetId) return;
  const block = await db.blocks.get(id);
  const target = await db.blocks.get(targetId);
  if (!block || !target || block.docId !== target.docId) return;
  if ((await subtreeIds(block)).includes(targetId)) return; // нельзя внутрь самого себя
  let parentId: string | null;
  let order: number;
  if (pos === 'inside') {
    const kids = (await siblings(block.docId, target.id)).filter((b) => b.id !== id);
    parentId = target.id;
    order = orderBetween(kids.at(-1)?.order, undefined);
    await db.blocks.update(target.id, { collapsed: false });
  } else {
    const sibs = (await siblings(block.docId, target.parentId)).filter((b) => b.id !== id);
    const i = sibs.findIndex((s) => s.id === target.id);
    const t = sibs[i].order; // свежий порядок (после возможной перенумерации)
    parentId = target.parentId;
    order = pos === 'before' ? orderBetween(sibs[i - 1]?.order, t) : orderBetween(t, sibs[i + 1]?.order);
  }
  await db.blocks.update(id, { parentId, order, updatedAt: Date.now() });
  // описание (;;) зависит от родителя — пересобираем карточки
  await syncBlockCards(id);
}

export function setCollapsed(id: string, collapsed: boolean) {
  return db.blocks.update(id, { collapsed });
}

export async function convertToInk(block: Block) {
  await db.blocks.update(block.id, {
    kind: 'ink',
    text: '',
    ink: { width: INK_WIDTH, height: INK_DEFAULT_HEIGHT, strokes: [] },
    updatedAt: Date.now(),
  });
  await syncBlockCards(block.id);
}

/** Строит дерево: parentId → отсортированные дети. */
export function childrenMap(blocks: Block[]): Map<string | null, Block[]> {
  const m = new Map<string | null, Block[]>();
  for (const b of blocks) {
    const arr = m.get(b.parentId) ?? [];
    arr.push(b);
    m.set(b.parentId, arr);
  }
  for (const arr of m.values()) arr.sort(byOrder);
  return m;
}

/** Видимые блоки в порядке отображения (с учётом свёрнутых). */
export function visibleOrder(kids: Map<string | null, Block[]>): Block[] {
  const out: Block[] = [];
  const walk = (pid: string | null) => {
    for (const b of kids.get(pid) ?? []) {
      out.push(b);
      if (!b.collapsed) walk(b.id);
    }
  };
  walk(null);
  return out;
}
