import { db } from '../../db/db';
import type { Block, FileRow } from '../../db/schema';
import { uid } from '../../lib/id';
import { appendBlock, insertAfter } from './blocks';

/** Фото с iPad бывают по 12+ Мп — для конспекта хватает 2400 px по длинной стороне. */
const MAX_SIDE = 2400;

async function decode(blob: Blob): Promise<{ img: CanvasImageSource; width: number; height: number; close: () => void }> {
  if ('createImageBitmap' in window) {
    try {
      const bmp = await createImageBitmap(blob);
      return { img: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* старый Safari — пробуем через <img> */
    }
  }
  const url = URL.createObjectURL(blob);
  const el = new Image();
  el.src = url;
  await el.decode();
  return { img: el, width: el.naturalWidth, height: el.naturalHeight, close: () => URL.revokeObjectURL(url) };
}

/** Сохраняет картинку в таблицу files (при необходимости уменьшив) и возвращает её размеры. */
export async function storeImage(file: Blob, name = 'image'): Promise<{ fileId: string; width: number; height: number }> {
  const d = await decode(file);
  let blob = file;
  let { width, height } = d;
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  if (scale < 1 || file.size > 3 * 1024 * 1024) {
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(d.img, 0, 0, width, height);
    // PNG оставляем PNG (скриншоты, схемы с прозрачностью), остальное — JPEG
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), type, 0.88));
  }
  d.close();
  const row: FileRow = { id: uid(), kind: 'image', mime: blob.type || 'image/png', name, size: blob.size, blob, createdAt: Date.now() };
  await db.files.add(row);
  return { fileId: row.id, width, height };
}

/** Вставляет картинки блоками: после блока `after` (или в конец документа). */
export async function insertImages(docId: string, files: File[], after: Block | null): Promise<Block | null> {
  let last = after;
  for (const f of files.filter((x) => x.type.startsWith('image/'))) {
    const image = await storeImage(f, f.name);
    const b = last ? await insertAfter(last, '', 'image', false) : await appendBlock(docId, 'image');
    await db.blocks.update(b.id, { image });
    last = { ...b, image };
  }
  return last;
}

/** Открывает системный выбор файла (на iPad: «Фото», «Снять фото», «Файлы»). */
export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    input.onchange = () => {
      resolve([...(input.files ?? [])]);
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
  });
}

/** Файлы, на которые больше не ссылается ни один блок, удаляем. */
export async function cleanupFiles(fileIds: string[]) {
  for (const id of fileIds) {
    const used = await db.blocks.filter((b) => b.image?.fileId === id || b.pdfRef?.fileId === id).count();
    const usedByDoc = await db.docs.filter((d) => d.fileId === id).count();
    if (!used && !usedByDoc) await db.files.delete(id);
  }
}
