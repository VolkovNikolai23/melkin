import { describe, expect, it } from 'vitest';
import type { Block, CardRow } from '../../db/schema';
import { newCardRow } from '../cards/sync';
import { parseCards } from '../cards/parser';
import { combineKnowledge, correctText, emptyAnswer, grade, latestScores, maskCloze, mistakeCards, shuffleApart, testFromCards, type CardSource, type Question } from './model';

// детерминированный «случай»
function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

const q = (data: Question['data'], prompt = 'Вопрос'): Question => ({ id: 'q', kind: data.kind, prompt, data });

describe('проверка ответов', () => {
  it('один ответ, верно/неверно', () => {
    const s = q({ kind: 'single', options: ['a', 'b'], correct: 1 });
    expect(grade(s, { kind: 'single', choice: 1 })).toEqual({ score: 1, correct: true });
    expect(grade(s, { kind: 'single', choice: null }).correct).toBe(false);
    expect(grade(q({ kind: 'truefalse', answer: false }), { kind: 'truefalse', value: false }).correct).toBe(true);
  });

  it('несколько правильных: частичный балл', () => {
    const m = q({ kind: 'multiple', options: ['a', 'b', 'c', 'd'], correct: [0, 2] });
    expect(grade(m, { kind: 'multiple', choices: [0, 2] })).toEqual({ score: 1, correct: true });
    expect(grade(m, { kind: 'multiple', choices: [0] })).toEqual({ score: 0.75, correct: false });
  });

  it('сопоставление, порядок, подписи', () => {
    expect(grade(q({ kind: 'match', left: ['a', 'b'], right: ['1', '2'] }), { kind: 'match', pairs: [0, null] })).toEqual({ score: 0.5, correct: false });
    expect(grade(q({ kind: 'order', items: ['1', '2', '3'] }), { kind: 'order', order: ['1', '2', '3'] }).correct).toBe(true);
    const label = q({ kind: 'label', fileId: 'f', areas: [{ id: 'a', x: 0, y: 0, w: 1, h: 1, text: 'Ядро' }, { id: 'b', x: 0, y: 0, w: 1, h: 1, text: 'Мембрана' }] });
    expect(grade(label, { kind: 'label', assigned: { a: 'ядро', b: 'Ядро' } })).toEqual({ score: 0.5, correct: false });
  });

  it('открытый: точное совпадение засчитывается, иначе ждёт проверки', () => {
    const o = q({ kind: 'open', answer: 'Митохондрия' });
    expect(grade(o, { kind: 'open', text: ' митохондрия! ' }).correct).toBe(true);
    expect(grade(o, { kind: 'open', text: 'органоид энергии' }).pending).toBe(true);
    expect(grade(o, { kind: 'open', text: '' })).toEqual({ score: 0, correct: false });
  });

  it('порядок перемешан, но не совпадает с правильным', () => {
    const items = ['a', 'b', 'c'];
    for (let i = 1; i < 20; i++) expect(shuffleApart(items, seeded(i))).not.toEqual(items);
    expect((emptyAnswer(q({ kind: 'order', items }), seeded(3)) as { order: string[] }).order.sort()).toEqual(items);
  });
});

describe('ошибки → карточки', () => {
  it('неверные пары — термины, порядок — список, остальное — вопрос/ответ', () => {
    const match = q({ kind: 'match', left: ['Митоз', 'Мейоз'], right: ['2 клетки', '4 клетки'] });
    expect(mistakeCards(match, { kind: 'match', pairs: [0, 0] })).toEqual([{ kind: 'term', front: 'Мейоз', back: '4 клетки' }]);
    expect(mistakeCards(q({ kind: 'order', items: ['a', 'b'] }, 'Фазы'), { kind: 'order', order: ['b', 'a'] })[0]).toMatchObject({ kind: 'list', items: ['a', 'b'] });
    const single = q({ kind: 'single', options: ['x', 'y'], correct: 1 }, 'Что?');
    expect(mistakeCards(single, { kind: 'single', choice: 0 })).toEqual([{ kind: 'qa', front: 'Что?', back: 'y' }]);
    expect(correctText(match)).toBe('Митоз — 2 клетки; Мейоз — 4 клетки');
  });
});

