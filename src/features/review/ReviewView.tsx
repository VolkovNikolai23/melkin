import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { db } from '../../db/db';
import { navigate } from '../../lib/router';
import { plural } from '../../lib/time';
import { CardFace } from './CardFace';
import { answerCard, cardsInScope, newLimitLeft, parseScope } from './data';
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

export function ReviewView({ scopeStr }: { scopeStr: string | null }) {
  const scope = useMemo(() => parseScope(scopeStr), [scopeStr]);
  const [session, setSession] = useState<Session | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [answered, setAnswered] = useState(0);
  const [busy, setBusy] = useState(false);

  const scopeTitle = useLiveQuery(
    async () => (scope.kind === 'all' ? 'Все карточки' : scope.kind === 'tag' ? '#' + scope.id : (await db.docs.get(scope.id))?.title ?? ''),
    [scopeStr],
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      const [cards, left] = await Promise.all([cardsInScope(scope), newLimitLeft()]);
      const t = Date.now();
      if (alive) {
        setSession(buildSession(cards, t, left));
        setNow(t);
        setAnswered(0);
        setRevealed(false);
      }
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
        const updated = await answerCard(current, g);
        const t = Date.now();
        setSession(afterAnswer(session, updated, t));
        setNow(t);
        setRevealed(false);
        setAnswered((n) => n + 1);
      } finally {
        setBusy(false);
      }
    },
    [current, session, busy],
  );

  // Клавиатура: пробел/Enter — показать ответ, 1–4 — оценка
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select')) return;
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
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
  }, [revealed, answer]);

  if (!session) return <div className="page-pad muted">Загрузка…</div>;
  const counts = sessionCounts(session, now);

  return (
    <div className="review">
      <header className="review-head">
        <button className="icon-btn" onClick={() => history.back()} aria-label="Назад">
          <Icon name="close" />
        </button>
        <div className="review-title">{scopeTitle}</div>
        <div className="review-counts" title="новые · изучаются · повторение">
          <span className="c-new">{counts.fresh}</span>
          <span className="c-learn">{counts.learning}</span>
          <span className="c-review">{counts.review}</span>
        </div>
      </header>

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
        <div className="review-done">
          <div className="done-heart">
            <Icon name="heart" size={48} />
          </div>
          <h2>{answered ? 'На сегодня всё!' : 'Сейчас повторять нечего'}</h2>
          {answered > 0 && (
            <p className="muted">
              {answered} {plural(answered, 'ответ', 'ответа', 'ответов')} за эту сессию.
            </p>
          )}
          {session.due.length > 0 && <p className="muted">Ещё {session.due.length} в изучении — вернутся через несколько минут.</p>}
          <button className="btn" onClick={() => navigate('')}>
            На главную
          </button>
        </div>
      )}
    </div>
  );
}
