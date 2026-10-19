// Тесты в базе: создание (из карточек или ИИ), попытки, ошибки → карточки.
import { db } from '../../db/db';
import type { Block, Doc, TestAttempt, TestRow } from '../../db/schema';
import { uid } from '../../lib/id';
import { syncBlockCards } from '../cards/sync';
import { askJson } from '../ai/client';
import { cardText, findSub, lectureMaterial, materialText, pageImages, subjectOf, summaryDoc, type DraftCard } from '../ai/lecture';
import { prompt } from '../ai/prompts';
import { normalizeVerdict, type CheckResult } from '../ai/review';
import { collectSubtree, createDoc } from '../notes/docs';
import { storeImage } from '../notes/images';
import { testFromCards, type Area, type CardSource, type Question, type QuestionData } from './model';

// ---------- Тест из карточек ----------

export async function cardSources(rootId: string): Promise<CardSource[]> {
  const docs = await db.docs.filter((d) => !d.deletedAt).toArray();
  const ids = collectSubtree(docs, rootId);
  const cards = await db.cards.where('docId').anyOf(ids).toArray();
  const blockIds = [...new Set(cards.map((c) => c.blockId))];
  const blocks = new Map((await db.blocks.bulkGet(blockIds)).filter((b): b is Block => !!b).map((b) => [b.id, b]));
  const kids = new Map<string, Block[]>();
  for (const b of await db.blocks.where('parentId').anyOf(blockIds).toArray()) kids.set(b.parentId!, [...(kids.get(b.parentId!) ?? []), b]);
  return cards.map((card) => ({
    card,
    block: blocks.get(card.blockId),
    children: (kids.get(card.blockId) ?? []).sort((a, b) => a.order - b.order).map((b) => b.text || b.recognizedText || '').filter(Boolean),
  }));
}

export async function createCardTest(doc: Doc): Promise<TestRow> {
  const questions = testFromCards(await cardSources(doc.id));
  if (questions.length < 3) throw new Error('Для теста из карточек нужно хотя бы 5–6 карточек вида «термин :: определение» или «вопрос >> ответ».');
  return saveTest(doc.id, `Тест по карточкам: ${doc.title}`, questions, 'cards');
}

async function saveTest(docId: string, title: string, questions: Question[], source: 'ai' | 'cards', subId?: string): Promise<TestRow> {
  const now = Date.now();
  const t: TestRow = { id: uid(), docId, title, source, ...(subId ? { subId } : {}), questions, createdAt: now, updatedAt: now };
  await db.tests.add(t);
  return t;
}

// ---------- Тест от ИИ ----------

interface RawQuestion {
  kind?: string;
  prompt?: string;
  options?: unknown[];
  correct?: unknown;
  answer?: unknown;
  left?: unknown[];
  right?: unknown[];
  items?: unknown[];
  page?: unknown;
  labels?: { text?: unknown; box?: unknown }[];
  explanation?: unknown;
}

const str = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const strs = (v: unknown[] | undefined) => (v ?? []).map(str).filter(Boolean);

/** Вопрос «подписать картинку» до отрисовки слайда: номер слайда и области (доли). */
export interface PendingLabel {
  page: number;
  areas: Area[];
}

/**
 * Ответ модели → вопросы. Сломанные вопросы отбрасываются; у «подписей» — только номер
 * слайда и области (картинку слайда дорисует вызывающий).
 */
export function normalizeAiQuestions(raw: { questions?: RawQuestion[] }, slideCount: number): { questions: Question[]; labels: Map<string, PendingLabel> } {
  const out: Question[] = [];
  const labels = new Map<string, PendingLabel>();
  for (const r of raw.questions ?? []) {
    const prompt = str(r.prompt);
    const explanation = str(r.explanation) || undefined;
    const id = uid();
    let data: QuestionData | null = null;
    switch (r.kind) {
      case 'single': {
        const options = strs(r.options);
        const c = Number(r.correct);
        if (options.length >= 2 && Number.isInteger(c) && c >= 0 && c < options.length) data = { kind: 'single', options, correct: c };
        break;
      }
      case 'multiple': {
        const options = strs(r.options);
        const correct = [...new Set((Array.isArray(r.correct) ? r.correct : []).map(Number))].filter((c) => Number.isInteger(c) && c >= 0 && c < options.length);
        if (options.length >= 3 && correct.length) data = { kind: 'multiple', options, correct };
        break;
      }
      case 'truefalse':
        if (typeof r.answer === 'boolean' || r.answer === 'true' || r.answer === 'false') data = { kind: 'truefalse', answer: r.answer === true || r.answer === 'true' };
        break;
      case 'open':
        if (str(r.answer)) data = { kind: 'open', answer: str(r.answer) };
        break;
      case 'match': {
        const left = strs(r.left);
        const right = strs(r.right);
        if (left.length >= 2 && left.length === right.length) data = { kind: 'match', left, right };
        break;
      }
      case 'order': {
        const items = strs(r.items);
        if (items.length >= 3 && new Set(items).size === items.length) data = { kind: 'order', items };
        break;
      }
      case 'label': {
        const page = Number(r.page);
        if (!Number.isInteger(page) || page < 1 || page > slideCount) break;
        const areas: Area[] = [];
        for (const l of r.labels ?? []) {
          const b = Array.isArray(l.box) ? l.box.map(Number) : [];
          if (b.length !== 4 || b.some((v) => !Number.isFinite(v)) || !str(l.text)) continue;
          const [y0, x0, y1, x1] = b.map((v) => Math.min(1000, Math.max(0, v)) / 1000);
          if (x1 - x0 < 0.005 || y1 - y0 < 0.005) continue;
          areas.push({ id: uid(), x: x0, y: y0, w: x1 - x0, h: y1 - y0, text: str(l.text) });
        }
        if (areas.length >= 2) {
          labels.set(id, { page, areas });
          data = { kind: 'label', fileId: '', areas };
        }
        break;
      }
    }
    if (data && prompt) out.push({ id, kind: data.kind, prompt, data, explanation });
  }
  return { questions: out, labels };
}

