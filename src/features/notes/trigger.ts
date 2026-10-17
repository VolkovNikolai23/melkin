// Что пользователь сейчас набирает перед курсором: [[ссылку, ((портал, #тег или /команду.
export type TriggerKind = 'link' | 'portal' | 'tag' | 'slash';

export interface Trigger {
  kind: TriggerKind;
  /** Позиция начала триггера ([[, ((, # или /) в тексте */
  start: number;
  query: string;
}

function openPair(before: string, open: string, close: string): number {
  const i = before.lastIndexOf(open);
  if (i < 0) return -1;
  const tail = before.slice(i + open.length);
  if (tail.includes(close) || tail.includes('\n') || tail.length > 60) return -1;
  return i;
}

export function detectTrigger(text: string, caret: number): Trigger | null {
  const before = text.slice(0, caret);
  const li = openPair(before, '[[', ']]');
  if (li >= 0) return { kind: 'link', start: li, query: before.slice(li + 2) };
  const pi = openPair(before, '((', '))');
  if (pi >= 0) return { kind: 'portal', start: pi, query: before.slice(pi + 2) };
  const slash = before.match(/(^|\s)\/([\p{L}\p{N}]*)$/u);
  if (slash) return { kind: 'slash', start: before.length - slash[2].length - 1, query: slash[2] };
  const tag = before.match(/(^|[\s(])#([\p{L}\p{N}_][\p{L}\p{N}_\-/]*)$/u);
  if (tag) return { kind: 'tag', start: before.length - tag[2].length - 1, query: tag[2] };
  return null;
}

/** Совпадение для подсказок: сначала по началу слова, потом по вхождению. */
export function rankMatch(label: string, query: string): number {
  const l = label.toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  if (l.startsWith(q)) return 3;
  if (l.split(/[\s\-–—,.:()]+/).some((w) => w.startsWith(q))) return 2;
  return l.includes(q) ? 1 : 0;
}
