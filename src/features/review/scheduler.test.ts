import { describe, expect, it } from 'vitest';
import type { CardRow } from '../../db/schema';
import { parseCards } from '../cards/parser';
import { newCardRow } from '../cards/sync';
import { dayStart } from '../../lib/time';
import { answerLadder, intervalFor, migrateCardToLadder, nextStep, RELEARN_DELAY_MS, stepForInterval } from './ladder';
import {
  afterAnswer,
  afterExpressAnswer,
  applyRating,
  buildExpressSession,
  buildSession,
  countDueToday,
  formatInterval,
  pickNext,
  previewIntervals,
  Rating,
  State,
} from './scheduler';

const now = new Date(2026, 9, 18, 12, 0).getTime();
const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;
const mk = (id: string, t = now): CardRow => newCardRow(id, 'd', parseCards('q >> a')[0], t);

describe('лестница интервалов', () => {
  it('15 мин → 1 ч → 1 день → 3 дня → 1 неделя → дальше вдвое', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(intervalFor)).toEqual([15 * MIN, H, D, 3 * D, 7 * D, 14 * D, 28 * D, 56 * D]);
  });

  it('«знаю» поднимает на ступень и ставит срок', () => {
    let c: CardRow = mk('a');
    const dues: number[] = [];
    let t = now;
    for (let i = 0; i < 6; i++) {
      c = answerLadder(c, true, t);
      dues.push(c.due - t);
      t = c.due;
    }
    expect(dues).toEqual([15 * MIN, H, D, 3 * D, 7 * D, 14 * D]);
    expect(c.step).toBe(5);
    expect(c.state).toBe(State.Review);
  });

  it('«не знаю» возвращает карточку через ~30 секунд', () => {
    const c = answerLadder({ ...mk('a'), step: 4, state: State.Review, reps: 5 }, false, now);
    expect(c.due - now).toBe(RELEARN_DELAY_MS);
    expect(c.relearnFrom).toBe(4);
    expect(c.lapses).toBe(1);
    expect(c.state).toBe(State.Relearning);
  });

  it('после «не знаю» и затем «знаю» — откат на 4 ступени', () => {
    let c: CardRow = { ...mk('a'), step: 6, state: State.Review, reps: 7 }; // 4 недели
    c = answerLadder(c, false, now);
    c = answerLadder(c, false, now + 30_000); // снова не знаю — ступень, с которой упали, не меняется
    expect(c.relearnFrom).toBe(6);
    expect(c.lapses).toBe(1);
    c = answerLadder(c, true, now + 60_000);
    expect(c.step).toBe(2); // 6 − 4 → 1 день
    expect(c.due - (now + 60_000)).toBe(D);
    expect(c.relearnFrom).toBeUndefined();
  });

  it('откат не ниже первой ступени', () => {
    let c: CardRow = { ...mk('a'), step: 2, state: State.Review, reps: 3 };
    c = answerLadder(answerLadder(c, false, now), true, now);
    expect(c.step).toBe(0);
    expect(c.due - now).toBe(15 * MIN);
    expect(nextStep(mk('новая'))).toBe(0);
  });

  it('перевод истории FSRS в ступени', () => {
    expect(stepForInterval(10 * D)).toBe(4); // 7 дней ≤ 10 < 14
    expect(stepForInterval(2 * MIN)).toBe(0);
    const review = { ...mk('a'), state: State.Review, reps: 4, scheduled_days: 30, due: now + 20 * D };
    expect(migrateCardToLadder(review)).toMatchObject({ step: 6, due: now + 20 * D }); // 28 дней ≤ 30
    expect(migrateCardToLadder(mk('b'))).toMatchObject({ step: null, state: State.New });
    const relearning = { ...mk('c'), state: State.Relearning, reps: 9, scheduled_days: 0, last_review: now - H, due: now };
    expect(migrateCardToLadder(relearning)).toMatchObject({ step: 1, relearnFrom: 1 });
  });
});

describe('ответы и журнал', () => {
  it('журнал пишет, была ли карточка новой', () => {
    const { card, log } = applyRating(mk('a'), Rating.Know, now);
    expect(log).toMatchObject({ cardId: 'a#fwd', wasNew: true, rating: Rating.Know });
    expect(card.reps).toBe(1);
  });

  it('подписи кнопок', () => {
    expect(previewIntervals(mk('a'))).toEqual({ [Rating.Know]: 15 * MIN, [Rating.DontKnow]: RELEARN_DELAY_MS });
    expect(previewIntervals({ ...mk('a'), step: 3, state: State.Review, reps: 4 })[Rating.Know]).toBe(7 * D);
  });
});