/** Тест ИИ по подтеме (subId) или по всей лекции. */
export async function createAiTest(lecture: Doc, subId?: string): Promise<TestRow> {
  const found = subId ? findSub(lecture.lecture?.outline, subId) : null;
  if (subId && !found) throw new Error('Подтема не найдена — обновите разбивку на вкладке «Сводки ИИ».');
  const m = await lectureMaterial(lecture);
  if (!m.slides.some((s) => s.trim()) && !m.notes.length) throw new Error('В лекции пока нет материала: загрузите презентацию или напишите конспект.');
  const pages = found?.sub.pages ?? [];
  // картинки слайдов — чтобы ИИ мог сделать вопрос «подпишите части»
  const imgPages = pages.length ? pages : m.slides.map((_, i) => i + 1);
  const { parts: images, rendered } = await pageImages(m.slidesDoc, imgPages, 3);
  const scope = found ? `подтема «${found.sub.title}» из темы «${found.topic.title}»` : `вся лекция «${lecture.title}»`;
  const raw = await askJson<{ questions?: RawQuestion[] }>(
    {
      system: prompt('tests', { scope, count: found ? '8–10' : '12–15', subject: await subjectOf(lecture) }),
      parts: [{ text: materialText(m, pages.length ? pages : undefined, 50000) }, ...images],
      temperature: 0.5,
      cache: false,
    },
    (v) => Array.isArray(v.questions) && v.questions.length > 0,
  );
  const { questions, labels } = normalizeAiQuestions(raw, m.slides.length);
  // «подписи»: дорисовываем слайд картинкой; если не вышло — вопрос убираем
  for (const [qid, l] of labels) {
    const q = questions.find((x) => x.id === qid)!;
    try {
      let png = rendered.get(l.page);
      if (!png && m.slidesDoc?.fileId) {
        const [{ loadPdf }, { renderClip }] = await Promise.all([import('../pdf/pdfjs'), import('../pdf/PdfPage')]);
        png = await renderClip(await loadPdf(m.slidesDoc.fileId), l.page, { id: '', x: 0, y: 0, w: 1, h: 1 });
      }
      if (!png) throw new Error('нет слайда');
      const { fileId } = await storeImage(png, `слайд ${l.page}.png`);
      q.data = { kind: 'label', fileId, areas: l.areas };
    } catch {
      questions.splice(questions.indexOf(q), 1);
    }
  }
  if (questions.length < 3) throw new Error('ИИ прислал слишком мало вопросов. Попробуйте ещё раз.');
  return saveTest(lecture.id, found ? `Тест: ${found.sub.title}` : `Тест по лекции: ${lecture.title}`, questions, 'ai', subId);
}

