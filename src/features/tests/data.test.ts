import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/db';
import { appendBlock } from '../notes/blocks';
import { createDoc, createFolder } from '../notes/docs';
import { syncBlockCards } from '../cards/sync';
import { addMistakeCards, attemptsIn, createCardTest, normalizeAiQuestions, saveAttempt } from './data';

describe('вопросы от ИИ', () => {
  it('все 7 типов; сломанные отброшены; подписи — с номером слайда и областями', () => {
    const { questions, labels } = normalizeAiQuestions(
      {
        questions: [
          { kind: 'single', prompt: 'Где ДНК?', options: ['ядро', 'рибосома'], correct: 0, explanation: 'ядро хранит ДНК' },
          { kind: 'single', prompt: 'плохой', options: ['a'], correct: 3 },
          { kind: 'multiple', prompt: 'Органоиды', options: ['ядро', 'вода', 'рибосома'], correct: [0, 2, 9] },
          { kind: 'truefalse', prompt: 'Митоз даёт 4 клетки', answer: 'false' },
          { kind: 'open', prompt: 'Что такое ген?', answer: 'участок ДНК' },
          { kind: 'match', prompt: 'Сопоставьте', left: ['a', 'b'], right: ['1'] },
          { kind: 'match', prompt: 'Сопоставьте', left: ['a', 'b'], right: ['1', '2'] },
          { kind: 'order', prompt: 'Фазы', items: ['Профаза', 'Метафаза', 'Анафаза'] },
          { kind: 'label', prompt: 'Подпишите', page: 2, labels: [{ text: 'ядро', box: [100, 100, 150, 300] }, { text: 'мембрана', box: [500, 50, 540, 200] }] },
          { kind: 'label', prompt: 'Выдуманный слайд', page: 40, labels: [{ text: 'x', box: [1, 1, 50, 50] }, { text: 'y', box: [60, 60, 90, 90] }] },
        ],
      },
      3,
    );
    expect(questions.map((q) => q.kind)).toEqual(['single', 'multiple', 'truefalse', 'open', 'match', 'order', 'label']);
    expect(questions[1].data).toMatchObject({ correct: [0, 2] });
    expect(questions[2].data).toEqual({ kind: 'truefalse', answer: false });
    const label = labels.get(questions[6].id)!;
    expect(label.page).toBe(2);
    expect(label.areas[0]).toMatchObject({ x: 0.1, y: 0.1, text: 'ядро' });
    expect(questions[0].explanation).toBe('ядро хранит ДНК');
  });
});

describe('тесты в базе', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('тест по теме из карточек всех лекций, попытка и знание, ошибки → карточки', async () => {
    const topic = await createFolder('topic', null, 'Клетка');
    const lecture = await createDoc('lecture', topic.id, 'Деление');
    const note = await createDoc('note', lecture.id, 'Термины');
    for (const t of ['Митоз :: деление на две', 'Мейоз :: деление на четыре', 'Профаза >> спирализация', 'Анафаза >> расхождение', 'Телофаза >> ядра', 'Цитокинез >> цитоплазма']) {
      const b = await appendBlock(note.id, 'text', t);
      await syncBlockCards(b.id);
    }
    const test = await createCardTest(topic);
    expect(test.questions.length).toBeGreaterThanOrEqual(5);
    expect(test.source).toBe('cards');
    await saveAttempt(test, [
      { questionId: 'a', correct: true, answer: null },
      { questionId: 'b', correct: false, score: 0.5, answer: null },
    ]);
    const attempts = await attemptsIn([topic.id]);
    expect(attempts[0].score).toBe(0.75);

    // ошибки темы — в заметку «Ошибки из тестов» внутри темы
    const doc = await addMistakeCards(topic.id, [{ kind: 'qa', front: 'Что в анафазе?', back: 'расхождение хроматид' }]);
    expect(doc.title).toBe('Ошибки из тестов');
    expect(await db.cards.where('docId').equals(doc.id).count()).toBe(1);
    // ошибки лекции — в её «Сводки»
    const d2 = await addMistakeCards(lecture.id, [{ kind: 'list', front: 'Фазы', items: ['a', 'b'] }]);
    expect(d2.title).toBe('Сводки');
  });

  it('мало карточек — понятная ошибка', async () => {
    const topic = await createFolder('topic', null, 'Пусто');
    await expect(createCardTest(topic)).rejects.toThrow(/карточ/);
  });
});
