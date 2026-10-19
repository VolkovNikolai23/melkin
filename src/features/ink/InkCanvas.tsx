import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PageBackground, PageItem, Stroke } from '../../db/schema';
import { uid } from '../../lib/id';
import { Icon } from '../../components/Icon';
import {
  duplicateStrokes,
  hitStroke,
  livePath,
  moveStrokes,
  recolorStrokes,
  scaleFactor,
  scaleStrokes,
  selectByLasso,
  strokeAt,
  strokePath,
  strokesBBox,
  strokesBottom,
  type BBox,
} from './geometry';
import { DEFAULT_TEXT_SIZE, duplicateItems, itemsBBox, moveItems, scaleItems, selectItemsByLasso, unionBox } from './items';
import { inkStore, useInk } from './inkStore';
import { PageItems, SvgImage } from './PageItems';
import { autoInkFor, dotsPath, paperGeometry, segmentsPath } from './paper';
import { recognizeShape, type Shape } from './shapes';

interface Props {
  id: string;
  width: number;
  height: number;
  strokes: Stroke[];
  background?: PageBackground;
  /** Цвет бумаги и линий фона (по умолчанию — из темы) */
  paper?: string;
  lineColor?: string;
  /** Текст и картинки на листе (только в тетрадях) */
  items?: PageItem[];
  onItemsChange?: (items: PageItem[]) => void;
  readOnly?: boolean;
  onChange?: (strokes: Stroke[]) => void;
  /** Вызывается после штриха с нижней границей рисунка — для авто-увеличения высоты */
  onStrokeEnd?: (bottom: number) => void;
  /** Щипок двумя пальцами: множитель масштаба */
  onPinch?: (ratio: number) => void;
  /** ИИ-ручка: откуда фрагмент (для подсказки модели) и подложка (страница PDF) */
  aiContext?: string;
  underlay?: () => CanvasImageSource | null;
  /** Сюда холст кладёт функцию вставки объекта (картинки) с записью в историю */
  insertRef?: React.MutableRefObject<((item: PageItem) => void) | null>;
  className?: string;
}

interface Drawing {
  pointerId: number;
  mode: 'draw' | 'erase' | 'lasso' | 'move' | 'scale' | 'tap';
  /** Для переноса/масштаба выделения: точка начала и текущий сдвиг */
  start?: [number, number];
  dx?: number;
  dy?: number;
  flat: number[];
  tool: 'pen' | 'marker';
  color: string;
  size: number;
  real: boolean;
  before: Snap;
  erased: boolean;
  /** Автофигура, в которую превратился штрих после задержки */
  shape?: Shape;
  hold?: { x: number; y: number };
}

/** Снимок для истории: штрихи и объекты листа отменяются вместе */
interface Snap {
  s: Stroke[];
  i: PageItem[];
}

const NO_ITEMS: PageItem[] = [];
const HOLD_MS = 450;
const fillOf = (color: string) => (color === 'auto' ? 'var(--ink-auto)' : color);

function scrollParent(el: Element | null): HTMLElement {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return (document.scrollingElement as HTMLElement) ?? document.body;
}

/** Штрихи рисуются блоками по CHUNK: новый штрих перерисовывает только последний блок,
 *  а не тысячи путей на исписанном листе. */
const CHUNK = 150;

const sameItems = (a: Stroke[], b: Stroke[]) => a.length === b.length && a.every((x, i) => x === b[i]);

const StrokeChunk = memo(
  function StrokeChunk({ strokes }: { strokes: Stroke[] }) {
    return (
      <>
        {strokes.map((s) => (
          <path key={s.id} d={strokePath(s)} fill={fillOf(s.color)} />
        ))}
      </>
    );
  },
  (a, b) => sameItems(a.strokes, b.strokes),
);

function chunks(list: Stroke[]): Stroke[][] {
  const out: Stroke[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
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
        {chunks(markers).map((c, i) => (
          <StrokeChunk key={i} strokes={c} />
        ))}
      </g>
      {chunks(pens).map((c, i) => (
        <StrokeChunk key={i} strokes={c} />
      ))}
    </>
  );
});

