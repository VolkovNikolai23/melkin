export type DocType = 'folder' | 'note' | 'notebook';

export interface Doc {
  id: string;
  parentId: string | null;
  type: DocType;
  title: string;
  order: number;
  /** Свёрнута ли папка в боковой панели */
  collapsed?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type InkTool = 'pen' | 'marker';

export interface Stroke {
  id: string;
  tool: InkTool;
  /** Цвет; 'auto' — цвет текста текущей темы */
  color: string;
  size: number;
  /** Плоский массив точек: x0, y0, p0, x1, y1, p1, … */
  points: number[];
}

export interface InkData {
  width: number;
  height: number;
  strokes: Stroke[];
}

export type BlockKind = 'text' | 'ink';

export interface Block {
  id: string;
  docId: string;
  parentId: string | null;
  order: number;
  kind: BlockKind;
  text: string;
  collapsed?: boolean;
  ink?: InkData;
  createdAt: number;
  updatedAt: number;
}

export type PageBackground = 'blank' | 'grid' | 'lines';

export interface Page {
  id: string;
  docId: string;
  order: number;
  background: PageBackground;
  strokes: Stroke[];
  createdAt: number;
  updatedAt: number;
}

export type CardKind = 'forward' | 'reverse' | 'cloze';

/** Карточка + состояние FSRS (даты хранятся как миллисекунды). */
export interface CardRow {
  id: string;
  blockId: string;
  docId: string;
  kind: CardKind;
  clozeIndex?: number;
  front: string;
  back: string;
  createdAt: number;
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: number | null;
}

export interface ReviewLogRow {
  id: string;
  cardId: string;
  rating: number;
  /** Состояние карточки ДО ответа */
  state: number;
  wasNew: boolean;
  review: number;
  due: number;
  stability: number;
  difficulty: number;
  scheduled_days: number;
  learning_steps: number;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export interface Settings {
  newPerDay: number;
}

export const DEFAULT_SETTINGS: Settings = { newPerDay: 20 };
