import { fsrs, generatorParameters, Rating, State, type Card, type Grade } from 'ts-fsrs';
import type { CardRow, ReviewLogRow } from '../../db/schema';
import { uid } from '../../lib/id';

export { Rating, State };
export type { Grade };

export const GRADES: { rating: Grade; label: string }[] = [
  { rating: Rating.Again, label: 'Снова' },
  { rating: Rating.Hard, label: 'Трудно' },
  { rating: Rating.Good, label: 'Хорошо' },
  { rating: Rating.Easy, label: 'Легко' },
];

/** Сколько можно «заглянуть вперёд» за карточками в изучении, если остальное закончилось. */
export const LEARN_AHEAD_MS = 20 * 60 * 1000;

const scheduler = fsrs(generatorParameters({ enable_fuzz: true, enable_short_term: true }));

export function toFsrsCard(c: CardRow): Card {
  return {
    due: new Date(c.due),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as State,
    last_review: c.last_review ? new Date(c.last_review) : undefined,
  };
}

function fromFsrsCard(row: CardRow, c: Card): CardRow {
  return {
    ...row,
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review ? c.last_review.getTime() : null,
  };
}

/** Применяет оценку: новое состояние карточки и запись в журнал. */
export function applyRating(row: CardRow, rating: Grade, now: number): { card: CardRow; log: ReviewLogRow } {
  const { card, log } = scheduler.next(toFsrsCard(row), new Date(now), rating);
  return {
    card: fromFsrsCard(row, card),
    log: {
      id: uid(),
      cardId: row.id,
      rating,
      state: log.state,
      wasNew: row.state === State.New,
      review: now,
      due: log.due.getTime(),
      stability: log.stability,
      difficulty: log.difficulty,
      scheduled_days: log.scheduled_days,
      learning_steps: log.learning_steps,
    },
  };
}

/** Через сколько карточка вернётся при каждой оценке (для подписей на кнопках). */
export function previewIntervals(row: CardRow, now: number): Record<Grade, number> {
  const p = scheduler.repeat(toFsrsCard(row), new Date(now));
  const out = {} as Record<Grade, number>;
  for (const g of GRADES) out[g.rating] = p[g.rating].card.due.getTime() - now;
  return out;
}

export function formatInterval(ms: number): string {
  if (ms < 60000) return '<1 мин';
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

export const isNew = (c: CardRow) => c.state === State.New;

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

/** Следующая карточка: сначала просроченные, затем новые, затем изучаемые «наперёд». */
export function pickNext(s: Session, now: number): CardRow | null {
  const ready = s.due.find((c) => c.due <= now);
  if (ready) return ready;
  if (s.fresh.length) return s.fresh[0];
  const soon = s.due.find((c) => c.due <= now + LEARN_AHEAD_MS);
  return soon ?? null;
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
