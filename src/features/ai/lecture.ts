// ИИ для лекции: материал (слайды + конспект) → разбивка на темы и подтемы →
// сводки по подтемам (с картинками и схемами только из реальных источников) → карточки.
// Всё хранится в обычной заметке «Сводки» внутри лекции — её можно править как угодно.
import { db } from '../../db/db';
import type { Block, Doc, Outline, OutlineSub, OutlineTopic, SourceRef } from '../../db/schema';
import { uid } from '../../lib/id';
import { syncBlockCards } from '../cards/sync';
import { deleteBlock } from '../notes/blocks';
import { createDoc } from '../notes/docs';
import { storeImage } from '../notes/images';
import { ensurePdfIndex, getPdfIndex } from '../pdf/textIndex';
import { askJson, canvasPart, type Part } from './client';
import { commonsLabel, searchCommons } from './commons';
import { diagramSvg, type Diagram } from './diagrams';
import { prompt } from './prompts';

// ---------- Материал ----------

export interface Material {
  /** Текст слайдов по страницам (с единицы: slides[0] — стр. 1) */
  slides: string[];
  /** Конспект: распознанная рукопись и тексты на листах, по листам */
  notes: string[];
  slidesDoc?: Doc;
  /** Сколько листов конспекта ещё не распознано */
  unrecognized: number;
}

/** Предмет лекции — верхняя папка-предмет (для правил языка). */
export async function subjectOf(doc: Doc): Promise<string> {
  let cur: Doc | undefined = doc;
  let top = doc.title;
  for (let i = 0; cur && i < 20; i++) {
    if (cur.role === 'subject') return cur.title;
    top = cur.title;
    cur = cur.parentId ? await db.docs.get(cur.parentId) : undefined;
  }
  return top;
}

export async function lectureMaterial(lecture: Doc): Promise<Material> {
  const slidesDoc = lecture.lecture?.slidesId ? await db.docs.get(lecture.lecture.slidesId) : undefined;
  let slides: string[] = [];
  if (slidesDoc?.fileId && !slidesDoc.deletedAt) {
    await ensurePdfIndex(slidesDoc.fileId);
    slides = (await getPdfIndex(slidesDoc.fileId)) ?? [];
  }
  const notes: string[] = [];
  let unrecognized = 0;
  if (lecture.lecture?.notebookId) {
    const pages = await db.pages.where('[docId+order]').between([lecture.lecture.notebookId, -Infinity], [lecture.lecture.notebookId, Infinity]).toArray();
    for (const p of pages) {
      if (p.strokes.length && p.recognizedAt !== p.updatedAt) unrecognized++;
      const t = [p.recognizedText ?? '', ...(p.items ?? []).map((i) => i.text ?? '')].filter((x) => x.trim()).join('\n');
      if (t) notes.push(t);
    }
  }
  return { slides, notes, slidesDoc: slidesDoc && !slidesDoc.deletedAt ? slidesDoc : undefined, unrecognized };
}

/** Текст материала для модели (с номерами слайдов), не длиннее limit символов. */
export function materialText(m: Pick<Material, 'slides' | 'notes'>, pages?: number[], limit = 60000): string {
  const chosen = pages?.length ? pages.filter((n) => n >= 1 && n <= m.slides.length) : m.slides.map((_, i) => i + 1);
  let out = '';
  for (const n of chosen) {
    const t = m.slides[n - 1].replace(/\s+/g, ' ').trim();
    if (t) out += `=== Слайд ${n} ===\n${t}\n`;
  }
  if (m.notes.length) out += `\n=== Конспект студентки ===\n${m.notes.join('\n---\n')}\n`;
  return out.length > limit ? out.slice(0, limit) + '\n[…материал обрезан…]' : out;
}

export const hasMaterial = (m: Material) => m.slides.some((s) => s.trim()) || m.notes.length > 0;

// ---------- Разбивка ----------

interface RawOutline {
  topics?: { title?: string; subtopics?: { title?: string; pages?: unknown[] }[] }[];
}

