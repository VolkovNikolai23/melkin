// Схема данных. Поля для всех этапов (картинки, PDF, ссылки, порталы и т. д.)
// заложены сразу, чтобы дальше не переделывать таблицы. Необязательные поля
// появляются у записей по мере того, как соответствующие функции начинают ими пользоваться.

export type DocType = 'folder' | 'note' | 'notebook' | 'pdf' | 'daily' | 'lecture';

/** Роль папки в структуре учёбы: Предмет → Тема → Лекция */
export type FolderRole = 'subject' | 'topic';

export interface Doc {
  id: string;
  parentId: string | null;
  type: DocType;
  title: string;
  order: number;
  /** Свёрнута ли папка в боковой панели */
  collapsed?: boolean;
  /** Ежедневная заметка: дата в формате YYYY-MM-DD */
  dailyDate?: string;
  /** Документ-шаблон (вставляется через /template) */
  isTemplate?: boolean;
  /** Для PDF-документа — ссылка на файл в таблице files */
  fileId?: string;
  /** PDF сделан из PowerPoint (оригинал .pptx — в fileId источника) или из фото */
  source?: { kind: 'pptx' | 'photos'; fileId?: string };
  /** Для папки: предмет или тема */
  role?: FolderRole;
  /** Иконка из набора и её цвет (для папок, предметов, тем, лекций) */
  icon?: string;
  color?: string;
  /** Лекция: её конспект (тетрадка) и презентация (PDF) */
  lecture?: { notebookId?: string; slidesId?: string };
  /** Корзина: когда удалён (через 30 дней удаляется насовсем) */
  deletedAt?: number;
  /** Корень удаления — именно его показываем в корзине и восстанавливаем вместе с вложенными */
  trashRoot?: boolean;
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
  /** Автофигура (линия, круг, стрелка…): рисуется ровной линией постоянной толщины */
  shape?: string;
}

export interface InkData {
  width: number;
  height: number;
  strokes: Stroke[];
}

export type BlockKind = 'text' | 'ink' | 'image' | 'code' | 'portal' | 'pdf-clip';

/** Прямоугольник в долях от размеров картинки/страницы (0…1) */
export interface Rect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImageData {
  fileId: string;
  width: number;
  height: number;
  /** Ширина показа в долях ширины блока (1 — во всю ширину) */
  displayWidth?: number;
  /** Прямоугольники image occlusion; каждый — отдельная карточка */
  occlusions?: Rect[];
  /**
   * 'hideAll' — на вопросе скрыты все области, в ответе открывается проверяемая;
   * 'hideOne' — скрыта только проверяемая область (по умолчанию).
   */
  occlusionMode?: 'hideOne' | 'hideAll';
}

export interface PdfRef {
  docId: string;
  page: number;
  rects?: Rect[];
  /** Если вырезана область страницы как картинка */
  fileId?: string;
}

export interface Block {
  id: string;
  docId: string;
  parentId: string | null;
  order: number;
  kind: BlockKind;
  text: string;
  collapsed?: boolean;
  /** Заголовок H1–H3 */
  heading?: 1 | 2 | 3;
  /** Как показывать дочерние блоки: маркеры (по умолчанию) или нумерация */
  list?: 'number';
  /** Свойства блока: поле → значение */
  props?: Record<string, string>;
  /** Нормализованные теги (#тег), индексируются для фильтра */
  tags: string[];
  /** id документов/блоков, на которые ссылается текст ([[...]]) — для обратных ссылок */
  links: string[];
  /** Портал: id оригинального блока */
  portalOf?: string;
  ink?: InkData;
  image?: ImageData;
  code?: { lang: string };
  pdfRef?: PdfRef;
  /** Карточки блока временно отключены (текст и история сохраняются) */
  cardsOff?: boolean;
  /** Распознанный текст рукописного блока (для офлайн-поиска и ИИ) */
  recognizedText?: string;
  createdAt: number;
  updatedAt: number;
}

export type FileKind = 'image' | 'pdf';

/** Двоичные данные (картинки, PDF) хранятся отдельно от блоков как Blob. */
export interface FileRow {
  id: string;
  kind: FileKind;
  mime: string;
  name: string;
  size: number;
  blob: Blob;
  createdAt: number;
}

