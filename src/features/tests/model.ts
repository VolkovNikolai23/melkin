// Тесты: 7 типов вопросов, проверка ответов, тест из карточек (работает офлайн, без ИИ),
// ошибки → черновики карточек, вклад результатов в процент знания темы.
import type { Block, CardRow, TestAttempt, TestQuestionKind, TestRow } from '../../db/schema';
import type { DraftCard } from '../ai/lecture';

export interface Area {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Правильная подпись области */
  text: string;
}

export type QuestionData =
  | { kind: 'single'; options: string[]; correct: number }
  | { kind: 'multiple'; options: string[]; correct: number[] }
  | { kind: 'truefalse'; answer: boolean }
  | { kind: 'open'; answer: string }
  | { kind: 'match'; left: string[]; right: string[] }
  | { kind: 'label'; fileId: string; areas: Area[] }
  | { kind: 'order'; items: string[] };

export interface Question {
  id: string;
  kind: TestQuestionKind;
  prompt: string;
  data: QuestionData;
  /** Объяснение правильного ответа — показывается в разборе ошибок */
  explanation?: string;
}

/** Ответы по типам */
export type Answer =
  | { kind: 'single'; choice: number | null }
  | { kind: 'multiple'; choices: number[] }
  | { kind: 'truefalse'; value: boolean | null }
  | { kind: 'open'; text: string; strokes?: unknown[] }
  | { kind: 'match'; pairs: (number | null)[] }
  | { kind: 'label'; assigned: Record<string, string> }
  | { kind: 'order'; order: string[] };

export interface Graded {
  /** 0…1: частичный балл за сопоставление, порядок, подписи, несколько ответов */
  score: number;
  correct: boolean;
  /** Открытый ответ ждёт проверки (ИИ или самопроверка) */
  pending?: boolean;
}

export const KIND_LABEL: Record<TestQuestionKind, string> = {
  single: 'Один ответ',
  multiple: 'Несколько правильных',
  truefalse: 'Верно или неверно',
  open: 'Открытый ответ',
  match: 'Сопоставление',
  label: 'Подпишите части картинки',
  order: 'Расставьте по порядку',
};

export type Rnd = () => number;