/** Приводит ответ модели к разбивке: id, обрезка названий, номера страниц в пределах. */
export function normalizeOutline(raw: RawOutline, slideCount: number): Outline {
  const clip = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return (raw.topics ?? [])
    .map((t) => ({
      id: uid(),
      title: clip(t.title) || 'Тема',
      subtopics: (t.subtopics ?? [])
        .map((s) => ({
          id: uid(),
          title: clip(s.title),
          pages: [...new Set((s.pages ?? []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= slideCount))].sort((a, b) => a - b),
        }))
        .filter((s) => s.title),
    }))
    .filter((t) => t.subtopics.length);
}

export async function proposeOutline(lecture: Doc): Promise<Outline> {
  const m = await lectureMaterial(lecture);
  if (!hasMaterial(m)) throw new Error('В лекции пока нет материала: загрузите презентацию или напишите конспект (рукопись распознаётся автоматически).');
  const raw = await askJson<RawOutline>(
    { system: prompt('outline', { subject: await subjectOf(lecture) }), parts: [{ text: `Лекция: ${lecture.title}\n\n${materialText(m)}` }], temperature: 0.2 },
    (v) => Array.isArray(v.topics) && v.topics.length > 0,
  );
  const outline = normalizeOutline(raw, m.slides.length);
  if (!outline.length) throw new Error('ИИ не смог разбить материал на темы. Попробуйте ещё раз.');
  return outline;
}

/** Заметка «Сводки» лекции (создаётся при первом сохранении разбивки). */
export async function summaryDoc(lecture: Doc): Promise<Doc> {
  const id = lecture.lecture?.summaryId;
  const existing = id ? await db.docs.get(id) : undefined;
  if (existing && !existing.deletedAt) return existing;
  const doc = await createDoc('note', lecture.id, 'Сводки');
  const fresh = (await db.docs.get(lecture.id))!;
  await db.docs.update(lecture.id, { lecture: { ...fresh.lecture, summaryId: doc.id } });
  return doc;
}

function newBlock(docId: string, parentId: string | null, order: number, text: string, extra: Partial<Block> = {}): Block {
  const now = Date.now();
  return { id: uid(), docId, parentId, order, kind: 'text', text, tags: [], links: [], createdAt: now, updatedAt: now, ...extra };
}

/**
 * Сохраняет разбивку: заголовки тем (H2) и подтем (H3) в заметке «Сводки».
 * Переименование меняет заголовок, порядок — порядок; удалённые подтемы удаляются вместе со сводками.
 */
export async function saveOutline(lecture: Doc, outline: Outline): Promise<Doc> {
  const doc = await summaryDoc(lecture);
  const blocks = await db.blocks.where('docId').equals(doc.id).toArray();
  const heads = blocks.filter((b) => b.ai?.kind === 'heading');
  const keepTopics = new Set(outline.map((t) => t.id));
  const keepSubs = new Set(outline.flatMap((t) => t.subtopics.map((s) => s.id)));
  for (const h of heads) {
    const gone = h.ai!.sub ? !keepSubs.has(h.ai!.sub) : !keepTopics.has(h.ai!.topic ?? '');
    if (gone && (await db.blocks.get(h.id))) await deleteBlock(h);
  }
  const fresh = await db.blocks.where('docId').equals(doc.id).toArray();
  const topicBlock = (id: string) => fresh.find((b) => b.ai?.kind === 'heading' && b.ai.topic === id && !b.ai.sub);
  const subBlock = (id: string) => fresh.find((b) => b.ai?.kind === 'heading' && b.ai.sub === id);
  const now = Date.now();
  for (const [i, t] of outline.entries()) {
    let tb = topicBlock(t.id);
    if (tb) await db.blocks.update(tb.id, { text: t.title, order: i, parentId: null, updatedAt: now });
    else {
      tb = newBlock(doc.id, null, i, t.title, { heading: 2, ai: { kind: 'heading', topic: t.id } });
      await db.blocks.add(tb);
    }
    for (const [j, s] of t.subtopics.entries()) {
      const sb = subBlock(s.id);
      if (sb) await db.blocks.update(sb.id, { text: s.title, order: j, parentId: tb.id, updatedAt: now });
      else await db.blocks.add(newBlock(doc.id, tb.id, j, s.title, { heading: 3, ai: { kind: 'heading', topic: t.id, sub: s.id } }));
    }
  }
  const lec = (await db.docs.get(lecture.id))!;
  await db.docs.update(lecture.id, { lecture: { ...lec.lecture, outline } });
  await db.docs.update(doc.id, { updatedAt: now });
  return doc;
}

