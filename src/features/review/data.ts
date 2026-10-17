import { db, getSettings } from '../../db/db';
import type { CardRow, Doc } from '../../db/schema';
import { dayStart } from '../../lib/time';
import { applyRating, newAllowance, type Grade } from './scheduler';

export type Scope = { kind: 'all' } | { kind: 'doc'; id: string } | { kind: 'folder'; id: string } | { kind: 'tag'; id: string };

export function parseScope(s: string | null): Scope {
  if (!s) return { kind: 'all' };
  const i = s.indexOf(':');
  const kind = s.slice(0, i);
  const id = s.slice(i + 1);
  if ((kind === 'doc' || kind === 'folder' || kind === 'tag') && id) return { kind, id };
  return { kind: 'all' };
}

/** Все документы внутри папки (рекурсивно). */
export function descendantDocIds(docs: Doc[], folderId: string): Set<string> {
  const res = new Set<string>();
  const stack = [folderId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const d of docs) {
      if (d.parentId === id && !res.has(d.id)) {
        res.add(d.id);
        stack.push(d.id);
      }
    }
  }
  return res;
}

export async function cardsInScope(scope: Scope): Promise<CardRow[]> {
  if (scope.kind === 'doc') return db.cards.where('docId').equals(scope.id).toArray();
  if (scope.kind === 'tag') {
    const ids = await db.blocks.where('tags').equals(scope.id.toLowerCase()).primaryKeys();
    return db.cards.where('blockId').anyOf(ids as string[]).toArray();
  }
  if (scope.kind === 'folder') {
    const ids = descendantDocIds(await db.docs.toArray(), scope.id);
    return db.cards.where('docId').anyOf([...ids]).toArray();
  }
  return db.cards.toArray();
}

export async function newDoneToday(now = Date.now()): Promise<number> {
  return db.reviewLogs
    .where('review')
    .aboveOrEqual(dayStart(now))
    .filter((l) => l.wasNew)
    .count();
}

export async function newLimitLeft(now = Date.now()) {
  const settings = await getSettings();
  return newAllowance(settings.newPerDay, await newDoneToday(now));
}

export interface Answer {
  before: CardRow;
  updated: CardRow;
  logId: string;
  rating: Grade;
}

export async function answerCard(card: CardRow, rating: Grade, now = Date.now()): Promise<Answer> {
  const { card: updated, log } = applyRating(card, rating, now);
  await db.transaction('rw', db.cards, db.reviewLogs, async () => {
    await db.cards.put(updated);
    await db.reviewLogs.add(log);
  });
  return { before: card, updated, logId: log.id, rating };
}

/** Отмена ответа: карточка возвращается в прежнее состояние, запись журнала удаляется. */
export async function undoAnswer(a: Answer) {
  await db.transaction('rw', db.cards, db.reviewLogs, async () => {
    await db.cards.put(a.before);
    await db.reviewLogs.delete(a.logId);
  });
}
