import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PageBackground, Stroke } from '../../db/schema';
import { uid } from '../../lib/id';
import { hitStroke, livePath, MARKER_SIZE, PEN_SIZES, strokePath, strokesBottom } from './geometry';
import { inkStore } from './inkStore';

interface Props {
  id: string;
  width: number;
  height: number;
  strokes: Stroke[];
  background?: PageBackground;
  readOnly?: boolean;
  onChange?: (strokes: Stroke[]) => void;
  /** Вызывается после штриха с нижней границей рисунка — для авто-увеличения высоты */
  onStrokeEnd?: (bottom: number) => void;
  /** Щипок двумя пальцами: множитель масштаба */
  onPinch?: (ratio: number) => void;
  className?: string;
}

interface Drawing {
  pointerId: number;
  mode: 'draw' | 'erase';
  flat: number[];
  tool: 'pen' | 'marker';
  color: string;
  size: number;
  real: boolean;
  before: Stroke[];
  erased: boolean;
}

const fillOf = (color: string) => (color === 'auto' ? 'var(--ink-auto)' : color);

function scrollParent(el: Element | null): HTMLElement {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return (document.scrollingElement as HTMLElement) ?? document.body;
}

const StrokePaths = memo(function StrokePaths({ strokes }: { strokes: Stroke[] }) {
  // маркер рисуем под чернилами, как настоящий текстовыделитель
  const markers = strokes.filter((s) => s.tool === 'marker');
  const pens = strokes.filter((s) => s.tool !== 'marker');
  return (
    <>
      <g opacity={0.4}>
        {markers.map((s) => (
          <path key={s.id} d={strokePath(s)} fill={fillOf(s.color)} />
        ))}
      </g>
      {pens.map((s) => (
        <path key={s.id} d={strokePath(s)} fill={fillOf(s.color)} />
      ))}
    </>
  );
});

