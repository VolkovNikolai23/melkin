// Ссылки [[Название]] между документами. В тексте хранится название (удобно редактировать),
// а в block.links — id найденных документов: по этому индексу строятся обратные ссылки.
// При переименовании документа текст ссылок во всех блоках обновляется.
import { db } from '../../db/db';
import type { Doc } from '../../db/schema';
import { analyze } from '../../lib/markup';

export const normTitle = (t: string) => t.trim().replace(/\s+/g, ' ').toLowerCase();

type DocLite = Pick<Doc, 'id' | 'title' | 'type'>;

/** id документов, на которые ссылается текст (папки ссылками не считаются). */
export function resolveLinks(text: string, docs: DocLite[]): string[] {
  const byTitle = new Map<string, string>();
  for (const d of docs) if (d.type !== 'folder' && !byTitle.has(normTitle(d.title))) byTitle.set(normTitle(d.title), d.id);
  const ids = new Set<string>();
  for (const l of analyze(text).links) {
    const id = byTitle.get(normTitle(l.content));
    if (id) ids.add(id);
  }
  return [...ids];
}

/** Заменяет [[старое]] на [[новое]] (без учёта регистра), не трогая формулы и код. */
export function renameLinkInText(text: string, oldTitle: string, newTitle: string): string {
  const old = normTitle(oldTitle);
  const hits = analyze(text).links.filter((l) => normTitle(l.content) === old);
  let out = text;
  for (const l of [...hits].reverse()) out = out.slice(0, l.start) + `[[${newTitle}]]` + out.slice(l.end);
  return out;
}

export async function linksFor(text: string): Promise<string[]> {
  if (!text.includes('[[')) return [];
  return resolveLinks(text, await db.docs.toArray());
}

/** Документ появился или получил новое название — привязываем к нему ссылки, которые раньше «висели». */
export async function relinkTitle(title: string) {
  const needle = '[[' ;
  const t = normTitle(title);
  const docs = await db.docs.toArray();
  const blocks = await db.blocks.filter((b) => b.text.includes(needle) && normTitle(b.text).includes(t)).toArray();
  for (const b of blocks) {
    const links = resolveLinks(b.text, docs);
    if (links.join() !== (b.links ?? []).join()) await db.blocks.update(b.id, { links });
  }
}

/** Переименование документа: обновляем текст всех ссылок на него. */
export async function propagateRename(docId: string, oldTitle: string, newTitle: string) {
  if (normTitle(oldTitle) === normTitle(newTitle)) return;
  const linking = await db.blocks.where('links').equals(docId).toArray();
  for (const b of linking) {
    const text = renameLinkInText(b.text, oldTitle, newTitle);
    if (text !== b.text) await db.blocks.update(b.id, { text, updatedAt: Date.now() });
  }
  await relinkTitle(newTitle);
}

export function backlinksQuery(docId: string) {
  return db.blocks.where('links').equals(docId).toArray();
}