export type PageBackground = 'blank' | 'grid' | 'smallgrid' | 'lines' | 'widelines' | 'dots' | 'cornell' | 'music';

/** Объект на листе тетради: текстовый блок или картинка (координаты — в единицах листа). */
export interface PageItem {
  id: string;
  kind: 'text' | 'image';
  x: number;
  y: number;
  w: number;
  /** Высота картинки; у текста считается по содержимому */
  h: number;
  text?: string;
  /** Размер шрифта текста в единицах листа */
  fontSize?: number;
  color?: string;
  fileId?: string;
}

export interface Page {
  id: string;
  docId: string;
  order: number;
  background: PageBackground;
  /** Цвет бумаги (по умолчанию — из темы) и цвет линий фона */
  paper?: string;
  lineColor?: string;
  strokes: Stroke[];
  items?: PageItem[];
  /** Распознанный текст страницы (для офлайн-поиска и ИИ) */
  recognizedText?: string;
  createdAt: number;
  updatedAt: number;
}

/** Слой аннотаций PDF: сам файл не меняется. */
export interface Annotation {
  id: string;
  docId: string;
  page: number;
  kind: 'highlight' | 'ink';
  color: string;
  rects?: Rect[];
  text?: string;
  strokes?: Stroke[];
  /** Блок, созданный из этого выделения */
  blockId?: string;
  createdAt: number;
  updatedAt: number;
}

export type CardKind = 'forward' | 'backward' | 'cloze' | 'list' | 'mcq' | 'occlusion';

/** Карточка + состояние FSRS (даты хранятся как миллисекунды). */
export interface CardRow {
  id: string;
  blockId: string;
  docId: string;
  kind: CardKind;
  /** Для клоза — номер группы по порядку в тексте; для occlusion — номер прямоугольника */
  clozeIndex?: number;
  /** Ключ подкарточки (группа клоза, id прямоугольника) */
  sub?: string;
  front: string;
  back: string;
  /** Карточка-понятие (::) — левая часть выделяется стилем */
  concept?: boolean;
  /** Карточка отключена пользователем — не попадает в очередь */
  disabled?: boolean;
  /** Двусторонняя (термин ↔ определение): ответ не пишут, а открывают и сравнивают сами */
  twoSided?: boolean;
  /** Ступень лестницы интервалов (null — новая карточка) */
  step?: number | null;
  /** После «не знаю»: ступень, с которой упали (откат на 4 при «знаю») */
  relearnFrom?: number;
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
  /** Экспресс-повтор перед экзаменом: ответ записан, но график карточки не менялся */
  express?: boolean;
}

export type TestQuestionKind = 'single' | 'multiple' | 'truefalse' | 'open' | 'match' | 'label' | 'order';

/** Тест по подтеме или всей теме (наполняется на этапе 6). */
export interface TestRow {
  id: string;
  /** Документ (лекция или тема), к которому относится тест */
  docId: string;
  title: string;
  questions: { id: string; kind: TestQuestionKind; prompt: string; data: unknown }[];
  createdAt: number;
  updatedAt: number;
}

export interface TestAttempt {
  id: string;
  testId: string;
  docId: string;
  at: number;
  score: number;
  answers: { questionId: string; correct: boolean; answer: unknown }[];
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export type ThemeSetting = 'system' | 'light' | 'dark';
export type FontSetting = 'nunito' | 'system' | 'ptsans' | 'caveat';
export type AiProviderId = 'gemini' | 'claude';

export interface Settings {
  newPerDay: number;
  theme: ThemeSetting;
  font: FontSetting;
  /** Провайдер ИИ и модель; ключи хранятся отдельно (meta 'aiKeys') и не попадают в копию */
  aiProvider: AiProviderId;
  aiModel: { gemini: string; claude: string };
}

export const DEFAULT_SETTINGS: Settings = {
  newPerDay: 20,
  theme: 'system',
  font: 'nunito',
  aiProvider: 'gemini',
  aiModel: { gemini: 'gemini-flash-latest', claude: 'claude-opus-5-5' },
};
