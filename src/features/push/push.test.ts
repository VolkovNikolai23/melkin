import { describe, expect, it } from 'vitest';
import type { CardRow } from '../../db/schema';
import { newCardRow } from '../cards/sync';
import { parseCards } from '../cards/parser';
import { State } from '../review/scheduler';
import { computeSchedule } from './push';

const now = new Date(2026, 9, 19, 10, 7).getTime();
const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;
const card = (extra: Partial<CardRow>): CardRow => ({ ...newCardRow('b' + Math.random(), 'd', parseCards('q >> a')[0], now - D), state: State.Review, step: 3, reps: 4, ...extra });

describe('расписание напоминаний', () => {
  it('короткие шаги — точно по сроку (с округлением до 15 минут)', () => {
    const t = computeSchedule([card({ due: now + 14 * MIN })], now);
    expect(t[0]).toBe(new Date(2026, 9, 19, 10, 30).getTime());
  });

  it('длинные интервалы — раз в день в выбранный час, только если к нему что-то наступит', () => {
    const t = computeSchedule([card({ due: now + 3 * D })], now, 19);
    expect(t).toContain(new Date(2026, 9, 22, 19, 0).getTime());
    expect(t).not.toContain(new Date(2026, 9, 20, 19, 0).getTime());
    expect(t.every((x) => x > now)).toBe(true);
  });

  it('новые или уже просроченные карточки — напоминание сегодня вечером', () => {
    expect(computeSchedule([card({ state: State.New, step: null, reps: 0, due: now - D })], now, 19)).toContain(new Date(2026, 9, 19, 19, 0).getTime());
    expect(computeSchedule([card({ due: now - H })], now, 19)).toContain(new Date(2026, 9, 19, 19, 0).getTime());
  });

  it('отключённые не учитываются; нет карточек — нет напоминаний', () => {
    expect(computeSchedule([card({ due: now + 30 * MIN, disabled: true })], now)).toEqual([]);
    expect(computeSchedule([], now)).toEqual([]);
  });
});