/** Фон листа одним-двумя путями SVG (быстрее, чем шаблон с сотнями линий). */
const PaperBg = memo(function PaperBg({ background, width, height, paper, lineColor }: { background: PageBackground; width: number; height: number; paper?: string; lineColor?: string }) {
  const g = useMemo(() => paperGeometry(background, width, height), [background, width, height]);
  const line = lineColor ?? 'var(--paper-line)';
  return (
    <g pointerEvents="none">
      {paper && <rect width={width} height={height} fill={paper} />}
      {g.lines.length > 0 && <path d={segmentsPath(g.lines)} stroke={line} strokeWidth={1} fill="none" />}
      {g.dots.length > 0 && <path d={dotsPath(g.dots)} fill={line} />}
      {g.margins.length > 0 && <path d={segmentsPath(g.margins)} stroke={lineColor ?? 'var(--paper-margin)'} strokeWidth={1.5} fill="none" />}
    </g>
  );
});

export function InkCanvas({
  id,
  width,
  height,
  strokes: propStrokes,
  background = 'blank',
  paper,
  lineColor,
  items: propItems,
  onItemsChange,
  readOnly,
  onChange,
  onStrokeEnd,
  onPinch,
  insertRef,
  aiContext,
  underlay,
  className,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<SVGPathElement>(null);
  const [strokes, setStrokes] = useState(propStrokes);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const [items, setItems] = useState(propItems ?? NO_ITEMS);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const history = useRef<{ past: Snap[]; future: Snap[] }>({ past: [], future: [] });
  const drawing = useRef<Drawing | null>(null);
  const lastLocal = useRef(0);
  const touches = useRef(new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>());
  const scroller = useRef<HTMLElement | null>(null);
  const raf = useRef(0);
  const holdTimer = useRef(0);
  const ink = useInk();
  const lassoRef = useRef<SVGPathElement>(null);
  const selGroupRef = useRef<SVGGElement>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [itemSel, setItemSel] = useState<string[]>([]);
  const [activeItem, setActiveItem] = useState<string | null>(null);
  /** Обведённая лассо область без штрихов — для «объясни/переведи» (например, текст слайда) */
  const [aiRegion, setAiRegion] = useState<BBox | null>(null);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const withItems = !!onItemsChange;
  // «Текст» есть только на листах тетради; на других холстах это обычная ручка
  const tool = ink.tool === 'text' && !withItems ? 'pen' : ink.tool;

  // Выделение лассо живёт, только пока выбран инструмент «лассо»; выбор объекта — пока выбран «Текст»
  useEffect(() => {
    if (tool !== 'lasso') {
      setSelection([]);
      setItemSel([]);
      setAiRegion(null);
    }
    if (tool !== 'text') {
      setActiveItem(null);
      setEditingItem(null);
    }
  }, [tool]);

  // Внешние изменения (из БД) принимаем, только если пользователь сейчас не рисует
  // и не менял холст только что (иначе «эхо» сохранения затрёт свежий штрих).
  useEffect(() => {
    if (drawing.current || Date.now() - lastLocal.current < 1500) return;
    setStrokes(propStrokes);
  }, [propStrokes]);
  useEffect(() => {
    if (drawing.current || editingItem || Date.now() - lastLocal.current < 1500) return;
    setItems(propItems ?? NO_ITEMS);
  }, [propItems, editingItem]);

  const snap = (): Snap => ({ s: strokesRef.current, i: itemsRef.current });

  /** Показать снимок и сохранить изменившиеся части. */
  const show = useCallback(
    (next: Snap, prev: Snap) => {
      lastLocal.current = Date.now();
      strokesRef.current = next.s;
      itemsRef.current = next.i;
      setStrokes(next.s);
      setItems(next.i);
      if (next.s !== prev.s) onChange?.(next.s);
      if (next.i !== prev.i) onItemsChange?.(next.i);
    },
    [onChange, onItemsChange],
  );

  const commit = useCallback(
    (next: Snap, before: Snap) => {
      history.current.past.push(before);
      if (history.current.past.length > 200) history.current.past.shift();
      history.current.future = [];
      show(next, before);
    },
    [show],
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
          const cur = snap();
          h.future.push(cur);
          setSelection([]);
          setItemSel([]);
          show(prev, cur);
          register();
        },
        redo: () => {
          const next = h.future.pop();
          if (!next) return;
          const cur = snap();
          h.past.push(cur);
          setSelection([]);
          setItemSel([]);
          show(next, cur);
          register();
        },
      },
    });
  }, [id, show]);

  useEffect(
    () => () => {
      clearTimeout(holdTimer.current);
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
  /** Сколько единиц листа в одном CSS-пикселе (для зон касания, не зависящих от масштаба) */
  const unitsPerPx = () => width / (svgRef.current?.getBoundingClientRect().width || width);

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
    liveRef.current.setAttribute('d', d.shape ? livePath({ tool: d.tool, size: d.size, shape: d.shape.kind }, d.shape.points, false) : livePath({ tool: d.tool, size: d.size }, d.flat, d.real));
  };

  // Автофигура: Pencil задержали на месте в конце линии — штрих выравнивается
  const armHold = (x: number, y: number) => {
    const d = drawing.current;
    if (!d || d.mode !== 'draw' || d.shape || !inkStore.get().autoShapes) return;
    const tol = 5 * unitsPerPx();
    if (d.hold && Math.hypot(x - d.hold.x, y - d.hold.y) < tol) return;
    d.hold = { x, y };
    clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => {
      const cur = drawing.current;
      if (cur !== d || d.shape) return;
      const shape = recognizeShape(d.flat);
      if (!shape) return;
      d.shape = shape;
      drawLive();
    }, HOLD_MS);
  };

  const selSet = useMemo(() => new Set(selection), [selection]);
  const itemSelSet = useMemo(() => new Set(itemSel), [itemSel]);
  const selected = useMemo(() => strokes.filter((x) => selSet.has(x.id)), [strokes, selSet]);
  const rest = useMemo(() => (selSet.size ? strokes.filter((x) => !selSet.has(x.id)) : strokes), [strokes, selSet]);
  const selBox: BBox | null = useMemo(
    () => unionBox(strokesBBox(selected), itemsBBox(items.filter((i) => itemSelSet.has(i.id)))),
    [selected, items, itemSelSet],
  );
  const images = items.filter((i) => i.kind === 'image');

  /** Предпросмотр переноса/масштаба выделенных текстовых блоков (они в HTML-слое) */
  const previewItems = (dx: number, dy: number, k: number, ox: number, oy: number) => {
    const f = 1 / unitsPerPx();
    for (const it of itemsRef.current) {
      if (!itemSelSet.has(it.id) || it.kind !== 'text') continue;
      const el = wrapRef.current?.querySelector<HTMLElement>(`[data-item-id="${it.id}"]`);
      if (!el) continue;
      const nx = ox + (it.x - ox) * k + dx;
      const ny = oy + (it.y - oy) * k + dy;
      el.style.transformOrigin = '0 0';
      el.style.transform = k === 1 && !dx && !dy ? '' : `translate(${(nx - it.x) * f}px, ${(ny - it.y) * f}px) scale(${k})`;
    }
  };

  const addText = (x: number, y: number) => {
    const it: PageItem = {
      id: uid(),
      kind: 'text',
      x: Math.max(0, Math.min(width - 120, x - 6)),
      y: Math.max(0, y - DEFAULT_TEXT_SIZE * 0.7),
      w: Math.min(520, width - x + 6),
      h: DEFAULT_TEXT_SIZE * 1.4,
      text: '',
      fontSize: DEFAULT_TEXT_SIZE,
      color: inkStore.get().penColor,
    };
    const before = snap();
    commit({ s: before.s, i: [...before.i, it] }, before);
    setActiveItem(it.id);
    setEditingItem(it.id);
    register();
  };

  /** Касание инструментом «Текст» по пустому месту: снять выбор или создать текстовый блок */
  const tapText = (x: number, y: number) => {
    if (activeItem || editingItem) {
      // Pencil не забирает фокус — убираем клавиатуру сами
      if (editingItem) (document.activeElement as HTMLElement | null)?.blur?.();
      setActiveItem(null);
      setEditingItem(null);
      return;
    }
    addText(x, y);
  };

  const pickColor = (x: number, y: number) => {
    const s = strokeAt(strokesRef.current, x, y, 6 * unitsPerPx());
    if (!s) return;
    const prev = inkStore.get().prevTool;
    inkStore.setColor(s.color, s.tool === 'marker');
    inkStore.set({ tool: s.tool === 'marker' ? 'marker' : prev === 'text' && withItems ? 'text' : 'pen' });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (readOnly) return;
    // Отсечение ладони: пальцы никогда не рисуют, только прокручивают/масштабируют.
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: Date.now() });
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
    const t = tools.tool === 'marker' ? 'marker' : 'pen';
    const before = snap();
    const base = { pointerId: e.pointerId, start: [x, y] as [number, number], dx: 0, dy: 0, flat: [x, y], tool: t as 'pen' | 'marker', color: '', size: 0, real, before, erased: false };
    if (tool === 'eyedropper') {
      pickColor(x, y);
      return;
    }
    if (tool === 'text') {
      drawing.current = { ...base, mode: 'tap' };
      return;
    }
    if (tool === 'lasso') {
      const box = selBox;
      const pad = 12 * unitsPerPx();
      // ручка масштаба — правый нижний угол рамки
      const handle = box && Math.hypot(x - (box.x + box.w + 8), y - (box.y + box.h + 8)) < 22 * unitsPerPx();
      // касание внутри рамки выделения — переносим, иначе — новое лассо
      const inside = box && x >= box.x - pad && x <= box.x + box.w + pad && y >= box.y - pad && y <= box.y + box.h + pad;
      drawing.current = { ...base, mode: handle ? 'scale' : inside ? 'move' : 'lasso' };
      if (!handle && !inside) {
        setSelection([]);
        setItemSel([]);
        setAiRegion(null);
      }
      register();
      return;
    }
    drawing.current = {
      ...base,
      mode: tool === 'eraser' ? 'erase' : 'draw',
      flat: [x, y, p],
      color: t === 'marker' ? tools.markerColor : tools.penColor,
      size: t === 'marker' ? tools.markerWidth : tools.penWidth,
    };
    if (tool === 'eraser') eraseAt(x, y);
    else if (liveRef.current) {
      liveRef.current.setAttribute('fill', fillOf(drawing.current.color));
      liveRef.current.setAttribute('opacity', t === 'marker' ? '0.4' : '1');
      drawLive();
      armHold(x, y);
    }
    register();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') {
      const prev = touches.current.get(e.pointerId);
      if (!prev) return;
      const n = touches.current.size;
      if (n >= 2 && onPinch) {
        const other = [...touches.current.entries()].find(([k]) => k !== e.pointerId)![1];
        const before = Math.hypot(prev.x - other.x, prev.y - other.y);
        const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
        if (before > 0) onPinch(after / before);
      }
      const k = 1 / Math.max(1, n);
      scroller.current?.scrollBy((prev.x - e.clientX) * k, (prev.y - e.clientY) * k);
      touches.current.set(e.pointerId, { ...prev, x: e.clientX, y: e.clientY });
      return;
    }
    const d = drawing.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (d.mode === 'tap') return;
    if (d.mode === 'lasso' || d.mode === 'move' || d.mode === 'scale') {
      const [x, y] = toLocal(e);
      if (d.mode === 'lasso') {
        d.flat.push(x, y);
        lassoRef.current?.setAttribute('d', 'M' + d.flat.join(' ') + 'Z');
      } else if (d.mode === 'move') {
        d.dx = x - d.start![0];
        d.dy = y - d.start![1];
        selGroupRef.current?.setAttribute('transform', `translate(${d.dx} ${d.dy})`);
        previewItems(d.dx, d.dy, 1, 0, 0);
      } else if (selBox) {
        d.dx = x - d.start![0];
        d.dy = y - d.start![1];
        const k = scaleFactor(selBox, d.dx, d.dy);
        const { x: ox, y: oy } = selBox;
        selGroupRef.current?.setAttribute('transform', `translate(${ox} ${oy}) scale(${k}) translate(${-ox} ${-oy})`);
        previewItems(0, 0, k, ox, oy);
      }
      return;
    }
    if (d.shape) return; // фигура уже выровнена — дальше ведём без изменений
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const [x, y] = toLocal(ev);
      if (d.mode === 'erase') eraseAt(x, y);
      else d.flat.push(x, y, d.real ? Math.max(ev.pressure, 0.05) : 0.5);
    }
    if (d.mode === 'draw') {
      if (!raf.current) raf.current = requestAnimationFrame(drawLive);
      const n = d.flat.length;
      armHold(d.flat[n - 3], d.flat[n - 2]);
    }
  };

  const finish = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') {
      const t = touches.current.get(e.pointerId);
      touches.current.delete(e.pointerId);
      // касание пальцем инструментом «Текст» — как касание Pencil
      if (t && tool === 'text' && e.type === 'pointerup' && !touches.current.size && Date.now() - t.t < 400 && Math.hypot(e.clientX - t.sx, e.clientY - t.sy) < 8) {
        const [x, y] = toLocal(e);
        tapText(x, y);
      }
      return;
    }
    const d = drawing.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drawing.current = null;
    clearTimeout(holdTimer.current);
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
    liveRef.current?.setAttribute('d', '');
    if (d.mode === 'tap') {
      if (e.type === 'pointerup') tapText(d.start![0], d.start![1]);
      return;
    }
    if (d.mode === 'lasso') {
      lassoRef.current?.setAttribute('d', '');
      const sel = selectByLasso(strokesRef.current, d.flat);
      const isel = selectItemsByLasso(itemsRef.current, d.flat);
      setSelection(sel);
      setItemSel(isel);
      // ничего не выделено, но обвели заметную область — можно спросить ИИ про неё
      if (!sel.length && !isel.length) {
        const xs = d.flat.filter((_, i) => i % 2 === 0);
        const ys = d.flat.filter((_, i) => i % 2 === 1);
        const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
        setAiRegion(box.w > 30 && box.h > 15 ? box : null);
      }
      register();
      return;
    }
    if (d.mode === 'move' || d.mode === 'scale') {
      selGroupRef.current?.removeAttribute('transform');
      previewItems(0, 0, 1, 0, 0);
      if (Math.hypot(d.dx ?? 0, d.dy ?? 0) > 1 && selBox) {
        let r: { strokes: Stroke[]; ids: string[] };
        let nextItems: PageItem[];
        if (d.mode === 'move') {
          r = moveStrokes(strokesRef.current, selection, d.dx!, d.dy!, uid);
          nextItems = itemSel.length ? moveItems(itemsRef.current, itemSel, d.dx!, d.dy!) : itemsRef.current;
        } else {
          const k = scaleFactor(selBox, d.dx!, d.dy!);
          r = scaleStrokes(strokesRef.current, selection, selBox.x, selBox.y, k, uid);
          nextItems = itemSel.length ? scaleItems(itemsRef.current, itemSel, selBox.x, selBox.y, k) : itemsRef.current;
        }
        commit({ s: r.strokes, i: nextItems }, d.before);
        setSelection(r.ids);
        const moved = r.strokes.filter((x) => r.ids.includes(x.id));
        onStrokeEnd?.(Math.max(strokesBottom(moved), ...nextItems.filter((i) => itemSel.includes(i.id)).map((i) => i.y + i.h)));
      }
      register();
      return;
    }
    if (d.mode === 'erase') {
      if (d.erased) commit({ s: strokesRef.current, i: itemsRef.current }, d.before);
    } else {
      const s: Stroke = d.shape
        ? { id: uid(), tool: d.tool, color: d.color, size: d.size, points: d.shape.points, shape: d.shape.kind }
        : { id: uid(), tool: d.tool, color: d.color, size: d.size, points: d.flat.map((v) => Math.round(v * 100) / 100) };
      commit({ s: [...d.before.s, s], i: d.before.i }, d.before);
      onStrokeEnd?.(strokesBottom([s]));
    }
    register();
  };

  const applySel = (r: { strokes: Stroke[]; ids: string[] }, nextItems = itemsRef.current, itemIds = itemSel) => {
    commit({ s: r.strokes, i: nextItems }, snap());
    setSelection(r.ids);
    setItemSel(itemIds);
    register();
  };
  const selActions = [
    {
      label: 'Удалить',
      icon: 'trash' as const,
      run: () => {
        applySel({ strokes: strokesRef.current.filter((x) => !selSet.has(x.id)), ids: [] }, itemsRef.current.filter((i) => !itemSelSet.has(i.id)), []);
      },
    },
    {
      label: 'Копия',
      icon: 'plus' as const,
      run: () => {
        const d = duplicateItems(itemsRef.current, itemSel, 24, uid);
        applySel(duplicateStrokes(strokesRef.current, selection, 24, uid), d.items, d.ids);
      },
    },
    {
      label: 'Цвет ручки',
      icon: 'pen' as const,
      run: () => {
        const c = inkStore.get().penColor;
        applySel(
          recolorStrokes(strokesRef.current, selection, c, uid),
          itemsRef.current.map((i) => (itemSelSet.has(i.id) && i.kind === 'text' ? { ...i, color: c } : i)),
        );
      },
    },
    {
      label: 'Снять выделение',
      icon: 'check' as const,
      run: () => {
        setSelection([]);
        setItemSel([]);
      },
    },
  ];

  /** ИИ-ручка: рисуем обведённый фрагмент (с подложкой PDF и картинками) и спрашиваем модель */
  const askAi = async (kind: 'explain' | 'translate', box: BBox) => {
    const pad = 16;
    const b = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), w: 0, h: 0 };
    b.w = Math.min(width, box.x + box.w + pad) - b.x;
    b.h = Math.min(height, box.y + box.h + pad) - b.y;
    const [{ renderInk }, { ask, blobPart }, { prompt }, { showAiAnswer }] = await Promise.all([
      import('../ai/inkImage'),
      import('../ai/client'),
      import('../ai/prompts'),
      import('../ai/AiAnswer'),
    ]);
    const c = await renderInk({ width, height, strokes: strokesRef.current, items: itemsRef.current, underlay: underlay?.() ?? undefined, withImages: true }, b, 1400);
    const blob = await new Promise<Blob>((res, rej) => c.toBlob((x) => (x ? res(x) : rej(new Error('toBlob'))), 'image/jpeg', 0.85));
    const insertBelow = withItems
      ? {
          label: 'Вставить на лист',
          run: (text: string) => {
            const plain = text.replace(/\*\*|==\{\w+\}|==|__/g, '').trim();
            const before = snap();
            const it: PageItem = {
              id: uid(),
              kind: 'text',
              x: Math.min(b.x, width - 300),
              y: Math.min(height - 80, b.y + b.h + 8),
              w: Math.min(640, width - Math.min(b.x, width - 300)),
              h: 40,
              text: plain,
              fontSize: 22,
              color: '#7c3aed',
            };
            commit({ s: before.s, i: [...before.i, it] }, before);
            register();
          },
        }
      : undefined;
    await showAiAnswer(
      kind === 'explain' ? 'Объяснение' : 'Перевод',
      async () =>
        ask({
          system: prompt(kind, { context: aiContext ?? 'конспект' }),
          parts: [await blobPart(blob), { text: kind === 'explain' ? 'Объясни этот фрагмент.' : 'Переведи этот фрагмент.' }],
        }),
      { preview: blob, action: insertBelow },
    );
  };

  const commitItems = useCallback(
    (next: PageItem[]) => {
      commit({ s: strokesRef.current, i: next }, snap());
      register();
    },
    [commit, register],
  );
  const silentItems = useCallback(
    (next: PageItem[]) => {
      itemsRef.current = next;
      lastLocal.current = Date.now();
      setItems(next);
      onItemsChange?.(next);
    },
    [onItemsChange],
  );

  useEffect(() => {
    if (!insertRef) return;
    insertRef.current = (it) => {
      const before = snap();
      commit({ s: before.s, i: [...before.i, it] }, before);
      // сразу можно подвинуть и поменять размер
      inkStore.set({ tool: 'text' });
      setActiveItem(it.id);
      register();
    };
    return () => {
      insertRef.current = null;
    };
  });

  // «Авто»-цвет чернил подстраивается под цвет бумаги
  const wrapStyle = paper ? ({ '--ink-auto': autoInkFor(paper) } as React.CSSProperties) : undefined;
  const handleR = 14 * (selBox ? unitsPerPx() : 1);

  return (
    <div ref={wrapRef} className="ink-wrap" style={wrapStyle}>
      <svg
        ref={svgRef}
        className={'ink-canvas ' + (readOnly ? 'readonly ' : '') + `tool-${tool} ` + (className ?? '')}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMin meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onContextMenu={(e) => e.preventDefault()}
      >
        <PaperBg background={background} width={width} height={height} paper={paper} lineColor={lineColor} />
        {images
          .filter((i) => !itemSelSet.has(i.id))
          .map((i) => (
            <SvgImage key={i.id} item={i} />
          ))}
        <StrokePaths strokes={rest} />
        <g ref={selGroupRef}>
          {images
            .filter((i) => itemSelSet.has(i.id))
            .map((i) => (
              <g key={i.id}>
                <SvgImage item={i} />
                <rect x={i.x} y={i.y} width={i.w} height={i.h} className="lasso-item" vectorEffect="non-scaling-stroke" />
              </g>
            ))}
          {selected.length > 0 && <StrokePaths strokes={selected} halo />}
          {selBox && (
            <>
              <rect x={selBox.x - 8} y={selBox.y - 8} width={selBox.w + 16} height={selBox.h + 16} className="lasso-box" vectorEffect="non-scaling-stroke" />
              {!readOnly && <circle cx={selBox.x + selBox.w + 8} cy={selBox.y + selBox.h + 8} r={handleR} className="lasso-handle" vectorEffect="non-scaling-stroke" />}
            </>
          )}
        </g>
        <path ref={liveRef} />
        <path ref={lassoRef} className="lasso-path" vectorEffect="non-scaling-stroke" />
      </svg>
      {items.some((i) => i.kind === 'text') || (tool === 'text' && items.length) ? (
        <PageItems
          items={items}
          width={width}
          height={height}
          interactive={tool === 'text' && !readOnly}
          activeId={activeItem}
          editingId={editingItem}
          setActive={setActiveItem}
          setEditing={setEditingItem}
          onCommit={commitItems}
          onSilent={silentItems}
          lassoIds={itemSelSet}
        />
      ) : null}
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
          <span className="tb-sep" />
          <button className="tool-btn" title="Объяснить (ИИ)" aria-label="Объяснить выделенное (ИИ)" onClick={() => askAi('explain', selBox)}>
            <Icon name="sparkle" size={18} />
          </button>
          <button className="tool-btn" title="Перевести (ИИ)" aria-label="Перевести выделенное (ИИ)" onClick={() => askAi('translate', selBox)}>
            <Icon name="globe" size={18} />
          </button>
        </div>
      )}
      {aiRegion && !selBox && !readOnly && (
        <>
          <div
            className="ai-region"
            style={{ left: `${(aiRegion.x / width) * 100}%`, top: `${(aiRegion.y / height) * 100}%`, width: `${(aiRegion.w / width) * 100}%`, height: `${(aiRegion.h / height) * 100}%` }}
          />
          <div
            className="lasso-menu"
            style={{ left: `${(Math.max(0, aiRegion.x) / width) * 100}%`, top: `${(Math.max(0, aiRegion.y - 8) / height) * 100}%` }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button className="tool-btn text" onClick={() => askAi('explain', aiRegion)}>
              <Icon name="sparkle" size={18} /> Объяснить
            </button>
            <button className="tool-btn text" onClick={() => askAi('translate', aiRegion)}>
              <Icon name="globe" size={18} /> Перевести
            </button>
            <button className="tool-btn" aria-label="Закрыть" onClick={() => setAiRegion(null)}>
              <Icon name="close" size={18} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
