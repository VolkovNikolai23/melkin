import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../db/db';
import { newLimitLeft } from '../features/review/data';
import { countDueToday } from '../features/review/scheduler';

/** Сколько карточек к повторению сейчас (пересчёт при изменениях БД и раз в минуту). */
export function useDueCount() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  return useLiveQuery(async () => {
    const [cards, left] = await Promise.all([db.cards.toArray(), newLimitLeft()]);
    return { ...countDueToday(cards, Date.now(), left), cards: cards.length };
  }, [tick]);
}
