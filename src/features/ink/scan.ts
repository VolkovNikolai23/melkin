// «Сканер» для фото доски и слайдов: поиск углов, выпрямление перспективы и улучшение
// (белый фон, контраст). Всё считается офлайн над массивом пикселей RGBA.

export interface Img {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export type Pt = [number, number];
/** Углы: левый верхний, правый верхний, правый нижний, левый нижний */
export type Quad = [Pt, Pt, Pt, Pt];

const lum = (d: Uint8ClampedArray, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/** Уменьшенная копия яркости (для поиска углов достаточно ~320 px). */
function smallGray(img: Img, maxSide: number): { g: Float32Array; w: number; h: number; k: number } {
  const k = Math.max(1, Math.max(img.width, img.height) / maxSide);
  const w = Math.max(1, Math.round(img.width / k));
  const h = Math.max(1, Math.round(img.height / k));
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x * k));
      const sy = Math.min(img.height - 1, Math.floor(y * k));
      g[y * w + x] = lum(img.data, (sy * img.width + sx) * 4);
    }
  return { g, w, h, k };
}

/** Порог Оцу: делит яркости на «фон» и «лист». */
function otsu(g: Float32Array): number {
  const hist = new Array(256).fill(0);
  for (const v of g) hist[Math.min(255, Math.max(0, Math.round(v)))]++;
  const total = g.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
}

/** Углы по умолчанию — небольшой отступ от краёв фото. */
export function defaultQuad(width: number, height: number, inset = 0.04): Quad {
  const dx = width * inset;
  const dy = height * inset;
  return [
    [dx, dy],
    [width - dx, dy],
    [width - dx, height - dy],
    [dx, height - dy],
  ];
}

/**
 * Ищет на фото светлый лист / доску / экран: самая большая связная светлая область,
 * углы — её крайние точки по диагоналям. Если ничего крупного не нашлось — отступ от краёв.
 */
export function detectQuad(img: Img): Quad {
  const { g, w, h, k } = smallGray(img, 320);
  const thr = otsu(g);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++) mask[i] = g[i] > thr ? 1 : 0;
  // связные области (заливка через стек), берём самую большую
  const label = new Int32Array(w * h).fill(-1);
  let bestId = -1;
  let bestSize = 0;
  const stack: number[] = [];
  let id = 0;
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s] !== -1) continue;
    let size = 0;
    stack.push(s);
    label[s] = id;
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % w;
      const y = (p - x) / w;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) if (q >= 0 && mask[q] && label[q] === -1) (label[q] = id), stack.push(q);
    }
    if (size > bestSize) {
      bestSize = size;
      bestId = id;
    }
    id++;
  }
  // слишком маленькая или почти весь кадр (не отделилась от фона) — не угадываем
  if (bestId < 0 || bestSize < w * h * 0.12 || bestSize > w * h * 0.97) return defaultQuad(img.width, img.height);
  let tl: Pt = [0, 0];
  let tr: Pt = [0, 0];
  let br: Pt = [0, 0];
  let bl: Pt = [0, 0];
  let mTl = Infinity;
  let mTr = -Infinity;
  let mBr = -Infinity;
  let mBl = -Infinity;
  for (let p = 0; p < label.length; p++) {
    if (label[p] !== bestId) continue;
    const x = p % w;
    const y = (p - x) / w;
    if (x + y < mTl) (mTl = x + y), (tl = [x, y]);
    if (x - y > mTr) (mTr = x - y), (tr = [x, y]);
    if (x + y > mBr) (mBr = x + y), (br = [x, y]);
    if (y - x > mBl) (mBl = y - x), (bl = [x, y]);
  }
  const up = (p: Pt): Pt => [Math.min(img.width, (p[0] + 0.5) * k), Math.min(img.height, (p[1] + 0.5) * k)];
  return [up(tl), up(tr), up(br), up(bl)];
}

/** Решение линейной системы методом Гаусса (8×8 для гомографии). */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    [m[c], m[piv]] = [m[piv], m[c]];
    const d = m[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / d;
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[n] / (row[i] || 1e-12));
}

/** Гомография, переводящая точки from[i] в to[i]. Возвращает 3×3 построчно (h33 = 1). */
export function homography(from: Quad, to: Quad): number[] {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  return [...solve(a, b), 1];
}

