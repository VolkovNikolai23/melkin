import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../db/db';
import type { Doc } from '../db/schema';
import { getOrCreateDaily } from '../features/notes/daily';
import { docIcon } from '../features/notes/docIcons';
import { collectSubtree } from '../features/notes/docs';
import { Outliner } from '../features/notes/Outliner';
import { streakDays } from '../features/review/stats';
import { badgeCount, sumDue } from '../features/review/scheduler';
import { navigate } from '../lib/router';
import { plural } from '../lib/time';
import { Icon } from './Icon';
import { useDueCount } from './useDue';
import { StorageWarning } from './storage';


function StreakCard() {
  const s = useLiveQuery(async () => streakDays((await db.reviewLogs.toArray()).map((l) => l.review), Date.now()), []);
  if (!s) return null;
  return (
    <section className={'widget streak' + (s.today ? ' lit' : '')}>
      <div className="streak-flame">
        <Icon name="flame" size={30} />
      </div>
      <div>
        <div className="widget-num">
          {s.days} {plural(s.days, 'день', 'дня', 'дней')}
        </div>
        <div className="muted small">
          {s.days === 0 ? 'Повторите хоть одну карточку — и стрик начнётся' : s.today ? 'Сегодня уже занимались — так держать!' : 'Повторите сегодня, чтобы не прервать стрик'}
        </div>
      </div>
    </section>
  );
}

function DueCard() {
  const due = useDueCount();
  const docs = useLiveQuery(() => db.docs.filter((d) => !d.deletedAt).toArray(), []);
  if (!due || !docs) return null;
  // где больше всего карточек к повторению: лекции и самостоятельные документы
  const top = docs
    .filter((d) => d.type === 'lecture' || (d.type !== 'folder' && !docs.some((p) => p.id === d.parentId && p.type === 'lecture')))
    .map((d) => ({ d, n: badgeCount(sumDue(due.byDoc, collectSubtree(docs, d.id)), due.newLeft) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 4);
  return (
    <section className="widget">
      <h3 className="widget-title">
        <Icon name="cards" size={18} /> Что повторить
      </h3>
      <div className="widget-num">
        {due.total} <span className="widget-unit">{plural(due.total, 'карточка', 'карточки', 'карточек')}</span>
      </div>
      {top.map(({ d, n }) => (
        <button key={d.id} className="widget-row" onClick={() => navigate(`review?scope=${d.type === 'lecture' ? 'folder' : 'doc'}:${d.id}`)}>
          <Icon name={docIcon(d)} size={16} />
          <span>{d.title}</span>
          <span className="tree-due">{n}</span>
        </button>
      ))}
      <button className="btn primary grow" disabled={!due.total} onClick={() => navigate('review?scope=all')}>
        Повторить всё
      </button>
    </section>
  );
}

function RecentLectures() {
  const recent = useLiveQuery(async () => {
    const docs = await db.docs.filter((d) => !d.deletedAt).toArray();
    const lectures = docs.filter((d) => d.type === 'lecture');
    const activity = (l: Doc) => Math.max(...collectSubtree(docs, l.id).map((id) => docs.find((d) => d.id === id)?.updatedAt ?? 0));
    const parentTitle = (l: Doc) => docs.find((d) => d.id === l.parentId)?.title ?? '';
    return lectures
      .map((l) => ({ l, at: activity(l), parent: parentTitle(l) }))
      .sort((a, b) => b.at - a.at)
      .slice(0, 6);
  }, []);
  return (
    <section className="widget">
      <h3 className="widget-title">
        <Icon name="lecture" size={18} /> Последние лекции
      </h3>
      {recent && recent.length === 0 && <p className="muted small">Создайте предмет, в нём тему и лекцию — меню «⋯» в боковой панели.</p>}
      {recent?.map(({ l, parent }) => (
        <button key={l.id} className="widget-row" onClick={() => navigate(`doc/${l.id}`)} style={{ color: l.color || undefined }}>
          <Icon name={docIcon(l)} size={16} />
          <span>{l.title}</span>
          <small className="muted">{parent}</small>
        </button>
      ))}
    </section>
  );
}

/** Главный экран «Сегодня»: заметка дня + стрик, что повторить, последние лекции. */
export function Home() {
  const [daily, setDaily] = useState<Doc | null>(null);
  useEffect(() => {
    getOrCreateDaily().then(setDaily);
  }, []);
  const title = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="today">
      <div className="today-main">
        <header className="today-head">
          <div className="muted today-date">{title}</div>
          <h1>Сегодня</h1>
        </header>
        <StorageWarning />
        {daily && <Outliner docId={daily.id} highlight={null} />}
      </div>
      <aside className="today-side">
        <StreakCard />
        <DueCard />
        <RecentLectures />
      </aside>
    </div>
  );
}