/** Тест ИИ по всей теме (предмету): материал всех лекций внутри. */
export async function createAiTopicTest(folder: Doc): Promise<TestRow> {
  const docs = await db.docs.filter((d) => !d.deletedAt).toArray();
  const ids = new Set(collectSubtree(docs, folder.id));
  const lectures = docs.filter((d) => d.type === 'lecture' && ids.has(d.id));
  if (!lectures.length) throw new Error('В теме пока нет лекций. Тест по теме строится по материалу её лекций.');
  // каждой лекции — равная доля материала
  const per = Math.floor(60000 / lectures.length);
  const parts: string[] = [];
  for (const l of lectures) {
    const m = await lectureMaterial(l);
    if (m.slides.some((x) => x.trim()) || m.notes.length) parts.push(`##### Лекция «${l.title}»\n${materialText(m, undefined, per)}`);
  }
  if (!parts.length) throw new Error('В лекциях темы пока нет материала: загрузите презентации или напишите конспекты.');
  const raw = await askJson<{ questions?: RawQuestion[] }>(
    {
      system: prompt('tests', { scope: `вся тема «${folder.title}» (${lectures.length} ${lectures.length === 1 ? 'лекция' : 'лекций'}); вопросы по всем лекциям, особенно на связи между ними`, count: '15–20', subject: await subjectOf(folder) }),
      parts: [{ text: parts.join('\n\n') }],
      temperature: 0.5,
      cache: false,
    },
    (v) => Array.isArray(v.questions) && v.questions.length > 0,
  );
  // картинок слайдов здесь нет — вопросы «подпишите» без изображения не берём
  const questions = normalizeAiQuestions(raw, 0).questions.filter((q) => q.kind !== 'label');
  if (questions.length < 3) throw new Error('ИИ прислал слишком мало вопросов. Попробуйте ещё раз.');
  return saveTest(folder.id, `Тест по теме: ${folder.title}`, questions, 'ai');
}

// ---------- Открытые ответы ----------

export async function checkOpen(q: Question, text: string, image?: Blob): Promise<CheckResult> {
  if (q.data.kind !== 'open') throw new Error('Не открытый вопрос');
  const { blobPart } = await import('../ai/client');
  const parts = [{ text: `Вопрос: ${q.prompt}\nПравильный ответ: ${q.data.answer}` }, ...(image ? [{ text: 'Ответ студентки (от руки):' }, await blobPart(image)] : [{ text: `Ответ студентки: ${text || '(пусто)'}` }])];
  return normalizeVerdict(await askJson<Partial<CheckResult>>({ system: prompt('check'), parts, temperature: 0, cache: false }, (v) => typeof v.verdict === 'string'));
}

// ---------- Попытки ----------

export async function saveAttempt(test: TestRow, answers: TestAttempt['answers']): Promise<TestAttempt> {
  const score = answers.length ? answers.reduce((s, a) => s + (a.score ?? (a.correct ? 1 : 0)), 0) / answers.length : 0;
  const a: TestAttempt = { id: uid(), testId: test.id, docId: test.docId, at: Date.now(), score, answers };
  await db.testAttempts.add(a);
  await db.tests.update(test.id, { updatedAt: a.at });
  return a;
}

/** Последние попытки тестов поддерева — для процента знания. */
export async function attemptsIn(ids: string[]): Promise<TestAttempt[]> {
  return db.testAttempts.where('docId').anyOf(ids).toArray();
}

// ---------- Ошибки → карточки ----------

/** Куда класть карточки из ошибок: в «Сводки» лекции или в заметку «Ошибки из тестов» темы. */
async function mistakesDoc(docId: string): Promise<Doc> {
  const doc = await db.docs.get(docId);
  if (!doc) throw new Error('Документ теста не найден');
  if (doc.type === 'lecture') return summaryDoc(doc);
  const existing = await db.docs.filter((d) => d.parentId === docId && !d.deletedAt && d.type === 'note' && d.title === 'Ошибки из тестов').first();
  return existing ?? createDoc('note', docId, 'Ошибки из тестов');
}

export async function addMistakeCards(docId: string, cards: DraftCard[]): Promise<Doc> {
  const doc = await mistakesDoc(docId);
  const all = await db.blocks.where('docId').equals(doc.id).toArray();
  const now = Date.now();
  let head = all.find((b) => b.ai?.kind === 'heading' && b.ai.topic === 'mistakes');
  if (!head) {
    head = { id: uid(), docId: doc.id, parentId: null, order: Math.max(0, ...all.filter((b) => !b.parentId).map((b) => b.order)) + 1, kind: 'text', text: 'Ошибки из тестов', heading: 2, tags: [], links: [], ai: { kind: 'heading', topic: 'mistakes' }, createdAt: now, updatedAt: now };
    await db.blocks.add(head);
  }
  let order = Math.max(0, ...all.filter((b) => b.parentId === head!.id).map((b) => b.order)) + 1;
  const created: Block[] = [];
  for (const c of cards) {
    const { text, children } = cardText(c);
    const b: Block = { id: uid(), docId: doc.id, parentId: head.id, order: order++, kind: 'text', text, tags: [], links: [], ai: { kind: 'cards' }, createdAt: now, updatedAt: now };
    created.push(b, ...children.map((t, i): Block => ({ id: uid(), docId: doc.id, parentId: b.id, order: i, kind: 'text', text: t, tags: [], links: [], createdAt: now, updatedAt: now })));
  }
  await db.blocks.bulkAdd(created);
  for (const b of created) await syncBlockCards(b.id);
  await db.docs.update(doc.id, { updatedAt: now });
  return doc;
}
