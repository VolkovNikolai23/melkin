import type { CardKind, ImageData } from '../../db/schema';
import { analyze, type SepKind } from '../../lib/markup';

export { hashString } from '../../lib/markup';

export interface ParsedCard {
  /** Стабильный ключ внутри блока: по нему карточка узнаётся после правки текста. */
  key: string;
  kind: CardKind;
  front: string;
  back: string;
  concept?: boolean;
  /** Двусторонняя (термин ↔ определение): при повторении сравнивают сами, без ввода ответа */
  twoSided?: boolean;
  clozeIndex?: number;
  sub?: string;
}

export interface ParseContext {
  /** Текст родительского блока — нужен для описаний (;;) */
  parentText?: string;
}

/**
 * Image occlusion: по карточке на каждый прямоугольник. Ключ — id прямоугольника,
 * поэтому перемещение/изменение области сохраняет историю, а удаление — убирает карточку.
 * Вопросом служит название родителя (например «Строение клетки»), если оно есть.
 */
export function occlusionCards(image: ImageData | undefined, ctx: ParseContext = {}): ParsedCard[] {
  const rects = image?.occlusions ?? [];
  const title = ctx.parentText ? conceptName(ctx.parentText) : '';
  return rects.map((r, i) => ({ key: `occ:${r.id}`, kind: 'occlusion' as const, front: title, back: '', clozeIndex: i, sub: r.id }));
}

/** Теги — служебные метки блока, в тексте карточки они не нужны. */
export function stripTags(text: string): string {
  const { tags } = analyze(text);
  let out = text;
  for (const t of [...tags].reverse()) out = out.slice(0, t.start) + out.slice(t.end);
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

/** Название понятия из текста блока: левая часть до разделителя или весь текст. */
export function conceptName(text: string): string {
  const { sep } = analyze(text);
  return stripTags(sep ? text.slice(0, sep.index) : text);
}

export function separatorOf(text: string): SepKind | null {
  return analyze(text).sep?.sep ?? null;
}

/**
 * Разбирает текст блока в карточки (синтаксис RemNote):
 *  - «вопрос >> ответ» — вперёд; «<<» — обратная; «<>» — в обе стороны;
 *  - «понятие :: определение» — понятие, в обе стороны;
 *  - «свойство ;; значение» — описание понятия-родителя: «Понятие → свойство?»;
 *  - «вопрос >>>» — многострочный ответ из дочерних блоков;
 *  - «вопрос >>1.» — карточка-список; «вопрос >>A)» — множественный выбор;
 *  - «текст с {{клозами}}» — по карточке на группу ({{c1::…}} объединяет клозы).
 * Ключи вперёд/назад одинаковы для всех видов, поэтому смена >> на :: не теряет историю.
 */
export function parseCards(text: string, ctx: ParseContext = {}): ParsedCard[] {
  const a = analyze(text);

  if (a.sep) {
    const left = stripTags(text.slice(0, a.sep.index));
    const right = stripTags(text.slice(a.sep.index + a.sep.sep.length));
    if (!left) return [];
    const fwd = (front = left, back = right, extra: Partial<ParsedCard> = {}): ParsedCard => ({ key: 'fwd', kind: 'forward', front, back, ...extra });
    const bwd = (extra: Partial<ParsedCard> = {}): ParsedCard => ({ key: 'bwd', kind: 'backward', front: right, back: left, ...extra });
    switch (a.sep.sep) {
      case '>>':
        return [fwd()];
      case '<<':
        return right ? [bwd()] : [];
      case '<>':
        return right ? [fwd(left, right, { twoSided: true }), bwd({ twoSided: true })] : [fwd()];
      case '::':
        return right
          ? [fwd(left, right, { concept: true, twoSided: true }), bwd({ concept: true, twoSided: true })]
          : [fwd(left, right, { concept: true })];
      case ';;': {
        const parent = ctx.parentText ? conceptName(ctx.parentText) : '';
        return [fwd(parent ? `${parent} → ${left}` : left, right)];
      }
      case '>>>':
        return [fwd(left, '')];
      case '>>1.':
        return [{ key: 'list', kind: 'list', front: left, back: '' }];
      case '>>A)':
        return [{ key: 'mcq', kind: 'mcq', front: left, back: '' }];
    }
  }

  // Клозы: одна карточка на группу. Ключ — группа (c1) или хэш содержимого,
  // поэтому перестановка клозов в тексте не путает историю повторений.
  const groups = new Map<string, { index: number; contents: string[] }>();
  a.clozes.forEach((c, i) => {
    const g = groups.get(c.group);
    if (g) g.contents.push(c.content);
    else groups.set(c.group, { index: i, contents: [c.content] });
  });
  return [...groups].map(([group, g]) => ({
    key: `cloze:${group}`,
    kind: 'cloze' as const,
    front: text,
    back: g.contents.join(' · '),
    clozeIndex: g.index,
    sub: group,
  }));
}
