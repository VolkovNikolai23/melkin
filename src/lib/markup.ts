// Общий разбор текста блока: формулы $…$ / $$…$$, клозы {{…}} и разделители карточек :: / ;;.
// Используется и парсером карточек, и рендером, чтобы правила совпадали.

export interface MathRange {
  start: number;
  end: number; // не включая
  display: boolean;
  content: string;
}

export interface ClozeRange {
  start: number;
  end: number;
  content: string;
}

export type Segment =
  | { t: 'text'; v: string }
  | { t: 'math'; v: string; display: boolean }
  | { t: 'cloze'; v: string; index: number }
  | { t: 'sep'; v: '::' | ';;' };

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

export function findMath(text: string): MathRange[] {
  const res: MathRange[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch !== '$') {
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

const inRanges = (pos: number, ranges: { start: number; end: number }[]) =>
  ranges.some((r) => pos >= r.start && pos < r.end);

export function findClozes(text: string, math = findMath(text)): ClozeRange[] {
  const res: ClozeRange[] = [];
  let i = 0;
  while (i < text.length - 1) {
    if (text.startsWith('{{', i) && !inRanges(i, math)) {
      let j = i + 2;
      let found = -1;
      while (j < text.length - 1) {
        if (text.startsWith('}}', j) && !inRanges(j, math)) {
          // «}}}» — берём последнюю пару, чтобы {{a^{2}}} закрывался правильно
          while (text[j + 2] === '}') j++;
          found = j;
          break;
        }
        j++;
      }
      if (found < 0) break;
      const content = text.slice(i + 2, found);
      if (content.trim()) res.push({ start: i, end: found + 2, content });
      i = found + 2;
    } else i++;
  }
  return res;
}

export function findSeparator(
  text: string,
  math = findMath(text),
  clozes = findClozes(text, math),
): { index: number; sep: '::' | ';;' } | null {
  for (let i = 0; i < text.length - 1; i++) {
    const two = text.slice(i, i + 2);
    if ((two === '::' || two === ';;') && !inRanges(i, math) && !inRanges(i, clozes)) {
      return { index: i, sep: two };
    }
  }
  return null;
}

/** Разбивает текст на сегменты для рендера. */
export function tokenize(text: string): Segment[] {
  const math = findMath(text);
  const clozes = findClozes(text, math);
  const sep = findSeparator(text, math, clozes);
  type Mark = { start: number; end: number; seg: Segment };
  const marks: Mark[] = [];
  for (const m of math) {
    if (!inRanges(m.start, clozes)) marks.push({ start: m.start, end: m.end, seg: { t: 'math', v: m.content, display: m.display } });
  }
  clozes.forEach((c, index) => marks.push({ start: c.start, end: c.end, seg: { t: 'cloze', v: c.content, index } }));
  if (sep) marks.push({ start: sep.index, end: sep.index + 2, seg: { t: 'sep', v: sep.sep } });
  marks.sort((a, b) => a.start - b.start);

  const out: Segment[] = [];
  let pos = 0;
  for (const m of marks) {
    if (m.start > pos) out.push({ t: 'text', v: text.slice(pos, m.start) });
    out.push(m.seg);
    pos = m.end;
  }
  if (pos < text.length) out.push({ t: 'text', v: text.slice(pos) });
  return out;
}
