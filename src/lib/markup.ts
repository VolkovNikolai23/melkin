// Общий разбор текста блока: формулы $…$ / $$…$$, код `…`, клозы {{…}} / {{c1::…}},
// ссылки [[…]], теги #тег и разделители карточек (>>, <<, <>, ::, ;;, >>>, >>1., >>A)).
// Используется и парсером карточек, и рендером, чтобы правила совпадали.

export interface Range {
  start: number;
  end: number; // не включая
}

export interface MathRange extends Range {
  display: boolean;
  content: string;
}

export interface ClozeRange extends Range {
  /** Видимый текст клоза (без префикса c1::) */
  content: string;
  /** Группа: 'c1', 'c2'… для явных групп, иначе хэш содержимого */
  group: string;
}

export interface TextRange extends Range {
  content: string;
}

export type SepKind = '>>>' | '>>1.' | '>>A)' | '<>' | '>>' | '<<' | '::' | ';;';

// Порядок важен: длинные разделители проверяются раньше коротких.
export const SEPARATORS: SepKind[] = ['>>>', '>>1.', '>>A)', '<>', '>>', '<<', '::', ';;'];

export type Segment =
  | { t: 'text'; v: string }
  | { t: 'math'; v: string; display: boolean }
  | { t: 'code'; v: string }
  | { t: 'cloze'; v: string; index: number; group: string }
  | { t: 'sep'; v: SepKind }
  | { t: 'link'; v: string }
  | { t: 'tag'; v: string };

const inRanges = (pos: number, ranges: Range[]) => ranges.some((r) => pos >= r.start && pos < r.end);

/** Короткий детерминированный хэш строки (djb2). */
export function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function findCode(text: string): TextRange[] {
  const res: TextRange[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '`') {
      const j = text.indexOf('`', i + 1);
      if (j < 0) break;
      if (j > i + 1) res.push({ start: i, end: j + 1, content: text.slice(i + 1, j) });
      i = j + 1;
    } else i++;
  }
  return res;
}

function findClosingDollar(text: string, from: number): number {
  for (let j = from; j < text.length; j++) {
    if (text[j] === '\\') {
      j++;
      continue;
    }
    if (text[j] === '$') return j;
  }
  return -1;
}

export function findMath(text: string, code = findCode(text)): MathRange[] {
  const res: MathRange[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch !== '$' || inRanges(i, code)) {
      i++;
      continue;
    }
    if (text[i + 1] === '$') {
      const j = text.indexOf('$$', i + 2);
      if (j < 0) break;
      res.push({ start: i, end: j + 2, display: true, content: text.slice(i + 2, j) });
      i = j + 2;
    } else {
      const j = findClosingDollar(text, i + 1);
      if (j < 0) break;
      if (j > i + 1) res.push({ start: i, end: j + 1, display: false, content: text.slice(i + 1, j) });
      i = j + 1;
    }
  }
  return res;
}

const CLOZE_GROUP = /^c(\d+)::/i;

export function findClozes(text: string, skip: Range[] = [...findCode(text), ...findMath(text)]): ClozeRange[] {
  const res: ClozeRange[] = [];
  let i = 0;
  while (i < text.length - 1) {
    if (text.startsWith('{{', i) && !inRanges(i, skip)) {
      let j = i + 2;
      let found = -1;
      while (j < text.length - 1) {
        if (text.startsWith('}}', j) && !inRanges(j, skip)) {
          // «}}}» — берём последнюю пару, чтобы {{a^{2}}} закрывался правильно
          while (text[j + 2] === '}') j++;
          found = j;
          break;
        }
        j++;
      }
      if (found < 0) break;
      const raw = text.slice(i + 2, found);
      const m = raw.match(CLOZE_GROUP);
      const content = m ? raw.slice(m[0].length) : raw;
      if (content.trim()) {
        res.push({ start: i, end: found + 2, content, group: m ? `c${Number(m[1])}` : 'h' + hashString(content.trim()) });
      }
      i = found + 2;
    } else i++;
  }
  return res;
}

