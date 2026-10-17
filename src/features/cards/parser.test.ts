import { describe, expect, it } from 'vitest';
import { parseCards } from './parser';
import { planCardSync, newCardRow } from './sync';
import { tokenize } from '../../lib/markup';

describe('parseCards', () => {
  it('обычный текст — без карточек', () => {
    expect(parseCards('Просто заметка про матрицы')).toEqual([]);
  });

  it(':: создаёт карточку вперёд', () => {
    const c = parseCards('Что такое ранг? :: Размерность образа');
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ key: 'fwd', kind: 'forward', front: 'Что такое ранг?', back: 'Размерность образа' });
  });

  it(';; создаёт двустороннюю карточку', () => {
    const c = parseCards('det ;; определитель');
    expect(c.map((x) => x.kind)).toEqual(['forward', 'reverse']);
    expect(c[1]).toMatchObject({ front: 'определитель', back: 'det' });
  });

  it('пустой ответ допустим (ответ — дочерние блоки), но без обратной карточки', () => {
    expect(parseCards('Свойства определителя ::')).toHaveLength(1);
    expect(parseCards('Свойства ;;')).toHaveLength(1);
  });

  it('пустой вопрос — не карточка', () => {
    expect(parseCards(':: ответ')).toEqual([]);
  });

  it(':: внутри формулы не считается разделителем', () => {
    expect(parseCards('Отображение $f :: A \\to B$ задано')).toEqual([]);
    const c = parseCards('$a::b$ ? :: да');
    expect(c[0].front).toBe('$a::b$ ?');
  });

  it('каждый клоз — отдельная карточка', () => {
    const c = parseCards('Матрица {{обратима}} тогда и только тогда, когда {{$\\det A \\ne 0$}}');
    expect(c).toHaveLength(2);
    expect(c.map((x) => x.clozeIndex)).toEqual([0, 1]);
    expect(c[1].back).toBe('$\\det A \\ne 0$');
    expect(new Set(c.map((x) => x.key)).size).toBe(2);
  });

  it('ключ клоза не зависит от позиции', () => {
    const a = parseCards('{{x}} и {{y}}');
    const b = parseCards('сначала {{y}}, потом {{x}}');
    expect(a.find((c) => c.back === 'x')!.key).toBe(b.find((c) => c.back === 'x')!.key);
  });

  it('одинаковые клозы получают разные ключи', () => {
    const c = parseCards('{{a}} + {{a}}');
    expect(c[0].key).not.toBe(c[1].key);
  });

  it('{{ внутри формулы — не клоз; }}} закрывается правильно', () => {
    expect(parseCards('$x^{{2}}$')).toEqual([]);
    expect(parseCards('{{a^{2}}} = b')[0].back).toBe('a^{2}');
  });

  it('при наличии разделителя клозы не превращаются в отдельные карточки', () => {
    expect(parseCards('{{a}} :: b').map((c) => c.kind)).toEqual(['forward']);
  });
});

describe('tokenize', () => {
  it('выделяет формулы, клозы и разделитель', () => {
    const t = tokenize('Ранг $r$ :: {{dim}} $$x$$');
    expect(t.map((s) => s.t)).toEqual(['text', 'math', 'text', 'sep', 'text', 'cloze', 'text', 'math']);
  });
  it('экранированный доллар — не формула', () => {
    expect(tokenize('цена \\$5').every((s) => s.t === 'text')).toBe(true);
  });
});

describe('planCardSync', () => {
  const now = 1_700_000_000_000;

  it('создаёт новые карточки', () => {
    const r = planCardSync('b1', 'd1', parseCards('q :: a'), [], now);
    expect(r.put).toHaveLength(1);
    expect(r.put[0].id).toBe('b1#fwd');
    expect(r.remove).toEqual([]);
  });

  it('при правке ответа сохраняет историю повторений', () => {
    const old = { ...newCardRow('b1', 'd1', parseCards('q :: a')[0], now), reps: 5, stability: 12, state: 2 };
    const r = planCardSync('b1', 'd1', parseCards('q :: исправленный ответ'), [old], now + 1);
    expect(r.put).toHaveLength(1);
    expect(r.put[0]).toMatchObject({ id: 'b1#fwd', reps: 5, stability: 12, back: 'исправленный ответ' });
  });

  it('ничего не делает, если текст карточки не изменился', () => {
    const old = newCardRow('b1', 'd1', parseCards('q :: a')[0], now);
    expect(planCardSync('b1', 'd1', parseCards('q :: a'), [old], now)).toEqual({ put: [], remove: [] });
  });

  it('удаляет карточки, которых больше нет', () => {
    const cards = parseCards('q ;; a').map((p) => newCardRow('b1', 'd1', p, now));
    const r = planCardSync('b1', 'd1', parseCards('q :: a'), cards, now);
    expect(r.remove).toEqual(['b1#rev']);
  });
});
