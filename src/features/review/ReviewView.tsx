import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { db } from '../../db/db';
import type { CardRow, Stroke } from '../../db/schema';
import { navigate } from '../../lib/router';
import { plural } from '../../lib/time';
import { InkCanvas } from '../ink/InkCanvas';
import { InkToolbar } from '../ink/InkToolbar';
import { CardFace } from './CardFace';
import { answerCard, cardsInScope, logExpress, newLimitLeft, parseScope, undoAnswer, type Answer } from './data';
import {
  afterAnswer,
  afterExpressAnswer,
  buildExpressSession,
  buildSession,
  formatInterval,
  LEARN_AHEAD_MS,
  pickNext,
  previewIntervals,
  Rating,
  sessionCounts,
  type Grade,
  type Session,
} from './scheduler';

interface Step {
  answer: Answer;
  /** Сессия до ответа — для отмены */
  session: Session;
}

/** Нужно ли писать ответ: двусторонние сравнивают сами, в выборе ответа — варианты. */
const needsOwnAnswer = (c: CardRow) => !c.twoSided && c.kind !== 'mcq';

type MyAnswer = { mode: 'text' | 'pen'; text: string; strokes: Stroke[] };
const EMPTY_ANSWER: MyAnswer = { mode: 'text', text: '', strokes: [] };

