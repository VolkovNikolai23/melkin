import { useCallback, useRef } from 'react';
import { db } from '../../db/db';
import { markInkDirty } from '../ai/recognize';
import type { Block, Stroke } from '../../db/schema';
import { INK_DEFAULT_HEIGHT, INK_WIDTH } from '../notes/blocks';
import { strokesBottom } from './geometry';
import { InkCanvas } from './InkCanvas';

const MIN_H = 120;
const MAX_H = 4000;

/** Рукописный блок внутри заметки (и внутри ответа карточки — в режиме только чтения). */
export function InkBlock({ block, readOnly }: { block: Block; readOnly?: boolean }) {
  const ink = block.ink ?? { width: INK_WIDTH, height: INK_DEFAULT_HEIGHT, strokes: [] };
  const heightRef = useRef(ink.height);
  heightRef.current = ink.height;

  const onChange = useCallback(
    (strokes: Stroke[]) => {
      db.blocks.update(block.id, { ink: { width: INK_WIDTH, height: heightRef.current, strokes }, updatedAt: Date.now() });
      markInkDirty('block', block.id);
    },
    [block.id],
  );

  const setHeight = useCallback(
    async (h: number) => {
      const cur = await db.blocks.get(block.id);
      if (!cur?.ink) return;
      const min = Math.max(MIN_H, strokesBottom(cur.ink.strokes) + 20);
      const height = Math.round(Math.min(MAX_H, Math.max(min, h)));
      heightRef.current = height;
      await db.blocks.update(block.id, { ink: { ...cur.ink, height } });
    },
    [block.id],
  );

  // Дописали у нижнего края — блок сам становится выше.
  const onStrokeEnd = useCallback(
    (bottom: number) => {
      if (bottom > heightRef.current - 60) setHeight(heightRef.current + 200);
    },
    [setHeight],
  );

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const svg = el.parentElement!.querySelector('svg')!;
    const scale = INK_WIDTH / svg.getBoundingClientRect().width;
    const startY = e.clientY;
    const startH = heightRef.current;
    const move = (ev: PointerEvent) => {
      const h = startH + (ev.clientY - startY) * scale;
      svg.setAttribute('viewBox', `0 0 ${INK_WIDTH} ${Math.max(MIN_H, h)}`);
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setHeight(startH + (ev.clientY - startY) * scale);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  return (
    <div className="ink-block">
      <InkCanvas
        id={'block-' + block.id}
        width={INK_WIDTH}
        height={ink.height}
        strokes={ink.strokes}
        readOnly={readOnly}
        onChange={onChange}
        onStrokeEnd={onStrokeEnd}
      />
      {!readOnly && (
        <div className="ink-resize" onPointerDown={startResize} title="Потяните, чтобы изменить высоту">
          <span />
        </div>
      )}
    </div>
  );
}
