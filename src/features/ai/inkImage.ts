// Рисунок листа/блока на canvas — для отправки ИИ (распознавание, «объясни», вопросы от руки).
import { db } from '../../db/db';
import type { PageItem, Stroke } from '../../db/schema';
import { strokePath, type BBox } from '../ink/geometry';
import { DEFAULT_TEXT_SIZE } from '../ink/items';
import { wrapLines } from '../ink/exportNotebook';

export interface InkScene {
  width: number;
  height: number;
  strokes: Stroke[];
  items?: PageItem[];
  /** Подложка (страница PDF) в координатах листа */
  underlay?: CanvasImageSource;
  /** Включать картинки листа (для «объясни» — да, для распознавания рукописи — нет) */
  withImages?: boolean;
}

/** Рисует сцену (или её часть box) на белом фоне; длинная сторона — не больше maxSide px. */
export async function renderInk(scene: InkScene, box?: BBox, maxSide = 1600): Promise<HTMLCanvasElement> {
  const b = box ?? { x: 0, y: 0, w: scene.width, h: scene.height };
  const k = Math.min(3, maxSide / Math.max(b.w, b.h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(b.w * k));
  c.height = Math.max(1, Math.round(b.h * k));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.setTransform(k, 0, 0, k, -b.x * k, -b.y * k);
  if (scene.underlay) ctx.drawImage(scene.underlay, 0, 0, scene.width, scene.height);
  const items = scene.items ?? [];
  if (scene.withImages) {
    for (const it of items.filter((i) => i.kind === 'image' && i.fileId)) {
      const f = await db.files.get(it.fileId!);
      if (!f) continue;
      try {
        const bmp = await createImageBitmap(f.blob);
        ctx.drawImage(bmp, it.x, it.y, it.w, it.h);
        bmp.close();
      } catch {
        /* картинка не читается — пропускаем */
      }
    }
  }
  // маркер под ручкой, как на экране
  const ordered = [...scene.strokes.filter((s) => s.tool === 'marker'), ...scene.strokes.filter((s) => s.tool !== 'marker')];
  for (const s of ordered) {
    ctx.globalAlpha = s.tool === 'marker' ? 0.4 : 1;
    ctx.fillStyle = s.color === 'auto' ? '#1f1f23' : s.color;
    ctx.fill(new Path2D(strokePath(s)));
  }
  ctx.globalAlpha = 1;
  const family = getComputedStyle(document.documentElement).getPropertyValue('--app-font').trim() || 'sans-serif';
  for (const it of items.filter((i) => i.kind === 'text' && i.text)) {
    const fs = it.fontSize ?? DEFAULT_TEXT_SIZE;
    ctx.font = `${fs}px ${family}`;
    ctx.fillStyle = !it.color || it.color === 'auto' ? '#1f1f23' : it.color;
    ctx.textBaseline = 'top';
    wrapLines(it.text!, it.w, (s) => ctx.measureText(s).width).forEach((l, i) => ctx.fillText(l, it.x, it.y + i * fs * 1.3));
  }
  return c;
}
