import { db, getMeta, setMeta } from '../../db/db';
import type { Annotation, Block, Doc, Rect, Stroke } from '../../db/schema';
import { orderBetween, uid } from '../../lib/id';
import { syncBlockCards } from '../cards/sync';
import { byOrder } from '../notes/blocks';
import { createDoc } from '../notes/docs';
import { storeImage } from '../notes/images';
import { linksFor } from '../links/links';
import { extractTags } from '../../lib/markup';

/** Импорт PDF: файл в таблицу files, документ типа «pdf». */
export async function importPdf(file: File, parentId: string | null): Promise<Doc> {
  const now = Date.now();
  const fileId = uid();
  await db.files.add({ id: fileId, kind: 'pdf', mime: 'application/pdf', name: file.name, size: file.size, blob: file, createdAt: now });
  const doc = await createDoc('pdf', parentId, file.name.replace(/\.pdf$/i, ''));
  await db.docs.update(doc.id, { fileId });
  return { ...doc, fileId };
}

export function pageAnnotations(docId: string, page: number) {
  return db.annotations.where('[docId+page]').equals([docId, page]).toArray();
}

export async function addHighlight(docId: string, page: number, rects: Rect[], text: string, color: string): Promise<Annotation> {
  const now = Date.now();
  const a: Annotation = { id: uid(), docId, page, kind: 'highlight', color, rects, text, createdAt: now, updatedAt: now };
  await db.annotations.add(a);
  await db.docs.update(docId, { updatedAt: now });
  return a;
}

/** Рукописный слой страницы — одна запись kind='ink' на страницу. */
export async function saveInk(docId: string, page: number, strokes: Stroke[]) {
  const now = Date.now();
  const existing = (await pageAnnotations(docId, page)).find((a) => a.kind === 'ink');
  if (existing) await db.annotations.update(existing.id, { strokes, updatedAt: now });
  else await db.annotations.add({ id: uid(), docId, page, kind: 'ink', color: '', strokes, createdAt: now, updatedAt: now });
}

/** Документ, куда отправляются выделения из этого PDF (запоминается). */
export async function getTargetNote(pdf: Doc): Promise<string | null> {
  const id = await getMeta<string | null>(`pdfTarget:${pdf.id}`, null);
  const doc = id ? await db.docs.get(id) : undefined;
  return doc && !doc.deletedAt ? doc.id : null;
}

export async function setTargetNote(pdfId: string, noteId: string) {
  await setMeta(`pdfTarget:${pdfId}`, noteId);
}

export async function createTargetNote(pdf: Doc): Promise<string> {
  const note = await createDoc('note', pdf.parentId, `Конспект: ${pdf.title}`);
  await setTargetNote(pdf.id, note.id);
  return note.id;
}

async function appendTo(noteId: string, block: Partial<Block> & Pick<Block, 'kind' | 'text'>): Promise<Block> {
  const sibs = (await db.blocks.where('docId').equals(noteId).toArray()).filter((b) => b.parentId === null).sort(byOrder);
  const now = Date.now();
  const b: Block = {
    id: uid(),
    docId: noteId,
    parentId: null,
    order: orderBetween(sibs.at(-1)?.order, undefined),
    tags: extractTags(block.text),
    links: await linksFor(block.text),
    createdAt: now,
    updatedAt: now,
    ...block,
  };
  await db.blocks.add(b);
  await db.docs.update(noteId, { updatedAt: now });
  await syncBlockCards(b.id);
  return b;
}

/**
 * Выделение → блок в конспекте со ссылкой на страницу PDF.
 * С вопросом получается карточка «вопрос >> фрагмент»; без вопроса, но с cloze=true — «{{фрагмент}}».
 */
export async function highlightToBlock(a: Annotation, noteId: string, opts: { question?: string; cloze?: boolean } = {}): Promise<Block> {
  const quote = (a.text ?? '').replace(/\s+/g, ' ').trim();
  const text = opts.question ? `${opts.question.trim()} >> ${quote}` : opts.cloze ? `{{${quote}}}` : quote;
  const b = await appendTo(noteId, { kind: 'text', text, pdfRef: { docId: a.docId, page: a.page, rects: a.rects } });
  await db.annotations.update(a.id, { blockId: b.id, updatedAt: Date.now() });
  return b;
}

/** Область страницы (уже вырезанная картинка) → блок-картинка в конспекте. */
export async function clipToBlock(pdfId: string, page: number, rect: Rect, png: Blob, noteId: string): Promise<Block> {
  const image = await storeImage(png, `стр. ${page}.png`);
  return appendTo(noteId, { kind: 'image', text: '', image, pdfRef: { docId: pdfId, page, rects: [rect], fileId: image.fileId } });
}