export function findLinks(text: string, skip: Range[]): TextRange[] {
  const res: TextRange[] = [];
  const re = /\[\[([^\]\n]+?)\]\]/g;
  for (let m; (m = re.exec(text)); ) {
    if (!inRanges(m.index, skip) && m[1].trim()) res.push({ start: m.index, end: m.index + m[0].length, content: m[1].trim() });
  }
  return res;
}

// Тег: # + буквы/цифры/_/-, перед ним начало строки или пробел (не путать с «# Заголовок»).
export function findTags(text: string, skip: Range[]): TextRange[] {
  const res: TextRange[] = [];
  const re = /(^|[\s(])#([\p{L}\p{N}_][\p{L}\p{N}_\-/]*)/gu;
  for (let m; (m = re.exec(text)); ) {
    const start = m.index + m[1].length;
    if (!inRanges(start, skip)) res.push({ start, end: start + 1 + m[2].length, content: m[2] });
  }
  return res;
}

export function normalizeTag(t: string): string {
  return t.trim().toLowerCase();
}

export function findSeparator(text: string, skip: Range[]): { index: number; sep: SepKind } | null {
  for (let i = 0; i < text.length - 1; i++) {
    if (inRanges(i, skip)) continue;
    for (const s of SEPARATORS) {
      if (text.startsWith(s, i)) return { index: i, sep: s };
    }
  }
  return null;
}

export interface Analysis {
  code: TextRange[];
  math: MathRange[];
  clozes: ClozeRange[];
  links: TextRange[];
  tags: TextRange[];
  sep: { index: number; sep: SepKind } | null;
}

/** Полный разбор текста блока (один проход по всем видам разметки). */
export function analyze(text: string): Analysis {
  const code = findCode(text);
  const math = findMath(text, code);
  const clozes = findClozes(text, [...code, ...math]);
  const base: Range[] = [...code, ...math];
  const links = findLinks(text, [...base, ...clozes]);
  const tags = findTags(text, [...base, ...links]);
  const sep = findSeparator(text, [...base, ...clozes, ...links]);
  return { code, math, clozes, links, tags, sep };
}

/** Разбивает текст на сегменты для рендера. */
export function tokenize(text: string, a = analyze(text)): Segment[] {
  type Mark = { start: number; end: number; seg: Segment };
  const marks: Mark[] = [];
  const clozeRanges = a.clozes;
  for (const c of a.code) if (!inRanges(c.start, clozeRanges)) marks.push({ start: c.start, end: c.end, seg: { t: 'code', v: c.content } });
  for (const m of a.math) if (!inRanges(m.start, clozeRanges)) marks.push({ start: m.start, end: m.end, seg: { t: 'math', v: m.content, display: m.display } });
  a.clozes.forEach((c, index) => marks.push({ start: c.start, end: c.end, seg: { t: 'cloze', v: c.content, index, group: c.group } }));
  for (const l of a.links) marks.push({ start: l.start, end: l.end, seg: { t: 'link', v: l.content } });
  for (const t of a.tags) if (!inRanges(t.start, clozeRanges)) marks.push({ start: t.start, end: t.end, seg: { t: 'tag', v: t.content } });
  if (a.sep) marks.push({ start: a.sep.index, end: a.sep.index + a.sep.sep.length, seg: { t: 'sep', v: a.sep.sep } });
  marks.sort((x, y) => x.start - y.start);

  const out: Segment[] = [];
  let pos = 0;
  for (const m of marks) {
    if (m.start < pos) continue; // перекрытия не допускаем
    if (m.start > pos) out.push({ t: 'text', v: text.slice(pos, m.start) });
    out.push(m.seg);
    pos = m.end;
  }
  if (pos < text.length) out.push({ t: 'text', v: text.slice(pos) });
  return out;
}

export function extractTags(text: string): string[] {
  return [...new Set(analyze(text).tags.map((t) => normalizeTag(t.content)))];
}

export function extractLinkTitles(text: string): string[] {
  return [...new Set(analyze(text).links.map((l) => l.content))];
}
