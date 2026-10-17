import { getStroke } from 'perfect-freehand';
import type { Stroke } from '../../db/schema';

export const PEN_SIZES = [2, 4, 7];
export const MARKER_SIZE = 18;
export const PEN_COLORS = ['auto', '#2563eb', '#dc2626', '#16a34a', '#9333ea'];
export const MARKER_COLORS = ['#facc15', '#4ade80', '#f472b6', '#60a5fa'];

export function strokeOptions(s: Pick<Stroke, 'tool' | 'size'>, realPressure: boolean) {
  if (s.tool === 'marker') {
    return { size: s.size, thinning: 0, smoothing: 0.5, streamline: 0.5, simulatePressure: false, start: { cap: true }, end: { cap: true } };
  }
  return { size: s.size * 2.2, thinning: 0.6, smoothing: 0.5, streamline: 0.35, simulatePressure: !realPressure };
}

export function toPointTriples(flat: number[]): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) pts.push([flat[i], flat[i + 1], flat[i + 2]]);
  return pts;
}

/** Есть ли в штрихе реальные данные нажима (у мыши всегда 0.5). */
export function hasRealPressure(flat: number[]): boolean {
  for (let i = 2; i < flat.length; i += 3) if (flat[i] !== 0.5) return true;
  return false;
}

const avg = (a: number, b: number) => (a + b) / 2;

/** Контур perfect-freehand → путь SVG (квадратичные кривые). */
export function outlineToPath(points: number[][]): string {
  const len = points.length;
  if (len < 4) {
    if (!len) return '';
    // точка — рисуем маленький круг
    const [x, y] = points[0];
    return `M${x - 0.5},${y}a0.5,0.5 0 1,0 1,0a0.5,0.5 0 1,0 -1,0`;
  }
  let a = points[0];
  let b = points[1];
  const c = points[2];
  let d = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(2)} ${avg(b[0], c[0]).toFixed(2)},${avg(b[1], c[1]).toFixed(2)} T`;
  for (let i = 2, max = len - 1; i < max; i++) {
    a = points[i];
    b = points[i + 1];
    d += `${avg(a[0], b[0]).toFixed(2)},${avg(a[1], b[1]).toFixed(2)} `;
  }
  return d + 'Z';
}

// Штрихи неизменяемы после создания, поэтому контур кэшируем по id
// (объекты штрихов пересоздаются при каждом чтении из IndexedDB).
const pathCache = new Map<string, string>();

export function strokePath(s: Stroke): string {
  let p = pathCache.get(s.id);
  if (p === undefined) {
    const triples = toPointTriples(s.points);
    p = outlineToPath(getStroke(triples, strokeOptions(s, hasRealPressure(s.points))));
    if (pathCache.size > 20000) pathCache.clear();
    pathCache.set(s.id, p);
  }
  return p;
}

export function livePath(s: Pick<Stroke, 'tool' | 'size'>, flat: number[], realPressure: boolean): string {
  return outlineToPath(getStroke(toPointTriples(flat), { ...strokeOptions(s, realPressure), last: false }));
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx - px;
  const y = ay + t * dy - py;
  return Math.sqrt(x * x + y * y);
}

/** Ластик по штриху: задевает ли точка (x, y) с радиусом r данный штрих. */
export function hitStroke(s: Stroke, x: number, y: number, r: number): boolean {
  const pad = r + s.size * 1.2;
  const p = s.points;
  if (p.length < 3) return false;
  if (p.length === 3) return Math.hypot(p[0] - x, p[1] - y) <= pad;
  for (let i = 0; i + 5 < p.length; i += 3) {
    // быстрая отбраковка по прямоугольнику отрезка
    const minX = Math.min(p[i], p[i + 3]) - pad;
    const maxX = Math.max(p[i], p[i + 3]) + pad;
    if (x < minX || x > maxX) continue;
    const minY = Math.min(p[i + 1], p[i + 4]) - pad;
    const maxY = Math.max(p[i + 1], p[i + 4]) + pad;
    if (y < minY || y > maxY) continue;
    if (distToSegment(x, y, p[i], p[i + 1], p[i + 3], p[i + 4]) <= pad) return true;
  }
  return false;
}

export function strokesBottom(strokes: Stroke[]): number {
  let max = 0;
  for (const s of strokes) for (let i = 1; i < s.points.length; i += 3) if (s.points[i] > max) max = s.points[i];
  return max;
}
