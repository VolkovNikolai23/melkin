import type { CardRow, ReviewLogRow } from '../../db/schema';
import { uid } from '../../lib/id';
import { answerLadder, isNewCard, previewLadder, RELEARN_DELAY_MS, State } from './ladder';

export { State };

/** Две кнопки (SPEC 3): «не знаю» = 1, «знаю» = 3 (числа совместимы со старым журналом). */
export type Grade = 1 | 3;
export const Rating = { DontKnow: 1, Know: 3 } as const;

export const GRADES: { rating: Grade; label: string; key: string }[] = [
  { rating: Rating.DontKnow, label: 'Не знаю', key: '1' },
  { rating: Rating.Know, label: 'Знаю', key: '2' },
];

/**
 * Сколько ждать карточки, которые скоро вернутся, прежде чем закончить сессию.
 * После «знаю» новая карточка возвращается через 15 минут — сессия её дождётся.
 */
export const LEARN_AHEAD_MS = 20 * 60 * 1000;

/** Применяет ответ: новое состояние карточки и запись в журнал. */
export function applyRating(row: CardRow, rating: Grade, now: number): { card: CardRow; log: ReviewLogRow } {
  const card = answerLadder(row, rating === Rating.Know, now);
  return {
    card,
    log: {
      id: uid(),
      cardId: row.id,
      rating,
      state: row.state,
      wasNew: isNewCard(row),
      review: now,
      due: card.due,
      stability: 0,
      difficulty: 0,
      scheduled_days: card.scheduled_days,
      learning_steps: card.step ?? 0,
    },
  };
}

/** Через сколько карточка вернётся при каждом ответе (для подписей на кнопках). */
export function previewIntervals(row: CardRow): Record<Grade, number> {
  const p = previewLadder(row);
  return { [Rating.Know]: p.know, [Rating.DontKnow]: p.dontKnow } as Record<Grade, number>;
}

export function formatInterval(ms: number): string {
  if (ms < 60000) return `${Math.max(1, Math.round(ms / 1000))} с`;
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} мин`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d} дн`;
  const mo = d / 30.4;
  if (mo < 12) return `${Math.round(mo * 10) / 10} мес`.replace('.', ',');
  return `${Math.round((d / 365) * 10) / 10} г`.replace('.', ',');
}

export const isNew = (c: CardRow) => isNewCard(c);

/** Сколько новых карточек ещё можно взять сегодня. */
export function newAllowance(newPerDay: number, newDoneToday: number) {
  return Math.max(0, newPerDay - newDoneToday);
}

export interface Session {
  /** Карточки в изучении/повторении, отсортированы по сроку */
  due: CardRow[];
  /** Новые карточки (уже с учётом дневного лимита) */
  fresh: CardRow[];
}

export function buildSession(all: CardRow[], now: number, newLimitLeft: number): Session {
  const cards = all.filter((c) => !c.disabled);
  const due = cards.filter((c) => !isNew(c) && c.due <= now).sort((a, b) => a.due - b.due);
  const fresh = cards
    .filter(isNew)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .slice(0, newLimitLeft);
  return { due, fresh };
}

/**
 * Следующая карточка: сначала те, чей срок наступил, затем новые. Карточку после «не знаю»
 * (вернётся через 30 с) показываем раньше срока, только если больше показывать нечего.
 */
export function pickNext(s: Session, now: number): CardRow | null {
  const ready = s.due.find((c) => c.due <= now);
  if (ready) return ready;
  if (s.fresh.length) return s.fresh[0];
  const relearn = s.due.find((c) => c.relearnFrom !== undefined && c.relearnFrom !== null && c.due <= now + RELEARN_DELAY_MS);
  return relearn ?? null;
}

/** Экспресс-повтор перед экзаменом: все карточки подряд, без графика (порядок перемешан). */
export function buildExpressSession(all: CardRow[], seed = Math.random): Session {
  const cards = all.filter((c) => !c.disabled);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(seed() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return { due: [], fresh: cards };
}

/** Экспресс: «знаю» — карточка уходит, «не знаю» — вернётся через ~30 с. График не меняется. */
export function afterExpressAnswer(s: Session, card: CardRow, known: boolean, now: number): Session {
  const fresh = s.fresh.filter((c) => c.id !== card.id);
  const due = s.due.filter((c) => c.id !== card.id);
  if (!known) due.push({ ...card, due: now + RELEARN_DELAY_MS, relearnFrom: card.step ?? 0 });
  return { due: due.sort((a, b) => a.due - b.due), fresh };
}

/** Обновляет сессию после ответа: карточка, которая скоро снова нужна, возвращается в очередь. */
export function afterAnswer(s: Session, updated: CardRow, now: number): Session {
  const due = s.due.filter((c) => c.id !== updated.id);
  const fresh = s.fresh.filter((c) => c.id !== updated.id);
  if (updated.due <= now + LEARN_AHEAD_MS) {
    due.push(updated);
    due.sort((a, b) => a.due - b.due);
  }
  return { due, fresh };
}

export function sessionCounts(s: Session, now: number) {
  return {
    fresh: s.fresh.length,
    learning: s.due.filter((c) => c.state === State.Learning || c.state === State.Relearning).length,
    review: s.due.filter((c) => c.state === State.Review && c.due <= now).length,
  };
}

/** Число карточек «к повторению сегодня» для главного экрана. */
export function countDueToday(cards: CardRow[], now: number, newLimitLeft: number) {
  let due = 0;
  let fresh = 0;
  for (const c of cards) {
    if (c.disabled) continue;
    if (isNew(c)) fresh++;
    else if (c.due <= now) due++;
  }
  return { due, fresh: Math.min(fresh, newLimitLeft), total: due + Math.min(fresh, newLimitLeft) };
}

export interface DueCount {
  /** Карточки повторения/изучения, срок которых наступил */
  due: number;
  /** Новые карточки (без учёта дневного лимита) */
  fresh: number;
}

/** Сколько карточек к повторению в каждом документе. */
export function dueByDoc(cards: CardRow[], now: number): Map<string, DueCount> {
  const m = new Map<string, DueCount>();
  for (const c of cards) {
    if (c.disabled) continue;
    const isFresh = isNew(c);
    if (!isFresh && c.due > now) continue;
    const e = m.get(c.docId) ?? { due: 0, fresh: 0 };
    if (isFresh) e.fresh++;
    else e.due++;
    m.set(c.docId, e);
  }
  return m;
}

/** Сумма по набору документов (папка = все вложенные документы). */
export function sumDue(byDoc: Map<string, DueCount>, docIds: Iterable<string>): DueCount {
  const s = { due: 0, fresh: 0 };
  for (const id of docIds) {
    const e = byDoc.get(id);
    if (e) {
      s.due += e.due;
      s.fresh += e.fresh;
    }
  }
  return s;
}

/** Число для значка: просроченные + новые в пределах оставшегося дневного лимита. */
export const badgeCount = (d: DueCount, newLimitLeft: number) => d.due + Math.min(d.fresh, newLimitLeft);
