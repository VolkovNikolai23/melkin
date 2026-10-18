import { db } from '../../db/db';
import type { Block, CardRow } from '../../db/schema';
import { occlusionCards, parseCards, type ParsedCard } from './parser';

export const cardId = (blockId: string, key: string) => `${blockId}#${key}`;

/** Поля повторения новой карточки (лестница интервалов: ступени ещё нет). */
export function emptySchedule(now: number) {
  return {
    due: now,
    step: null,
    relearnFrom: undefined,
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    last_review: null,
  };
}

export function newCardRow(blockId: string, docId: string, p: ParsedCard, now: number, disabled = false): CardRow {
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
    twoSided: p.twoSided,
    disabled: disabled || undefined,
    createdAt: now,
    ...emptySchedule(now),
  };
}

const CONTENT_FIELDS = ['kind', 'front', 'back', 'clozeIndex', 'sub', 'concept', 'twoSided', 'docId', 'disabled'] as const;

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
    const next: CardRow = { ...old, kind: p.kind, front: p.front, back: p.back, clozeIndex: p.clozeIndex, sub: p.sub, concept: p.concept, twoSided: p.twoSided, docId, disabled: disabled || undefined };
    if (CONTENT_FIELDS.some((f) => (old[f] ?? undefined) !== (next[f] ?? undefined))) put.push(next);
  }
  const remove = existing.filter((c) => !keep.has(c.id)).map((c) => c.id);
  return { put, remove };
}

async function syncOne(block: Block | undefined, blockId: string) {
  const existing = await db.cards.where('blockId').equals(blockId).toArray();
  let parsed: ParsedCard[] = [];
  if (block && (block.kind === 'text' || block.kind === 'image')) {
    const parent = block.parentId ? await db.blocks.get(block.parentId) : undefined;
    parsed = block.kind === 'text' ? parseCards(block.text, { parentText: parent?.text }) : occlusionCards(block.image, { parentText: parent?.text });
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
    // дети, чей текст карточки зависит от родителя: описания (;;) и области на картинках
    const kids = await db.blocks
      .where('parentId')
      .equals(blockId)
      .filter((b) => b.text.includes(';;') || !!b.image?.occlusions?.length)
      .toArray();
    for (const k of kids) await syncOne(k, k.id);
  });
}

/**
 * Полная пересборка всех карточек (после миграции схемы или импорта).
 * Один проход и одна транзакция: на тысячах блоков это в десятки раз быстрее поблочной синхронизации.
 */
export async function resyncAllCards() {
  await db.transaction('rw', db.blocks, db.cards, db.docs, async () => {
    const [blocks, cards, docs] = await Promise.all([db.blocks.toArray(), db.cards.toArray(), db.docs.toArray()]);
    const byId = new Map(blocks.map((b) => [b.id, b]));
    const templates = new Set(docs.filter((d) => d.isTemplate).map((d) => d.id));
    const cardsByBlock = new Map<string, CardRow[]>();
    for (const c of cards) cardsByBlock.set(c.blockId, [...(cardsByBlock.get(c.blockId) ?? []), c]);
    const now = Date.now();
    const put: CardRow[] = [];
    const remove: string[] = [];
    for (const b of blocks) {
      const parentText = b.parentId ? byId.get(b.parentId)?.text : undefined;
      const parsed = b.kind === 'text' ? parseCards(b.text, { parentText }) : b.kind === 'image' ? occlusionCards(b.image, { parentText }) : [];
      const plan = planCardSync(b.id, b.docId, parsed, cardsByBlock.get(b.id) ?? [], now, !!b.cardsOff || templates.has(b.docId));
      put.push(...plan.put);
      remove.push(...plan.remove);
      cardsByBlock.delete(b.id);
    }
    // карточки удалённых блоков
    for (const rest of cardsByBlock.values()) remove.push(...rest.map((c) => c.id));
    if (remove.length) await db.cards.bulkDelete(remove);
    if (put.length) await db.cards.bulkPut(put);
  });
}

/** Сбросить прогресс карточки: она снова станет новой (журнал повторений сохраняется). */
export async function resetCard(id: string) {
  if (!(await db.cards.get(id))) return;
  await db.cards.update(id, emptySchedule(Date.now()));
}
