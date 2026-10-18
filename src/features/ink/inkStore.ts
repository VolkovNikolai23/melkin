import { useSyncExternalStore } from 'react';
import { MARKER_COLORS, MARKER_SIZES, PEN_COLORS, PEN_SIZES } from './geometry';

/** eyedropper — пипетка (цвет из нарисованного), text — текст и объекты на листе */
export type Tool = 'pen' | 'marker' | 'eraser' | 'lasso' | 'eyedropper' | 'text';

export interface ActiveCanvas {
  id: string;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

interface InkState {
  tool: Tool;
  /** Инструмент, к которому вернуться после пипетки */
  prevTool: Tool;
  penColor: string;
  markerColor: string;
  /** Толщина ручки и маркера (в единицах листа) */
  penWidth: number;
  markerWidth: number;
  /** Последние выбранные из палитры цвета */
  recent: string[];
  /** Автофигуры: задержать Pencil в конце линии — фигура выравнивается */
  autoShapes: boolean;
  active: ActiveCanvas | null;
}

type Saved = Partial<InkState> & { penSize?: number };

const saved: Saved = (() => {
  try {
    return JSON.parse(localStorage.getItem('melkin-ink') || '{}') as Saved;
  } catch {
    return {};
  }
})();

// Раньше толщина хранилась индексом в [2, 4, 7]
const legacyWidth = saved.penSize !== undefined ? [2, 4, 7][saved.penSize] : undefined;

let state: InkState = {
  tool: saved.tool ?? 'pen',
  prevTool: 'pen',
  penColor: saved.penColor ?? PEN_COLORS[0],
  markerColor: saved.markerColor ?? MARKER_COLORS[0],
  penWidth: saved.penWidth ?? legacyWidth ?? PEN_SIZES[2],
  markerWidth: saved.markerWidth ?? MARKER_SIZES[1],
  recent: saved.recent ?? [],
  autoShapes: saved.autoShapes ?? true,
  active: null,
};
if (state.tool === 'eyedropper') state.tool = 'pen';

const listeners = new Set<() => void>();

export const inkStore = {
  get: () => state,
  set(patch: Partial<InkState>) {
    state = { ...state, ...patch };
    if (!('active' in patch) || Object.keys(patch).length > 1) {
      try {
        const { tool, penColor, markerColor, penWidth, markerWidth, recent, autoShapes } = state;
        localStorage.setItem('melkin-ink', JSON.stringify({ tool, penColor, markerColor, penWidth, markerWidth, recent, autoShapes }));
      } catch {
        /* приватный режим */
      }
    }
    listeners.forEach((l) => l());
  },
  /** Выбор цвета для текущего инструмента (маркер — свой цвет, остальное — ручка). */
  setColor(color: string, forMarker = state.tool === 'marker') {
    const recent = PEN_COLORS.includes(color) || MARKER_COLORS.includes(color) ? state.recent : [color, ...state.recent.filter((c) => c !== color)].slice(0, 6);
    this.set(forMarker ? { markerColor: color, recent } : { penColor: color, recent });
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useInk(): InkState {
  return useSyncExternalStore(inkStore.subscribe, inkStore.get);
}
