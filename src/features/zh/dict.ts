// Китайский словарь в IndexedDB: загрузка CC-CEDICT, импорт своего DSL, поиск слов.
import { db, getMeta, setMeta } from '../../db/db';
import type { ZhEntry } from '../../db/schema';
import { candidates, parseCedictLine, parseDsl, segment } from './parse';

export interface DictStatus {
  src: 'cedict' | 'dsl';
  name: string;
  count: number;
  at: number;
}

const STATUS_KEY = 'zhDicts';

export function dictStatus(): Promise<DictStatus[]> {
  return getMeta<DictStatus[]>(STATUS_KEY, []);
}

/** Поток байтов → строки (gzip/dictzip распаковываются, UTF-16 с BOM распознаётся). */
async function* lines(stream: ReadableStream<Uint8Array>, gz: boolean): AsyncGenerator<string> {
  let s = stream;
  if (gz) s = s.pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  const reader = s.getReader();
  let decoder: TextDecoder | null = null;
  let rest = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!decoder) {
      // DSL часто в UTF-16LE с меткой порядка байтов
      const utf16 = value[0] === 0xff && value[1] === 0xfe;
      decoder = new TextDecoder(utf16 ? 'utf-16le' : 'utf-8');
    }
    rest += decoder.decode(value, { stream: true });
    const parts = rest.split('\n');
    rest = parts.pop() ?? '';
    yield* parts;
  }
  if (rest) yield rest;
}

/** Синхронный генератор DSL поверх асинхронных строк: копим пачку строк и разбираем её. */
async function store(entries: AsyncIterable<ZhEntry>, src: ZhEntry['src'], onProgress?: (n: number) => void): Promise<number> {
  await db.zh.where('src').equals(src).delete();
  let batch: ZhEntry[] = [];
  let n = 0;
  for await (const e of entries) {
    batch.push(e);
    if (batch.length >= 5000) {
      await db.zh.bulkAdd(batch);
      n += batch.length;
      batch = [];
      onProgress?.(n);
    }
  }
  if (batch.length) await db.zh.bulkAdd(batch);
  n += batch.length;
  onProgress?.(n);
  return n;
}

async function saveStatus(s: DictStatus) {
  const all = (await dictStatus()).filter((x) => x.src !== s.src);
  await setMeta(STATUS_KEY, [...all, s]);
}

/** CC-CEDICT с сайта приложения (лежит рядом, в public/dict). */
export async function loadCedict(onProgress?: (n: number) => void): Promise<number> {
  const res = await fetch(`${import.meta.env.BASE_URL}dict/cedict.txt.gz`);
  if (!res.ok || !res.body) throw new Error('Не удалось загрузить словарь. Проверьте интернет и повторите.');
  // сервер мог уже распаковать файл (Content-Encoding) — проверяем сигнатуру gzip
  const [a, b] = res.body.tee();
  const peek = a.getReader();
  const head = (await peek.read()).value;
  void peek.cancel(); // вторая ветка не нужна — не держим её данные в памяти
  const gz = !!head && head[0] === 0x1f && head[1] === 0x8b;
  async function* parse() {
    for await (const l of lines(b, gz)) {
      const e = parseCedictLine(l);
      if (e) yield e;
    }
  }
  const n = await store(parse(), 'cedict', onProgress);
  await saveStatus({ src: 'cedict', name: 'CC-CEDICT (китайско-английский, CC BY-SA 4.0)', count: n, at: Date.now() });
  return n;
}

/** Свой словарь в формате DSL (например, БКРС, скачанный вами): .dsl, .dsl.dz или .gz. */
export async function importDsl(file: File, onProgress?: (n: number) => void): Promise<number> {
  const gz = /\.(dz|gz)$/i.test(file.name);
  // parseDsl синхронный — подаём ему строки пачками
  async function* parse() {
    let buf: string[] = [];
    for await (const l of lines(file.stream() as ReadableStream<Uint8Array>, gz)) {
      // режем пачку только на новом заголовке, чтобы статья не разорвалась
      if (buf.length > 20000 && l && !/^[\t ]/.test(l)) {
        yield* parseDsl(buf);
        buf = [];
      }
      buf.push(l);
    }
    yield* parseDsl(buf);
  }
  const n = await store(parse(), 'dsl', onProgress);
  if (!n) throw new Error('В файле не нашлось китайских статей. Нужен словарь в формате DSL (GoldenDict/Lingvo).');
  await saveStatus({ src: 'dsl', name: file.name, count: n, at: Date.now() });
  return n;
}

export async function removeDict(src: ZhEntry['src']) {
  await db.zh.where('src').equals(src).delete();
  await setMeta(
    STATUS_KEY,
    (await dictStatus()).filter((x) => x.src !== src),
  );
}

export interface WordHit {
  word: string;
  entries: ZhEntry[];
}

/** Слова из выделенного текста со статьями (свой DSL-словарь — первым: он на русском). */
export async function lookup(text: string): Promise<WordHit[]> {
  const cands = candidates(text);
  if (!cands.length) return [];
  const [simp, trad] = await Promise.all([db.zh.where('w').anyOf(cands).toArray(), db.zh.where('t').anyOf(cands).toArray()]);
  const byWord = new Map<string, ZhEntry[]>();
  for (const e of [...simp, ...trad]) {
    for (const k of new Set([e.w, e.t])) {
      if (!cands.includes(k)) continue;
      const list = byWord.get(k) ?? [];
      if (!list.some((x) => x.id === e.id)) list.push(e);
      byWord.set(k, list);
    }
  }
  return segment(text, new Set(byWord.keys())).map((word) => ({
    word,
    entries: (byWord.get(word) ?? []).sort((a, b) => (a.src === b.src ? 0 : a.src === 'dsl' ? -1 : 1)),
  }));
}

/** Слово в Trainchinese: своей ссылки на слово у приложения нет — открываем поиск на сайте. */
export const trainchineseUrl = (word: string) => `https://www.trainchinese.com/v2/search.php?searchWord=${encodeURIComponent(word)}&tcLanguage=ru`;
