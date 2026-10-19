// Словарь терминов. Источники: термины, которые ИИ собирает при сводках лекций,
// добавленные вручную, и карточки-понятия «термин :: определение». Нажатие на термин
// в заметке показывает определение офлайн.
import { db } from '../../db/db';
import type { GlossaryEntry } from '../../db/schema';
import { uid } from '../../lib/id';

export interface Term {
  key: string;
  term: string;
  definition: string;
  zh?: string;
  pinyin?: string;
  docId?: string;
  /** Запись словаря (можно править) или карточка-понятие */
  entryId?: string;
  blockId?: string;
}

export const termKey = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');

const clean = (s: string) =>
  String(s ?? '')
    .replace(/\*\*|==\{\w+\}|==|__/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Все термины: записи словаря важнее карточек с тем же термином. */
export async function allTerms(): Promise<Term[]> {
  const [entries, cards, docs] = await Promise.all([db.glossary.toArray(), db.cards.filter((c) => !!c.concept && c.kind === 'forward' && !c.disabled).toArray(), db.docs.filter((d) => !d.deletedAt).toArray()]);
  const live = new Set(docs.map((d) => d.id));
  const out = new Map<string, Term>();
  for (const c of cards) {
    if (!live.has(c.docId)) continue;
    const term = clean(c.front);
    const key = termKey(term);
    if (term.length < 2 || term.length > 60 || out.has(key)) continue;
    out.set(key, { key, term, definition: clean(c.back), docId: c.docId, blockId: c.blockId });
  }
  for (const e of entries) {
    if (e.docId && !live.has(e.docId)) continue;
    out.set(e.key, { key: e.key, term: e.term, definition: e.definition, zh: e.zh, pinyin: e.pinyin, docId: e.docId, entryId: e.id });
  }
  return [...out.values()].sort((a, b) => a.term.localeCompare(b.term, 'ru'));
}

/** Добавить/обновить термин (по ключу). Ручная правка пользователя не перезаписывается ИИ. */
export async function upsertTerm(t: { term: string; definition: string; zh?: string; pinyin?: string; docId?: string }, source: GlossaryEntry['source']): Promise<void> {
  const term = clean(t.term);
  const definition = clean(t.definition);
  if (!term || !definition) return;
  const key = termKey(term);
  const ex = await db.glossary.where('key').equals(key).first();
  if (ex && ex.source === 'user' && source === 'ai') {
    // перевод на китайский дополняем, остальное не трогаем
    if (!ex.zh && t.zh) await db.glossary.update(ex.id, { zh: clean(t.zh), pinyin: t.pinyin ? clean(t.pinyin) : ex.pinyin, updatedAt: Date.now() });
    return;
  }
  const row: GlossaryEntry = {
    id: ex?.id ?? uid(),
    key,
    term,
    definition,
    zh: t.zh ? clean(t.zh) : ex?.zh,
    pinyin: t.pinyin ? clean(t.pinyin) : ex?.pinyin,
    docId: t.docId ?? ex?.docId,
    source,
    updatedAt: Date.now(),
  };
  await db.glossary.put(row);
}

// ---------- Разметка терминов в тексте ----------

const MARK_OPEN = '\uE000';
const MARK_SEP = '\uE001';
const MARK_CLOSE = '\uE002';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface TermIndex {
  re: RegExp | null;
  byKey: Map<string, Term>;
}

/**
 * Регулярное выражение по всем терминам: длинные раньше коротких; у однословных терминов
 * от 5 букв допускаем окончание (митоз → митоза, митозе).
 */
export function buildIndex(terms: Term[]): TermIndex {
  const byKey = new Map(terms.map((t) => [t.key, t]));
  const parts = terms
    .filter((t) => t.term.length >= 3)
    .sort((a, b) => b.term.length - a.term.length)
    .map((t) => {
      const body = esc(t.term).replace(/\s+/g, '\\s+').replace(/[её]/gi, '[её]');
      return !/\s/.test(t.term) && t.term.length >= 5 ? `${body}\\p{L}{0,3}` : body;
    });
  if (!parts.length) return { re: null, byKey };
  return { re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${parts.join('|')})(?![\\p{L}\\p{N}])`, 'giu'), byKey };
}

/** Найти термин по найденному в тексте слову (с окончанием). */
export function matchKey(word: string, index: TermIndex): string | null {
  const k = termKey(word);
  if (index.byKey.has(k)) return k;
  for (let cut = 1; cut <= 3; cut++) if (index.byKey.has(k.slice(0, -cut))) return k.slice(0, -cut);
  return null;
}

/**
 * Помечает термины в исходном тексте блока специальными символами (вне формул, ссылок
 * и клозов), по одному разу на термин. Сам блок-определение термина не размечается.
 */
export function markTerms(text: string, index: TermIndex): string {
  if (!index.re || !text) return text;
  const defined = text.includes('::') ? termKey(text.split('::')[0]) : '';
  const seen = new Set<string>();
  // формулы, [[ссылки]], {{клозы}}, ((порталы)) не трогаем
  return text
    .split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+\$|\[\[[^\]]*\]\]|\{\{[\s\S]*?\}\}|\(\([^)]*\)\))/)
    .map((seg, i) =>
      i % 2
        ? seg
        : seg.replace(index.re!, (m) => {
            const key = matchKey(m, index);
            if (!key || seen.has(key) || key === defined) return m;
            seen.add(key);
            return MARK_OPEN + key + MARK_SEP + m + MARK_CLOSE;
          }),
    )
    .join('');
}

/** После renderText: метки → кнопка-термин. */
export function termsToHtml(html: string): string {
  return html.replace(new RegExp(`${MARK_OPEN}([^${MARK_SEP}]*)${MARK_SEP}([\\s\\S]*?)${MARK_CLOSE}`, 'g'), (_, key: string, inner: string) => `<span class="gl-term" data-term="${key.replace(/"/g, '&quot;')}">${inner}</span>`);
}

/** Убрать метки (если текст пошёл не в HTML). */
export const stripMarks = (s: string) => s.replace(new RegExp(`${MARK_OPEN}[^${MARK_SEP}]*${MARK_SEP}|${MARK_CLOSE}`, 'g'), '');
