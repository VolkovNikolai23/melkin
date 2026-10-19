// Поздравления за стрик: первый ответ учебного дня продлевает стрик — сообщаем об этом,
// а на круглых числах (3, 7, 14, 30… дней) — с конфетти.
import { db, getMeta, setMeta } from '../../db/db';
import { cheer, confetti, STREAK_MILESTONES } from '../../lib/joy';
import { dayStart, plural } from '../../lib/time';
import { streakDays } from './stats';

export async function celebrateStreak(now = Date.now()) {
  const today = dayStart(now);
  if ((await getMeta<number>('streakCelebrated', 0)) >= today) return;
  await setMeta('streakCelebrated', today);
  const s = streakDays((await db.reviewLogs.orderBy('review').reverse().limit(5000).toArray()).map((l) => l.review), now);
  if (!s.today || s.days < 2) return;
  const milestone = STREAK_MILESTONES.includes(s.days);
  cheer(milestone ? `🔥 ${s.days} ${plural(s.days, 'день', 'дня', 'дней')} подряд — так держать!` : `🔥 Стрик: ${s.days} ${plural(s.days, 'день', 'дня', 'дней')}`);
  if (milestone) confetti(s.days >= 30 ? 2 : 1);
}
