// Фоны листа (клетка, линейка, точки, Корнелл, нотный стан) как набор линий и точек:
// одно описание и для экрана (SVG), и для экспорта в PDF.
import type { PageBackground } from '../../db/schema';

export const BG_LABEL: Record<PageBackground, string> = {
  blank: 'Чистый',
  grid: 'Клетка',
  smallgrid: 'Мелкая клетка',
  lines: 'Линейка',
  widelines: 'Широкая линейка',
  dots: 'Точки',
  cornell: 'Корнелл (поля для вопросов)',
  music: 'Нотный стан',
};

/** Цвета бумаги: undefined — как в теме приложения */
export const PAPER_COLORS: { color: string | undefined; label: string }[] = [
  { color: undefined, label: 'Как в теме' },
  { color: '#ffffff', label: 'Белая' },
  { color: '#fdf8ee', label: 'Кремовая' },
  { color: '#fdf0f3', label: 'Розовая' },
  { color: '#eef7f1', label: 'Мятная' },
  { color: '#eef4fb', label: 'Голубая' },
  { color: '#f3f1f6', label: 'Серая' },
  { color: '#25212a', label: 'Тёмная' },
  { color: '#1f3a2e', label: 'Школьная доска' },
];

export const LINE_COLORS: { color: string | undefined; label: string }[] = [
  { color: undefined, label: 'Как в теме' },
  { color: '#d4d4d8', label: 'Серые' },
  { color: '#a5c8ec', label: 'Голубые' },
  { color: '#f2b8c6', label: 'Розовые' },
  { color: '#a7d7b8', label: 'Зелёные' },
  { color: '#6b6475', label: 'Тёмные' },
];

export interface PaperGeometry {
  /** Отрезки x1, y1, x2, y2 */
  lines: number[][];
  /** Отрезки цвета полей (красная линия на линейке, разделители Корнелла) */
  margins: number[][];
  /** Точки x, y, r */
  dots: number[][];
}

export function paperGeometry(bg: PageBackground, w: number, h: number): PaperGeometry {
  const lines: number[][] = [];
  const margins: number[][] = [];
  const dots: number[][] = [];
  const hLines = (step: number, from = step) => {
    for (let y = from; y < h; y += step) lines.push([0, y, w, y]);
  };
  const vLines = (step: number) => {
    for (let x = step; x < w; x += step) lines.push([x, 0, x, h]);
  };
  switch (bg) {
    case 'grid':
      hLines(40);
      vLines(40);
      break;
    case 'smallgrid':
      hLines(20);
      vLines(20);
      break;
    case 'lines':
      hLines(40, 80);
      margins.push([70, 0, 70, h]);
      break;
    case 'widelines':
      hLines(56, 84);
      break;
    case 'dots':
      for (let y = 40; y < h; y += 40) for (let x = 40; x < w; x += 40) dots.push([x, y, 2]);
      break;
    case 'cornell': {
      // слева — колонка для вопросов, внизу — место для краткого итога
      const summary = h - 300;
      for (let y = 120; y < summary; y += 40) lines.push([0, y, w, y]);
      margins.push([0, 80, w, 80], [260, 80, 260, summary], [0, summary, w, summary]);
      break;
    }
    case 'music':
      for (let top = 100; top + 48 < h - 40; top += 120) for (let i = 0; i < 5; i++) lines.push([60, top + i * 12, w - 60, top + i * 12]);
      break;
  }
  return { lines, margins, dots };
}

/** Путь SVG из отрезков (одним элементом — быстрее сотен <line>). */
export function segmentsPath(segs: number[][]): string {
  return segs.map(([x1, y1, x2, y2]) => `M${x1} ${y1}L${x2} ${y2}`).join('');
}

export function dotsPath(dots: number[][]): string {
  return dots.map(([x, y, r]) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`).join('');
}

/** Светлая ли бумага (для «авто»-цвета чернил и линий). */
export function isLight(hex: string): boolean {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return true;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5;
}

/** «Авто»-цвет чернил на бумаге заданного цвета. */
export const autoInkFor = (paper: string) => (isLight(paper) ? '#2b2228' : '#f4ecef');