// ---------- Сводки ----------

/** Убирает из текста сводки синтаксис карточек — сводка не должна плодить карточки. */
export function sanitizeSummary(s: string): string {
  return String(s ?? '')
    .replace(/<>|>>|<</g, '→')
    .replace(/::/g, ':')
    .replace(/;;/g, ';')
    .replace(/\{\{|\}\}/g, '')
    .replace(/^\s*[-•*]\s+/, '')
    .trim();
}

interface SummaryNode {
  text?: string;
  children?: SummaryNode[];
}

interface RawSummary {
  blocks?: SummaryNode[];
  terms?: { term?: string; definition?: string; zh?: string; pinyin?: string }[];
  slides?: { page?: number; caption?: string }[];
  web?: { query?: string; caption?: string }[];
  diagrams?: Diagram[];
}

export type SummaryMode = 'short' | 'detailed';

export async function pageImages(slidesDoc: Doc | undefined, pages: number[], max: number): Promise<{ parts: Part[]; rendered: Map<number, Blob> }> {
  const parts: Part[] = [];
  const rendered = new Map<number, Blob>();
  if (!slidesDoc?.fileId || !pages.length) return { parts, rendered };
  const [{ loadPdf }, { renderClip }] = await Promise.all([import('../pdf/pdfjs'), import('../pdf/PdfPage')]);
  const pdf = await loadPdf(slidesDoc.fileId);
  for (const n of pages.filter((p) => p >= 1 && p <= pdf.numPages).slice(0, max)) {
    const png = await renderClip(pdf, n, { id: '', x: 0, y: 0, w: 1, h: 1 });
    rendered.set(n, png);
    // модели хватит уменьшенной копии
    const bmp = await createImageBitmap(png);
    const c = document.createElement('canvas');
    const k = Math.min(1, 1100 / bmp.width);
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    parts.push({ text: `Изображение слайда ${n}:` }, await canvasPart(c));
  }
  return { parts, rendered };
}

async function slideImage(slidesDoc: Doc, page: number, cache: Map<number, Blob>): Promise<Blob | null> {
  if (cache.has(page)) return cache.get(page)!;
  const [{ loadPdf }, { renderClip }] = await Promise.all([import('../pdf/pdfjs'), import('../pdf/PdfPage')]);
  const pdf = await loadPdf(slidesDoc.fileId!);
  if (page < 1 || page > pdf.numPages) return null;
  const png = await renderClip(pdf, page, { id: '', x: 0, y: 0, w: 1, h: 1 });
  cache.set(page, png);
  return png;
}

/** Найти подтему и её тему в разбивке лекции. */
export function findSub(outline: Outline | undefined, subId: string): { topic: OutlineTopic; sub: OutlineSub } | null {
  for (const topic of outline ?? []) for (const sub of topic.subtopics) if (sub.id === subId) return { topic, sub };
  return null;
}