describe('тест из карточек', () => {
  const now = Date.now();
  const src = (id: string, text: string, children: string[] = [], block?: Partial<Block>): CardSource[] =>
    parseCards(text).map((p) => ({ card: newCardRow(id, 'd', p, now) as CardRow, children, block: block as Block }));

  it('собирает разные типы вопросов и не дублирует обратные стороны', () => {
    const sources = [
      ...src('b1', 'Митоз :: деление на две клетки'),
      ...src('b2', 'Мейоз :: деление на четыре клетки'),
      ...src('b3', 'Профаза >> хромосомы спирализуются'),
      ...src('b4', 'Анафаза >> хроматиды расходятся'),
      ...src('b5', 'Телофаза >> образуются ядра'),
      ...src('b6', 'Цитокинез >> делится цитоплазма'),
      ...src('b7', 'Фазы митоза >>1.', ['Профаза', 'Метафаза', 'Анафаза', 'Телофаза']),
      ...src('b8', 'У человека {{46}} хромосом'),
    ];
    const img = { id: 'b9', text: 'Клетка', image: { fileId: 'f', width: 10, height: 10, occlusions: [{ id: 'r1', x: 0, y: 0, w: 0.1, h: 0.1, label: 'Ядро' }, { id: 'r2', x: 0.5, y: 0.5, w: 0.1, h: 0.1, label: 'Мембрана' }] } } as Block;
    // у картинки — карточки-области
    sources.push(...['r1', 'r2'].map((r, i) => ({ card: newCardRow('b9', 'd', { key: `occ:${r}`, kind: 'occlusion', front: 'Клетка', back: '', clozeIndex: i, sub: r }, now) as CardRow, children: [], block: img })));
    const qs = testFromCards(sources, seeded(7), 20);
    const kinds = new Set(qs.map((x) => x.kind));
    for (const k of ['single', 'truefalse', 'match', 'multiple', 'order', 'label', 'open']) expect(kinds).toContain(k);
    const single = qs.find((x) => x.kind === 'single')!;
    if (single.data.kind !== 'single') throw new Error();
    expect(single.data.options).toHaveLength(4);
    expect(new Set(single.data.options).size).toBe(4);
    // во всех вопросах правильный ответ проверяется как верный
    for (const x of qs) {
      if (x.data.kind === 'single') expect(grade(x, { kind: 'single', choice: x.data.correct }).correct).toBe(true);
      if (x.data.kind === 'match') expect(grade(x, { kind: 'match', pairs: x.data.left.map((_, i) => i) }).correct).toBe(true);
    }
  });

  it('мало карточек — мало вопросов, без ошибок', () => {
    expect(testFromCards(src('b1', 'A :: B'), seeded(2))).toHaveLength(0);
  });

  it('клоз: скрыт только нужный пропуск', () => {
    expect(maskCloze('{{c1::Ядро}} хранит {{c2::ДНК}}', 'ДНК')).toBe('Ядро хранит _____');
  });
});

describe('знание темы', () => {
  it('карточки 70%, тесты 30%; последняя попытка каждого теста', () => {
    expect(combineKnowledge(50, 10, [])).toBe(50);
    expect(combineKnowledge(50, 10, [1])).toBe(65);
    expect(combineKnowledge(0, 0, [0.8])).toBe(80);
    const scores = latestScores([
      { id: '1', testId: 't', docId: 'd', at: 1, score: 0.2, answers: [] },
      { id: '2', testId: 't', docId: 'd', at: 2, score: 0.9, answers: [] },
      { id: '3', testId: 'u', docId: 'd', at: 1, score: 0.5, answers: [] },
    ]);
    expect(scores.sort()).toEqual([0.5, 0.9]);
  });
});