export function shuffle<T>(arr: T[], rnd: Rnd = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Перемешать, но не оставить исходный порядок (для порядка и сопоставления). */
export function shuffleApart<T>(arr: T[], rnd: Rnd = Math.random): T[] {
  if (arr.length < 2) return [...arr];
  for (let t = 0; t < 8; t++) {
    const s = shuffle(arr, rnd);
    if (s.some((x, i) => x !== arr[i])) return s;
  }
  return [...arr.slice(1), arr[0]];
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Пустой ответ на вопрос (начальное состояние). */
export function emptyAnswer(q: Question, rnd: Rnd = Math.random): Answer {
  const d = q.data;
  switch (d.kind) {
    case 'single':
      return { kind: 'single', choice: null };
    case 'multiple':
      return { kind: 'multiple', choices: [] };
    case 'truefalse':
      return { kind: 'truefalse', value: null };
    case 'open':
      return { kind: 'open', text: '' };
    case 'match':
      return { kind: 'match', pairs: d.left.map(() => null) };
    case 'label':
      return { kind: 'label', assigned: {} };
    case 'order':
      return { kind: 'order', order: shuffleApart(d.items, rnd) };
  }
}

export function isAnswered(a: Answer): boolean {
  switch (a.kind) {
    case 'single':
      return a.choice !== null;
    case 'multiple':
      return a.choices.length > 0;
    case 'truefalse':
      return a.value !== null;
    case 'open':
      return !!a.text.trim() || !!a.strokes?.length;
    case 'match':
      return a.pairs.some((p) => p !== null);
    case 'label':
      return Object.keys(a.assigned).length > 0;
    case 'order':
      return true;
  }
}

/** Проверка ответа (открытый — только точное совпадение, иначе ждёт ИИ или самопроверку). */
export function grade(q: Question, a: Answer): Graded {
  const d = q.data;
  const frac = (ok: number, total: number): Graded => ({ score: total ? ok / total : 0, correct: total > 0 && ok === total });
  if (d.kind === 'single' && a.kind === 'single') return frac(a.choice === d.correct ? 1 : 0, 1);
  if (d.kind === 'truefalse' && a.kind === 'truefalse') return frac(a.value === d.answer ? 1 : 0, 1);
  if (d.kind === 'multiple' && a.kind === 'multiple') {
    // за каждый вариант: отмечен верно или верно не отмечен
    const ok = d.options.filter((_, i) => d.correct.includes(i) === a.choices.includes(i)).length;
    return frac(ok, d.options.length);
  }
  if (d.kind === 'match' && a.kind === 'match') return frac(d.left.filter((_, i) => a.pairs[i] === i).length, d.left.length);
  if (d.kind === 'label' && a.kind === 'label') return frac(d.areas.filter((ar) => norm(a.assigned[ar.id] ?? '') === norm(ar.text)).length, d.areas.length);
  if (d.kind === 'order' && a.kind === 'order') return frac(d.items.filter((it, i) => a.order[i] === it).length, d.items.length);
  if (d.kind === 'open' && a.kind === 'open') {
    if (!a.text.trim() && !a.strokes?.length) return { score: 0, correct: false };
    if (a.text.trim() && norm(a.text) === norm(d.answer)) return { score: 1, correct: true };
    return { score: 0, correct: false, pending: true };
  }
  return { score: 0, correct: false };
}

/** Правильный ответ словами — для разбора ошибок. */
export function correctText(q: Question): string {
  const d = q.data;
  switch (d.kind) {
    case 'single':
      return d.options[d.correct] ?? '';
    case 'multiple':
      return d.correct.map((i) => d.options[i]).join('; ');
    case 'truefalse':
      return d.answer ? 'Верно' : 'Неверно';
    case 'open':
      return d.answer;
    case 'match':
      return d.left.map((l, i) => `${l} — ${d.right[i]}`).join('; ');
    case 'label':
      return d.areas.map((a, i) => `${i + 1} — ${a.text}`).join('; ');
    case 'order':
      return d.items.map((x, i) => `${i + 1}. ${x}`).join(' ');
  }
}

/** Ответ пользователя словами — для разбора ошибок. */
export function answerText(q: Question, a: Answer): string {
  const d = q.data;
  if (a.kind === 'single' && d.kind === 'single') return a.choice === null ? '—' : d.options[a.choice];
  if (a.kind === 'multiple' && d.kind === 'multiple') return a.choices.map((i) => d.options[i]).join('; ') || '—';
  if (a.kind === 'truefalse') return a.value === null ? '—' : a.value ? 'Верно' : 'Неверно';
  if (a.kind === 'open') return a.text.trim() || (a.strokes?.length ? '(от руки)' : '—');
  if (a.kind === 'match' && d.kind === 'match') return d.left.map((l, i) => `${l} — ${a.pairs[i] === null ? '?' : d.right[a.pairs[i]!]}`).join('; ');
  if (a.kind === 'label' && d.kind === 'label') return d.areas.map((ar, i) => `${i + 1} — ${a.assigned[ar.id] ?? '?'}`).join('; ');
  if (a.kind === 'order') return a.order.map((x, i) => `${i + 1}. ${x}`).join(' ');
  return '—';
}

// ---------- Ошибки → карточки ----------

/** Ошибка в тесте → черновик карточки (для экрана одобрения). */
export function mistakeCards(q: Question, a: Answer): DraftCard[] {
  const d = q.data;
  const p = q.prompt.trim();
  switch (d.kind) {
    case 'match':
      // только неверно сопоставленные пары — как термин ↔ определение
      return d.left.flatMap((l, i) => (a.kind === 'match' && a.pairs[i] === i ? [] : [{ kind: 'term' as const, front: l, back: d.right[i] }]));
    case 'order':
      return [{ kind: 'list', front: p, items: d.items }];
    case 'label':
      return d.areas.flatMap((ar, i) =>
        a.kind === 'label' && norm(a.assigned[ar.id] ?? '') === norm(ar.text) ? [] : [{ kind: 'qa' as const, front: `${p}: что обозначено цифрой ${i + 1}?`, back: ar.text }],
      );
    case 'truefalse':
      return [{ kind: 'qa', front: `Верно ли: ${p}`, back: (d.answer ? 'Верно' : 'Неверно') + (q.explanation ? `. ${q.explanation}` : '') }];
    default:
      return [{ kind: 'qa', front: p, back: correctText(q) }];
  }
}

// ---------- Тест из карточек (офлайн) ----------

export interface CardSource {
  card: CardRow;
  block?: Block;
  /** Тексты вложенных блоков (ответ многострочной карточки или пункты списка) */
  children: string[];
}

const short = (s: string, n = 160) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const plain = (s: string) => s.replace(/\*\*|==\{\w+\}|==|__|\{\{(?:c\d+::)?|\}\}/g, '').trim();

/** Клоз: скрываем текст карточки (back), остальные пропуски открываем. */
export function maskCloze(front: string, back: string): string {
  const hidden = new Set(back.split(' · ').map((s) => s.trim()));
  return front.replace(/\{\{(?:c\d+::)?(.+?)\}\}/g, (_, t: string) => (hidden.has(t.trim()) ? '_____' : t));
}

/**
 * Тест из карточек темы: выбор ответа, верно/неверно, сопоставление, несколько правильных,
 * порядок (карточки-списки), подписи (картинки с подписанными областями), открытые вопросы.
 */
export function testFromCards(sources: CardSource[], rnd: Rnd = Math.random, max = 12): Question[] {
  const active = sources.filter((s) => !s.card.disabled);
  // пары «вопрос — ответ» (одна на блок: обратные стороны не дублируем)
  const seen = new Set<string>();
  const pairs: { front: string; back: string; block: string }[] = [];
  for (const s of active) {
    if (s.card.kind !== 'forward' || seen.has(s.card.blockId)) continue;
    const back = plain(s.card.back || s.children.join('; '));
    if (!plain(s.card.front) || !back) continue;
    seen.add(s.card.blockId);
    pairs.push({ front: plain(s.card.front), back, block: s.card.blockId });
  }
  const lists = active.filter((s) => s.card.kind === 'list' && s.children.length >= 3);
  const clozes = active.filter((s) => s.card.kind === 'cloze' && s.card.back);
  const labelled = new Map<string, CardSource>();
  for (const s of active) if (s.card.kind === 'occlusion' && s.block?.image && (s.block.image.occlusions ?? []).filter((r) => r.label).length >= 2) labelled.set(s.block.id, s);

  const qs: Question[] = [];
  let n = 0;
  const id = () => 'q' + ++n;
  const shuffledPairs = shuffle(pairs, rnd);
  const others = (p: { back: string }) => shuffle(pairs.filter((x) => x.back !== p.back).map((x) => x.back), rnd);

  // один ответ: термин → выбор определения из 4
  for (const p of shuffledPairs.slice(0, 3)) {
    const wrong = others(p).slice(0, 3);
    if (wrong.length < 2) break;
    const options = shuffle([p.back, ...wrong], rnd).map((o) => short(o));
    qs.push({ id: id(), kind: 'single', prompt: p.front, data: { kind: 'single', options, correct: options.indexOf(short(p.back)) }, explanation: `${p.front} — ${p.back}` });
  }
  // верно/неверно: пара верная или с чужим ответом
  for (const p of shuffledPairs.slice(3, 5)) {
    const truth = rnd() < 0.5;
    const wrong = others(p)[0];
    const back = truth || !wrong ? p.back : wrong;
    qs.push({ id: id(), kind: 'truefalse', prompt: `${p.front} — ${short(back)}`, data: { kind: 'truefalse', answer: truth || !wrong }, explanation: `${p.front} — ${p.back}` });
  }
  // сопоставление: 4 пары
  if (pairs.length >= 4) {
    const set = shuffle(pairs, rnd).slice(0, 4);
    qs.push({ id: id(), kind: 'match', prompt: 'Сопоставьте понятия и определения', data: { kind: 'match', left: set.map((p) => p.front), right: set.map((p) => short(p.back, 100)) } });
  }
  // несколько правильных: 4 утверждения, часть — с чужими ответами
  if (pairs.length >= 5) {
    const set = shuffle(pairs, rnd).slice(0, 4);
    const correct: number[] = [];
    const options = set.map((p, i) => {
      const truth = rnd() < 0.5 || i === 0;
      if (truth) correct.push(i);
      return `${p.front} — ${short(truth ? p.back : others(p)[0], 90)}`;
    });
    qs.push({ id: id(), kind: 'multiple', prompt: 'Отметьте все верные утверждения', data: { kind: 'multiple', options, correct }, explanation: set.map((p) => `${p.front} — ${p.back}`).join('; ') });
  }
  // порядок: карточки-списки
  for (const s of shuffle(lists, rnd).slice(0, 2)) {
    qs.push({ id: id(), kind: 'order', prompt: plain(s.card.front), data: { kind: 'order', items: s.children.map((c) => short(plain(c), 90)) } });
  }
  // подписи на картинке
  for (const s of [...labelled.values()].slice(0, 1)) {
    const areas = (s.block!.image!.occlusions ?? []).filter((r) => r.label).slice(0, 8).map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, text: r.label! }));
    qs.push({ id: id(), kind: 'label', prompt: plain(s.block!.text) || 'Подпишите части картинки', data: { kind: 'label', fileId: s.block!.image!.fileId, areas } });
  }
  // открытые: клозы и оставшиеся вопросы
  for (const s of shuffle(clozes, rnd).slice(0, 2)) {
    qs.push({ id: id(), kind: 'open', prompt: `Вставьте пропущенное: ${maskCloze(s.card.front, s.card.back)}`, data: { kind: 'open', answer: s.card.back.replace(/ · /g, ', ') } });
  }
  for (const p of shuffledPairs.slice(5, 7)) qs.push({ id: id(), kind: 'open', prompt: p.front, data: { kind: 'open', answer: p.back } });
  return shuffle(qs, rnd).slice(0, max);
}

// ---------- Знание темы ----------

/** Последняя попытка каждого теста (для процента знания). */
export function latestScores(attempts: TestAttempt[]): number[] {
  const last = new Map<string, TestAttempt>();
  for (const a of attempts) if (!last.has(a.testId) || last.get(a.testId)!.at < a.at) last.set(a.testId, a);
  return [...last.values()].map((a) => a.score);
}

/**
 * Процент знания: карточки — 70%, результаты тестов (последние попытки) — 30%.
 * Нет тестов — только карточки; нет карточек — только тесты.
 */
export function combineKnowledge(cardPercent: number, cardTotal: number, testScores: number[]): number {
  if (!testScores.length) return cardPercent;
  const tests = (testScores.reduce((s, x) => s + x, 0) / testScores.length) * 100;
  if (!cardTotal) return Math.round(tests);
  return Math.round(cardPercent * 0.7 + tests * 0.3);
}

export const questionsOf = (t: TestRow) => t.questions as Question[];