describe('очередь на сегодня', () => {
  it('лимита новых нет — берутся все', () => {
    const cards = Array.from({ length: 300 }, (_, i) => mk('n' + i, now + i));
    expect(buildSession(cards, now, Infinity).fresh).toHaveLength(300);
    expect(countDueToday(cards, now, Infinity).total).toBe(300);
  });

  it('просроченные идут раньше новых, будущие не попадают', () => {
    const reviewed = { ...mk('r'), state: State.Review, step: 2, reps: 3, due: now - 1000 };
    const future = { ...mk('f'), state: State.Review, step: 3, reps: 4, due: now + D };
    const s = buildSession([mk('n'), reviewed, future], now, Infinity);
    expect(s.due.map((c) => c.id)).toEqual(['r#fwd']);
    expect(pickNext(s, now)!.id).toBe('r#fwd');
  });

  it('«не знаю» — карточка возвращается среди других, а когда других нет — сразу', () => {
    const a = mk('a');
    const b = mk('b', now + 1);
    let s = buildSession([a, b], now, Infinity);
    const { card } = applyRating(a, Rating.DontKnow, now);
    s = afterAnswer(s, card, now);
    expect(pickNext(s, now)!.id).toBe('b#fwd'); // сначала другая карточка
    const { card: b2 } = applyRating(b, Rating.Know, now);
    s = afterAnswer(s, b2, now);
    expect(pickNext(s, now)!.id).toBe('a#fwd'); // больше ничего нет — возвращается ошибочная
  });

  it('«знаю» на новой: вернётся через 15 минут, сессия её дождётся, но раньше срока не покажет', () => {
    const a = mk('a');
    let s = buildSession([a], now, Infinity);
    s = afterAnswer(s, applyRating(a, Rating.Know, now).card, now);
    expect(s.due).toHaveLength(1);
    expect(pickNext(s, now)).toBeNull();
    expect(pickNext(s, now + 15 * MIN)!.id).toBe('a#fwd');
  });

  it('отключённые карточки не попадают в очередь и счётчик', () => {
    const off = { ...mk('x'), disabled: true };
    expect(buildSession([off, mk('y')], now, Infinity).fresh.map((c) => c.id)).toEqual(['y#fwd']);
    expect(countDueToday([off], now, Infinity).total).toBe(0);
  });
});

describe('экспресс-повтор', () => {
  it('все карточки подряд, без графика; «не знаю» возвращает карточку', () => {
    const cards = [mk('a'), { ...mk('b'), state: State.Review, step: 5, reps: 6, due: now + 30 * D }, { ...mk('c'), disabled: true }];
    let s = buildExpressSession(cards, () => 0.5);
    expect(s.fresh).toHaveLength(2); // будущие тоже, отключённые — нет
    const first = pickNext(s, now)!;
    s = afterExpressAnswer(s, first, false, now);
    const second = pickNext(s, now)!;
    expect(second.id).not.toBe(first.id);
    s = afterExpressAnswer(s, second, true, now);
    expect(pickNext(s, now)!.id).toBe(first.id);
    s = afterExpressAnswer(s, first, true, now);
    expect(pickNext(s, now)).toBeNull();
  });
});

describe('formatInterval и день', () => {
  it('форматирует интервалы по-русски', () => {
    expect(formatInterval(30 * 1000)).toBe('30 с');
    expect(formatInterval(15 * MIN)).toBe('15 мин');
    expect(formatInterval(3 * H)).toBe('3 ч');
    expect(formatInterval(4 * D)).toBe('4 дн');
    expect(formatInterval(90 * D)).toBe('3 мес');
    expect(formatInterval(400 * D)).toBe('1,1 г');
  });

  it('учебный день начинается в 4:00', () => {
    const night = new Date(2026, 9, 19, 2, 0).getTime();
    expect(dayStart(night)).toBe(new Date(2026, 9, 18, 4, 0).getTime());
  });
});

describe('счётчики по документам', () => {
  it('просроченные и новые по документам, будущие и отключённые не считаются', async () => {
    const { dueByDoc, sumDue, badgeCount } = await import('./scheduler');
    const card = (id: string, docId: string, extra: object) => ({ ...mk(id), docId, ...extra });
    const cards = [
      card('a', 'd1', {}),
      card('b', 'd1', { state: State.Review, step: 2, reps: 2, due: now - 1 }),
      card('c', 'd1', { state: State.Review, step: 2, reps: 2, due: now + 1e6 }),
      card('d', 'd2', {}),
      card('e', 'd2', { disabled: true }),
    ];
    const m = dueByDoc(cards, now);
    expect(m.get('d1')).toEqual({ due: 1, fresh: 1 });
    expect(sumDue(m, ['d1', 'd2'])).toEqual({ due: 1, fresh: 2 });
    expect(badgeCount(sumDue(m, ['d1', 'd2']), Infinity)).toBe(3);
  });
});
