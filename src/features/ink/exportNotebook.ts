// Экспорт тетрадки в PDF: фон, штрихи и фигуры — векторами (чёткие при любом масштабе),
// картинки — как есть, текстовые блоки — картинкой высокого разрешения (стандартные
// шрифты PDF не знают кириллицу).
import { PDFDocument, rgb, type PDFPage } from 'pdf-lib';
import { db } from '../../db/db';
import type { Doc, Page, PageItem } from '../../db/schema';
import { strokePathPdf } from './geometry';
import { DEFAULT_TEXT_SIZE } from './items';
import { autoInkFor, paperGeometry } from './paper';

/** A4 в пунктах */
const A4_W = 595.28;

function hexToRgb(hex: string) {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return rgb(0.12, 0.12, 0.14);
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

/** Пустые листы в конце (запасные) не экспортируем. */
export function pagesToExport(pages: Page[]): Page[] {
  let end = pages.length;
  while (end > 1 && !pages[end - 1].strokes.length && !pages[end - 1].items?.length) end--;
  return pages.slice(0, end);
}

/** Перенос строк по ширине — так же, как в текстовом блоке на экране. */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (line && measure(next.trimEnd()) > maxWidth) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else line = next;
    }
    out.push(line.trimEnd());
  }
  return out;
}

async function textImage(it: PageItem, ink: string, scale: number): Promise<Uint8Array> {
  const fs = it.fontSize ?? DEFAULT_TEXT_SIZE;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const family = getComputedStyle(document.documentElement).getPropertyValue('--app-font').trim() || 'sans-serif';
  const font = `${fs * scale}px ${family}`;
  ctx.font = font;
  const lines = wrapLines(it.text ?? '', it.w * scale, (s) => ctx.measureText(s).width);
  const lh = fs * 1.3 * scale;
  c.width = Math.ceil(it.w * scale);
  c.height = Math.max(1, Math.ceil(lines.length * lh + fs * 0.3 * scale));
  ctx.font = font;
  ctx.fillStyle = !it.color || it.color === 'auto' ? ink : it.color;
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, 0, i * lh + fs * 0.15 * scale));
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Картинку в формате, который понимает pdf-lib (JPEG/PNG); остальное перекодируем. */
async function embedImage(pdf: PDFDocument, blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (blob.type === 'image/jpeg') return pdf.embedJpg(bytes);
  if (blob.type === 'image/png') return pdf.embedPng(bytes);
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  const jpg = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/jpeg', 0.9));
  return pdf.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
}

async function drawPage(pdf: PDFDocument, out: PDFPage, page: Page, pageW: number, pageH: number, themePaper: string, themeLine: string) {
  const k = A4_W / pageW;
  const H = pageH * k;
  const paper = page.paper ?? themePaper;
  const ink = autoInkFor(paper);
  out.drawRectangle({ x: 0, y: 0, width: A4_W, height: H, color: hexToRgb(paper) });
  const g = paperGeometry(page.background, pageW, pageH);
  const line = hexToRgb(page.lineColor ?? themeLine);
  for (const [x1, y1, x2, y2] of g.lines) out.drawLine({ start: { x: x1 * k, y: H - y1 * k }, end: { x: x2 * k, y: H - y2 * k }, thickness: 0.5, color: line });
  for (const [x1, y1, x2, y2] of g.margins)
    out.drawLine({ start: { x: x1 * k, y: H - y1 * k }, end: { x: x2 * k, y: H - y2 * k }, thickness: 0.8, color: page.lineColor ? line : rgb(0.95, 0.72, 0.78) });
  for (const [x, y, r] of g.dots) out.drawCircle({ x: x * k, y: H - y * k, size: r * k, color: line });

  const items = page.items ?? [];
  for (const it of items.filter((i) => i.kind === 'image' && i.fileId)) {
    const f = await db.files.get(it.fileId!);
    if (!f) continue;
    const img = await embedImage(pdf, f.blob);
    out.drawImage(img, { x: it.x * k, y: H - (it.y + it.h) * k, width: it.w * k, height: it.h * k });
  }
  // маркер под ручкой, как на экране
  const strokes = [...page.strokes.filter((s) => s.tool === 'marker'), ...page.strokes.filter((s) => s.tool !== 'marker')];
  for (const s of strokes) {
    const d = strokePathPdf(s);
    if (!d) continue;
    const color = s.color === 'auto' ? hexToRgb(ink) : hexToRgb(s.color);
    out.drawSvgPath(d, { x: 0, y: H, scale: k, color, opacity: s.tool === 'marker' ? 0.4 : 1, borderWidth: 0 });
  }
  for (const it of items.filter((i) => i.kind === 'text' && i.text?.trim())) {
    const png = await pdf.embedPng(await textImage(it, ink, 3));
    const h = (png.height / 3) * k;
    out.drawImage(png, { x: it.x * k, y: H - it.y * k - h, width: it.w * k, height: h });
  }
}

export async function exportNotebookPdf(doc: Doc, pageW: number, pageH: number): Promise<File> {
  const all = await db.pages.where('[docId+order]').between([doc.id, -Infinity], [doc.id, Infinity]).toArray();
  const pages = pagesToExport(all);
  // бумага «как в теме» в PDF всегда светлая (как в светлой теме) — так её удобно печатать
  const themePaper = '#ffffff';
  const themeLine = '#ecdfe5';
  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.title);
  for (const p of pages) {
    const out = pdf.addPage([A4_W, (pageH * A4_W) / pageW]);
    await drawPage(pdf, out, p, pageW, pageH, themePaper, themeLine);
  }
  const bytes = await pdf.save();
  return new File([bytes as Uint8Array<ArrayBuffer>], `${doc.title || 'Тетрадь'}.pdf`, { type: 'application/pdf' });
}
