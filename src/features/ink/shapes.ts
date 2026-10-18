// Автофигуры: провела линию/круг/прямоугольник/стрелку и задержала Pencil — штрих
// заменяется ровной фигурой. Распознавание — чистые функции над точками x, y, p.

export type ShapeKind = 'line' | 'arrow' | 'circle' | 'ellipse' | 'rect' | 'triangle' | 'polygon';

export interface Shape {
  kind: ShapeKind;
  /** Плоский массив x, y, p — готовые точки штриха */
  points: number[];
}

type Pt = [number, number];

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function toPts(flat: number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 3) out.push([flat[i], flat[i + 1]]);
  return out;
}

function pathLength(pts: Pt[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

/** Расстояние от точки до отрезка ab. */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
}

/** Упрощение ломаной (Рамер — Дуглас — Пекер). */
export function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  let maxD = 0;
  let idx = 0;
  const a = pts[0];
  const b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], a, b);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= eps) return [a, b];
  const left = simplify(pts.slice(0, idx + 1), eps);
  const right = simplify(pts.slice(idx), eps);
  return [...left.slice(0, -1), ...right];
}

/** Равномерно расставляет точки по ломаной (плотность — для ровного контура perfect-freehand). */
function densify(poly: Pt[], step = 6): number[] {
  const out: number[] = [];
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    const n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 0; k < n; k++) out.push(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, 0.5);
  }
  const last = poly[poly.length - 1];
  out.push(last[0], last[1], 0.5);
  return out.map((v) => Math.round(v * 100) / 100);
}

function ellipsePoints(cx: number, cy: number, rx: number, ry: number): number[] {
  const n = Math.max(24, Math.min(120, Math.round((Math.PI * (rx + ry)) / 6)));
  const poly: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2 - Math.PI / 2;
    poly.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return densify(poly, 100);
}

/** Наконечник стрелки: две линии от острия назад под углом ±28°. */
function arrowPoints(from: Pt, tip: Pt): number[] {
  const len = dist(from, tip);
  const head = Math.max(14, Math.min(60, len * 0.22));
  const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const wing = (s: number): Pt => [tip[0] - head * Math.cos(ang + s * 0.49), tip[1] - head * Math.sin(ang + s * 0.49)];
  return densify([from, tip, wing(1), tip, wing(-1)]);
}

/** Угол отрезка к ближайшей оси (0…45°). */
function axisDeviation(a: Pt, b: Pt): number {
  const ang = Math.abs((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI) % 90;
  return Math.min(ang, 90 - ang);
}

/** Почти горизонтальная/вертикальная линия выпрямляется по оси. */
function snapLine(a: Pt, b: Pt): [Pt, Pt] {
  const dx = Math.abs(b[0] - a[0]);
  const dy = Math.abs(b[1] - a[1]);
  if (axisDeviation(a, b) < 6) return dx > dy ? [a, [b[0], a[1]]] : [a, [a[0], b[1]]];
  return [a, b];
}

/**
 * Распознаёт фигуру в штрихе. Возвращает null, если штрих не похож ни на одну фигуру
 * (тогда остаётся рукописным).
 */
export function recognizeShape(flat: number[]): Shape | null {
  const pts = toPts(flat);
  if (pts.length < 4) return null;
  const len = pathLength(pts);
  if (len < 30) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const w = x1 - x0;
  const h = y1 - y0;
  const diag = Math.hypot(w, h);
  const start = pts[0];
  const end = pts[pts.length - 1];

  // 1. Прямая: все точки близко к хорде
  const chord = dist(start, end);
  if (chord > 25 && chord > len * 0.85) {
    const dev = Math.max(...pts.map((p) => segDist(p, start, end)));
    if (dev < Math.max(6, chord * 0.07)) {
      const [a, b] = snapLine(start, end);
      return { kind: 'line', points: densify([a, b]) };
    }
  }

  // 2. Стрелка: прямой «стержень» до самой дальней от начала точки + короткий хвост-наконечник
  let tipIdx = 0;
  let far = 0;
  pts.forEach((p, i) => {
    const d = dist(start, p);
    if (d > far) {
      far = d;
      tipIdx = i;
    }
  });
  const tip = pts[tipIdx];
  if (far > 40 && tipIdx < pts.length - 2) {
    const shaft = pts.slice(0, tipIdx + 1);
    const tail = pts.slice(tipIdx);
    const shaftLen = pathLength(shaft);
    const tailLen = pathLength(tail);
    const shaftDev = Math.max(...shaft.map((p) => segDist(p, start, tip)));
    // хвост короткий, держится у острия и возвращается назад (не продолжает линию)
    const tailFar = Math.max(...tail.map((p) => dist(p, tip)));
    if (shaftLen < far * 1.15 && shaftDev < Math.max(6, far * 0.07) && tailLen > far * 0.12 && tailLen < far * 1.1 && tailFar < far * 0.45) {
      const [a, b] = snapLine(start, tip);
      return { kind: 'arrow', points: arrowPoints(a, b) };
    }
  }

  // Остальные фигуры замкнутые: конец возле начала
  if (diag < 30 || dist(start, end) > Math.max(25, diag * 0.25)) return null;

  // 3. Многоугольник: углы по упрощённой ломаной
  const closed = [...pts, start];
  const simple = simplify(closed, Math.max(6, diag * 0.07));
  // дубль начальной точки в конце и почти совпадающие соседи не считаем углами
  const corners: Pt[] = [];
  for (const p of simple.slice(0, -1)) if (!corners.length || dist(corners[corners.length - 1], p) > diag * 0.12) corners.push(p);
  if (corners.length > 2 && dist(corners[0], corners[corners.length - 1]) < diag * 0.12) corners.pop();

  // насколько точки ложатся на эллипс, вписанный в рамку
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = w / 2 || 1;
  const ry = h / 2 || 1;
  const ellipseErr = pts.reduce((s, [x, y]) => s + Math.abs(Math.hypot((x - cx) / rx, (y - cy) / ry) - 1), 0) / pts.length;

  if (corners.length === 4 && ellipseErr > 0.08) {
    const sides = corners.map((c, i) => [c, corners[(i + 1) % 4]] as [Pt, Pt]);
    if (sides.every(([a, b]) => axisDeviation(a, b) < 15)) {
      return { kind: 'rect', points: densify([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]) };
    }
    return { kind: 'polygon', points: densify([...corners, corners[0]]) };
  }
  if (corners.length === 3 && ellipseErr > 0.1) return { kind: 'triangle', points: densify([...corners, corners[0]]) };

  if (ellipseErr < 0.14) {
    const ratio = w / h;
    if (ratio > 0.82 && ratio < 1.22) {
      const r = (w + h) / 4;
      return { kind: 'circle', points: ellipsePoints(cx, cy, r, r) };
    }
    return { kind: 'ellipse', points: ellipsePoints(cx, cy, rx, ry) };
  }
  if (corners.length >= 5 && corners.length <= 6) return { kind: 'polygon', points: densify([...corners, corners[0]]) };
  return null;
}
