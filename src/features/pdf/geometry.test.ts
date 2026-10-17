import { describe, expect, it } from 'vitest';
import { findInPages, selectionRects, toPdfRect } from './geometry';

let n = 0;
const id = () => 'r' + ++n;
const page = { left: 100, top: 50, width: 600, height: 800 };

describe('выделения в PDF', () => {
  it('куски одной строки склеиваются, разные строки — нет', () => {
    const rects = selectionRects(
      [
        { left: 160, top: 130, width: 100, height: 20 },
        { left: 260, top: 131, width: 80, height: 19 },
        { left: 160, top: 160, width: 50, height: 20 },
        { left: 300, top: 300, width: 0, height: 20 }, // пустой — отбрасывается
      ],
      page,
      id,
    );
    expect(rects).toHaveLength(2);
    expect(rects[0].x).toBeCloseTo(0.1);
    expect(rects[0].w).toBeCloseTo(180 / 600);
    expect(rects[1].y).toBeCloseTo(110 / 800);
  });

  it('прямоугольники за пределами страницы обрезаются', () => {
    const [r] = selectionRects([{ left: 650, top: 100, width: 200, height: 20 }], page, id);
    expect(r.x + r.w).toBeLessThanOrEqual(1);
  });

  it('поиск по страницам', () => {
    const hits = findInPages(['Ранг   матрицы равен…', 'ничего', 'ещё раз ранг матрицы'], 'ранг матрицы');
    expect(hits.map((h) => h.page)).toEqual([1, 3]);
    expect(hits[0].snippet).toContain('Ранг матрицы');
    expect(findInPages(['abc'], 'a')).toEqual([]);
  });

  it('перевод в координаты PDF (ось Y снизу)', () => {
    expect(toPdfRect({ x: 0.1, y: 0.1, w: 0.5, h: 0.05 }, 600, 800)).toEqual({ x: 60, y: 680, width: 300, height: 40 });
  });
});
