// Хранилище состояния outliner'а с подпиской по блокам.
// Раньше любое сохранение перерисовывало все строки документа (на 2000 строк — ~100 мс,
// на iPad заметно при наборе). Теперь каждая строка подписана только на свои данные:
// неизменившиеся записи из IndexedDB переиспользуются, и перерисовывается лишь то, что поменялось.
import { useEffect, useReducer, useRef, type MutableRefObject } from 'react';
import type { Block, CardRow } from '../../db/schema';
import { byOrder } from './blocks';
import type { Caret, EditorAction, OutlinerCtx } from './outlinerContext';

interface State {
  blocks: Map<string, Block>;
  kids: Map<string | null, Block[]>;
  visible: Block[];
  cardCount: Map<string, number>;
  editing: { id: string; caret: Caret } | null;
  propsOpen: string | null;
  highlight: string | null;
  loaded: boolean;
}

/** Подпись блока: если она не изменилась, используем прежний объект (React.memo и сравнение по ссылке). */
function signature(b: Block): string {
  const ink = b.ink ? `${b.ink.height}:${b.ink.strokes.length}:${b.ink.strokes.at(-1)?.id ?? ''}` : '';
  return [
    b.updatedAt,
    b.order,
    b.parentId,
    b.collapsed ? 1 : 0,
    b.kind,
    b.heading ?? '',
    b.list ?? '',
    b.cardsOff ? 1 : 0,
    b.portalOf ?? '',
    b.code?.lang ?? '',
    b.pdfRef ? `${b.pdfRef.docId}:${b.pdfRef.page}` : '',
    b.props ? JSON.stringify(b.props) : '',
    b.image ? JSON.stringify(b.image) : '',
    ink,
    b.text,
  ].join('\u0001');
}

const sameArray = <T,>(a: T[] | undefined, b: T[]) => !!a && a.length === b.length && a.every((x, i) => x === b[i]);

export class OutlinerStore implements OutlinerCtx {
  state: State = {
    blocks: new Map(),
    kids: new Map(),
    visible: [],
    cardCount: new Map(),
    editing: null,
    propsOpen: null,
    highlight: null,
    loaded: false,
  };
  editorApi: MutableRefObject<((a: EditorAction) => void) | null> = { current: null };
  private sigs = new Map<string, string>();
  private listeners = new Set<() => void>();

  constructor(public docId: string) {}

  // --- интерфейс OutlinerCtx (используется редакторами в обработчиках событий) ---
  get kids() {
    return this.state.kids;
  }
  get visible() {
    return this.state.visible;
  }
  get editing() {
    return this.state.editing;
  }
  get cardCount() {
    return this.state.cardCount;
  }
  get highlight() {
    return this.state.highlight;
  }
  get propsOpen() {
    return this.state.propsOpen;
  }
  setEditing = (e: { id: string; caret: Caret } | null) => this.patch({ editing: e });
  setPropsOpen = (id: string | null) => this.patch({ propsOpen: id });
  setHighlight = (id: string | null) => this.patch({ highlight: id });

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };

  private patch(p: Partial<State>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  }

  /** Новые данные из IndexedDB: переиспользуем неизменившиеся блоки и массивы детей. */
  setData(rows: Block[], cards: CardRow[]) {
    const prev = this.state;
    const blocks = new Map<string, Block>();
    const sigs = new Map<string, string>();
    for (const b of rows) {
      const sig = signature(b);
      const old = prev.blocks.get(b.id);
      blocks.set(b.id, old && this.sigs.get(b.id) === sig ? old : b);
      sigs.set(b.id, sig);
    }
    this.sigs = sigs;

    const grouped = new Map<string | null, Block[]>();
    for (const b of blocks.values()) {
      const arr = grouped.get(b.parentId);
      if (arr) arr.push(b);
      else grouped.set(b.parentId, [b]);
    }
    const kids = new Map<string | null, Block[]>();
    for (const [k, arr] of grouped) {
      arr.sort(byOrder);
      const old = prev.kids.get(k);
      kids.set(k, sameArray(old, arr) ? old! : arr);
    }

    const visible: Block[] = [];
    const walk = (pid: string | null) => {
      for (const b of kids.get(pid) ?? []) {
        visible.push(b);
        if (!b.collapsed) walk(b.id);
      }
    };
    walk(null);

    const cardCount = new Map<string, number>();
    for (const c of cards) cardCount.set(c.blockId, (cardCount.get(c.blockId) ?? 0) + 1);

    this.patch({ blocks, kids, visible, cardCount, loaded: true });
  }
}

const NO_KIDS: Block[] = [];

/** Номер пункта нумерованного списка: считаем подряд идущих соседей с нумерацией. */
function listNumber(block: Block, siblings: Block[]): number | null {
  if (block.list !== 'number') return null;
  const i = siblings.findIndex((s) => s.id === block.id);
  let n = 1;
  for (let j = i - 1; j >= 0 && siblings[j].list === 'number'; j--) n++;
  return n;
}

export interface BlockSlice {
  block: Block | undefined;
  kids: Block[];
  editing: Caret | null;
  cards: number;
  propsOpen: boolean;
  highlighted: boolean;
  number: number | null;
}

function sliceOf(s: State, id: string): BlockSlice {
  const block = s.blocks.get(id);
  return {
    block,
    kids: s.kids.get(id) ?? NO_KIDS,
    editing: s.editing?.id === id ? s.editing.caret : null,
    cards: s.cardCount.get(id) ?? 0,
    propsOpen: s.propsOpen === id,
    highlighted: s.highlight === id,
    number: block ? listNumber(block, s.kids.get(block.parentId) ?? NO_KIDS) : null,
  };
}

const sameSlice = (a: BlockSlice, b: BlockSlice) =>
  a.block === b.block &&
  a.kids === b.kids &&
  a.editing === b.editing &&
  a.cards === b.cards &&
  a.propsOpen === b.propsOpen &&
  a.highlighted === b.highlighted &&
  a.number === b.number;

/** Подписка строки на свои данные: перерисовка только при их изменении. */
export function useBlockSlice(store: OutlinerStore, id: string): BlockSlice {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const slice = sliceOf(store.state, id);
  const last = useRef(slice);
  last.current = slice;
  useEffect(
    () =>
      store.subscribe(() => {
        if (!sameSlice(sliceOf(store.state, id), last.current)) force();
      }),
    [store, id],
  );
  return slice;
}

/** Подписка на произвольную часть состояния (сравнение по ===). */
export function useStoreValue<T>(store: OutlinerStore, select: (s: State) => T): T {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const value = select(store.state);
  const last = useRef(value);
  last.current = value;
  const sel = useRef(select);
  sel.current = select;
  useEffect(
    () =>
      store.subscribe(() => {
        if (sel.current(store.state) !== last.current) force();
      }),
    [store],
  );
  return value;
}
