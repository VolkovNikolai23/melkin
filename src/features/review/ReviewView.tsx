import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { db } from '../../db/db';
import { navigate } from '../../lib/router';
import { plural } from '../../lib/time';
import { CardFace } from './CardFace';
import { answerCard, cardsInScope, newLimitLeft, parseScope, undoAnswer, type Answer } from './data';
import {
  afterAnswer,
  buildSession,
  formatInterval,
  GRADES,
  LEARN_AHEAD_MS,
  pickNext,
  previewIntervals,
  sessionCounts,
  type Grade,
  type Session,
} from './scheduler';

interface Step {
  answer: Answer;
  /** Сессия до ответа — для отмены */
  session: Session;
}

export function ReviewView({ scopeStr }: { scopeStr: string | null }) {
  const scope = useMemo(() => parseScope(scopeStr), [scopeStr]);
  const [session, setSession] = useState<Session | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [total, setTotal] = useState(0);

  const scopeTitle = useLiveQuery(
    async () => (scope.kind === 'all' ? 'Все карточки' : scope.kind === 'tag' ? '#' + scope.id : ((await db.docs.get(scope.id))?.title ?? '')),
    [scopeStr],
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      const [cards, left] = await Promise.all([cardsInScope(scope), newLimitLeft()]);
      const t = Date.now();
      if (!alive) return;
      const s = buildSession(cards, t, left);
      setSession(s);
      setTotal(s.due.length + s.fresh.length);
      setNow(t);
      setSteps([]);
      setRevealed(false);
    })();
    return () => {
      alive = false;
    };
  }, [scope]);

  const current = session ? pickNext(session, now) : null;

  // Если остались только «будущие» карточки изучения — проверим снова, когда подойдёт срок.
  useEffect(() => {
    if (!session || current || !session.due.length) return;
    const wait = Math.max(1000, session.due[0].due - LEARN_AHEAD_MS - Date.now());
    const t = setTimeout(() => setNow(Date.now()), Math.min(wait, 60_000));
    return () => clearTimeout(t);
  }, [session, current]);

  const intervals = useMemo(() => (current && revealed ? previewIntervals(current, Date.now()) : null), [current, revealed]);

  const answer = useCallback(
    async (g: Grade) => {
      if (!current || !session || busy) return;
      setBusy(true);
      try {
        const a = await answerCard(current, g);
        const t = Date.now();
        setSteps((st) => [...st, { answer: a, session }]);
        // карточка, вернувшаяся в очередь («Снова»), увеличивает общий объём сессии
        const next = afterAnswer(session, a.updated, t);
        if (next.due.some((c) => c.id === a.updated.id)) setTotal((n) => n + 1);
        setSession(next);
        setNow(t);
        setRevealed(false);
      } finally {
        setBusy(false);
      }
    },
    [current, session, busy],
  );

  const undo = useCallback(async () => {
    const last = steps.at(-1);
    if (!last || busy) return;
    setBusy(true);
    try {
      await undoAnswer(last.answer);
      const restored = last.session;
      // если карточка возвращалась в очередь, общий объём сессии уменьшаем обратно
      if (afterAnswer(restored, last.answer.updated, Date.now()).due.some((c) => c.id === last.answer.updated.id)) setTotal((n) => n - 1);
      setSession(restored);
      setSteps(steps.slice(0, -1));
      setNow(Date.now());
      setRevealed(true);
    } finally {
      setBusy(false);
    }
  }, [steps, busy]);

  // Клавиатура: пробел/Enter — показать ответ, 1–4 — оценка, ⌘Z / Z — отменить ответ
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select')) return;
      if ((e.key === 'z' || e.key === 'я') && (e.metaKey || e.ctrlKey || !e.altKey)) {
        e.preventDefault();
        undo();
      } else if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) answer(Number(e.key) as Grade);
      else if (revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        answer(3 as Grade);
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [revealed, answer, undo]);

  if (!session) return <div className="page-pad muted">Загрузка…</div>;
  const counts = sessionCounts(session, now);
  const left = session.due.length + session.fresh.length;
  const progress = total ? Math.min(1, (total - left) / total) : 1;

  return (
    <div className="review">
      <header className="review-head">
        <button className="icon-btn" onClick={() => navigate('review')} aria-label="Закрыть">
          <Icon name="close" />
        </button>
        <div className="review-title">{scopeTitle}</div>
        <button className="icon-btn" disabled={!steps.length || busy} onClick={undo} aria-label="Отменить последний ответ" title="Отменить ответ (Z)">
          <Icon name="undo" />
        </button>
        <div className="review-counts" title="новые · изучаются · повторение">
          <span className="c-new">{counts.fresh}</span>
          <span className="c-learn">{counts.learning}</span>
          <span className="c-review">{counts.review}</span>
        </div>
      </header>
      <div className="review-progress" aria-hidden>
        <span style={{ width: `${progress * 100}%` }} />
      </div>

      {current ? (
        <>
          <div className="review-body">
            <CardFace key={current.id + ':' + current.reps} card={current} revealed={revealed} onReveal={() => setRevealed(true)} />
            <button className="btn ghost small to-source" onClick={() => navigate(`doc/${current.docId}?b=${current.blockId}`)}>
              <Icon name="note" size={18} /> Открыть в заметке
            </button>
          </div>
          <footer className="review-foot">
            {!revealed ? (
              <button className="btn primary big" onClick={() => setRevealed(true)}>
                Показать ответ
              </button>
            ) : (
              <div className="grades">
                {GRADES.map((g) => (
                  <button key={g.rating} className={`grade grade-${g.rating}`} disabled={busy} onClick={() => answer(g.rating)}>
                    <span className="grade-label">{g.label}</span>
                    <span className="grade-int">{intervals ? formatInterval(intervals[g.rating]) : ''}</span>
                  </button>
                ))}
              </div>
            )}
          </footer>
        </>
      ) : (
        <SessionDone steps={steps} session={session} onUndo={steps.length ? undo : undefined} />
      )}
    </div>
  );
}

function SessionDone({ steps, session, onUndo }: { steps: Step[]; session: Session; onUndo?: () => void }) {
  const byRating = [1, 2, 3, 4].map((r) => steps.filter((s) => s.answer.rating === r).length);
  const n = steps.length;
  const soon = session.due[0];
  return (
    <div className="review-done">
      <div className="done-heart">
        <Icon name="heart" size={48} />
      </div>
      <h2>{n ? 'На сегодня всё!' : 'Сейчас повторять нечего'}</h2>
      {n > 0 && (
        <>
          <p className="muted">
            {n} {plural(n, 'ответ', 'ответа', 'ответов')} за эту сессию
          </p>
          <div className="done-stats">
            {GRADES.map((g, i) => (
              <span key={g.rating} className={`grade-${g.rating}`}>
                <span className="grade-label">{g.label}</span> {byRating[i]}
              </span>
            ))}
          </div>
        </>
      )}
      {soon && (
        <p className="muted">
          Ещё {session.due.length} в изучении — вернутся через {formatInterval(Math.max(0, soon.due - Date.now()))}.
        </p>
      )}
      <div className="row-gap">
        {onUndo && (
          <button className="btn" onClick={onUndo}>
            <Icon name="undo" /> Отменить последний ответ
          </button>
        )}
        <button className="btn" onClick={() => navigate('review')}>
          Другие очереди
        </button>
        <button className="btn primary" onClick={() => navigate('')}>
          На главную
        </button>
      </div>
    </div>
  );
}
