import { useSyncExternalStore } from 'react';
import { MARKER_COLORS, PEN_COLORS } from './geometry';

export type Tool = 'pen' | 'marker' | 'eraser';

export interface ActiveCanvas {
  id: string;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

interface InkState {
  tool: Tool;
  penColor: string;
  markerColor: string;
  penSize: number; // индекс в PEN_SIZES
  active: ActiveCanvas | null;
}

const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem('melkin-ink') || '{}') as Partial<InkState>;
  } catch {
    return {};
  }
})();

let state: InkState = {
  tool: saved.tool ?? 'pen',
  penColor: saved.penColor ?? PEN_COLORS[0],
  markerColor: saved.markerColor ?? MARKER_COLORS[0],
  penSize: saved.penSize ?? 1,
  active: null,
};

const listeners = new Set<() => void>();

export const inkStore = {
  get: () => state,
  set(patch: Partial<InkState>) {
    state = { ...state, ...patch };
    if (!('active' in patch) || Object.keys(patch).length > 1) {
      try {
        const { tool, penColor, markerColor, penSize } = state;
        localStorage.setItem('melkin-ink', JSON.stringify({ tool, penColor, markerColor, penSize }));
      } catch {
        /* приватный режим */
      }
    }
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useInk(): InkState {
  return useSyncExternalStore(inkStore.subscribe, inkStore.get);
}
