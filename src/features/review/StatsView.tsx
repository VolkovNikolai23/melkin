import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { db } from '../../db/db';
import type { Doc } from '../../db/schema';
import { navigate } from '../../lib/router';
import { plural } from '../../lib/time';
import { docIcon } from '../notes/docIcons';
import { collectSubtree, sortDocs } from '../notes/docs';
import { Rating } from './scheduler';
import { combineKnowledge, latestScores } from '../tests/model';
import { knowledgeOf, readiness, reviewsPerDay, SOLID_STEP, streakDays } from './stats';

const dayLabel = (t: number) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

/** График повторений по дням: один ряд, тонкие столбцы, подсказка при наведении/касании. */
function ReviewsChart({ data }: { data: { day: number; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.count));
  const W = 600;
  const H = 160;
  const pad = { l: 28, r: 6, t: 10, b: 22 };
  const bw = (W - pad.l - pad.r) / data.length;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const h = hover !== null ? data[hover] : null;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Повторения по дням за 30 дней" onPointerLeave={() => setHover(null)}>
        {/* приглушённая сетка: ноль и максимум */}
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} className="chart-axis" />
        <line x1={pad.l} x2={W - pad.r} y1={y(max)} y2={y(max)} className="chart-grid" />
        <text x={pad.l - 6} y={y(max) + 4} className="chart-tick" textAnchor="end">
          {max}
        </text>
        <text x={pad.l - 6} y={y(0) + 4} className="chart-tick" textAnchor="end">
          0
        </text>
        {data.map((d, i) => {
          const x = pad.l + i * bw + 1; // 2px зазор между столбцами
          const top = y(d.count);
          const bh = Math.max(0, y(0) - top);
          const r = Math.min(4, bh, (bw - 2) / 2);
          return (
            <g key={d.day} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)}>
              {/* зона касания больше самого столбца */}
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
              {d.count > 0 && (
                <path
                  className={'chart-bar' + (hover === i ? ' hover' : '')}
                  d={`M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - 2 - r} Q${x + bw - 2},${top} ${x + bw - 2},${top + r} V${y(0)} Z`}
                />
              )}
            </g>
          );
        })}
        <text x={pad.l} y={H - 6} className="chart-tick">
          {dayLabel(data[0].day)}
        </text>
        <text x={W - pad.r} y={H - 6} className="chart-tick" textAnchor="end">
          сегодня
        </text>
      </svg>
      {h && (
        <div className="chart-tip" style={{ left: `${((hover! + 0.5) / data.length) * 100}%` }}>
          <strong>
            {h.count} {plural(h.count, 'ответ', 'ответа', 'ответов')}
          </strong>
          <span>{dayLabel(h.day)}</span>
        </div>
      )}
      <details className="chart-table">
        <summary>Таблицей</summary>
        <table>
          <tbody>
            {[...data].reverse().map((d) => (
              <tr key={d.day}>
                <td>{dayLabel(d.day)}</td>
                <td>{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function KnowledgeRow({ doc, depth, percent, total }: { doc: Doc; depth: number; percent: number; total: number }) {
  return (
    <button className="know-row" style={{ paddingLeft: 12 + depth * 20 }} onClick={() => navigate(`doc/${doc.id}`)}>
      <span className="know-name" style={{ color: doc.color || undefined }}>
        <Icon name={docIcon(doc)} size={16} /> {doc.title}
      </span>
      <span className="know-bar" aria-hidden>
        <span style={{ width: `${percent}%` }} />
      </span>
      <span className="know-pct">{total ? `${percent}%` : '—'}</span>
    </button>
  );
}

/** Статистика (SPEC 3): стрик, график повторений, знание по темам, прогноз готовности. */
export function StatsView() {
  const data = useLiveQuery(async () => {
    const now = Date.now();
    const [logs, allCards, docs, attempts] = await Promise.all([db.reviewLogs.toArray(), db.cards.toArray(), db.docs.filter((d) => !d.deletedAt).toArray(), db.testAttempts.toArray()]);
    const live = new Set(docs.map((d) => d.id));
    const cards = allCards.filter((c) => live.has(c.docId));
    const times = logs.map((l) => l.review);
    const solidReached = logs.filter((l) => l.rating === Rating.Know && !l.express && l.learning_steps === SOLID_STEP).map((l) => l.review);
    // знание по предметам → темам → лекциям (только где есть карточки)
    const rows: { doc: Doc; depth: number; percent: number; total: number }[] = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const d of docs.filter((x) => x.parentId === parentId && (x.type === 'folder' || x.type === 'lecture')).sort(sortDocs)) {
        const ids = new Set(collectSubtree(docs, d.id));
        const k = knowledgeOf(cards.filter((c) => ids.has(c.docId)), now);
        // тесты (последние попытки) тоже входят в процент знания
        const tests = latestScores(attempts.filter((a) => ids.has(a.docId)));
        if (!k.total && !tests.length) continue;
        rows.push({ doc: d, depth, percent: combineKnowledge(k.percent, k.total, tests), total: k.total + tests.length });
        if (d.type === 'folder') walk(d.id, depth + 1);
      }
    };
    walk(null, 0);
    return {
      streak: streakDays(times, now),
      perDay: reviewsPerDay(times, now, 30),
      total: logs.length,
      overall: knowledgeOf(cards, now),
      ready: readiness(cards, solidReached, now),
      rows,
    };
  }, []);
  if (!data) return <div className="page-pad muted">Загрузка…</div>;
  const { streak, perDay, overall, ready, rows } = data;
  const week = perDay.slice(-7).reduce((s, d) => s + d.count, 0);

  return (
    <div className="page-pad stats">
      <h1>Статистика</h1>
      <div className="stat-tiles">
        <div className={'stat-tile' + (streak.today ? ' lit' : '')}>
          <Icon name="flame" size={22} />
          <div className="stat-num">{streak.days}</div>
          <div className="stat-label">{plural(streak.days, 'день', 'дня', 'дней')} подряд</div>
        </div>
        <div className="stat-tile">
          <Icon name="cards" size={22} />
          <div className="stat-num">{week}</div>
          <div className="stat-label">ответов за неделю</div>
        </div>
        <div className="stat-tile">
          <Icon name="star" size={22} />
          <div className="stat-num">{overall.percent}%</div>
          <div className="stat-label">знание всех карточек</div>
        </div>
        <div className="stat-tile">
          <Icon name="check" size={22} />
          <div className="stat-num">{ready.percent}%</div>
          <div className="stat-label">готовность</div>
        </div>
      </div>

      <section className="panel">
        <h2>Повторения за 30 дней</h2>
        {data.total ? <ReviewsChart data={perDay} /> : <p className="muted">Пока нет ни одного ответа — начните с «Повторить».</p>}
      </section>

      <section className="panel">
        <h2>Прогноз готовности</h2>
        <p>
          Надёжно выучено (интервал от 3 дней): <strong>{ready.solid}</strong> из {ready.total} {plural(ready.total, 'карточки', 'карточек', 'карточек')}.
        </p>
        <p className="muted">
          {ready.total === 0
            ? 'Когда появятся карточки, здесь будет прогноз.'
            : ready.daysLeft === 0
              ? 'Всё выучено надёжно — можно делать экспресс-повтор перед экзаменом.'
              : ready.daysLeft === null
                ? 'Прогноз появится, когда первые карточки дойдут до интервала в 3 дня.'
                : `При нынешнем темпе (≈${String(ready.perDay).replace('.', ',')} ${plural(Math.round(ready.perDay), 'карточка', 'карточки', 'карточек')} в день) всё будет выучено надёжно примерно через ${ready.daysLeft} ${plural(ready.daysLeft, 'день', 'дня', 'дней')}.`}
        </p>
      </section>

      <section className="panel">
        <h2>Знание по предметам и темам</h2>
        {rows.length === 0 && <p className="muted">Карточек в предметах пока нет.</p>}
        <div className="know-list">
          {rows.map((r) => (
            <KnowledgeRow key={r.doc.id} {...r} />
          ))}
        </div>
      </section>
    </div>
  );
}
