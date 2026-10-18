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
  it('выученные / к повторению / новые', () => {
    const mk = (id: string, extra: object) => ({ ...newCardRow(id, 'd', parseCards('q >> a')[0], now), ...extra });
    const k = knowledgeOf([mk('a', { state: 2, due: now + D }), mk('b', { state: 2, due: now - 1 }), mk('c', {}), mk('d', { disabled: true })], now);
    expect(k).toEqual({ total: 3, known: 1, due: 1, fresh: 1, percent: 33 });
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
