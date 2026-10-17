import { describe, expect, it } from 'vitest';
import { parseCards } from '../cards/parser';
import { newCardRow } from '../cards/sync';
import { dayStart } from '../../lib/time';
import {
  afterAnswer,
  applyRating,
  buildSession,
  countDueToday,
  formatInterval,
  newAllowance,
  pickNext,
  previewIntervals,
  Rating,
  State,
} from './scheduler';

const now = new Date(2026, 9, 17, 12, 0).getTime();
const mk = (id: string, t = now) => newCardRow(id, 'd', parseCards('q :: a')[0], t);

describe('applyRating', () => {
  it('новая карточка после «Хорошо» уходит в изучение и пишет журнал', () => {
    const { card, log } = applyRating(mk('a'), Rating.Good, now);
    expect(card.state).not.toBe(State.New);
    expect(card.reps).toBe(1);
    expect(card.due).toBeGreaterThan(now);
    expect(log.wasNew).toBe(true);
    expect(log.cardId).toBe('a#fwd');
  });

  it('интервалы растут от «Снова» к «Легко»', () => {
    let c = mk('a');
    // доводим карточку до состояния повторения
    for (let i = 0; i < 3; i++) c = applyRating(c, Rating.Good, c.due).card;
    const p = previewIntervals(c, c.due);
    expect(p[Rating.Again]).toBeLessThan(p[Rating.Hard]);
    expect(p[Rating.Hard]).toBeLessThanOrEqual(p[Rating.Good]);
    expect(p[Rating.Good]).toBeLessThan(p[Rating.Easy]);
  });

  it('«Снова» на выученной карточке увеличивает число забываний', () => {
    let c = mk('a');
    c = applyRating(c, Rating.Easy, now).card;
    expect(c.state).toBe(State.Review);
    const after = applyRating(c, Rating.Again, c.due).card;
    expect(after.lapses).toBe(1);
    expect(after.state).toBe(State.Relearning);
  });
});

describe('очередь', () => {
  it('лимит новых карточек', () => {
    expect(newAllowance(20, 5)).toBe(15);
    expect(newAllowance(20, 25)).toBe(0);
    const cards = Array.from({ length: 30 }, (_, i) => mk('n' + i, now + i));
    expect(buildSession(cards, now, 20).fresh).toHaveLength(20);
    expect(countDueToday(cards, now, 7).total).toBe(7);
  });

  it('просроченные идут раньше новых, будущие не попадают', () => {
    const reviewed = { ...mk('r'), state: State.Review, due: now - 1000 };
    const future = { ...mk('f'), state: State.Review, due: now + 86400000 };
    const s = buildSession([mk('n'), reviewed, future], now, 20);
    expect(s.due.map((c) => c.id)).toEqual(['r#fwd']);
    expect(pickNext(s, now)!.id).toBe('r#fwd');
  });

  it('карточка после «Снова» возвращается в сессию', () => {
    const card = mk('a');
    let s = buildSession([card], now, 20);
    const { card: upd } = applyRating(card, Rating.Again, now);
    s = afterAnswer(s, upd, now);
    expect(s.fresh).toHaveLength(0);
    expect(s.due).toHaveLength(1);
    // даже если срок ещё не наступил, показываем её «наперёд», раз больше ничего нет
    expect(pickNext(s, now)!.id).toBe('a#fwd');
  });

  it('карточка с «Легко» покидает сессию', () => {
    const card = mk('a');
    const { card: upd } = applyRating(card, Rating.Easy, now);
    const s = afterAnswer(buildSession([card], now, 20), upd, now);
    expect(pickNext(s, now)).toBeNull();
  });
});

describe('formatInterval и день', () => {
  it('форматирует интервалы по-русски', () => {
    expect(formatInterval(30 * 1000)).toBe('<1 мин');
    expect(formatInterval(10 * 60000)).toBe('10 мин');
    expect(formatInterval(3 * 3600000)).toBe('3 ч');
    expect(formatInterval(4 * 86400000)).toBe('4 дн');
    expect(formatInterval(90 * 86400000)).toBe('3 мес');
    expect(formatInterval(400 * 86400000)).toBe('1,1 г');
  });

  it('учебный день начинается в 4:00', () => {
    const night = new Date(2026, 9, 18, 2, 0).getTime();
    expect(dayStart(night)).toBe(new Date(2026, 9, 17, 4, 0).getTime());
    expect(dayStart(now)).toBe(new Date(2026, 9, 17, 4, 0).getTime());
  });
});
