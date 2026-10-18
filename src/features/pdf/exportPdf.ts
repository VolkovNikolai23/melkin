// Экспорт PDF с аннотациями: исходный файл не меняется, выделения и рукописные
// пометки дорисовываются в копию средствами pdf-lib.
import { PDFDocument, rgb } from 'pdf-lib';
import { db } from '../../db/db';
import type { Doc } from '../../db/schema';
import { strokePathPdf } from '../ink/geometry';
import { HIGHLIGHT_HEX, toPdfRect } from './geometry';

function hexToRgb(hex: string) {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return rgb(0.1, 0.1, 0.12);
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

export async function exportAnnotatedPdf(doc: Doc): Promise<File> {
  const file = await db.files.get(doc.fileId!);
  if (!file) throw new Error('Файл PDF не найден');
  const pdf = await PDFDocument.load(await file.blob.arrayBuffer(), { ignoreEncryption: true });
  const anns = await db.annotations.where('docId').equals(doc.id).toArray();
  const pages = pdf.getPages();
  for (const a of anns) {
    const page = pages[a.page - 1];
    if (!page) continue;
    const { width, height } = page.getSize();
    if (a.kind === 'highlight') {
      for (const r of a.rects ?? []) {
        page.drawRectangle({ ...toPdfRect(r, width, height), color: hexToRgb(HIGHLIGHT_HEX[a.color] ?? '#fde047'), opacity: 0.4 });
      }
    } else {
      // Контуры штрихов в координатах страницы (пункты, начало сверху) — drawSvgPath сам переворачивает ось Y
      for (const s of a.strokes ?? []) {
        const d = strokePathPdf(s);
        if (!d) continue;
        const color = s.color === 'auto' ? rgb(0.1, 0.1, 0.12) : hexToRgb(s.color);
        page.drawSvgPath(d, { x: 0, y: height, color, opacity: s.tool === 'marker' ? 0.4 : 1, borderWidth: 0 });
      }
    }
  }
  const bytes = await pdf.save();
  return new File([bytes as Uint8Array<ArrayBuffer>], `${doc.title} (с пометками).pdf`, { type: 'application/pdf' });
}