export function InkCanvas({ id, width, height, strokes: propStrokes, background = 'blank', readOnly, onChange, onStrokeEnd, onPinch, className }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const liveRef = useRef<SVGPathElement>(null);
  const [strokes, setStrokes] = useState(propStrokes);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const history = useRef<{ past: Stroke[][]; future: Stroke[][] }>({ past: [], future: [] });
  const drawing = useRef<Drawing | null>(null);
  const lastLocal = useRef(0);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const scroller = useRef<HTMLElement | null>(null);
  const raf = useRef(0);
  const patternId = useId().replace(/:/g, '');

  // Внешние изменения (из БД) принимаем, только если пользователь сейчас не рисует
  // и не менял холст только что (иначе «эхо» сохранения затрёт свежий штрих).
  useEffect(() => {
    if (drawing.current || Date.now() - lastLocal.current < 1500) return;
    setStrokes(propStrokes);
  }, [propStrokes]);

  const commit = useCallback(
    (next: Stroke[], before: Stroke[]) => {
      history.current.past.push(before);
      if (history.current.past.length > 200) history.current.past.shift();
      history.current.future = [];
      lastLocal.current = Date.now();
      setStrokes(next);
      onChange?.(next);
    },
    [onChange],
  );

  const register = useCallback(() => {
    const h = history.current;
    inkStore.set({
      active: {
        id,
        canUndo: h.past.length > 0,
        canRedo: h.future.length > 0,
        undo: () => {
          const prev = h.past.pop();
          if (!prev) return;
          h.future.push(strokesRef.current);
          lastLocal.current = Date.now();
          setStrokes(prev);
          onChange?.(prev);
          register();
        },
        redo: () => {
          const next = h.future.pop();
          if (!next) return;
          h.past.push(strokesRef.current);
          lastLocal.current = Date.now();
          setStrokes(next);
          onChange?.(next);
          register();
        },
      },
    });
  }, [id, onChange]);

  useEffect(
    () => () => {
      if (inkStore.get().active?.id === id) inkStore.set({ active: null });
    },
    [id],
  );

  // Запрещаем системное выделение/лупу при касании стилусом (iPadOS).
  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el || readOnly) return;
    const onTouch = (e: TouchEvent) => {
      for (const t of Array.from(e.touches)) {
        if ((t as Touch & { touchType?: string }).touchType === 'stylus') {
          e.preventDefault();
          return;
        }
      }
    };
    el.addEventListener('touchstart', onTouch, { passive: false });
    el.addEventListener('touchmove', onTouch, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onTouch);
      el.removeEventListener('touchmove', onTouch);
    };
  }, [readOnly]);

  const toLocal = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) * width) / r.width, ((e.clientY - r.top) * height) / r.height];
  };

  const eraseAt = (x: number, y: number) => {
    const d = drawing.current!;
    const cur = strokesRef.current;
    const left = cur.filter((s) => !hitStroke(s, x, y, 8));
    if (left.length !== cur.length) {
      d.erased = true;
      strokesRef.current = left;
      setStrokes(left);
    }
  };

  const drawLive = () => {
    raf.current = 0;
    const d = drawing.current;
    if (!d || d.mode !== 'draw' || !liveRef.current) return;
    liveRef.current.setAttribute('d', livePath(d, d.flat, d.real));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (readOnly) return;
    // Отсечение ладони: пальцы никогда не рисуют, только прокручивают/масштабируют.
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      scroller.current = scrollParent(svgRef.current);
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (drawing.current) return;
    e.preventDefault();
    svgRef.current!.setPointerCapture(e.pointerId);
    const ink = inkStore.get();
    const [x, y] = toLocal(e);
    const real = e.pointerType === 'pen';
    const p = real ? Math.max(e.pressure, 0.05) : 0.5;
    const tool = ink.tool === 'marker' ? 'marker' : 'pen';
    drawing.current = {
      pointerId: e.pointerId,
      mode: ink.tool === 'eraser' ? 'erase' : 'draw',
      flat: [x, y, p],
      tool,
      color: tool === 'marker' ? ink.markerColor : ink.penColor,
      size: tool === 'marker' ? MARKER_SIZE : PEN_SIZES[ink.penSize] ?? PEN_SIZES[1],
      real,
      before: strokesRef.current,
      erased: false,
    };
    if (ink.tool === 'eraser') eraseAt(x, y);
    else if (liveRef.current) {
      liveRef.current.setAttribute('fill', fillOf(drawing.current.color));
      liveRef.current.setAttribute('opacity', tool === 'marker' ? '0.4' : '1');
      drawLive();
    }
    register();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') {
      const prev = touches.current.get(e.pointerId);
      if (!prev) return;
      const pts = [...touches.current.values()];
      if (touches.current.size >= 2 && onPinch) {
        const other = [...touches.current.entries()].find(([k]) => k !== e.pointerId)![1];
        const before = Math.hypot(prev.x - other.x, prev.y - other.y);
        const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
        if (before > 0) onPinch(after / before);
      }
      const k = 1 / Math.max(1, pts.length);
      scroller.current?.scrollBy((prev.x - e.clientX) * k, (prev.y - e.clientY) * k);
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      return;
    }
    const d = drawing.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const [x, y] = toLocal(ev);
      if (d.mode === 'erase') eraseAt(x, y);
      else d.flat.push(x, y, d.real ? Math.max(ev.pressure, 0.05) : 0.5);
    }
    if (d.mode === 'draw' && !raf.current) raf.current = requestAnimationFrame(drawLive);
  };

  const finish = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') {
      touches.current.delete(e.pointerId);
      return;
    }
    const d = drawing.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drawing.current = null;
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
    liveRef.current?.setAttribute('d', '');
    if (d.mode === 'erase') {
      if (d.erased) commit(strokesRef.current, d.before);
    } else {
      const s: Stroke = { id: uid(), tool: d.tool, color: d.color, size: d.size, points: d.flat.map((v) => Math.round(v * 100) / 100) };
      const next = [...d.before, s];
      commit(next, d.before);
      onStrokeEnd?.(strokesBottom([s]));
    }
    register();
  };

  const bg = useMemo(() => {
    if (background === 'grid')
      return (
        <pattern id={patternId} width={40} height={40} patternUnits="userSpaceOnUse">
          <path d="M40 0H0V40" fill="none" stroke="var(--paper-line)" strokeWidth={1} />
        </pattern>
      );
    if (background === 'lines')
      return (
        <pattern id={patternId} width={width} height={40} patternUnits="userSpaceOnUse">
          <path d={`M0 39.5H${width}`} stroke="var(--paper-line)" strokeWidth={1} />
        </pattern>
      );
    return null;
  }, [background, patternId, width]);

  return (
    <svg
      ref={svgRef}
      className={'ink-canvas ' + (readOnly ? 'readonly ' : '') + (className ?? '')}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMin meet"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onContextMenu={(e) => e.preventDefault()}
    >
      {bg && <defs>{bg}</defs>}
      {bg && <rect width={width} height={height} fill={`url(#${patternId})`} />}
      {background === 'lines' && <path d={`M70 0V${height}`} stroke="var(--paper-margin)" strokeWidth={1.5} />}
      <StrokePaths strokes={strokes} />
      <path ref={liveRef} />
    </svg>
  );
}