/** Сводка по подтеме: заменяет прежнюю сводку под заголовком подтемы. Возвращает число предупреждений по картинкам. */
export async function summarize(lecture: Doc, subId: string, mode: SummaryMode, onStep?: (s: string) => void): Promise<string[]> {
  const found = findSub(lecture.lecture?.outline, subId);
  if (!found) throw new Error('Подтема не найдена — обновите разбивку.');
  const { topic, sub } = found;
  const doc = await summaryDoc(lecture);
  const head = (await db.blocks.where('docId').equals(doc.id).toArray()).find((b) => b.ai?.kind === 'heading' && b.ai.sub === subId);
  if (!head) throw new Error('Заголовок подтемы не найден — сохраните разбивку ещё раз.');

  onStep?.('Собираю материал…');
  const m = await lectureMaterial(lecture);
  const pages = sub.pages ?? [];
  const { parts: imgParts, rendered } = await pageImages(m.slidesDoc, pages, 3);
  onStep?.('ИИ пишет сводку…');
  const raw = await askJson<RawSummary>(
    {
      system: prompt('summary', { mode: mode === 'short' ? 'коротко' : 'подробно', subject: await subjectOf(lecture) }),
      parts: [{ text: `Лекция: ${lecture.title}\nТема: ${topic.title}\nПодтема: ${sub.title}\nСтраницы подтемы: ${pages.join(', ') || 'не указаны'}\n\n${materialText(m, pages.length ? pages : undefined, 40000)}` }, ...imgParts],
      temperature: 0.5,
      maxTokens: mode === 'short' ? 4096 : 8192,
    },
    (v) => Array.isArray(v.blocks) && v.blocks.length > 0,
  );

  // прежняя сводка (тексты, картинки, схемы) уходит, карточки остаются
  const old = (await db.blocks.where('docId').equals(doc.id).toArray()).filter((b) => b.parentId === head.id && b.ai?.kind === 'summary');
  for (const b of old) await deleteBlock(b);

  const out: Block[] = [];
  const add = (nodes: SummaryNode[], parentId: string, base: number) =>
    nodes.forEach((n, i) => {
      const text = sanitizeSummary(n.text ?? '');
      if (!text && !n.children?.length) return;
      const b = newBlock(doc.id, parentId, base + i, text, { ai: { kind: 'summary', sub: subId } });
      out.push(b);
      if (n.children?.length) add(n.children, b.id, 0);
    });
  // сводка — перед карточками подтемы
  add(raw.blocks ?? [], head.id, -10000);
  await db.blocks.bulkAdd(out);

  // термины подтемы — в словарь (нажатие на термин в заметке покажет определение)
  const { upsertTerm } = await import('../glossary/glossary');
  for (const t of (raw.terms ?? []).slice(0, 12)) {
    if (t.term && t.definition) await upsertTerm({ term: sanitizeSummary(t.term), definition: sanitizeSummary(t.definition), zh: t.zh, pinyin: t.pinyin, docId: lecture.id }, 'ai');
  }

  const warnings: string[] = [];
  let order = -5000;
  const addImage = async (blob: Blob, name: string, extra: Partial<Block>) => {
    const image = await storeImage(blob, name);
    await db.blocks.add(newBlock(doc.id, head.id, order++, '', { kind: 'image', image, ai: { kind: 'summary', sub: subId }, ...extra }));
  };
  const slidesDoc = m.slidesDoc;

  onStep?.('Добавляю картинки…');
  for (const s of (raw.slides ?? []).slice(0, 3)) {
    const page = Number(s.page);
    if (!slidesDoc || !Number.isInteger(page)) continue;
    try {
      const png = await slideImage(slidesDoc, page, rendered);
      if (png) await addImage(png, `слайд ${page}.png`, { pdfRef: { docId: slidesDoc.id, page }, source: { label: `Слайд ${page}${s.caption ? ': ' + sanitizeSummary(s.caption) : ''}` } });
    } catch {
      warnings.push(`Не удалось взять слайд ${page}`);
    }
  }
  for (const d of (raw.diagrams ?? []).slice(0, 2)) {
    const page = Number(d.page);
    // схема без реального источника (слайда) не добавляется — защита от выдумок
    if (!slidesDoc || !Number.isInteger(page) || page < 1 || page > m.slides.length) {
      warnings.push(`Схема «${d.title ?? ''}» пропущена: нет ссылки на слайд-источник`);
      continue;
    }
    const svg = diagramSvg(d);
    if (!svg) continue;
    try {
      await addImage(new Blob([svg], { type: 'image/svg+xml' }), `схема.svg`, { pdfRef: { docId: slidesDoc.id, page }, source: { label: `Схема ИИ по слайду ${page}${d.title ? ': ' + sanitizeSummary(d.title) : ''}` } });
    } catch {
      warnings.push('Не удалось нарисовать схему');
    }
  }
  for (const w of (raw.web ?? []).slice(0, 2)) {
    if (!w.query?.trim()) continue;
    try {
      const found = (await searchCommons(w.query))[0];
      if (!found) continue;
      const res = await fetch(found.thumb);
      if (!res.ok) continue;
      const source: SourceRef = { label: (w.caption ? sanitizeSummary(w.caption) + ' — ' : '') + commonsLabel(found), url: found.page };
      await addImage(await res.blob(), found.title, { source });
    } catch {
      warnings.push(`Картинка из интернета «${w.query}» не загрузилась`);
    }
  }
  await db.docs.update(doc.id, { updatedAt: Date.now() });
  return warnings;
}