/** Поле для своего ответа: текстом (или Scribble) либо от руки Pencil. Проверку ИИ добавим на этапе 4. */
function AnswerPad({ value, onChange, onSubmit, readOnly }: { value: MyAnswer; onChange: (v: MyAnswer) => void; onSubmit: () => void; readOnly?: boolean }) {
  if (readOnly) {
    if (!value.text.trim() && !value.strokes.length) return null;
    return (
      <div className="my-answer done">
        <div className="my-answer-label">Ваш ответ</div>
        {value.mode === 'text' ? <p className="my-answer-text">{value.text}</p> : <InkCanvas id="answer-view" width={800} height={240} strokes={value.strokes} readOnly className="answer-ink" />}
      </div>
    );
  }
  return (
    <div className="my-answer">
      <div className="my-answer-head">
        <span className="my-answer-label">Ваш ответ</span>
        <div className="segmented small">
          <button className={value.mode === 'text' ? 'active' : ''} onClick={() => onChange({ ...value, mode: 'text' })}>
            Текстом
          </button>
          <button className={value.mode === 'pen' ? 'active' : ''} onClick={() => onChange({ ...value, mode: 'pen' })}>
            <Icon name="pen" size={16} /> Pencil
          </button>
        </div>
      </div>
      {value.mode === 'text' ? (
        <textarea
          className="text-input answer-text"
          rows={2}
          placeholder="Напишите, что помните (или Pencil — Scribble). Можно и пропустить."
          value={value.text}
          onChange={(e) => onChange({ ...value, text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
      ) : (
        <>
          <InkToolbar />
          <InkCanvas id="answer" width={800} height={240} strokes={value.strokes} onChange={(strokes) => onChange({ ...value, strokes })} className="answer-ink" />
        </>
      )}
    </div>
  );
}

export function ReviewView({ scopeStr, express = false }: { scopeStr: string | null; express?: boolean }) {
  const scope = useMemo(() => parseScope(scopeStr), [scopeStr]);
  const [session, setSession] = useState<Session | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [total, setTotal] = useState(0);
  const [mine, setMine] = useState<MyAnswer>(EMPTY_ANSWER);

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
      const s = express ? buildExpressSession(cards) : buildSession(cards, t, left);
      setSession(s);
      setTotal(s.due.length + s.fresh.length);
      setNow(t);
      setSteps([]);
      setRevealed(false);
      setMine(EMPTY_ANSWER);
    })();
    return () => {
      alive = false;
    };
  }, [scope, express]);

  const current = session ? pickNext(session, now) : null;

  // Карточки, которые вернутся позже (после «не знаю» — через 30 с, после «знаю» — через 15 мин):
  // проверяем снова, когда подойдёт срок
  useEffect(() => {
    if (!session || current || !session.due.length) return;
    const wait = Math.max(500, session.due[0].due - Date.now());
    const t = setTimeout(() => setNow(Date.now()), Math.min(wait, 30_000));
    return () => clearTimeout(t);
  }, [session, current, now]);

  const intervals = useMemo(() => (current && revealed ? previewIntervals(current) : null), [current, revealed]);

  const answer = useCallback(
    async (g: Grade) => {
      if (!current || !session || busy) return;
      setBusy(true);
      try {
        const t = Date.now();
        const a = express ? await logExpress(current, g, t) : await answerCard(current, g, t);
        setSteps((st) => [...st, { answer: a, session }]);
        const next = express ? afterExpressAnswer(session, current, g === Rating.Know, t) : afterAnswer(session, a.updated, t);
        // карточка, вернувшаяся в очередь, увеличивает общий объём сессии
        if (next.due.some((c) => c.id === current.id) && !session.due.some((c) => c.id === current.id)) setTotal((n) => n + 1);
        setSession(next);
        setNow(t);
        setRevealed(false);
        setMine(EMPTY_ANSWER);
      } finally {
        setBusy(false);
      }
    },
    [current, session, busy, express],
  );

  const undo = useCallback(async () => {
    const last = steps.at(-1);
    if (!last || busy) return;
    setBusy(true);
    try {
      await undoAnswer(last.answer);
      setSession(last.session);
      setSteps(steps.slice(0, -1));
      setNow(Date.now());
      setRevealed(true);
    } finally {
      setBusy(false);
    }
  }, [steps, busy]);

  // Клавиатура: пробел/Enter — показать ответ, затем 1 — «не знаю», 2/пробел — «знаю», Z — отменить
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select')) return;
      if (e.key === 'z' || e.key === 'я') {
        e.preventDefault();
        undo();
      } else if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && e.key === '1') answer(Rating.DontKnow);
      else if (revealed && (e.key === '2' || e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        answer(Rating.Know);
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [revealed, answer, undo]);

  if (!session) return <div className="page-pad muted">Загрузка…</div>;
  const counts = sessionCounts(session, now);
  const left = session.due.length + session.fresh.length;
  const progress = total ? Math.min(1, (total - left) / total) : 1;
  const own = current ? needsOwnAnswer(current) : false;

  return (
    <div className="review">
      <header className="review-head">
        <button className="icon-btn" onClick={() => navigate('review')} aria-label="Закрыть">
          <Icon name="close" />
        </button>
        <div className="review-title">
          {scopeTitle}
          {express && <span className="express-badge">экспресс</span>}
        </div>
        <button className="icon-btn" disabled={!steps.length || busy} onClick={undo} aria-label="Отменить последний ответ" title="Отменить ответ (Z)">
          <Icon name="undo" />
        </button>
        <div className="review-counts" title="новые · повторяются после ошибки · к повторению">
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
            {own && <AnswerPad value={mine} onChange={setMine} onSubmit={() => setRevealed(true)} readOnly={revealed} />}
            <button className="btn ghost small to-source" onClick={() => navigate(`doc/${current.docId}?b=${current.blockId}`)}>
              <Icon name="note" size={18} /> Открыть в заметке
            </button>
          </div>
          <footer className="review-foot">
            {!revealed ? (
              <button className="btn primary big" onClick={() => setRevealed(true)}>
                {own && (mine.text.trim() || mine.strokes.length) ? 'Проверить' : 'Показать ответ'}
              </button>
            ) : (
              <div className="grades two">
                <button className="grade grade-no" disabled={busy} onClick={() => answer(Rating.DontKnow)}>
                  <span className="grade-label">Не знаю</span>
                  <span className="grade-int">{express ? 'ещё раз' : intervals ? `через ${formatInterval(intervals[Rating.DontKnow])}` : ''}</span>
                </button>
                <button className="grade grade-yes" disabled={busy} onClick={() => answer(Rating.Know)}>
                  <span className="grade-label">Знаю</span>
                  <span className="grade-int">{express ? 'дальше' : intervals ? `через ${formatInterval(intervals[Rating.Know])}` : ''}</span>
                </button>
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
  const known = steps.filter((s) => s.answer.rating === Rating.Know).length;
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
            <span className="grade-yes">
              <span className="grade-label">Знаю</span> {known}
            </span>
            <span className="grade-no">
              <span className="grade-label">Не знаю</span> {n - known}
            </span>
          </div>
        </>
      )}
      {soon && soon.due - Date.now() < LEARN_AHEAD_MS && (
        <p className="muted">
          Ещё {session.due.length} {plural(session.due.length, 'карточка вернётся', 'карточки вернутся', 'карточек вернутся')} через{' '}
          {formatInterval(Math.max(0, soon.due - Date.now()))} — можно подождать здесь.
        </p>
      )}
      <div className="row-gap">
        {onUndo && (
          <button className="btn" onClick={onUndo}>
            <Icon name="undo" /> Отменить последний ответ
          </button>
        )}
        <button className="btn" onClick={() => navigate('stats')}>
          <Icon name="star" /> Статистика
        </button>
        <button className="btn primary" onClick={() => navigate('')}>
          На главную
        </button>
      </div>
    </div>
  );
}
