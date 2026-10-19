// Импорт материала для просмотра страницами: PDF как есть, PowerPoint (.pptx) и фото —
// через преобразование в PDF. Тогда для всего работают одни и те же пометки Pencil,
// маркер, поиск по тексту и «сделать карточку».
import { db } from '../../db/db';
import type { Doc } from '../../db/schema';
import { uid } from '../../lib/id';
import { importPdf } from './annotations';

/** Что принимает выбор файла для презентаций */
export const SLIDES_ACCEPT = 'application/pdf,.pdf,.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation,image/*';

const baseName = (n: string) => n.replace(/\.[^.]+$/, '');

async function fontBytes() {
  // шрифты лежат в бандле (и в офлайн-кэше), подгружаются только при импорте PPTX
  const [latin, cyrillic, latinBold, cyrillicBold] = await Promise.all([
    import('@fontsource/pt-sans/files/pt-sans-latin-400-normal.woff?url'),
    import('@fontsource/pt-sans/files/pt-sans-cyrillic-400-normal.woff?url'),
    import('@fontsource/pt-sans/files/pt-sans-latin-700-normal.woff?url'),
    import('@fontsource/pt-sans/files/pt-sans-cyrillic-700-normal.woff?url'),
  ]);
  const get = async (m: { default: string }) => new Uint8Array(await (await fetch(m.default)).arrayBuffer());
  return { latin: await get(latin), cyrillic: await get(cyrillic), latinBold: await get(latinBold), cyrillicBold: await get(cyrillicBold) };
}

/** Картинки, которых не понимает PDF (GIF, BMP, TIFF, WebP…), перекодируем через canvas. */
async function convertImage(bytes: Uint8Array, ext: string): Promise<{ bytes: Uint8Array; png: boolean } | null> {
  if (ext === 'emf' || ext === 'wmf') return null; // векторные форматы Windows браузер не рисует
  try {
    const bmp = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]));
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    return blob ? { bytes: new Uint8Array(await blob.arrayBuffer()), png: true } : null;
  } catch {
    return null;
  }
}

/** PowerPoint → PDF (упрощённый вид). Оригинал .pptx сохраняется рядом. */
export async function importPptx(file: File, parentId: string | null): Promise<Doc> {
  const [{ parsePptx }, { pptxToPdf }] = await Promise.all([import('./pptx'), import('./pptxToPdf')]);
  const deck = parsePptx(new Uint8Array(await file.arrayBuffer()));
  if (!deck.slides.length) throw new Error('В презентации нет слайдов');
  const title = baseName(file.name);
  const bytes = await pptxToPdf(deck, await fontBytes(), convertImage, title);
  const pdf = new File([bytes as Uint8Array<ArrayBuffer>], title + '.pdf', { type: 'application/pdf' });
  const doc = await importPdf(pdf, parentId);
  const sourceId = uid();
  await db.files.add({ id: sourceId, kind: 'pdf', mime: file.type || 'application/vnd.openxmlformats-officedocument.presentationml.presentation', name: file.name, size: file.size, blob: file, createdAt: Date.now() });
  const source = { kind: 'pptx' as const, fileId: sourceId };
  await db.docs.update(doc.id, { source });
  return { ...doc, source };
}

/** Фото доски, слайдов или страниц → PDF, по странице на фото. */
export async function photosToPdf(files: Blob[]): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  for (const f of files) {
    const bmp = await createImageBitmap(f);
    // 2000 px по длинной стороне — чётко на экране iPad, а файл не раздувается
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const jpg = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Не удалось прочитать фото'))), 'image/jpeg', 0.88));
    const img = await pdf.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
    // ширина страницы — 720 пт, как у слайда 16:9 / 4:3
    const w = 720;
    const page = pdf.addPage([w, (w * c.height) / c.width]);
    page.drawImage(img, { x: 0, y: 0, width: w, height: (w * c.height) / c.width });
  }
  return pdf.save();
}

export async function importPhotos(files: File[], parentId: string | null, title = 'Фото'): Promise<Doc> {
  const bytes = await photosToPdf(files);
  const doc = await importPdf(new File([bytes as Uint8Array<ArrayBuffer>], title + '.pdf', { type: 'application/pdf' }), parentId);
  await db.docs.update(doc.id, { source: { kind: 'photos' } });
  return { ...doc, source: { kind: 'photos' } };
}

export const isPptx = (f: File) => /\.pptx$/i.test(f.name) || f.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** Импорт выбранных файлов: PDF, PPTX или фото (несколько фото — одна «презентация»). */
export async function importSlides(files: File[], parentId: string | null): Promise<Doc | null> {
  if (!files.length) return null;
  const f = files[0];
  if (/\.ppt$/i.test(f.name) || f.type === 'application/vnd.ms-powerpoint') {
    throw new Error('Старый формат .ppt не читается. Откройте файл в PowerPoint или Keynote и сохраните как .pptx или PDF.');
  }
  if (isPptx(f)) return importPptx(f, parentId);
  const photos = files.filter((x) => x.type.startsWith('image/'));
  if (photos.length) return importPhotos(photos, parentId, photos.length === 1 ? baseName(photos[0].name) : 'Фото');
  return importPdf(f, parentId);
}
