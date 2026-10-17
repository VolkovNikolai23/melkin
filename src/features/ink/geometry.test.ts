import { describe, expect, it } from 'vitest';
import type { Stroke } from '../../db/schema';
import { duplicateStrokes, hitStroke, moveStrokes, pointInPolygon, recolorStrokes, selectByLasso, strokesBBox } from './geometry';

const line = (id: string, x0: number, y0: number, x1: number, y1: number): Stroke => ({
  id,
  tool: 'pen',
  color: 'auto',
  size: 2,
  points: [x0, y0, 0.5, (x0 + x1) / 2, (y0 + y1) / 2, 0.5, x1, y1, 0.5],
});
const square = [0, 0, 100, 0, 100, 100, 0, 100];
let n = 0;
const newId = () => 'n' + ++n;

describe('лассо', () => {
  it('точка в многоугольнике', () => {
    expect(pointInPolygon(50, 50, square)).toBe(true);
    expect(pointInPolygon(150, 50, square)).toBe(false);
  });

  it('выбирает штрихи, которые в основном внутри', () => {
    const s = [line('in', 10, 10, 90, 90), line('half', 50, 50, 300, 300), line('out', 200, 200, 300, 300)];
    expect(selectByLasso(s, square)).toEqual(['in']);
  });

  it('перенос сдвигает только выбранные и выдаёт новые id', () => {
    const s = [line('a', 0, 0, 10, 10), line('b', 50, 50, 60, 60)];
    const r = moveStrokes(s, ['a'], 5, -5, newId);
    expect(r.strokes[0].points.slice(0, 3)).toEqual([5, -5, 0.5]);
    expect(r.strokes[0].id).not.toBe('a');
    expect(r.strokes[1]).toBe(s[1]);
    expect(r.ids).toEqual([r.strokes[0].id]);
  });

  it('копия добавляется со сдвигом, перекраска меняет цвет', () => {
    const s = [line('a', 0, 0, 10, 10)];
    const d = duplicateStrokes(s, ['a'], 20, newId);
    expect(d.strokes).toHaveLength(2);
    expect(d.strokes[1].points[0]).toBe(20);
    const c = recolorStrokes(d.strokes, d.ids, '#dc2626', newId);
    expect(c.strokes[1].color).toBe('#dc2626');
    expect(c.strokes[0].color).toBe('auto');
  });

  it('габариты и попадание ластика', () => {
    expect(strokesBBox([line('a', 10, 20, 30, 40)])).toEqual({ x: 8, y: 18, w: 24, h: 24 });
    expect(strokesBBox([])).toBeNull();
    expect(hitStroke(line('a', 0, 0, 100, 0), 50, 3, 4)).toBe(true);
    expect(hitStroke(line('a', 0, 0, 100, 0), 50, 30, 4)).toBe(false);
  });
});
