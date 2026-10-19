// Разбор словарей: CC-CEDICT (строка «傳統 传统 [chuan2 tong3] /tradition/…/») и DSL
// (формат Lingvo/GoldenDict — в нём распространяется БКРС). Чистые функции.
import type { ZhEntry } from '../../db/schema';

const TONES: Record<string, string[]> = {
  a: ['ā', 'á', 'ǎ', 'à'],
  e: ['ē', 'é', 'ě', 'è'],
  i: ['ī', 'í', 'ǐ', 'ì'],
  o: ['ō', 'ó', 'ǒ', 'ò'],
  u: ['ū', 'ú', 'ǔ', 'ù'],
  ü: ['ǖ', 'ǘ', 'ǚ', 'ǜ'],
};

/** Слог с цифрой тона → с диакритикой: zhong1 → zhōng, lu:4 → lǜ. */
export function syllableMarks(s: string): string {
  const m = s.match(/^([a-zü:]+)([1-5])$/i);
  if (!m) return s.replace(/u:|v/g, 'ü');
  const syl = m[1].replace(/u:|v/gi, 'ü');
  const tone = Number(m[2]);
  if (tone === 5) return syl;
  const lower = syl.toLowerCase();
  // правило: a или e; в «ou» — o; иначе последняя гласная
  let idx = lower.search(/[ae]/);
  if (idx < 0) idx = lower.indexOf('ou');
  if (idx < 0) {
    for (let i = lower.length - 1; i >= 0; i--)
      if ('iouü'.includes(lower[i])) {
        idx = i;
        break;
      }
  }
  if (idx < 0) return syl;
  const v = lower[idx];
  const marked = TONES[v]?.[tone - 1];
  if (!marked) return syl;
  const out = syl[idx] === v ? marked : marked.toUpperCase();
  return syl.slice(0, idx) + out + syl.slice(idx + 1);
}

export const pinyinMarks = (p: string) => p.split(/\s+/).filter(Boolean).map(syllableMarks).join(' ');

export function parseCedictLine(line: string): ZhEntry | null {
  if (!line || line.startsWith('#')) return null;
  const m = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]*)\]\s+\/(.*)\/\s*$/);
  if (!m) return null;
  const d = m[4].split('/').map((x) => x.trim()).filter(Boolean);
  if (!d.length) return null;
  return { t: m[1], w: m[2], p: pinyinMarks(m[3]), d, src: 'cedict' };
}

/** Убрать разметку DSL: [b], [/b], [m1], [p], [c], [ref]…, {{…}}, экранирование \[. */
export function stripDsl(s: string): string {
  // экранированные символы прячем, чтобы их не приняли за теги
  return s
    .replace(/\\\[/g, '\uE010')
    .replace(/\\\]/g, '\uE011')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\[\/?[a-z*!'][^\]]*\]/gi, '')
    .replace(/\\([{}~@#])/g, '$1')
    .replace(/\uE010/g, '[')
    .replace(/\uE011/g, ']')
    .replace(/\s+/g, ' ')
    .trim();
}

const HAN = /\p{Script=Han}/u;

/**
 * Разбор DSL по строкам: заголовок — строка без отступа, тело — строки с отступом.
 * В БКРС первая строка тела — пиньинь. Берём только китайские заголовки до maxLen иероглифов.
 */
export function* parseDsl(lines: Iterable<string>, maxLen = 6): Generator<ZhEntry> {
  let heads: string[] = [];
  let body: string[] = [];
  const flush = function* (): Generator<ZhEntry> {
    if (heads.length && body.length) {
      const [first, ...rest] = body.map(stripDsl).filter(Boolean);
      // пиньинь — латиница с тонами; если первой строки-пиньиня нет, всё тело — перевод
      const isPinyin = !!first && /^[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü' ,·-]+$/i.test(first) && !HAN.test(first);
      const p = isPinyin ? first : '';
      const d = (isPinyin ? rest : [first, ...rest]).filter(Boolean).slice(0, 12);
      if (d.length)
        for (const h of heads) {
          const w = stripDsl(h);
          if (w && HAN.test(w) && [...w].length <= maxLen) yield { w, t: w, p, d, src: 'dsl' };
        }
    }
    heads = [];
    body = [];
  };
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.startsWith('#')) continue;
    if (/^[\t ]/.test(line)) body.push(line.trim());
    else {
      if (body.length) yield* flush();
      heads.push(line.trim());
    }
  }
  yield* flush();
}

// ---------- Поиск слов в выделенном тексте ----------

export const hasHan = (s: string) => HAN.test(s);

/** Кандидаты для поиска: все подстроки из иероглифов длиной 1…max, начиная с каждой позиции. */
export function candidates(text: string, max = 4): string[] {
  const out = new Set<string>();
  for (const run of text.match(/\p{Script=Han}+/gu) ?? []) {
    const ch = [...run];
    for (let i = 0; i < ch.length; i++) for (let n = 1; n <= max && i + n <= ch.length; n++) out.add(ch.slice(i, i + n).join(''));
  }
  return [...out];
}

/** Разбивка на слова «самое длинное известное слово слева направо». */
export function segment(text: string, known: Set<string>, max = 4): string[] {
  const out: string[] = [];
  for (const run of text.match(/\p{Script=Han}+/gu) ?? []) {
    const ch = [...run];
    let i = 0;
    while (i < ch.length) {
      let n = Math.min(max, ch.length - i);
      while (n > 1 && !known.has(ch.slice(i, i + n).join(''))) n--;
      out.push(ch.slice(i, i + n).join(''));
      i += n;
    }
  }
  return out;
}

/** Предложение (переводит ИИ) или отдельные слова (переводит словарь). */
export const isSentence = (text: string) => [...(text.match(/\p{Script=Han}/gu) ?? [])].length > 4 || /[，。！？；、,.!?;]/.test(text);
