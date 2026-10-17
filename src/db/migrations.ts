// Преобразования данных между версиями схемы. Используются и при обновлении
// IndexedDB (Dexie upgrade), и при импорте старых резервных копий.
import { analyze, extractTags } from '../lib/markup';

type AnyRow = Record<string, unknown>;

/**
 * v1 → v2: синтаксис карточек стал как в RemNote.
 * В v1 «::» означало карточку вперёд, а «;;» — двустороннюю. Чтобы смысл и история
 * не потерялись, переписываем их в «>>» и «<>» соответственно.
 */
export function migrateBlockTextV1(text: string): string {
  const a = analyze(text);
  const skip = [...a.code, ...a.math, ...a.clozes];
  for (let i = 0; i < text.length - 1; i++) {
    if (skip.some((r) => i >= r.start && i < r.end)) continue;
    const two = text.slice(i, i + 2);
    if (two === '::') return text.slice(0, i) + '>>' + text.slice(i + 2);
    if (two === ';;') return text.slice(0, i) + '<>' + text.slice(i + 2);
  }
  return text;
}

export function migrateBlockV1(b: AnyRow): AnyRow {
  const text = typeof b.text === 'string' ? migrateBlockTextV1(b.text) : '';
  return { ...b, text, tags: extractTags(text), links: [] };
}

/** id карточек v1 → v2: обратная карточка «#rev» → «#bwd», клоз «#cloze:x» → «#cloze:hx». */
export function migrateCardIdV1(id: string): string {
  return id.replace(/#rev$/, '#bwd').replace(/#cloze:([0-9a-z]+)$/, '#cloze:h$1');
}

export function migrateCardV1(c: AnyRow): AnyRow {
  const id = migrateCardIdV1(String(c.id));
  const kind = c.kind === 'reverse' ? 'backward' : c.kind;
  return { ...c, id, kind };
}
