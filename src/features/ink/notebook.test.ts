import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/db';
import type { Page, PageItem, Stroke } from '../../db/schema';
import { pagesToExport, wrapLines } from './exportNotebook';
import { duplicateItems, itemsBBox, moveItems, placeImage, scaleItems, selectItemsByLasso } from './items';
import { appendPage, ensureSparePage, needsSparePage, pageIds, setPageLook } from './notebook';
import { autoInkFor, isLight, paperGeometry } from './paper';

const now = Date.now();
const stroke: Stroke = { id: 's', tool: 'pen', color: 'auto', size: 2, points: [1, 1, 0.5, 5, 5, 0.5] };
const page = (id: string, order: number, extra: Partial<Page> = {}): Page => ({ id, docId: 'nb', order, background: 'grid', strokes: [], createdAt: now, updatedAt: now, ...extra });

describe('листы тетради', () => {
  beforeEach(async () => {
    await db.pages.clear();
  });

  it('новый лист нужен, только когда пишем в конце и последний не пустой', () => {
    expect(needsSparePage(4, 5, false)).toBe(true); // последний
    expect(needsSparePage(3, 5, false)).toBe(true); // предпоследний, а последний занят
    expect(needsSparePage(3, 5, true)).toBe(false); // чистый лист уже есть
    expect(needsSparePage(1, 5, false)).toBe(false); // пишем в середине
  });

  it('id листов по порядку, без чтения штрихов; запасной лист наследует оформление', async () => {
    await db.pages.bulkAdd([page('b', 1, { strokes: [stroke], paper: '#fdf8ee', background: 'dots' }), page('a', 0)]);
    expect(await pageIds('nb')).toEqual(['a', 'b']);
    expect(await ensureSparePage('nb', 1)).toBe(true);
    const ids = await pageIds('nb');
    expect(ids).toHaveLength(3);
    expect(await db.pages.get(ids[2])).toMatchObject({ order: 2, background: 'dots', paper: '#fdf8ee', strokes: [] });
    // последний пустой — повторно не добавляем
    expect(await ensureSparePage('nb', 1)).toBe(false);
    expect(await pageIds('nb')).toHaveLength(3);
  });

  it('оформление: один лист или все; «как в теме» убирает цвет', async () => {
    await db.pages.bulkAdd([page('a', 0, { paper: '#ffffff' }), page('b', 1)]);
    await setPageLook('a', { background: 'lines', lineColor: '#a5c8ec' });
    expect(await db.pages.get('a')).toMatchObject({ background: 'lines', lineColor: '#a5c8ec' });
    expect((await db.pages.get('b'))!.background).toBe('grid');
    await setPageLook('a', { paper: undefined, background: 'cornell' }, 'nb');
    const all = await db.pages.toArray();
    expect(all.every((p) => p.background === 'cornell' && p.paper === undefined)).toBe(true);
  });

  it('пустая тетрадь получает первый лист', async () => {
    const p = await appendPage('nb2');
    expect(p).toMatchObject({ order: 0, background: 'grid' });
  });

  it('в PDF не попадают пустые листы в конце', () => {
    const pages = [page('a', 0, { strokes: [stroke] }), page('b', 1), page('c', 2, { items: [{ id: 'i', kind: 'text', x: 0, y: 0, w: 10, h: 10, text: 'x' }] }), page('d', 3), page('e', 4)];
    expect(pagesToExport(pages).map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(pagesToExport([page('z', 0)])).toHaveLength(1);
  });
});

describe('фоны листа', () => {
  it('клетка, линейка с полем, точки, Корнелл, нотный стан', () => {
    expect(paperGeometry('blank', 1000, 1414)).toEqual({ lines: [], margins: [], dots: [] });
    const grid = paperGeometry('grid', 1000, 1414);
    expect(grid.lines).toHaveLength(24 + 35);
    expect(paperGeometry('lines', 1000, 1414).margins).toEqual([[70, 0, 70, 1414]]);
    expect(paperGeometry('dots', 1000, 1414).dots).toHaveLength(24 * 35);
    expect(paperGeometry('cornell', 1000, 1414).margins).toHaveLength(3);
    expect(paperGeometry('music', 1000, 1414).lines.length % 5).toBe(0);
  });

  it('«авто»-чернила тёмные на светлой бумаге и светлые на тёмной', () => {
    expect(isLight('#fdf8ee')).toBe(true);
    expect(isLight('#25212a')).toBe(false);
    expect(autoInkFor('#1f3a2e')).toBe('#f4ecef');
  });
});

describe('объекты на листе', () => {
  const items: PageItem[] = [
    { id: 't', kind: 'text', x: 100, y: 100, w: 200, h: 40, text: 'Митоз', fontSize: 28 },
    { id: 'i', kind: 'image', x: 500, y: 500, w: 300, h: 200, fileId: 'f' },
  ];

  it('лассо выбирает по центру объекта', () => {
    expect(selectItemsByLasso(items, [0, 0, 400, 0, 400, 400, 0, 400])).toEqual(['t']);
  });

  it('перенос, масштаб (со шрифтом) и копия', () => {
    expect(moveItems(items, ['i'], 10, -20)[1]).toMatchObject({ x: 510, y: 480 });
    const s = scaleItems(items, ['t'], 100, 100, 2)[0];
    expect(s).toMatchObject({ x: 100, y: 100, w: 400, h: 80, fontSize: 56 });
    let n = 0;
    const d = duplicateItems(items, ['i'], 24, () => 'c' + ++n);
    expect(d.items[2]).toMatchObject({ id: 'c1', x: 524, fileId: 'f' });
    expect(itemsBBox(items)).toEqual({ x: 100, y: 100, w: 700, h: 600 });
  });

  it('картинка ставится по центру видимой части с сохранением пропорций', () => {
    const p = placeImage(4000, 3000, 1000, 1414, 300);
    expect(p.w).toBe(700);
    expect(p.h).toBe(525);
    expect(p.x).toBe(150);
    expect(p.y).toBe(37.5);
  });
});

describe('экспорт текста', () => {
  it('перенос строк по ширине и по абзацам', () => {
    const measure = (s: string) => s.length * 10;
    expect(wrapLines('раз два три четыре', 90, measure)).toEqual(['раз два', 'три', 'четыре']);
    expect(wrapLines('a\nb', 100, measure)).toEqual(['a', 'b']);
  });
});
