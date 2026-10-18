import { describe, expect, it } from 'vitest';
import { parseCards } from '../cards/parser';
import { newCardRow } from '../cards/sync';
import { startRoute } from '../../lib/session';
import { knowledgeOf, streakDays } from './stats';

const now = new Date(2026, 9, 18, 12, 0).getTime();
const H = 3600000;
const D = 24 * H;

describe('стрик', () => {
  it('считает дни подряд, включая сегодня', () => {
    expect(streakDays([now - 1 * H, now - D, now - 2 * D], now)).toEqual({ days: 3, today: true });
  });
  it('если сегодня ещё не занималась — стрик со вчера не сгорает', () => {
    expect(streakDays([now - D, now - 2 * D], now)).toEqual({ days: 2, today: false });
  });
  it('пропуск дня обнуляет', () => {
    expect(streakDays([now - 2 * D, now - 3 * D], now).days).toBe(0);
  });
  it('ночные занятия до 4:00 считаются предыдущим днём', () => {
    const night = new Date(2026, 9, 18, 2, 0).getTime(); // 2:00 — это ещё 17 октября
    expect(streakDays([night], now).days).toBe(1);
    expect(streakDays([night], now).today).toBe(false);
  });
});

describe('знание темы', () => {
  it('процент растёт постепенно по ступеням, «выучено» — от 3 дней', () => {
    const mk = (id: string, extra: object) => ({ ...newCardRow(id, 'd', parseCards('q >> a')[0], now), ...extra });
    const k = knowledgeOf(
      [mk('a', { state: 2, step: 3, due: now + D }), mk('b', { state: 2, step: 2, due: now - 1 }), mk('c', {}), mk('e', { state: 2, step: 0, due: now + 15 * 60000 }), mk('d', { disabled: true })],
      now,
    );
    // a — целиком (от 3 дней), e — четверть (15 мин), b просрочена, c новая: (1 + 0,25) / 4
    expect(k).toEqual({ total: 4, known: 1, due: 1, fresh: 1, percent: 31 });
    expect(knowledgeOf([], now).percent).toBe(0);
  });
});

describe('куда открыть при запуске', () => {
  it('перезагрузка страницы — остаёмся на месте', () => {
    expect(startRoute({ hasSession: true, lastActive: now, lastRoute: 'doc/x', now })).toBeNull();
  });
  it('возврат из другого приложения (iPadOS перезапустил PWA) — последняя заметка', () => {
    expect(startRoute({ hasSession: false, lastActive: now - 5 * 60000, lastRoute: 'doc/x', now })).toBe('doc/x');
  });
  it('после полного закрытия — «Сегодня»', () => {
    expect(startRoute({ hasSession: false, lastActive: now - 3 * H, lastRoute: 'doc/x', now })).toBe('');
    expect(startRoute({ hasSession: false, lastActive: null, lastRoute: null, now })).toBe('');
  });
});

describe('график и прогноз готовности', () => {
  it('повторения по дням', async () => {
    const { reviewsPerDay } = await import('./stats');
    const r = reviewsPerDay([now, now - H, now - D], now, 3);
    expect(r.map((x) => x.count)).toEqual([0, 1, 2]);
  });

  it('готовность: доля карточек с интервалом от 3 дней и срок при нынешнем темпе', async () => {
    const { readiness } = await import('./stats');
    const mk = (id: string, step: number | null) => ({ ...newCardRow(id, 'd', parseCards('q >> a')[0], now), step, state: step === null ? 0 : 2 });
    const cards = [mk('a', 4), mk('b', 3), mk('c', 1), mk('d', null)];
    // за неделю 7 карточек стали надёжными → 1 в день; осталось 2 → 2 дня
    const r = readiness(cards, Array.from({ length: 7 }, (_, i) => now - i * D), now);
    expect(r).toMatchObject({ total: 4, solid: 2, percent: 50, perDay: 1, daysLeft: 2 });
    expect(readiness(cards, [], now).daysLeft).toBeNull();
    expect(readiness([mk('x', 5)], [], now).daysLeft).toBe(0);
  });
});
