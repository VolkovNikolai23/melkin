import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/db';
import type { Outline } from '../../db/schema';
import { createDoc } from '../notes/docs';
import { parseCommons } from './commons';
import { diagramSvg, wrapText } from './diagrams';
import { addCards, cardText, materialText, normalizeCards, normalizeOutline, sanitizeSummary, saveOutline } from './lecture';

describe('разбивка и материал', () => {
  it('нормализует ответ: страницы в пределах, пустые подтемы и темы убраны', () => {
    const o = normalizeOutline(
      { topics: [{ title: ' Митоз ', subtopics: [{ title: 'Фазы', pages: [2, 2, 1, 99, 'x'] }, { title: '' }] }, { title: 'Пусто', subtopics: [] }] },
      5,
    );
    expect(o).toHaveLength(1);
    expect(o[0].title).toBe('Митоз');
    expect(o[0].subtopics).toHaveLength(1);
    expect(o[0].subtopics[0].pages).toEqual([1, 2]);
    expect(o[0].id).toBeTruthy();
  });

  it('текст материала: выбранные слайды с номерами и конспект, обрезка по длине', () => {
    const m = { slides: ['Клетка', 'Митоз  делится', 'Мейоз'], notes: ['рукопись'] };
    const t = materialText(m, [2]);
    expect(t).toContain('=== Слайд 2 ===\nМитоз делится');
    expect(t).not.toContain('Слайд 1');
    expect(t).toContain('рукопись');
    expect(materialText(m, undefined, 20)).toContain('обрезан');
  });
});

describe('сводки и карточки', () => {
  it('сводка не создаёт карточек: синтаксис заменяется', () => {
    expect(sanitizeSummary('- **ДНК** >> хранит {{гены}} :: да')).toBe('**ДНК** → хранит гены : да');
  });

  it('карточки: виды, пустые и сломанные отбрасываются', () => {
    const cards = normalizeCards({
      cards: [
        { kind: 'term', front: 'Митоз', back: 'деление >> на две' },
        { kind: 'qa', front: 'Сколько хромосом?', back: '' },
        { kind: 'cloze', front: 'У человека {{46}} хромосом' },
        { kind: 'cloze', front: 'без пропуска' },
        { kind: 'list', front: 'Фазы митоза', items: ['Профаза', 'Метафаза', 'Анафаза', 'Телофаза'] },
      ],
    });
    expect(cards.map((c) => c.kind)).toEqual(['term', 'cloze', 'list']);
    expect(cardText(cards[0])).toEqual({ text: 'Митоз :: деление → на две', children: [] });
    expect(cardText(cards[2]).text).toBe('Фазы митоза >>1.');
    expect(cardText({ kind: 'qa', front: 'Q', back: 'A' }).text).toBe('Q >> A');
  });
});

describe('схемы', () => {
  it('цепочка, цикл и сравнение — SVG с экранированным текстом', () => {
    const flow = diagramSvg({ kind: 'flow', title: 'Митоз', items: ['Профаза', 'Метафаза', 'Анафаза <А>', 'Телофаза', 'Цитокинез'] })!;
    expect(flow).toContain('<svg');
    expect(flow).toContain('Анафаза &lt;А&gt;');
    expect(flow.match(/marker-end/g)).toHaveLength(4);
    expect(diagramSvg({ kind: 'cycle', title: 'Цикл Кребса', items: ['a', 'b', 'c'] })).toContain('<path');
    expect(diagramSvg({ kind: 'compare', title: '', columns: ['Митоз', 'Мейоз'], rows: [['2 клетки', '4 клетки']] })).toContain('4 клетки');
    expect(diagramSvg({ kind: 'flow', title: '', items: ['один'] })).toBeNull();
  });

  it('перенос текста по ширине', () => {
    expect(wrapText('очень длинное название органоида клетки', 120, 20).length).toBeGreaterThan(1);
  });
});

describe('Wikimedia Commons', () => {
  it('порядок по релевантности, лицензия и автор без HTML, мелкие отброшены', () => {
    const r = parseCommons({
      query: {
        pages: {
          '2': { index: 2, title: 'File:Mitosis b.png', imageinfo: [{ thumburl: 'https://u/b.png', thumbwidth: 1000, descriptionurl: 'https://c/b', mime: 'image/png', extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<a href="x">Ivan</a>' } } }] },
          '1': { index: 1, title: 'File:Mitosis a.jpg', imageinfo: [{ thumburl: 'https://u/a.jpg', thumbwidth: 800, descriptionurl: 'https://c/a', mime: 'image/jpeg' }] },
          '3': { index: 3, title: 'File:tiny.png', imageinfo: [{ thumburl: 'https://u/t.png', thumbwidth: 100, descriptionurl: 'https://c/t', mime: 'image/png' }] },
        },
      },
    });
    expect(r.map((i) => i.title)).toEqual(['Mitosis a', 'Mitosis b']);
    expect(r[1]).toMatchObject({ license: 'CC BY-SA 4.0', author: 'Ivan', page: 'https://c/b' });
  });
});

describe('заметка «Сводки»', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('разбивка → заголовки; переименование и удаление подтемы; одобренные карточки', async () => {
    const lecture = await createDoc('lecture', null, 'Деление клетки');
    const outline: Outline = [
      { id: 't1', title: 'Митоз', subtopics: [{ id: 's1', title: 'Фазы' }, { id: 's2', title: 'Значение' }] },
      { id: 't2', title: 'Мейоз', subtopics: [{ id: 's3', title: 'Кроссинговер' }] },
    ];
    const doc = await saveOutline(lecture, outline);
    let blocks = await db.blocks.where('docId').equals(doc.id).toArray();
    expect(blocks.filter((b) => b.heading === 2).map((b) => b.text).sort()).toEqual(['Мейоз', 'Митоз']);
    expect(blocks.filter((b) => b.heading === 3)).toHaveLength(3);
    expect((await db.docs.get(lecture.id))!.lecture!.summaryId).toBe(doc.id);

    const fresh = (await db.docs.get(lecture.id))!;
    await addCards(fresh, 's1', [
      { kind: 'term', front: 'Профаза', back: 'хромосомы спирализуются' },
      { kind: 'list', front: 'Фазы митоза', items: ['Профаза', 'Метафаза'] },
    ]);
    expect(await db.cards.where('docId').equals(doc.id).count()).toBeGreaterThanOrEqual(3);

    // правка разбивки: переименовали подтему, удалили «Значение»
    await saveOutline(fresh, [{ ...outline[0], subtopics: [{ id: 's1', title: 'Фазы митоза' }] }, outline[1]]);
    blocks = await db.blocks.where('docId').equals(doc.id).toArray();
    expect(blocks.filter((b) => b.heading === 3).map((b) => b.text).sort()).toEqual(['Кроссинговер', 'Фазы митоза']);
    // карточки переименованной подтемы на месте
    expect(blocks.some((b) => b.text === 'Профаза :: хромосомы спирализуются')).toBe(true);
  });
});
