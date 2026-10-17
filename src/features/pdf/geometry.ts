import type { Rect } from '../../db/schema';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Прямоугольники выделения текста → доли размера страницы (0…1).
 * Браузер отдаёт по прямоугольнику на каждый кусок строки — соседние на одной строке склеиваем.
 */
export function selectionRects(client: Box[], page: Box, newId: () => string): Rect[] {
  const rs = client
    .filter((r) => r.width > 0.5 && r.height > 0.5)
    .map((r) => ({
      x: (r.left - page.left) / page.width,
      y: (r.top - page.top) / page.height,
      w: r.width / page.width,
      h: r.height / page.height,
    }))
    .filter((r) => r.x + r.w > 0 && r.y + r.h > 0 && r.x < 1 && r.y < 1)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Omit<Rect, 'id'>[] = [];
  for (const r of rs) {
    const last = out.at(-1);
    const sameLine = last && Math.abs(last.y + last.h / 2 - (r.y + r.h / 2)) < Math.min(last.h, r.h) * 0.5;
    if (last && sameLine && r.x <= last.x + last.w + 0.01) {
      const x1 = Math.max(last.x + last.w, r.x + r.w);
      const y0 = Math.min(last.y, r.y);
      const y1 = Math.max(last.y + last.h, r.y + r.h);
      last.x = Math.min(last.x, r.x);
      last.w = x1 - last.x;
      last.y = y0;
      last.h = y1 - y0;
    } else out.push({ ...r });
  }
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return out.map((r) => ({ id: newId(), x: clamp(r.x), y: clamp(r.y), w: Math.min(r.w, 1 - clamp(r.x)), h: Math.min(r.h, 1 - clamp(r.y)) }));
}

export interface TextHit {
  page: number;
  index: number;
  snippet: string;
}

/** Поиск по тексту страниц (без учёта регистра и лишних пробелов). */
export function findInPages(pages: string[], query: string, limit = 200): TextHit[] {
  const q = query.trim().replace(/\s+/g, ' ').toLowerCase();
  if (q.length < 2) return [];
  const hits: TextHit[] = [];
  pages.forEach((raw, p) => {
    const text = raw.replace(/\s+/g, ' ');
    const low = text.toLowerCase();
    for (let i = low.indexOf(q); i >= 0 && hits.length < limit; i = low.indexOf(q, i + q.length)) {
      const a = Math.max(0, i - 40);
      const b = Math.min(text.length, i + q.length + 60);
      hits.push({ page: p + 1, index: i, snippet: (a > 0 ? '…' : '') + text.slice(a, b) + (b < text.length ? '…' : '') });
    }
  });
  return hits;
}

/** Доли страницы → координаты PDF (начало внизу слева) для экспорта. */
export function toPdfRect(r: Pick<Rect, 'x' | 'y' | 'w' | 'h'>, pageW: number, pageH: number) {
  return { x: r.x * pageW, y: pageH - (r.y + r.h) * pageH, width: r.w * pageW, height: r.h * pageH };
}

export const HIGHLIGHT_HEX: Record<string, string> = {
  yellow: '#fde047',
  green: '#86efac',
  blue: '#93c5fd',
  pink: '#f9a8d4',
  red: '#fca5a5',
  purple: '#c4b5fd',
};
