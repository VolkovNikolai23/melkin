// ИИ в повторении: проверка своего ответа (текст или Pencil), «объясни проще»
// и автоматический поиск подписей на картинке для image occlusion.
import { db } from '../../db/db';
import type { CardRow, ImageData, Rect, Stroke } from '../../db/schema';
import { uid } from '../../lib/id';
import { renderInk } from './inkImage';
import { ask, askJson, blobPart, canvasPart, type Part } from './client';
import { prompt } from './prompts';
import { subjectOf } from './lecture';

export type Verdict = 'correct' | 'partial' | 'wrong';
export interface CheckResult {
  verdict: Verdict;
  feedback: string;
  recognized?: string;
}

/** Вырезать прямоугольник (в долях) из картинки — правильный ответ для occlusion. */
async function cropImage(image: ImageData, r: Rect): Promise<HTMLCanvasElement | null> {
  const f = await db.files.get(image.fileId);
  if (!f) return null;
  const bmp = await createImageBitmap(f.blob);
  // немного шире области — чтобы подпись читалась целиком
  const pad = 0.01;
  const x = Math.max(0, r.x - pad) * bmp.width;
  const y = Math.max(0, r.y - pad) * bmp.height;
  const w = Math.min(1, r.w + 2 * pad) * bmp.width;
  const h = Math.min(1, r.h + 2 * pad) * bmp.height;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  c.getContext('2d')!.drawImage(bmp, x, y, w, h, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

/** Правильный ответ карточки: текст ответа, вложенные пункты, для occlusion — картинка подписи. */
export async function expectedAnswer(card: CardRow): Promise<Part[]> {
  const block = await db.blocks.get(card.blockId);
  const parts: Part[] = [];
  if (card.kind === 'occlusion' && block?.image) {
    const r = block.image.occlusions?.find((x) => x.id === card.sub);
    if (r?.label) parts.push({ text: `Правильный ответ (подпись на картинке): ${r.label}` });
    else if (r) {
      const c = await cropImage(block.image, r);
      if (c) parts.push({ text: 'Правильный ответ — подпись на этом фрагменте картинки:' }, await canvasPart(c));
    }
    return parts;
  }
  const kids = block ? (await db.blocks.where('parentId').equals(block.id).sortBy('order')).map((b) => b.text || b.recognizedText || '').filter(Boolean) : [];
  const back = [card.back, ...kids].filter((s) => s?.trim()).join('\n');
  parts.push({ text: `Вопрос: ${card.front}\nПравильный ответ: ${back || '(см. вопрос: скрытое в {{…}})'}` });
  return parts;
}

export function normalizeVerdict(raw: Partial<CheckResult>): CheckResult {
  const v = raw.verdict === 'correct' || raw.verdict === 'partial' || raw.verdict === 'wrong' ? raw.verdict : 'partial';
  return { verdict: v, feedback: String(raw.feedback ?? '').trim(), recognized: raw.recognized ? String(raw.recognized) : undefined };
}

export async function checkAnswer(card: CardRow, mine: { mode: 'text' | 'pen'; text: string; strokes: Stroke[] }, inkSize: { width: number; height: number }): Promise<CheckResult> {
  const parts = await expectedAnswer(card);
  if (mine.mode === 'pen' && mine.strokes.length) {
    const c = await renderInk({ width: inkSize.width, height: inkSize.height, strokes: mine.strokes }, undefined, 1000);
    parts.push({ text: 'Ответ студентки (от руки):' }, await canvasPart(c));
  } else parts.push({ text: `Ответ студентки: ${mine.text.trim() || '(пусто)'}` });
  const raw = await askJson<Partial<CheckResult>>({ system: prompt('check'), parts, temperature: 0, cache: false }, (v) => typeof v.verdict === 'string');
  return normalizeVerdict(raw);
}

export async function explainSimpler(card: CardRow): Promise<string> {
  const doc = await db.docs.get(card.docId);
  const parts = await expectedAnswer(card);
  return ask({ system: prompt('simpler', { subject: doc ? await subjectOf(doc) : '' }), parts: [...parts, { text: 'Объясни проще.' }] });
}

// ---------- Подписи для image occlusion ----------

interface RawLabel {
  text?: string;
  box?: number[];
}

const iou = (a: Rect, b: Rect) => {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = x * y;
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};

/** Рамки модели [ymin, xmin, ymax, xmax] в 0…1000 → прямоугольники (доли), без дублей с уже нарисованными. */
export function labelsToRects(labels: RawLabel[], existing: Rect[], newId: () => string = uid): Rect[] {
  const out: Rect[] = [];
  const pad = 0.006;
  for (const l of labels) {
    const b = l.box;
    if (!Array.isArray(b) || b.length !== 4 || b.some((v) => typeof v !== 'number' || !Number.isFinite(v))) continue;
    const [y0, x0, y1, x1] = b.map((v) => Math.min(1000, Math.max(0, v)) / 1000);
    if (x1 - x0 < 0.005 || y1 - y0 < 0.005) continue;
    const r: Rect = { id: newId(), x: Math.max(0, x0 - pad), y: Math.max(0, y0 - pad), w: Math.min(1, x1 + pad) - Math.max(0, x0 - pad), h: Math.min(1, y1 + pad) - Math.max(0, y0 - pad), label: l.text?.trim() || undefined };
    if ([...existing, ...out].some((e) => iou(e, r) > 0.4)) continue;
    out.push(r);
  }
  return out;
}

export async function findLabels(image: ImageData, existing: Rect[]): Promise<Rect[]> {
  const f = await db.files.get(image.fileId);
  if (!f) throw new Error('Картинка не найдена');
  // модели хватает 1600 px; SVG и большие фото уменьшаем через canvas
  const bmp = await createImageBitmap(f.blob);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const raw = await askJson<{ labels?: RawLabel[] }>(
    { system: prompt('occlusion'), parts: [await blobPart(await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'))), { text: 'Найди подписи.' }], temperature: 0 },
    (v) => Array.isArray(v.labels),
  );
  return labelsToRects(raw.labels ?? [], existing);
}
