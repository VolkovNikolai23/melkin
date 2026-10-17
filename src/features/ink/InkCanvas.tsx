import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PageBackground, Stroke } from '../../db/schema';
import { uid } from '../../lib/id';
import { Icon } from '../../components/Icon';
import {
  duplicateStrokes,
  hitStroke,
  livePath,
  MARKER_SIZE,
  moveStrokes,
  PEN_SIZES,
  recolorStrokes,
  selectByLasso,
  strokePath,
  strokesBBox,
  strokesBottom,
} from './geometry';
import { inkStore, useInk } from './inkStore';

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
  mode: 'draw' | 'erase' | 'lasso' | 'move';
  /** Для переноса выделения: точка начала и текущий сдвиг */
  start?: [number, number];
  dx?: number;
  dy?: number;
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

const StrokePaths = memo(function StrokePaths({ strokes, halo }: { strokes: Stroke[]; halo?: boolean }) {
  // маркер рисуем под чернилами, как настоящий текстовыделитель
  const markers = strokes.filter((s) => s.tool === 'marker');
  const pens = strokes.filter((s) => s.tool !== 'marker');
  return (
    <>
      {/* подсветка выделенных лассо штрихов */}
      {halo && (
        <g opacity={0.35}>
          {strokes.map((s) => (
            <path key={'h' + s.id} d={strokePath(s)} fill="none" stroke="var(--accent)" strokeWidth={8} strokeLinejoin="round" />
          ))}
        </g>
      )}
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
  const ink = useInk();
  const lassoRef = useRef<SVGPathElement>(null);
  const selGroupRef = useRef<SVGGElement>(null);
  const [selection, setSelection] = useState<string[]>([]);

  // Выделение лассо живёт, только пока выбран инструмент «лассо»
  useEffect(() => {
    if (ink.tool !== 'lasso') setSelection([]);
  }, [ink.tool]);

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
    try {
      svgRef.current!.setPointerCapture(e.pointerId);
    } catch {
      /* указатель уже отпущен — рисуем без захвата */
    }
    const tools = inkStore.get();
    const [x, y] = toLocal(e);
    const real = e.pointerType === 'pen';
    const p = real ? Math.max(e.pressure, 0.05) : 0.5;
    const tool = tools.tool === 'marker' ? 'marker' : 'pen';
    if (tools.tool === 'lasso') {
      // Касание внутри рамки выделения — переносим, иначе — новое лассо
      const box = selBox;
      const inside = box && x >= box.x - 12 && x <= box.x + box.w + 12 && y >= box.y - 12 && y <= box.y + box.h + 12;
      drawing.current = {
        pointerId: e.pointerId,
        mode: inside ? 'move' : 'lasso',
        start: [x, y],
        dx: 0,
        dy: 0,
        flat: [x, y],
        tool,
        color: '',
        size: 0,
        real,
        before: strokesRef.current,
        erased: false,
      };
      if (!inside) setSelection([]);
      register();
      return;
    }
    drawing.current = {
      pointerId: e.pointerId,
      mode: tools.tool === 'eraser' ? 'erase' : 'draw',
      flat: [x, y, p],
      tool,
      color: tool === 'marker' ? tools.markerColor : tools.penColor,
      size: tool === 'marker' ? MARKER_SIZE : PEN_SIZES[tools.penSize] ?? PEN_SIZES[1],
      real,
      before: strokesRef.current,
      erased: false,
    };
    if (tools.tool === 'eraser') eraseAt(x, y);
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
    if (d.mode === 'lasso' || d.mode === 'move') {
      const [x, y] = toLocal(e);
      if (d.mode === 'lasso') {
        d.flat.push(x, y);
        lassoRef.current?.setAttribute('d', 'M' + d.flat.join(' ') + 'Z');
      } else {
        d.dx = x - d.start![0];
        d.dy = y - d.start![1];
        selGroupRef.current?.setAttribute('transform', `translate(${d.dx} ${d.dy})`);
      }
      return;
    }
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
    if (d.mode === 'lasso') {
      lassoRef.current?.setAttribute('d', '');
      setSelection(selectByLasso(strokesRef.current, d.flat));
      register();
      return;
    }
    if (d.mode === 'move') {
      selGroupRef.current?.removeAttribute('transform');
      if (Math.hypot(d.dx ?? 0, d.dy ?? 0) > 1) {
        const r = moveStrokes(strokesRef.current, selection, d.dx!, d.dy!, uid);
        commit(r.strokes, d.before);
        setSelection(r.ids);
        onStrokeEnd?.(strokesBottom(r.strokes.filter((x) => r.ids.includes(x.id))));
      }
      register();
      return;
    }
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

  const selSet = useMemo(() => new Set(selection), [selection]);
  const selected = useMemo(() => strokes.filter((x) => selSet.has(x.id)), [strokes, selSet]);
  const rest = useMemo(() => (selSet.size ? strokes.filter((x) => !selSet.has(x.id)) : strokes), [strokes, selSet]);
  const selBox = useMemo(() => strokesBBox(selected), [selected]);

  const applySel = (r: { strokes: Stroke[]; ids: string[] }) => {
    commit(r.strokes, strokesRef.current);
    setSelection(r.ids);
    register();
  };
  const selActions = [
    { label: 'Удалить', icon: 'trash' as const, run: () => (commit(strokesRef.current.filter((x) => !selSet.has(x.id)), strokesRef.current), setSelection([]), register()) },
    { label: 'Копия', icon: 'plus' as const, run: () => applySel(duplicateStrokes(strokesRef.current, selection, 24, uid)) },
    { label: 'Цвет пера', icon: 'pen' as const, run: () => applySel(recolorStrokes(strokesRef.current, selection, inkStore.get().penColor, uid)) },
    { label: 'Снять выделение', icon: 'check' as const, run: () => setSelection([]) },
  ];

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
    <div className="ink-wrap">
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
      <StrokePaths strokes={rest} />
      <g ref={selGroupRef}>
        {selected.length > 0 && <StrokePaths strokes={selected} halo />}
        {selBox && (
          <rect
            x={selBox.x - 8}
            y={selBox.y - 8}
            width={selBox.w + 16}
            height={selBox.h + 16}
            className="lasso-box"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </g>
      <path ref={liveRef} />
      <path ref={lassoRef} className="lasso-path" vectorEffect="non-scaling-stroke" />
    </svg>
    {selBox && !readOnly && (
      <div
        className="lasso-menu"
        style={{ left: `${(Math.max(0, selBox.x) / width) * 100}%`, top: `${(Math.max(0, selBox.y - 8) / height) * 100}%` }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {selActions.map((a) => (
          <button key={a.label} className="tool-btn" title={a.label} aria-label={a.label} onClick={a.run}>
            <Icon name={a.icon} size={18} />
          </button>
        ))}
      </div>
    )}
    </div>
  );
}