// ---------- Карточки ----------

export interface DraftCard {
  kind: 'term' | 'qa' | 'cloze' | 'list';
  front: string;
  back?: string;
  items?: string[];
}

/** Внутри частей карточки разделители синтаксиса заменяем, чтобы карточка не сломалась. */
const part = (s: unknown) =>
  String(s ?? '')
    .replace(/<>|>>|<</g, '→')
    .replace(/::/g, ':')
    .replace(/;;/g, ';')
    .replace(/\s+/g, ' ')
    .trim();

export function normalizeCards(raw: { cards?: Partial<DraftCard>[] }): DraftCard[] {
  return (raw.cards ?? [])
    .map((c): DraftCard | null => {
      const kind = c.kind === 'term' || c.kind === 'qa' || c.kind === 'cloze' || c.kind === 'list' ? c.kind : 'qa';
      if (kind === 'cloze') {
        const front = String(c.front ?? '').trim();
        return /\{\{.+?\}\}/.test(front) ? { kind, front } : null;
      }
      if (kind === 'list') {
        const items = (c.items ?? []).map(part).filter(Boolean);
        return part(c.front) && items.length >= 2 ? { kind, front: part(c.front), items } : null;
      }
      return part(c.front) && part(c.back) ? { kind, front: part(c.front), back: part(c.back) } : null;
    })
    .filter((c): c is DraftCard => !!c);
}

/** Карточка → текст блока (синтаксис RemNote) и вложенные пункты. */
export function cardText(c: DraftCard): { text: string; children: string[] } {
  if (c.kind === 'term') return { text: `${c.front} :: ${c.back}`, children: [] };
  if (c.kind === 'cloze') return { text: c.front, children: [] };
  if (c.kind === 'list') return { text: `${c.front} >>1.`, children: c.items ?? [] };
  return { text: `${c.front} >> ${c.back}`, children: [] };
}

export async function draftCards(lecture: Doc, subId: string): Promise<DraftCard[]> {
  const found = findSub(lecture.lecture?.outline, subId);
  if (!found) throw new Error('Подтема не найдена — обновите разбивку.');
  const m = await lectureMaterial(lecture);
  const doc = await summaryDoc(lecture);
  const summary = (await db.blocks.where('docId').equals(doc.id).toArray())
    .filter((b) => b.ai?.kind === 'summary' && b.ai.sub === subId && b.kind === 'text')
    .map((b) => b.text)
    .join('\n');
  const raw = await askJson<{ cards?: Partial<DraftCard>[] }>(
    {
      system: prompt('cards', { subject: await subjectOf(lecture) }),
      parts: [{ text: `Подтема: ${found.sub.title} (тема «${found.topic.title}»)\n\n${summary ? `Сводка:\n${summary}\n\n` : ''}${materialText(m, found.sub.pages?.length ? found.sub.pages : undefined, 30000)}` }],
      temperature: 0.4,
    },
    (v) => Array.isArray(v.cards),
  );
  return normalizeCards(raw);
}

/** Одобренные карточки → блоки под заголовком подтемы (после сводки). */
export async function addCards(lecture: Doc, subId: string, cards: DraftCard[]): Promise<number> {
  const doc = await summaryDoc(lecture);
  const all = await db.blocks.where('docId').equals(doc.id).toArray();
  const head = all.find((b) => b.ai?.kind === 'heading' && b.ai.sub === subId);
  if (!head) throw new Error('Заголовок подтемы не найден — сохраните разбивку ещё раз.');
  let order = Math.max(0, ...all.filter((b) => b.parentId === head.id).map((b) => b.order)) + 1;
  const created: Block[] = [];
  for (const c of cards) {
    const { text, children } = cardText(c);
    const b = newBlock(doc.id, head.id, order++, text, { ai: { kind: 'cards', sub: subId } });
    created.push(b, ...children.map((t, i) => newBlock(doc.id, b.id, i, t, { ai: { kind: 'cards', sub: subId } })));
  }
  await db.blocks.bulkAdd(created);
  for (const b of created) await syncBlockCards(b.id);
  await db.docs.update(doc.id, { updatedAt: Date.now() });
  return cards.length;
}
