import { describe, expect, it } from 'vitest';
import { fixRussianLayout } from './layout';
import { parseCards } from '../features/cards/parser';

describe('набор разметки в русской раскладке', () => {
  it('ЮЮ → >>, ББ → <<, БЮ → <>, ЖЖ → ::, жж → ;;', () => {
    expect(fixRussianLayout('Что такое ранг? ЮЮ размерность образа')).toBe('Что такое ранг? >> размерность образа');
    expect(fixRussianLayout('термин ББ определение')).toBe('термин << определение');
    expect(fixRussianLayout('базис БЮ система')).toBe('базис <> система');
    expect(fixRussianLayout('Ядро ЖЖ множество')).toBe('Ядро :: множество');
    expect(fixRussianLayout('размерность жж n')).toBe('размерность ;; n');
  });

  it('многострочный ответ, список и выбор ответа', () => {
    expect(fixRussianLayout('Свойства ЮЮЮ')).toBe('Свойства >>>');
    expect(fixRussianLayout('Шаги ЮЮ1.')).toBe('Шаги >>1.');
    expect(fixRussianLayout('Чему равен det I? ЮЮФ)')).toBe('Чему равен det I? >>A)');
  });

  it('клоз ХХ…ЪЪ → {{…}}', () => {
    expect(fixRussianLayout('Матрица ХХобратимаЪЪ, если ХХdet ≠ 0ЪЪ')).toBe('Матрица {{обратима}}, если {{det ≠ 0}}');
  });

  it('группа клоза c1 в русской раскладке', () => {
    expect(fixRussianLayout('ХХс1ЖЖстрочныйЪЪ и ХХс1ЖЖстолбцовыйЪЪ')).toBe('{{c1::строчный}} и {{c1::столбцовый}}');
  });

  it('длина не меняется, обычные слова не трогаются', () => {
    const t = 'Юлия, Борис и Жанна; дрожжи, жжение, ЮЮ';
    expect(fixRussianLayout(t)).toHaveLength(t.length);
    expect(fixRussianLayout('дрожжи жжение Юю')).toBe('дрожжи жжение Юю');
  });

  it('после исправления получается карточка', () => {
    expect(parseCards(fixRussianLayout('q ЮЮ a'))).toHaveLength(1);
  });
});
