import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/Icon';
import { useFileUrl } from '../../components/useFileUrl';
import { db } from '../../db/db';
import type { Block, ImageData, Rect } from '../../db/schema';
import { uid } from '../../lib/id';
import { syncBlockCards } from './sync';

type Drag =
  | { mode: 'new'; id: string; x0: number; y0: number }
  | { mode: 'move'; id: string; dx: number; dy: number }
  | { mode: 'resize'; id: string };

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const MIN = 0.015;

/**
 * Редактор image occlusion: прямоугольники рисуются протягиванием по картинке
 * (палец, Pencil или мышь), выбранный можно перетащить, изменить угол или удалить.
 * Координаты хранятся в долях размера картинки — не зависят от масштаба экрана.
 */
export function OcclusionEditor({ block, onClose }: { block: Block; onClose: () => void }) {
  const image = block.image as ImageData;
  const url = useFileUrl(image.fileId);
  const [rects, setRects] = useState<Rect[]>(image.occlusions ?? []);
  const [mode, setMode] = useState<'hideOne' | 'hideAll'>(image.occlusionMode ?? 'hideOne');
  const [sel, setSel] = useState<string | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const pos = (e: React.PointerEvent) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  };

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    stage.current!.setPointerCapture(e.pointerId);
    const p = pos(e);
    const t = e.target as HTMLElement;
    const id = t.closest('[data-rect]')?.getAttribute('data-rect');
    if (id && t.classList.contains('occ-handle')) {
      drag.current = { mode: 'resize', id };
    } else if (id) {
      const r = rects.find((x) => x.id === id)!;
      drag.current = { mode: 'move', id, dx: p.x - r.x, dy: p.y - r.y };
    } else {
      const nid = uid();
      drag.current = { mode: 'new', id: nid, x0: p.x, y0: p.y };
      setRects((rs) => [...rs, { id: nid, x: p.x, y: p.y, w: 0, h: 0 }]);
    }
    setSel(id ?? drag.current.id);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = pos(e);
    setRects((rs) =>
      rs.map((r) => {
        if (r.id !== d.id) return r;
        if (d.mode === 'new') return { ...r, x: Math.min(d.x0, p.x), y: Math.min(d.y0, p.y), w: Math.abs(p.x - d.x0), h: Math.abs(p.y - d.y0) };
        if (d.mode === 'move') return { ...r, x: clamp(Math.min(p.x - d.dx, 1 - r.w)), y: clamp(Math.min(p.y - d.dy, 1 - r.h)) };
        return { ...r, w: Math.max(MIN, p.x - r.x), h: Math.max(MIN, p.y - r.y) };
      }),
    );
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    // случайное касание без протягивания не создаёт область
    if (d?.mode === 'new') setRects((rs) => rs.filter((r) => r.id !== d.id || (r.w > MIN && r.h > MIN)));
  };

  const save = async () => {
    const occlusions = rects.filter((r) => r.w > MIN && r.h > MIN);
    await db.blocks.update(block.id, { image: { ...image, occlusions: occlusions.length ? occlusions : undefined, occlusionMode: mode }, updatedAt: Date.now() });
    await syncBlockCards(block.id);
    onClose();
  };

  return createPortal(
    <div className="occ-editor" role="dialog" aria-modal aria-label="Области для карточек">
      <div className="occ-toolbar">
        <button className="btn ghost small" onClick={onClose}>
          Отмена
        </button>
        <div className="occ-modes">
          <button className={'tool-btn text' + (mode === 'hideOne' ? ' active' : '')} onClick={() => setMode('hideOne')}>
            Скрыть одну
          </button>
          <button className={'tool-btn text' + (mode === 'hideAll' ? ' active' : '')} onClick={() => setMode('hideAll')}>
            Скрыть все
          </button>
        </div>
        <button className="tool-btn" disabled={!sel} aria-label="Удалить область" onClick={() => (setRects(rects.filter((r) => r.id !== sel)), setSel(null))}>
          <Icon name="trash" />
        </button>
        <button className="btn primary small" onClick={save}>
          Готово · {rects.filter((r) => r.w > MIN && r.h > MIN).length}
        </button>
      </div>
      <p className="occ-hint">Проведите по картинке, чтобы закрыть область. Каждая область — отдельная карточка.</p>
      <div className="occ-stage-wrap">
        <div
          ref={stage}
          className="occ-stage"
          style={{ aspectRatio: `${image.width} / ${image.height}` }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {url && <img src={url} alt="" draggable={false} />}
          {rects.map((r, i) => (
            <div
              key={r.id}
              data-rect={r.id}
              className={'occ-rect edit' + (sel === r.id ? ' selected' : '')}
              style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
            >
              <span className="occ-num">{i + 1}</span>
              {sel === r.id && <span className="occ-handle" />}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Картинка с областями: в заметке (контуры), на вопросе и в ответе карточки. */
export function OcclusionLayer({
  image,
  target,
  revealed,
}: {
  image: ImageData;
  /** id проверяемой области; без него — просто показать контуры (вид в заметке) */
  target?: string;
  revealed?: boolean;
}) {
  const hideAll = image.occlusionMode === 'hideAll';
  return (
    <>
      {(image.occlusions ?? []).map((r, i) => {
        let cls = 'occ-rect';
        if (!target) cls += ' outline';
        else if (r.id === target) cls += revealed ? ' reveal' : ' mask target';
        else cls += hideAll ? ' mask' : ' hidden';
        return (
          <div key={r.id} className={cls} style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}>
            {!target && <span className="occ-num">{i + 1}</span>}
            {target === r.id && !revealed && <span className="occ-q">?</span>}
          </div>
        );
      })}
    </>
  );
}
