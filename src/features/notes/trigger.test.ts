import { describe, expect, it } from 'vitest';
import { detectTrigger, rankMatch } from './trigger';

const at = (t: string) => detectTrigger(t, t.length);

describe('detectTrigger', () => {
  it('[[ссылка', () => {
    expect(at('см. [[Ран')).toEqual({ kind: 'link', start: 4, query: 'Ран' });
    expect(at('см. [[Ранг]] и')).toBeNull();
  });
  it('((портал', () => {
    expect(at('((опред')).toEqual({ kind: 'portal', start: 0, query: 'опред' });
  });
  it('/команда только в начале или после пробела', () => {
    expect(at('/кар')).toEqual({ kind: 'slash', start: 0, query: 'кар' });
    expect(at('текст /')).toEqual({ kind: 'slash', start: 6, query: '' });
    expect(at('a/b')).toBeNull();
  });
  it('#тег, но не «# » и не середина слова', () => {
    expect(at('про #лин')).toEqual({ kind: 'tag', start: 4, query: 'лин' });
    expect(at('# ')).toBeNull();
    expect(at('C#')).toBeNull();
  });
  it('курсор в середине текста', () => {
    const t = 'a [[Ра b';
    expect(detectTrigger(t, 6)).toEqual({ kind: 'link', start: 2, query: 'Ра' });
  });
});

describe('rankMatch', () => {
  it('начало важнее вхождения', () => {
    expect(rankMatch('Ранг матрицы', 'ран')).toBe(3);
    expect(rankMatch('Ранг матрицы', 'матр')).toBe(2);
    expect(rankMatch('Подматрица', 'матр')).toBe(1);
    expect(rankMatch('Ядро', 'матр')).toBe(0);
  });
});
