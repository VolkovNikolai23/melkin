// Распознавание рукописи через ИИ (Gemini по умолчанию). Текст сохраняется в листах
// тетрадей и рукописных блоках — для офлайн-поиска и как материал для сводок.
import { db, getSettings } from '../../db/db';
import type { Block, Page } from '../../db/schema';
import { PAGE_H, PAGE_W } from '../ink/notebook';
import { AiError, aiReady, ask, canvasPart } from './client';
import { renderInk } from './inkImage';
import { prompt } from './prompts';

/** Нужно ли (пере)распознать лист: есть штрихи и он менялся после прошлого распознавания. */
export const pageNeedsRecognition = (p: Page) => p.strokes.length > 0 && p.recognizedAt !== p.updatedAt;
export const blockNeedsRecognition = (b: Block) => b.kind === 'ink' && !!b.ink?.strokes.length && b.recognizedAt !== b.updatedAt;

async function recognizeImage(c: HTMLCanvasElement): Promise<string> {
  const text = await ask({ system: prompt('recognize'), parts: [await canvasPart(c, 'image/jpeg'), { text: 'Распознай текст.' }], temperature: 0 });
  return text.trim().replace(/^"|"$/g, '');
}

export async function recognizePage(id: string): Promise<string> {
  const p = await db.pages.get(id);
  if (!p) return '';
  if (!p.strokes.length) {
    await db.pages.update(id, { recognizedText: '', recognizedAt: p.updatedAt });
    return '';
  }
  const text = await recognizeImage(await renderInk({ width: PAGE_W, height: PAGE_H, strokes: p.strokes }, undefined, 1400));
  // лист могли изменить, пока шёл запрос, — тогда отметку не ставим, распознаем ещё раз
  const now = await db.pages.get(id);
  await db.pages.update(id, { recognizedText: text, ...(now?.updatedAt === p.updatedAt ? { recognizedAt: p.updatedAt } : {}) });
  return text;
}

export async function recognizeBlock(id: string): Promise<string> {
  const b = await db.blocks.get(id);
  if (!b?.ink) return '';
  const text = await recognizeImage(await renderInk({ width: b.ink.width, height: b.ink.height, strokes: b.ink.strokes }, undefined, 1200));
  const now = await db.blocks.get(id);
  await db.blocks.update(id, { recognizedText: text, ...(now?.updatedAt === b.updatedAt ? { recognizedAt: b.updatedAt } : {}) });
  return text;
}

/** Распознать все листы тетради, которые ещё не распознаны (с прогрессом). */
export async function recognizeNotebook(docId: string, onProgress?: (done: number, total: number) => void): Promise<number> {
  const pages = (await db.pages.where('docId').equals(docId).toArray()).filter(pageNeedsRecognition);
  let done = 0;
  for (const p of pages) {
    onProgress?.(done, pages.length);
    await recognizePage(p.id);
    done++;
  }
  onProgress?.(done, pages.length);
  return done;
}

// ---------- Фоновая очередь ----------

const dirtyPages = new Set<string>();
const dirtyBlocks = new Set<string>();
let timer = 0;
let pausedUntil = 0;
let running = false;
/** Сколько ждать после последней правки, прежде чем распознавать (пишет — не мешаем) */
const IDLE_MS = 20_000;

/** Лист или рукописный блок изменился — распознаем в фоне, когда пользователь остановится. */
export function markInkDirty(kind: 'page' | 'block', id: string) {
  (kind === 'page' ? dirtyPages : dirtyBlocks).add(id);
  schedule(IDLE_MS);
}

function schedule(ms: number) {
  if (typeof window === 'undefined') return;
  window.clearTimeout(timer);
  timer = window.setTimeout(runQueue, ms);
}

async function runQueue() {
  if (running || (!dirtyPages.size && !dirtyBlocks.size)) return;
  if (Date.now() < pausedUntil || !navigator.onLine) return schedule(60_000);
  const s = await getSettings();
  if (!s.autoRecognize || !(await aiReady())) return;
  running = true;
  try {
    for (const id of [...dirtyPages]) {
      const p = await db.pages.get(id);
      dirtyPages.delete(id);
      if (p && pageNeedsRecognition(p) && Date.now() - p.updatedAt >= IDLE_MS - 1000) await recognizePage(id);
      else if (p && pageNeedsRecognition(p)) dirtyPages.add(id); // ещё пишут — позже
    }
    for (const id of [...dirtyBlocks]) {
      const b = await db.blocks.get(id);
      dirtyBlocks.delete(id);
      if (b && blockNeedsRecognition(b) && Date.now() - b.updatedAt >= IDLE_MS - 1000) await recognizeBlock(id);
      else if (b && blockNeedsRecognition(b)) dirtyBlocks.add(id);
    }
  } catch (e) {
    // лимит, VPN, ключ — не долбим сервис, попробуем через 10 минут
    if (e instanceof AiError) pausedUntil = Date.now() + 10 * 60_000;
  } finally {
    running = false;
    if (dirtyPages.size || dirtyBlocks.size) schedule(IDLE_MS);
  }
}

/** При запуске: найти нераспознанные листы и блоки (один раз, в фоне). */
export async function startAutoRecognize() {
  const s = await getSettings();
  if (!s.autoRecognize) return;
  await db.pages.each((p) => {
    if (pageNeedsRecognition(p)) dirtyPages.add(p.id);
  });
  await db.blocks
    .filter((b) => b.kind === 'ink')
    .each((b) => {
      if (blockNeedsRecognition(b)) dirtyBlocks.add(b.id);
    });
  if (dirtyPages.size || dirtyBlocks.size) schedule(5_000);
  window.addEventListener('online', () => schedule(5_000));
}
