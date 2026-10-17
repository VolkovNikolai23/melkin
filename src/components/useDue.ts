import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../db/db';
import { newLimitLeft } from '../features/review/data';
import { countDueToday, dueByDoc } from '../features/review/scheduler';

/** Перерисовка раз в минуту: срок карточек наступает со временем, без изменений в БД. */
function useMinuteTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  return tick;
}

/** Сколько карточек к повторению сейчас — всего и по каждому документу. */
export function useDueCount() {
  const tick = useMinuteTick();
  return useLiveQuery(async () => {
    const [cards, left] = await Promise.all([db.cards.toArray(), newLimitLeft()]);
    const now = Date.now();
    return { ...countDueToday(cards, now, left), cards: cards.length, byDoc: dueByDoc(cards, now), newLeft: left };
  }, [tick]);
}
