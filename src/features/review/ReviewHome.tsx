import { useLiveQuery } from 'dexie-react-hooks';
import { Icon } from '../../components/Icon';
import { useDueCount } from '../../components/useDue';
import { db } from '../../db/db';
import type { Doc } from '../../db/schema';
import { navigate } from '../../lib/router';
import { plural } from '../../lib/time';
import { docIcon } from '../notes/docIcons';
import { collectSubtree, sortDocs } from '../notes/docs';
import { badgeCount, formatInterval, isNew, sumDue } from './scheduler';

const scopeOf = (d: Doc) => `${d.type === 'folder' || d.type === 'lecture' ? 'folder' : 'doc'}:${d.id}`;

/** «Повторить» (SPEC 3): всё на сегодня, одна тема/раздел, экспресс-повтор перед экзаменом. */
export function ReviewHome() {
  const due = useDueCount();
  const data = useLiveQuery(async () => {
    const now = Date.now();
    const docs = await db.docs.filter((d) => !d.deletedAt).toArray();
    const live = new Set(docs.map((d) => d.id));
    const cards = (await db.cards.toArray()).filter((c) => !c.disabled && live.has(c.docId));
    const next = cards.filter((c) => !isNew(c) && c.due > now).reduce((m, c) => Math.min(m, c.due), Infinity);
    const totalByDoc = new Map<string, number>();
    for (const c of cards) totalByDoc.set(c.docId, (totalByDoc.get(c.docId) ?? 0) + 1);
    return { docs, next, totalByDoc, total: cards.length };
  }, [due]);

  if (!due || !data) return <div className="page-pad muted">Загрузка…</div>;
  const { docs, totalByDoc } = data;

  // Дерево предметов → тем → лекций (и отдельных документов) с карточками
  const rows: { doc: Doc; depth: number; n: number; total: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const d of docs.filter((x) => x.parentId === parentId).sort(sortDocs)) {
      const ids = d.type === 'folder' || d.type === 'lecture' ? collectSubtree(docs, d.id) : [d.id];
      const total = ids.reduce((s, id) => s + (totalByDoc.get(id) ?? 0), 0);
      if (!total) continue;
      rows.push({ doc: d, depth, n: badgeCount(sumDue(due.byDoc, ids), due.newLeft), total });
      if (d.type === 'folder') walk(d.id, depth + 1);
    }
  };
  walk(null, 0);

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
          {due.total === 0 && data.next !== Infinity && <div className="muted small">Ближайшее повторение через {formatInterval(data.next - Date.now())}</div>}
        </div>
        <div className="due-actions">
          <button className="btn primary big" disabled={!due.total} onClick={() => navigate('review?scope=all')}>
            <Icon name="cards" /> Всё на сегодня
          </button>
          <button className="btn" disabled={!data.total} onClick={() => navigate('review?scope=all&mode=express')} title="Все карточки подряд, без графика">
            <Icon name="flame" /> Экспресс-повтор всего
          </button>
        </div>
      </section>

      {rows.length > 0 && (
        <section>
          <h2 className="section-title">Предметы, темы и лекции</h2>
          <p className="muted small">«Повторить» — то, что пора сегодня. «Экспресс» — перед экзаменом: все карточки темы подряд, график не меняется.</p>
          <div className="queue-list">
            {rows.map(({ doc, depth, n, total }) => (
              <div key={doc.id} className="queue-row" style={{ paddingLeft: 14 + depth * 22 }}>
                <span style={{ color: doc.color || undefined, display: 'inline-flex' }}>
                  <Icon name={docIcon(doc)} size={18} />
                </span>
                <span className="queue-title">
                  {doc.title}
                  <small className="muted"> · {total}</small>
                </span>
                <button className="btn small" disabled={!n} onClick={() => navigate(`review?scope=${scopeOf(doc)}`)}>
                  Повторить{n ? ` ${n}` : ''}
                </button>
                <button className="btn small ghost" onClick={() => navigate(`review?scope=${scopeOf(doc)}&mode=express`)}>
                  <Icon name="flame" size={16} /> Экспресс
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {rows.length === 0 && <p className="muted">Карточек пока нет. Напишите в заметке «вопрос &gt;&gt; ответ» — и карточка появится.</p>}
    </div>
  );
}
