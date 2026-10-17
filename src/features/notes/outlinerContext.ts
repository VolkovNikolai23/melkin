import { createContext, useContext, type MutableRefObject } from 'react';
import type { Block } from '../../db/schema';

export type Caret = number | 'start' | 'end';

export type EditorAction = 'indent' | 'outdent' | 'up' | 'down' | 'delete' | 'draw' | 'math' | 'cloze' | 'card' | 'done';

export interface OutlinerCtx {
  docId: string;
  kids: Map<string | null, Block[]>;
  visible: Block[];
  editing: { id: string; caret: Caret } | null;
  setEditing: (e: { id: string; caret: Caret } | null) => void;
  cardCount: Map<string, number>;
  highlight: string | null;
  editorApi: MutableRefObject<((a: EditorAction) => void) | null>;
}

export const OutlinerContext = createContext<OutlinerCtx | null>(null);

export function useOutliner() {
  const c = useContext(OutlinerContext);
  if (!c) throw new Error('OutlinerContext');
  return c;
}
