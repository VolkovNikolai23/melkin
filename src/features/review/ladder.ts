// Лестница интервалов (SPEC.md, раздел 3) вместо FSRS.
//  «знаю»:    15 мин → 1 ч → 1 день → 3 дня → 1 неделя → дальше ×2 (2 нед, 4 нед, 8 нед…);
//  «не знаю»: карточка возвращается примерно через 30 секунд среди других и повторяется,
//             пока не нажата «знаю»; тогда интервал откатывается на 4 шага назад
//             (но не раньше первого шага).
import type { CardRow } from '../../db/schema';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Первые ступени лестницы; дальше каждая следующая вдвое длиннее предыдущей. */
export const LADDER = [15 * MIN, HOUR, DAY, 3 * DAY, 7 * DAY];
/** Через сколько вернуть карточку после «не знаю». */
export const RELEARN_DELAY_MS = 30_000;
/** Насколько откатываемся после ошибки. */
export const ROLLBACK_STEPS = 4;
/** Потолок интервала — около трёх лет, чтобы карточки не исчезали навсегда. */
export const MAX_INTERVAL_MS = 3 * 365 * DAY;

/** Состояния карточки (числа совпадают с прежними значениями в базе). */
export const State = { New: 0, Learning: 1, Review: 2, Relearning: 3 } as const;

export function intervalFor(step: number): number {
  const s = Math.max(0, Math.floor(step));
  const ms = s < LADDER.length ? LADDER[s] : LADDER[LADDER.length - 1] * 2 ** (s - LADDER.length + 1);
  return Math.min(ms, MAX_INTERVAL_MS);
}

/** Самая высокая ступень, интервал которой не больше заданного (для перевода истории FSRS). */
export function stepForInterval(ms: number): number {
  let step = 0;
  while (intervalFor(step + 1) <= ms && intervalFor(step + 1) < MAX_INTERVAL_MS) step++;
  return step;
}

export const isNewCard = (c: Pick<CardRow, 'step' | 'relearnFrom' | 'state'>) => (c.step === undefined || c.step === null) && !c.relearnFrom && c.state === State.New;

/** Какой шаг станет следующим при «знаю». */
export function nextStep(c: Pick<CardRow, 'step' | 'relearnFrom'>): number {
  if (c.relearnFrom !== undefined && c.relearnFrom !== null) return Math.max(0, c.relearnFrom - ROLLBACK_STEPS);
  return c.step === undefined || c.step === null ? 0 : c.step + 1;
}

/** Ответ на карточку: новое состояние. Чистая функция — покрыта тестами. */
export function answerLadder(c: CardRow, known: boolean, now: number): CardRow {
  if (!known) {
    const failingAgain = c.relearnFrom !== undefined && c.relearnFrom !== null;
    return {
      ...c,
      // запоминаем, с какой ступени упали (при повторных «не знаю» — не меняем)
      relearnFrom: failingAgain ? c.relearnFrom : (c.step ?? 0),
      due: now + RELEARN_DELAY_MS,
      state: State.Relearning,
      lapses: c.lapses + (failingAgain ? 0 : 1),
      reps: c.reps + 1,
      last_review: now,
    };
  }
  const step = nextStep(c);
  return {
    ...c,
    step,
    relearnFrom: undefined,
    due: now + intervalFor(step),
    state: State.Review,
    reps: c.reps + 1,
    last_review: now,
    scheduled_days: intervalFor(step) / DAY,
  };
}

/** Подписи кнопок: через сколько карточка вернётся. */
export function previewLadder(c: CardRow): { know: number; dontKnow: number } {
  return { know: intervalFor(nextStep(c)), dontKnow: RELEARN_DELAY_MS };
}

/**
 * Перевод накопленной истории FSRS в ступени лестницы: берём последний назначенный интервал
 * и ставим самую высокую ступень, которая в него укладывается. Срок повторения не трогаем.
 */
export function migrateCardToLadder(c: CardRow): CardRow {
  if (c.step !== undefined && c.step !== null) return c;
  if (c.state === State.New || !c.reps) return { ...c, step: null, relearnFrom: undefined, state: State.New };
  const lastInterval = c.scheduled_days > 0 ? c.scheduled_days * DAY : c.last_review ? Math.max(0, c.due - c.last_review) : 0;
  const step = stepForInterval(lastInterval);
  if (c.state === State.Learning || c.state === State.Relearning) return { ...c, step, relearnFrom: c.state === State.Relearning ? step : undefined };
  return { ...c, step, relearnFrom: undefined, state: State.Review };
}