export function applyH(H: number[], x: number, y: number): Pt {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

/** Размер выпрямленного листа: по длинам сторон четырёхугольника, не больше maxSide. */
export function outputSize(q: Quad, maxSide = 2400): { width: number; height: number } {
  const d = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let width = Math.max(d(q[0], q[1]), d(q[3], q[2]));
  let height = Math.max(d(q[0], q[3]), d(q[1], q[2]));
  const k = Math.min(1, maxSide / Math.max(width, height));
  width = Math.max(1, Math.round(width * k));
  height = Math.max(1, Math.round(height * k));
  return { width, height };
}

/** Выпрямление: каждый пиксель результата берётся из фото (билинейная интерполяция). */
export function warp(img: Img, q: Quad, width: number, height: number): Img {
  const rect: Quad = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  const H = homography(rect, q);
  const out = new Uint8ClampedArray(width * height * 4);
  const src = img.data;
  const sw = img.width;
  const sh = img.height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [fx, fy] = applyH(H, x + 0.5, y + 0.5);
      const sx = Math.min(sw - 1.001, Math.max(0, fx - 0.5));
      const sy = Math.min(sh - 1.001, Math.max(0, fy - 0.5));
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const ax = sx - x0;
      const ay = sy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = src[i00 + c] * (1 - ax) + src[i10 + c] * ax;
        const bot = src[i01 + c] * (1 - ax) + src[i11 + c] * ax;
        out[o + c] = top * (1 - ay) + bot * ay;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width, height };
}

export type EnhanceMode = 'none' | 'color' | 'bw';

/**
 * Улучшение «как у сканера»: оцениваем освещение (яркий фон) крупными блоками и делим на него —
 * тени и неровный свет исчезают, фон становится белым; затем добавляем контраст.
 * 'bw' — ещё и чёрно-белый документ.
 */
export function enhance(img: Img, mode: EnhanceMode): Img {
  if (mode === 'none') return img;
  const { width: w, height: h, data } = img;
  const B = Math.max(16, Math.round(Math.max(w, h) / 40)); // размер блока
  const bw = Math.ceil(w / B);
  const bh = Math.ceil(h / B);
  // фон блока — 90-й перцентиль яркости (светлая бумага/доска, без чернил)
  const bg = new Float32Array(bw * bh);
  const hist = new Uint32Array(64);
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      hist.fill(0);
      let n = 0;
      for (let y = by * B; y < Math.min(h, (by + 1) * B); y += 2)
        for (let x = bx * B; x < Math.min(w, (bx + 1) * B); x += 2) {
          hist[Math.min(63, lum(data, (y * w + x) * 4) >> 2)]++;
          n++;
        }
      let acc = 0;
      let v = 63;
      for (let i = 0; i < 64; i++) {
        acc += hist[i];
        if (acc >= n * 0.9) {
          v = i;
          break;
        }
      }
      bg[by * bw + bx] = Math.max(40, v * 4 + 2);
    }
  // сглаживаем карту фона 3×3, чтобы не было ступенек между блоками
  const sm = new Float32Array(bg.length);
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      let s = 0;
      let c = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = bx + dx;
          const y = by + dy;
          if (x >= 0 && y >= 0 && x < bw && y < bh) (s += bg[y * bw + x]), c++;
        }
      sm[by * bw + bx] = s / c;
    }
  const bgAt = (x: number, y: number) => {
    // билинейно между центрами блоков
    const fx = Math.min(bw - 1, Math.max(0, x / B - 0.5));
    const fy = Math.min(bh - 1, Math.max(0, y / B - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(bw - 1, x0 + 1);
    const y1 = Math.min(bh - 1, y0 + 1);
    const ax = fx - x0;
    const ay = fy - y0;
    const top = sm[y0 * bw + x0] * (1 - ax) + sm[y0 * bw + x1] * ax;
    const bot = sm[y1 * bw + x0] * (1 - ax) + sm[y1 * bw + x1] * ax;
    return top * (1 - ay) + bot * ay;
  };
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const k = 255 / bgAt(x, y);
      if (mode === 'bw') {
        const v = Math.min(1, (lum(data, i) * k) / 255);
        // мягкий порог: светлое → белое, линии — тёмные и чёткие
        const t = Math.min(1, Math.max(0, (v - 0.45) / 0.4));
        const o = 255 * t * t * (3 - 2 * t);
        out[i] = out[i + 1] = out[i + 2] = o;
      } else {
        for (let c = 0; c < 3; c++) {
          const v = Math.min(1, (data[i + c] * k) / 255);
          // контраст: тёмное темнее, почти белое — белое
          const t = Math.min(1, Math.max(0, (v - 0.12) / 0.8));
          out[i + c] = 255 * Math.pow(t, 1.25);
        }
      }
      out[i + 3] = 255;
    }
  return { data: out, width: w, height: h };
}
