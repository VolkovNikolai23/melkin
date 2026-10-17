import { createEmptyCard } from 'ts-fsrs';
import { db } from '../../db/db';
import type { CardRow } from '../../db/schema';
import { parseCards, type ParsedCard } from './parser';

export const cardId = (blockId: string, key: string) => `${blockId}#${key}`;

export function newCardRow(blockId: string, docId: string, p: ParsedCard, now: number): CardRow {
  const e = createEmptyCard(new Date(now));
  return {
    id: cardId(blockId, p.key),
    blockId,
    docId,
    kind: p.kind,
    clozeIndex: p.clozeIndex,
    front: p.front,
    back: p.back,
    createdAt: now,
    due: e.due.getTime(),
    stability: e.stability,
    difficulty: e.difficulty,
    elapsed_days: e.elapsed_days,
    scheduled_days: e.scheduled_days,
    learning_steps: e.learning_steps,
    reps: e.reps,
    lapses: e.lapses,
    state: e.state,
    last_review: null,
  };
}

/**
 * Чистая функция: что нужно сделать с карточками блока после правки текста.
 * Карточки с тем же ключом обновляют только текст — расписание FSRS сохраняется.
 */
export function planCardSync(
  blockId: string,
  docId: string,
  parsed: ParsedCard[],
  existing: CardRow[],
  now: number,
): { put: CardRow[]; remove: string[] } {
  const byId = new Map(existing.map((c) => [c.id, c]));
  const put: CardRow[] = [];
  const keep = new Set<string>();
  for (const p of parsed) {
    const id = cardId(blockId, p.key);
    keep.add(id);
    const old = byId.get(id);
    if (!old) put.push(newCardRow(blockId, docId, p, now));
    else if (old.front !== p.front || old.back !== p.back || old.clozeIndex !== p.clozeIndex || old.docId !== docId) {
      put.push({ ...old, front: p.front, back: p.back, clozeIndex: p.clozeIndex, docId });
    }
  }
  const remove = existing.filter((c) => !keep.has(c.id)).map((c) => c.id);
  return { put, remove };
}

/** Пересобирает карточки блока по его текущему тексту. */
export async function syncBlockCards(blockId: string) {
  await db.transaction('rw', db.blocks, db.cards, async () => {
    const block = await db.blocks.get(blockId);
    const existing = await db.cards.where('blockId').equals(blockId).toArray();
    const parsed = block && block.kind === 'text' ? parseCards(block.text) : [];
    const { put, remove } = planCardSync(blockId, block?.docId ?? '', parsed, existing, Date.now());
    if (remove.length) await db.cards.bulkDelete(remove);
    if (put.length) await db.cards.bulkPut(put);
  });
}
