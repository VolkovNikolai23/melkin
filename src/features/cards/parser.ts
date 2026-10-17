import type { CardKind } from '../../db/schema';
import { findClozes, findMath, findSeparator } from '../../lib/markup';

export interface ParsedCard {
  /** Стабильный ключ внутри блока: по нему карточка узнаётся после правки текста. */
  key: string;
  kind: CardKind;
  clozeIndex?: number;
  front: string;
  back: string;
}

/** Короткий детерминированный хэш строки (djb2). */
export function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Разбирает текст блока в карточки.
 *  - «вопрос :: ответ» — карточка вперёд;
 *  - «вопрос ;; ответ» — двусторонняя (вперёд + обратная);
 *  - «текст с {{клозами}}» — по карточке на каждый клоз.
 * Пустой ответ допустим: тогда ответом служат дочерние блоки.
 */
export function parseCards(text: string): ParsedCard[] {
  const math = findMath(text);
  const clozes = findClozes(text, math);
  const sep = findSeparator(text, math, clozes);

  if (sep) {
    const front = text.slice(0, sep.index).trim();
    const back = text.slice(sep.index + 2).trim();
    if (!front) return [];
    const cards: ParsedCard[] = [{ key: 'fwd', kind: 'forward', front, back }];
    if (sep.sep === ';;' && back) cards.push({ key: 'rev', kind: 'reverse', front: back, back: front });
    return cards;
  }

  // Ключ клоза — хэш его содержимого: перестановка клозов не путает историю повторений.
  const seen = new Map<string, number>();
  return clozes.map((c, i) => {
    const base = hashString(c.content.trim());
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return {
      key: `cloze:${base}${n > 1 ? '-' + n : ''}`,
      kind: 'cloze' as const,
      clozeIndex: i,
      front: text,
      back: c.content,
    };
  });
}
