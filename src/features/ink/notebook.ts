// Операции с листами тетради: добавление, авто-запасной лист, оформление.
import { db } from '../../db/db';
import type { Page, PageItem } from '../../db/schema';
import { uid } from '../../lib/id';

export const PAGE_W = 1000;
export const PAGE_H = 1414; // пропорции A4

/** id листов по порядку — без чтения самих штрихов (индекс [docId+order]). */
export function pageIds(docId: string): Promise<string[]> {
  return db.pages
    .where('[docId+order]')
    .between([docId, -Infinity], [docId, Infinity])
    .primaryKeys() as Promise<string[]>;
}

const isEmpty = (p: Page | undefined) => !!p && !p.strokes.length && !p.items?.length;

/**
 * Нужен ли новый лист: пишем на последнем или предпоследнем листе, а последний уже не пустой.
 * Так в конце тетради всегда есть чистый лист и не копятся пустые.
 */
export function needsSparePage(index: number, total: number, lastIsEmpty: boolean): boolean {
  return index >= total - 2 && !lastIsEmpty;
}

/** Новый лист в конце с тем же оформлением, что у последнего. */
export async function appendPage(docId: string): Promise<Page> {
  const ids = await pageIds(docId);
  const last = ids.length ? await db.pages.get(ids[ids.length - 1]) : undefined;
  const now = Date.now();
  const page: Page = {
    id: uid(),
    docId,
    order: (last?.order ?? -1) + 1,
    background: last?.background ?? 'grid',
    ...(last?.paper ? { paper: last.paper } : {}),
    ...(last?.lineColor ? { lineColor: last.lineColor } : {}),
    strokes: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.pages.add(page);
  return page;
}

/** После записи на листе index: при необходимости добавляет запасной чистый лист. */
export async function ensureSparePage(docId: string, index: number): Promise<boolean> {
  return db.transaction('rw', db.pages, async () => {
    const ids = await pageIds(docId);
    const last = await db.pages.get(ids[ids.length - 1]);
    if (!needsSparePage(index, ids.length, isEmpty(last))) return false;
    await appendPage(docId);
    return true;
  });
}

export type PageLook = Pick<Page, 'background' | 'paper' | 'lineColor'>;

/** Оформление листа (или всех листов тетради). undefined в цвете — «как в теме». */
export async function setPageLook(pageId: string, look: Partial<PageLook>, allOfDoc?: string) {
  const patch = { ...look, updatedAt: Date.now() };
  if (allOfDoc) await db.pages.where('docId').equals(allOfDoc).modify(patch);
  else await db.pages.update(pageId, patch);
}

export async function addPageItem(pageId: string, item: PageItem) {
  const p = await db.pages.get(pageId);
  if (!p) return;
  await db.pages.update(pageId, { items: [...(p.items ?? []), item], updatedAt: Date.now() });
}
