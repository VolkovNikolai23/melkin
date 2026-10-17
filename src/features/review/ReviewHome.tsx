import { useLiveQuery } from 'dexie-react-hooks';
import { Icon } from '../../components/Icon';
import { useDueCount } from '../../components/useDue';
import { db } from '../../db/db';
import type { Doc } from '../../db/schema';
import { navigate } from '../../lib/router';
import { plural } from '../../lib/time';
import { TYPE_ICON } from '../notes/docIcons';
import { collectSubtree, sortDocs } from '../notes/docs';
import { badgeCount, formatInterval, isNew, sumDue } from './scheduler';

/** «Повторить»: все карточки или очередь по папке, документу, тегу. */
export function ReviewHome() {
  const due = useDueCount();
  const docs = useLiveQuery(() => db.docs.toArray(), []);
  const extra = useLiveQuery(async () => {
    const now = Date.now();
    const cards = await db.cards.filter((c) => !c.disabled).toArray();
    // ближайшее повторение, если сейчас ничего нет
    const next = cards.filter((c) => !isNew(c) && c.due > now).reduce((m, c) => Math.min(m, c.due), Infinity);
    // счётчики по тегам
    const tagged = await db.blocks.filter((b) => (b.tags?.length ?? 0) > 0).toArray();
    const tagsOf = new Map(tagged.map((b) => [b.id, b.tags]));
    const tags = new Map<string, { due: number; fresh: number }>();
    for (const c of cards) {
      const ts = tagsOf.get(c.blockId);
      if (!ts) continue;
      const fresh = isNew(c);
      if (!fresh && c.due > now) continue;
      for (const t of ts) {
        const e = tags.get(t) ?? { due: 0, fresh: 0 };
        if (fresh) e.fresh++;
        else e.due++;
        tags.set(t, e);
      }
    }
    return { next, tags };
  }, [due]);

  if (!due || !docs) return <div className="page-pad muted">Загрузка…</div>;

  // Дерево документов с ненулевыми счётчиками, в порядке боковой панели
  const rows: { doc: Doc; depth: number; n: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const d of docs.filter((x) => x.parentId === parentId).sort(sortDocs)) {
      const n = badgeCount(sumDue(due.byDoc, d.type === 'folder' ? collectSubtree(docs, d.id) : [d.id]), due.newLeft);
      if (n > 0) rows.push({ doc: d, depth, n });
      if (d.type === 'folder' && n > 0) walk(d.id, depth + 1);
    }
  };
  walk(null, 0);
  const tagRows = [...(extra?.tags ?? [])]
    .map(([t, c]) => ({ t, n: badgeCount(c, due.newLeft) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);

  return (
    <div className="page-pad review-home">
      <h1>Повторение</h1>
      <section className="due-card">
        <div>
          <div className="due-num">{due.total}</div>
          <div className="due-label">
            {plural(due.total, 'карточка', 'карточки', 'карточек')} на сегодня
            <span className="muted">
              {' '}
              · повторить {due.due}, новых {due.fresh}
            </span>
          </div>
          <div className="muted small">
            Новых сегодня можно ещё {due.newLeft}
            {due.total === 0 && extra && extra.next !== Infinity && ` · ближайшее повторение через ${formatInterval(extra.next - Date.now())}`}
          </div>
        </div>
        <button className="btn primary big" disabled={!due.total} onClick={() => navigate('review?scope=all')}>
          <Icon name="cards" /> Все карточки
        </button>
      </section>

      {rows.length > 0 && (
        <section>
          <h2 className="section-title">Папки и документы</h2>
          <div className="queue-list">
            {rows.map(({ doc, depth, n }) => (
              <button
                key={doc.id}
                className="queue-row"
                style={{ paddingLeft: 14 + depth * 22 }}
                onClick={() => navigate(`review?scope=${doc.type === 'folder' ? 'folder' : 'doc'}:${doc.id}`)}
              >
                <Icon name={TYPE_ICON[doc.type]} size={18} />
                <span className="queue-title">{doc.title}</span>
                <span className="tree-due">{n}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {tagRows.length > 0 && (
        <section>
          <h2 className="section-title">Теги</h2>
          <div className="tag-cloud">
            {tagRows.map(({ t, n }) => (
              <button key={t} className="tag-pill" onClick={() => navigate(`review?scope=tag:${encodeURIComponent(t)}`)}>
                #{t} <span className="tree-due">{n}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
