import { describe, expect, it } from 'vitest';
import { applyH, detectQuad, enhance, homography, outputSize, warp, type Img, type Quad } from './scan';

function image(w: number, h: number, fill: (x: number, y: number) => number): Img {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = fill(x, y);
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  return { data, width: w, height: h };
}

const at = (img: Img, x: number, y: number) => img.data[(y * img.width + x) * 4];

// Светлый наклонный четырёхугольник (лист на тёмном столе)
const sheet: Quad = [
  [60, 40],
  [330, 70],
  [310, 260],
  [40, 230],
];
function inside(x: number, y: number, q: Quad) {
  let c = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const [xi, yi] = q[i];
    const [xj, yj] = q[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

describe('сканер', () => {
  it('гомография переводит углы в углы', () => {
    const rect: Quad = [
      [0, 0],
      [100, 0],
      [100, 50],
      [0, 50],
    ];
    const H = homography(rect, sheet);
    rect.forEach((p, i) => {
      const [x, y] = applyH(H, p[0], p[1]);
      expect(x).toBeCloseTo(sheet[i][0], 6);
      expect(y).toBeCloseTo(sheet[i][1], 6);
    });
  });

  it('находит углы светлого листа на тёмном фоне', () => {
    const img = image(400, 300, (x, y) => (inside(x, y, sheet) ? 235 : 40));
    const q = detectQuad(img);
    q.forEach((p, i) => {
      expect(Math.abs(p[0] - sheet[i][0])).toBeLessThan(6);
      expect(Math.abs(p[1] - sheet[i][1])).toBeLessThan(6);
    });
  });

  it('если листа не видно — углы с отступом от краёв', () => {
    const q = detectQuad(image(200, 100, () => 128));
    expect(q[0][0]).toBeCloseTo(8);
    expect(q[2][1]).toBeCloseTo(96);
  });

  it('выпрямление: внутри листа всё светлое, края стола не попадают', () => {
    const img = image(400, 300, (x, y) => (inside(x, y, sheet) ? 235 : 40));
    const { width, height } = outputSize(sheet);
    expect(width).toBeGreaterThan(260);
    const out = warp(img, sheet, width, height);
    expect(at(out, 2, 2)).toBeGreaterThan(200);
    expect(at(out, width - 3, height - 3)).toBeGreaterThan(200);
    expect(at(out, width >> 1, height >> 1)).toBe(235);
  });

  it('улучшение убирает тень: фон белый, линии тёмные', () => {
    // фон с градиентом освещения (тень слева) и тёмная линия посередине
    const img = image(400, 200, (x, y) => (Math.abs(y - 100) < 3 ? 60 + x / 10 : 120 + x / 4));
    const out = enhance(img, 'color');
    expect(at(out, 10, 20)).toBeGreaterThan(235);
    expect(at(out, 390, 20)).toBeGreaterThan(235);
    expect(at(out, 10, 100)).toBeLessThan(140);
    const bw = enhance(img, 'bw');
    expect(at(bw, 200, 20)).toBe(255);
    expect(at(bw, 200, 100)).toBeLessThan(60);
  });
});
