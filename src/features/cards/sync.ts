import { createEmptyCard } from 'ts-fsrs';
import { db } from '../../db/db';
import type { Block, CardRow } from '../../db/schema';
import { parseCards, type ParsedCard } from './parser';

export const cardId = (blockId: string, key: string) => `${blockId}#${key}`;

export function newCardRow(blockId: string, docId: string, p: ParsedCard, now: number, disabled = false): CardRow {
  const e = createEmptyCard(new Date(now));
  return {
    id: cardId(blockId, p.key),
    blockId,
    docId,
    kind: p.kind,
    clozeIndex: p.clozeIndex,
    sub: p.sub,
    front: p.front,
    back: p.back,
    concept: p.concept,
    disabled: disabled || undefined,
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

const CONTENT_FIELDS = ['kind', 'front', 'back', 'clozeIndex', 'sub', 'concept', 'docId', 'disabled'] as const;

/**
 * Чистая функция: что нужно сделать с карточками блока после правки текста.
 * Карточки с тем же ключом обновляют только содержимое — расписание FSRS сохраняется.
 */
export function planCardSync(
  blockId: string,
  docId: string,
  parsed: ParsedCard[],
  existing: CardRow[],
  now: number,
  disabled = false,
): { put: CardRow[]; remove: string[] } {
  const byId = new Map(existing.map((c) => [c.id, c]));
  const put: CardRow[] = [];
  const keep = new Set<string>();
  for (const p of parsed) {
    const id = cardId(blockId, p.key);
    keep.add(id);
    const old = byId.get(id);
    if (!old) {
      put.push(newCardRow(blockId, docId, p, now, disabled));
      continue;
    }
    const next: CardRow = { ...old, kind: p.kind, front: p.front, back: p.back, clozeIndex: p.clozeIndex, sub: p.sub, concept: p.concept, docId, disabled: disabled || undefined };
    if (CONTENT_FIELDS.some((f) => (old[f] ?? undefined) !== (next[f] ?? undefined))) put.push(next);
  }
  const remove = existing.filter((c) => !keep.has(c.id)).map((c) => c.id);
  return { put, remove };
}

async function syncOne(block: Block | undefined, blockId: string) {
  const existing = await db.cards.where('blockId').equals(blockId).toArray();
  let parsed: ParsedCard[] = [];
  if (block && block.kind === 'text') {
    const parent = block.parentId ? await db.blocks.get(block.parentId) : undefined;
    parsed = parseCards(block.text, { parentText: parent?.text });
  }
  // Карточки шаблонов не повторяем — они оживают в копиях
  const doc = block ? await db.docs.get(block.docId) : undefined;
  const off = !!block?.cardsOff || !!doc?.isTemplate;
  const { put, remove } = planCardSync(blockId, block?.docId ?? '', parsed, existing, Date.now(), off);
  if (remove.length) await db.cards.bulkDelete(remove);
  if (put.length) await db.cards.bulkPut(put);
}

/**
 * Пересобирает карточки блока по его текущему тексту.
 * Описания (;;) у дочерних блоков зависят от названия понятия-родителя — их тоже обновляем.
 */
export async function syncBlockCards(blockId: string) {
  await db.transaction('rw', db.blocks, db.cards, db.docs, async () => {
    const block = await db.blocks.get(blockId);
    await syncOne(block, blockId);
    if (!block) return;
    const kids = await db.blocks.where('parentId').equals(blockId).filter((b) => b.text.includes(';;')).toArray();
    for (const k of kids) await syncOne(k, k.id);
  });
}

/** Полная пересборка всех карточек (после миграции схемы или импорта). */
export async function resyncAllCards() {
  const ids = await db.blocks.toCollection().primaryKeys();
  for (const id of ids) await syncBlockCards(id as string);
}
