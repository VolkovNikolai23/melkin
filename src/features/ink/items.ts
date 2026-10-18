// Объекты на листе (текст, картинки): выделение лассо, перенос, масштаб, копия.
import type { PageItem } from '../../db/schema';
import { pointInPolygon, type BBox } from './geometry';

export const TEXT_SIZES = [20, 28, 40, 56];
export const DEFAULT_TEXT_SIZE = 28;

/** Объект попадает в лассо, если внутри его центр. */
export function selectItemsByLasso(items: PageItem[], poly: number[]): string[] {
  if (poly.length < 6) return [];
  return items.filter((i) => pointInPolygon(i.x + i.w / 2, i.y + i.h / 2, poly)).map((i) => i.id);
}

export function itemsBBox(items: PageItem[]): BBox | null {
  if (!items.length) return null;
  const x0 = Math.min(...items.map((i) => i.x));
  const y0 = Math.min(...items.map((i) => i.y));
  const x1 = Math.max(...items.map((i) => i.x + i.w));
  const y1 = Math.max(...items.map((i) => i.y + i.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function unionBox(a: BBox | null, b: BBox | null): BBox | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function moveItems(items: PageItem[], ids: string[], dx: number, dy: number): PageItem[] {
  const set = new Set(ids);
  return items.map((i) => (set.has(i.id) ? { ...i, x: r2(i.x + dx), y: r2(i.y + dy) } : i));
}

/** Масштаб относительно точки (ox, oy): позиция, размер и шрифт меняются вместе. */
export function scaleItems(items: PageItem[], ids: string[], ox: number, oy: number, k: number): PageItem[] {
  const set = new Set(ids);
  return items.map((i) =>
    set.has(i.id)
      ? {
          ...i,
          x: r2(ox + (i.x - ox) * k),
          y: r2(oy + (i.y - oy) * k),
          w: r2(i.w * k),
          h: r2(i.h * k),
          ...(i.kind === 'text' ? { fontSize: r2((i.fontSize ?? DEFAULT_TEXT_SIZE) * k) } : {}),
        }
      : i,
  );
}

export function duplicateItems(items: PageItem[], ids: string[], offset: number, newId: () => string): { items: PageItem[]; ids: string[] } {
  const set = new Set(ids);
  const copies = items.filter((i) => set.has(i.id)).map((i) => ({ ...i, id: newId(), x: i.x + offset, y: i.y + offset }));
  return { items: [...items, ...copies], ids: copies.map((c) => c.id) };
}

/**
 * Где поставить картинку на листе: по центру видимой части, не шире 70% листа,
 * с сохранением пропорций.
 */
export function placeImage(imgW: number, imgH: number, pageW: number, pageH: number, centerY = pageH / 2): Pick<PageItem, 'x' | 'y' | 'w' | 'h'> {
  const w = Math.min(pageW * 0.7, imgW);
  const h = (w * imgH) / imgW;
  const k = Math.min(1, (pageH * 0.8) / h);
  const fw = r2(w * k);
  const fh = r2(h * k);
  const y = Math.max(20, Math.min(pageH - fh - 20, centerY - fh / 2));
  return { x: r2((pageW - fw) / 2), y: r2(y), w: fw, h: fh };
}
