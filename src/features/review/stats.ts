import type { CardRow } from '../../db/schema';
import { dayStart } from '../../lib/time';
import { isNew } from './scheduler';

export interface Knowledge {
  total: number;
  /** надёжно выучено: интервал уже от 3 дней и срок не наступил */
  known: number;
  due: number;
  fresh: number;
  percent: number;
}

/**
 * Процент знания по набору карточек (отключённые не считаются). Растёт постепенно:
 * карточка на ступени 0 (15 мин) даёт ¼, 1 час — ½, 1 день — ¾, от 3 дней — целиком.
 * Новые и просроченные карточки дают 0.
 */
export function knowledgeOf(cards: CardRow[], now: number): Knowledge {
  let total = 0;
  let known = 0;
  let due = 0;
  let fresh = 0;
  let score = 0;
  for (const c of cards) {
    if (c.disabled) continue;
    total++;
    if (isNew(c)) fresh++;
    else if (c.due <= now || (c.relearnFrom !== undefined && c.relearnFrom !== null)) due++;
    else {
      const step = c.step ?? 0;
      if (step >= SOLID_STEP) known++;
      score += Math.min(1, (step + 1) / (SOLID_STEP + 1));
    }
  }
  return { total, known, due, fresh, percent: total ? Math.round((score / total) * 100) : 0 };
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

/** Повторения по дням за последние `days` учебных дней (для графика). */
export function reviewsPerDay(reviewTimes: number[], now: number, days = 30): { day: number; count: number }[] {
  const DAY = 86400000;
  const counts = new Map<number, number>();
  for (const t of reviewTimes) {
    const d = dayStart(t);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const out: { day: number; count: number }[] = [];
  let d = dayStart(now);
  for (let i = 0; i < days; i++) {
    out.unshift({ day: d, count: counts.get(d) ?? counts.get(d + 3600000) ?? counts.get(d - 3600000) ?? 0 });
    d = dayStart(d - DAY / 2);
  }
  return out;
}

/**
 * Прогноз готовности: карточка «надёжно выучена», когда дошла до интервала от 3 дней
 * (ступень ≥ 3). Готовность — доля таких карточек; срок — сколько дней понадобится
 * при нынешнем темпе (сколько карточек в день становилось надёжными за последнюю неделю).
 */
export const SOLID_STEP = 3;

export function readiness(cards: CardRow[], solidReachedTimes: number[], now: number) {
  const active = cards.filter((c) => !c.disabled);
  const solid = active.filter((c) => (c.step ?? -1) >= SOLID_STEP && !c.relearnFrom).length;
  const total = active.length;
  const weekAgo = now - 7 * 86400000;
  const perDay = solidReachedTimes.filter((t) => t >= weekAgo).length / 7;
  const left = total - solid;
  return {
    total,
    solid,
    percent: total ? Math.round((solid / total) * 100) : 0,
    perDay: Math.round(perDay * 10) / 10,
    /** null — темпа пока нет, прогноз невозможен; 0 — уже всё */
    daysLeft: left === 0 ? 0 : perDay > 0 ? Math.ceil(left / perDay) : null,
  };
}
