import type { CardRow } from '../../db/schema';
import { dayStart } from '../../lib/time';
import { isNew } from './scheduler';

export interface Knowledge {
  total: number;
  /** выучено: карточка уже повторялась и её срок ещё не наступил */
  known: number;
  due: number;
  fresh: number;
  percent: number;
}

/** Процент знания по набору карточек (отключённые не считаются). */
export function knowledgeOf(cards: CardRow[], now: number): Knowledge {
  let total = 0;
  let known = 0;
  let due = 0;
  let fresh = 0;
  for (const c of cards) {
    if (c.disabled) continue;
    total++;
    if (isNew(c)) fresh++;
    else if (c.due <= now) due++;
    else known++;
  }
  return { total, known, due, fresh, percent: total ? Math.round((known / total) * 100) : 0 };
}

/**
 * Стрик: сколько учебных дней подряд было хотя бы одно повторение.
 * Если сегодня ещё не занималась, стрик не сгорает до конца дня (считаем со вчера).
 */
export function streakDays(reviewTimes: number[], now: number): { days: number; today: boolean } {
  const DAY = 86400000;
  const days = new Set(reviewTimes.map((t) => dayStart(t)));
  const today = dayStart(now);
  const doneToday = days.has(today);
  let d = doneToday ? today : today - DAY;
  let n = 0;
  // сравниваем по началу учебного дня; переходы на летнее время дают ±1 ч — округляем
  const has = (x: number) => days.has(x) || days.has(x + 3600000) || days.has(x - 3600000);
  while (has(d)) {
    n++;
    d = dayStart(d - DAY / 2);
  }
  return { days: n, today: doneToday };
}
