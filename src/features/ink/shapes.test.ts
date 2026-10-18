import { describe, expect, it } from 'vitest';
import type { Stroke } from '../../db/schema';
import { hitStroke, scaleFactor, scaleStrokes, strokeAt, strokesBBox } from './geometry';
import { recognizeShape } from './shapes';

// Детерминированный «дрожащий» штрих: имитация руки без случайности
const jitter = (i: number, amp: number) => Math.sin(i * 1.7) * amp + Math.cos(i * 0.6) * amp * 0.5;

function poly(points: [number, number][], step = 4, amp = 1.5): number[] {
  const out: number[] = [];
  let k = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let j = 0; j < n; j++, k++) out.push(ax + ((bx - ax) * j) / n + jitter(k, amp), ay + ((by - ay) * j) / n + jitter(k + 3, amp), 0.5);
  }
  const [lx, ly] = points[points.length - 1];
  out.push(lx, ly, 0.5);
  return out;
}

function ellipse(cx: number, cy: number, rx: number, ry: number, turn = 1, amp = 2): number[] {
  const out: number[] = [];
  const n = 80;
  for (let i = 0; i <= n * turn; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push(cx + rx * Math.cos(t) + jitter(i, amp), cy + ry * Math.sin(t) + jitter(i + 5, amp), 0.5);
  }
  return out;
}

const xs = (flat: number[]) => flat.filter((_, i) => i % 3 === 0);
const ys = (flat: number[]) => flat.filter((_, i) => i % 3 === 1);

describe('автофигуры', () => {
  it('прямая линия, почти горизонтальная — выпрямляется по оси', () => {
    const s = recognizeShape(poly([[100, 200], [400, 210]]));
    expect(s?.kind).toBe('line');
    expect(new Set(ys(s!.points).map(Math.round)).size).toBe(1);
  });

  it('наклонная линия остаётся наклонной', () => {
    const s = recognizeShape(poly([[100, 100], [300, 300]]));
    expect(s?.kind).toBe('line');
    expect(Math.min(...xs(s!.points))).toBeCloseTo(100, -1);
    expect(Math.max(...ys(s!.points))).toBeCloseTo(300, -1);
  });

  it('стрелка: стержень и наконечник', () => {
    const s = recognizeShape(poly([[100, 300], [400, 300], [370, 280], [400, 300], [370, 322]]));
    expect(s?.kind).toBe('arrow');
    expect(Math.max(...xs(s!.points))).toBeCloseTo(400, -1);
  });

  it('круг и эллипс', () => {
    expect(recognizeShape(ellipse(300, 300, 100, 104))?.kind).toBe('circle');
    expect(recognizeShape(ellipse(300, 300, 160, 80))?.kind).toBe('ellipse');
  });

  it('прямоугольник выравнивается по рамке', () => {
    const s = recognizeShape(poly([[100, 100], [402, 104], [398, 300], [103, 296], [100, 104]]));
    expect(s?.kind).toBe('rect');
    expect(Math.min(...xs(s!.points))).toBeCloseTo(100, -1);
    expect(Math.max(...ys(s!.points))).toBeGreaterThan(290);
  });

  it('треугольник', () => {
    expect(recognizeShape(poly([[200, 100], [320, 300], [80, 300], [200, 104]]))?.kind).toBe('triangle');
  });

  it('каракули и короткие штрихи не трогаем', () => {
    expect(recognizeShape(poly([[10, 10], [14, 12]]))).toBeNull();
    // зигзаг (буква «м») — не фигура
    expect(recognizeShape(poly([[100, 300], [130, 200], [160, 300], [190, 200], [220, 300], [250, 210], [280, 300]], 4, 0.5))).toBeNull();
  });
});

const line = (id: string, x0: number, y0: number, x1: number, y1: number, tool: Stroke['tool'] = 'pen', color = 'auto'): Stroke => ({
  id,
  tool,
  color,
  size: 2,
  points: [x0, y0, 0.5, (x0 + x1) / 2, (y0 + y1) / 2, 0.5, x1, y1, 0.5],
});

describe('лассо: масштаб, пипетка, ластик', () => {
  it('масштаб относительно угла сохраняет пропорции и толщину', () => {
    let n = 0;
    const r = scaleStrokes([line('a', 0, 0, 100, 50), line('b', 500, 500, 600, 600)], ['a'], 0, 0, 2, () => 'n' + ++n);
    expect(r.ids).toEqual(['n1']);
    expect(strokesBBox([r.strokes[0]])).toMatchObject({ w: 200 + 8, h: 100 + 8 });
    expect(r.strokes[0].size).toBe(4);
    expect(r.strokes[1].id).toBe('b');
  });

  it('коэффициент по перетаскиванию угла', () => {
    const box = { x: 0, y: 0, w: 100, h: 50 };
    expect(scaleFactor(box, 100, 10)).toBe(2);
    expect(scaleFactor(box, -95, -49)).toBe(0.1); // не меньше 0.1
  });

  it('пипетка берёт верхний штрих, ручка важнее маркера', () => {
    const strokes = [line('m', 0, 0, 100, 0, 'marker', '#facc15'), line('p1', 0, 0, 100, 0, 'pen', '#dc2626'), line('p2', 0, 0, 100, 0, 'pen', '#2563eb')];
    expect(strokeAt(strokes, 50, 1)?.id).toBe('p2');
    expect(strokeAt([strokes[0]], 50, 1)?.color).toBe('#facc15');
    expect(strokeAt(strokes, 50, 300)).toBeNull();
  });

  it('ластик: тысячи штрихов проверяются быстро', () => {
    const many = Array.from({ length: 5000 }, (_, i) => line('s' + i, (i % 50) * 20, Math.floor(i / 50) * 14, (i % 50) * 20 + 15, Math.floor(i / 50) * 14 + 5));
    many.forEach((s) => hitStroke(s, -100, -100, 8)); // прогрев кэша рамок
    const t = performance.now();
    for (let k = 0; k < 60; k++) many.filter((s) => !hitStroke(s, 500 + k, 700, 8));
    expect((performance.now() - t) / 60).toBeLessThan(4); // мс на одно движение ластика
  });
});
