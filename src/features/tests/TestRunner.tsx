import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { dialog } from '../../components/dialog';
import { useFileUrl } from '../../components/useFileUrl';
import { db } from '../../db/db';
import type { Stroke, TestAttempt, TestRow } from '../../db/schema';
import { navigate } from '../../lib/router';
import { plural } from '../../lib/time';
import { aiErrorText, aiReady } from '../ai/client';
import { renderInk } from '../ai/inkImage';
import { CardApproval } from '../ai/SummaryTab';
import { InkCanvas } from '../ink/InkCanvas';
import { InkToolbar } from '../ink/InkToolbar';
import { renderText } from '../notes/render';
import { addMistakeCards, checkOpen, saveAttempt } from './data';
import { startDrag } from './drag';
import { cheer, confetti } from '../../lib/joy';
import { answerText, correctText, emptyAnswer, grade, isAnswered, KIND_LABEL, mistakeCards, questionsOf, shuffle, type Answer, type Graded, type Question } from './model';

const OPEN_W = 800;
const OPEN_H = 240;

const Rich = ({ text, className }: { text: string; className?: string }) => <span className={className} dangerouslySetInnerHTML={{ __html: renderText(text) }} />;

type Props<A extends Answer> = { q: Question; a: A; onChange: (a: A) => void };

function SingleQ({ q, a, onChange }: Props<Extract<Answer, { kind: 'single' }>>) {
  if (q.data.kind !== 'single') return null;
  return (
    <div className="t-options" role="radiogroup">
      {q.data.options.map((o, i) => (
        <button key={i} role="radio" aria-checked={a.choice === i} className={'t-option' + (a.choice === i ? ' on' : '')} onClick={() => onChange({ ...a, choice: i })}>
          <span className="t-mark radio" aria-hidden />
          <Rich text={o} />
        </button>
      ))}
    </div>
  );
}

function MultipleQ({ q, a, onChange }: Props<Extract<Answer, { kind: 'multiple' }>>) {
  if (q.data.kind !== 'multiple') return null;
  const toggle = (i: number) => onChange({ ...a, choices: a.choices.includes(i) ? a.choices.filter((x) => x !== i) : [...a.choices, i].sort() });
  return (
    <div className="t-options">
      <p className="muted small">Правильных может быть несколько.</p>
      {q.data.options.map((o, i) => (
        <button key={i} role="checkbox" aria-checked={a.choices.includes(i)} className={'t-option' + (a.choices.includes(i) ? ' on' : '')} onClick={() => toggle(i)}>
          <span className="t-mark box" aria-hidden />
          <Rich text={o} />
        </button>
      ))}
    </div>
  );
}

function TrueFalseQ({ a, onChange }: Props<Extract<Answer, { kind: 'truefalse' }>>) {
  return (
    <div className="t-tf">
      {[true, false].map((v) => (
        <button key={String(v)} className={'t-option big' + (a.value === v ? ' on' : '')} aria-pressed={a.value === v} onClick={() => onChange({ ...a, value: v })}>
          {v ? 'Верно' : 'Неверно'}
        </button>
      ))}
    </div>
  );
}

function OpenQ({ q, a, onChange }: Props<Extract<Answer, { kind: 'open' }>>) {
  const [pen, setPen] = useState(!!a.strokes?.length);
  return (
    <div className="t-open">
      <div className="segmented small">
        <button className={!pen ? 'active' : ''} onClick={() => setPen(false)}>
          Текстом
        </button>
        <button className={pen ? 'active' : ''} onClick={() => setPen(true)}>
          <Icon name="pen" size={16} /> Pencil
        </button>
      </div>
      {pen ? (
        <>
          <InkToolbar />
          <InkCanvas key={q.id} id={'test-' + q.id} width={OPEN_W} height={OPEN_H} strokes={(a.strokes as Stroke[]) ?? []} background="lines" onChange={(strokes) => onChange({ ...a, strokes })} className="answer-ink" />
        </>
      ) : (
        <textarea className="text-input" rows={3} placeholder="Ваш ответ (можно писать Pencil — Scribble)" value={a.text} onChange={(e) => onChange({ ...a, text: e.target.value })} />
      )}
    </div>
  );
}

/** Фишки для перетаскивания: касание выбирает, перетаскивание кладёт в ячейку. */
function Chips({ items, selected, onSelect, onDrop }: { items: { key: string; text: string }[]; selected: string | null; onSelect: (k: string | null) => void; onDrop: (key: string, target: string) => void }) {
  return (
    <div className="t-chips">
      {items.map((it) => (
        <button
          key={it.key}
          className={'t-chip' + (selected === it.key ? ' on' : '')}
          onPointerDown={(e) =>
            startDrag(e, {
              label: it.text,
              onTap: () => onSelect(selected === it.key ? null : it.key),
              onDrop: (t) => t && onDrop(it.key, t),
            })
          }
        >
          <Rich text={it.text} />
        </button>
      ))}
      {!items.length && <span className="muted small">Все фишки разложены.</span>}
    </div>
  );
}

function MatchQ({ q, a, onChange }: Props<Extract<Answer, { kind: 'match' }>>) {
  const [sel, setSel] = useState<string | null>(null);
  const d = q.data.kind === 'match' ? q.data : null;
  const order = useMemo(() => (d ? shuffle(d.right.map((_, i) => i)) : []), [d]);
  if (!d) return null;
  const used = new Set(a.pairs.filter((p): p is number => p !== null));
  const put = (right: number, left: number) => onChange({ ...a, pairs: a.pairs.map((p, i) => (i === left ? right : p === right ? null : p)) });
  return (
    <div className="t-match">
      <p className="muted small">Перетащите ответ к нужной строке или коснитесь ответа, а затем строки.</p>
      {d.left.map((l, i) => (
        <div key={i} className="t-match-row">
          <div className="t-match-left">
            <Rich text={l} />
          </div>
          <button
            className={'t-slot' + (a.pairs[i] !== null ? ' filled' : '')}
            data-drop={`l:${i}`}
            onClick={() => {
              if (sel !== null) {
                put(Number(sel), i);
                setSel(null);
              } else if (a.pairs[i] !== null) onChange({ ...a, pairs: a.pairs.map((p, k) => (k === i ? null : p)) });
            }}
          >
            {a.pairs[i] !== null ? <Rich text={d.right[a.pairs[i]!]} /> : <span className="muted">сюда</span>}
          </button>
        </div>
      ))}
      <Chips
        items={order.filter((r) => !used.has(r)).map((r) => ({ key: String(r), text: d.right[r] }))}
        selected={sel}
        onSelect={setSel}
        onDrop={(k, t) => t.startsWith('l:') && put(Number(k), Number(t.slice(2)))}
      />
    </div>
  );
}

function LabelQ({ q, a, onChange }: Props<Extract<Answer, { kind: 'label' }>>) {
  const [sel, setSel] = useState<string | null>(null);
  const d = q.data.kind === 'label' ? q.data : null;
  const url = useFileUrl(d?.fileId);
  const texts = useMemo(() => (d ? shuffle([...new Set(d.areas.map((x) => x.text))]) : []), [d]);
  if (!d) return null;
  const usedTexts = new Set(Object.values(a.assigned));
  const put = (text: string, area: string) => {
    const assigned = Object.fromEntries(Object.entries(a.assigned).filter(([, v]) => v !== text));
    onChange({ ...a, assigned: { ...assigned, [area]: text } });
  };
  return (
    <div className="t-label">
      <div className="t-label-stage">
        {url && <img src={url} alt="" draggable={false} />}
        {d.areas.map((ar, i) => (
          <button
            key={ar.id}
            className={'t-area' + (a.assigned[ar.id] ? ' filled' : '')}
            data-drop={`a:${ar.id}`}
            style={{ left: `${ar.x * 100}%`, top: `${ar.y * 100}%`, width: `${ar.w * 100}%`, height: `${ar.h * 100}%` }}
            onClick={() => {
              if (sel) {
                put(sel, ar.id);
                setSel(null);
              } else if (a.assigned[ar.id]) {
                const { [ar.id]: _, ...rest } = a.assigned;
                onChange({ ...a, assigned: rest });
              }
            }}
            aria-label={`Область ${i + 1}`}
          >
            <span className="t-area-num">{i + 1}</span>
            {a.assigned[ar.id] && <span className="t-area-text">{a.assigned[ar.id]}</span>}
          </button>
        ))}
      </div>
      <Chips items={texts.filter((t) => !usedTexts.has(t)).map((t) => ({ key: t, text: t }))} selected={sel} onSelect={setSel} onDrop={(k, t) => t.startsWith('a:') && put(k, t.slice(2))} />
    </div>
  );
}

function OrderQ({ a, onChange }: Props<Extract<Answer, { kind: 'order' }>>) {
  const listRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= a.order.length) return;
    const o = [...a.order];
    const [x] = o.splice(from, 1);
    o.splice(to, 0, x);
    onChange({ ...a, order: o });
  };
  return (
    <div className="t-order" ref={listRef}>
      <p className="muted small">Тяните за ручку ⋮⋮ или пользуйтесь стрелками.</p>
      {a.order.map((it, i) => (
        <div key={it} className={'t-order-item' + (dragging === i ? ' dragging' : '')} data-index={i}>
          <span
            className="t-handle"
            aria-hidden
            onPointerDown={(e) => {
              e.preventDefault();
              setDragging(i);
              try {
                (e.target as Element).setPointerCapture(e.pointerId);
              } catch {
                /* указатель уже отпущен — тянем без захвата */
              }
            }}
            onPointerMove={(e) => {
              if (dragging === null) return;
              // строка под пальцем — новое место
              const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-index]') ?? [])];
              const to = rows.findIndex((r) => {
                const b = r.getBoundingClientRect();
                return e.clientY >= b.top && e.clientY <= b.bottom;
              });
              if (to >= 0 && to !== dragging) {
                move(dragging, to);
                setDragging(to);
              }
            }}
            onPointerUp={() => setDragging(null)}
            onPointerCancel={() => setDragging(null)}
          >
            ⋮⋮
          </span>
          <span className="t-order-num">{i + 1}</span>
          <Rich text={it} className="t-order-text" />
          <button className="icon-btn small" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label="Выше">
            <Icon name="arrowUp" size={18} />
          </button>
          <button className="icon-btn small" disabled={i === a.order.length - 1} onClick={() => move(i, i + 1)} aria-label="Ниже">
            <Icon name="arrowDown" size={18} />
          </button>
        </div>
      ))}
    </div>
  );
}

function QuestionView({ q, a, onChange }: { q: Question; a: Answer; onChange: (a: Answer) => void }) {
  // у каждого вида вопроса — свой тип ответа; onChange принимает любой из них
  const set = onChange as (a: any) => void;
  switch (a.kind) {
    case 'single':
      return <SingleQ q={q} a={a} onChange={set} />;
    case 'multiple':
      return <MultipleQ q={q} a={a} onChange={set} />;
    case 'truefalse':
      return <TrueFalseQ q={q} a={a} onChange={set} />;
    case 'open':
      return <OpenQ q={q} a={a} onChange={set} />;
    case 'match':
      return <MatchQ q={q} a={a} onChange={set} />;
    case 'label':
      return <LabelQ q={q} a={a} onChange={set} />;
    case 'order':
      return <OrderQ q={q} a={a} onChange={set} />;
  }
}

type Result = Graded & { feedback?: string };

/** Итог: балл, разбор каждой ошибки, самопроверка открытых, ошибки → карточки. */
function Results({ test, questions, answers, results, attempt, onSelf, onRetry }: { test: TestRow; questions: Question[]; answers: Answer[]; results: Result[]; attempt: TestAttempt | null; onSelf: (i: number, ok: boolean) => void; onRetry: () => void }) {
  const [approve, setApprove] = useState(false);
  const total = results.reduce((s, r) => s + r.score, 0);
  const pct = Math.round((total / Math.max(1, results.length)) * 100);
  const wrong = questions.map((q, i) => ({ q, a: answers[i], r: results[i] })).filter((x) => !x.r.correct && !x.r.pending);
  const pending = results.filter((r) => r.pending).length;
  return (
    <div className="t-results">
      <div className="knowledge-ring" style={{ '--p': `${pct}%` } as React.CSSProperties}>
        <span>{pct}%</span>
      </div>
      <h2>
        {results.filter((r) => r.correct).length} из {results.length} верно
      </h2>
      {pending > 0 && <p className="muted">Проверьте сами {pending} {plural(pending, 'открытый ответ', 'открытых ответа', 'открытых ответов')} — ИИ сейчас недоступен.</p>}
      <div className="row-gap">
        {wrong.length > 0 && (
          <button className="btn primary" onClick={() => setApprove(true)}>
            <Icon name="cards" /> Карточки из ошибок ({wrong.length})
          </button>
        )}
        <button className="btn" onClick={onRetry}>
          <Icon name="restore" /> Пройти ещё раз
        </button>
        <button className="btn ghost" onClick={() => navigate(`doc/${test.docId}?tab=tests`)}>
          К тестам
        </button>
      </div>
      <h3 className="section-title">Разбор</h3>
      <div className="t-review">
        {questions.map((q, i) => {
          const r = results[i];
          const state = r.pending ? 'pending' : r.correct ? 'ok' : r.score > 0 ? 'part' : 'bad';
          return (
            <div key={q.id} className={'t-review-item ' + state}>
              <div className="t-review-head">
                <span className="t-review-badge">{state === 'ok' ? '✓' : state === 'pending' ? '?' : state === 'part' ? '½' : '✗'}</span>
                <span className="muted small">
                  {i + 1}. {KIND_LABEL[q.kind]}
                </span>
              </div>
              <Rich text={q.prompt} className="t-review-q" />
              {!r.correct && (
                <>
                  <p className="small">
                    <span className="muted">Ваш ответ:</span> {answerText(q, answers[i])}
                  </p>
                  <p className="small">
                    <span className="muted">Правильно:</span> <Rich text={correctText(q)} />
                  </p>
                </>
              )}
              {r.feedback && <p className="small t-feedback">ИИ: {r.feedback}</p>}
              {!r.correct && q.explanation && (
                <p className="small t-expl">
                  <Rich text={q.explanation} />
                </p>
              )}
              {r.pending && (
                <div className="row-gap">
                  <button className="btn small" onClick={() => onSelf(i, true)}>
                    Я ответила верно
                  </button>
                  <button className="btn small ghost" onClick={() => onSelf(i, false)}>
                    Неверно
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {attempt && <p className="muted small">Результат сохранён и учтён в проценте знания темы.</p>}
      {approve && (
        <CardApproval
          title="ошибки теста"
          cards={wrong.flatMap((w) => mistakeCards(w.q, w.a))}
          onCancel={() => setApprove(false)}
          onAdd={async (cards) => {
            try {
              const doc = await addMistakeCards(test.docId, cards);
              setApprove(false);
              await dialog.alert('Карточки добавлены', `${cards.length} ${plural(cards.length, 'карточка', 'карточки', 'карточек')} — в заметке «${doc.title}». Они уже в повторении.`);
            } catch (e) {
              await dialog.alert('Не получилось', aiErrorText(e));
            }
          }}
        />
      )}
    </div>
  );
}

export function TestRunner({ id }: { id: string }) {
  const test = useLiveQuery(() => db.tests.get(id), [id]);
  const questions = useMemo(() => (test ? questionsOf(test) : []), [test?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [answers, setAnswers] = useState<Answer[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<'answer' | 'checking' | 'results'>('answer');
  const [results, setResults] = useState<Result[]>([]);
  const [attempt, setAttempt] = useState<TestAttempt | null>(null);

  useEffect(() => {
    if (questions.length && !answers) setAnswers(questions.map((q) => emptyAnswer(q)));
  }, [questions, answers]);

  if (test === undefined || !answers) return <div className="page-pad muted">{test === undefined ? 'Загрузка…' : 'Тест пуст.'}</div>;
  if (!test) return <div className="page-pad muted">Тест не найден.</div>;

  const q = questions[idx];
  const answered = answers.filter(isAnswered).length;

  const finish = async () => {
    const unanswered = questions.length - answered;
    if (unanswered && !(await dialog.confirm(`Без ответа: ${unanswered}. Завершить тест?`, 'Завершить'))) return;
    setPhase('checking');
    const res: Result[] = questions.map((x, i) => grade(x, answers[i]));
    // открытые ответы проверяет ИИ (если есть ключ и сеть), иначе — самопроверка
    if (res.some((r) => r.pending) && (await aiReady())) {
      for (const [i, r] of res.entries()) {
        if (!r.pending) continue;
        const a = answers[i];
        if (a.kind !== 'open') continue;
        try {
          let image: Blob | undefined;
          if (a.strokes?.length && !a.text.trim()) {
            const c = await renderInk({ width: OPEN_W, height: OPEN_H, strokes: a.strokes as Stroke[] }, undefined, 1000);
            image = await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('toBlob'))), 'image/jpeg', 0.85));
          }
          const v = await checkOpen(questions[i], a.text, image);
          res[i] = { score: v.verdict === 'correct' ? 1 : v.verdict === 'partial' ? 0.5 : 0, correct: v.verdict === 'correct', feedback: v.feedback };
        } catch {
          /* остаётся на самопроверку */
        }
      }
    }
    setResults(res);
    setAttempt(await saveAttempt(test, res.map((r, i) => ({ questionId: questions[i].id, correct: r.correct, score: r.pending ? 0 : r.score, answer: answers[i], feedback: r.feedback }))));
    setPhase('results');
    const pct = res.reduce((s, r) => s + r.score, 0) / Math.max(1, res.length);
    if (pct >= 0.999) {
      confetti(2);
      cheer('Идеально! Все ответы верны 🎉');
    } else if (pct >= 0.8) {
      confetti(1);
      cheer('Отличный результат!');
    }
  };

  const selfGrade = async (i: number, ok: boolean) => {
    const res = results.map((r, k) => (k === i ? { ...r, pending: false, correct: ok, score: ok ? 1 : 0 } : r));
    setResults(res);
    if (attempt) {
      const ans = attempt.answers.map((x, k) => (k === i ? { ...x, correct: ok, score: ok ? 1 : 0 } : x));
      const score = ans.reduce((s, x) => s + (x.score ?? 0), 0) / ans.length;
      await db.testAttempts.update(attempt.id, { answers: ans, score });
      setAttempt({ ...attempt, answers: ans, score });
    }
  };

  const retry = () => {
    setAnswers(questions.map((x) => emptyAnswer(x)));
    setResults([]);
    setAttempt(null);
    setIdx(0);
    setPhase('answer');
  };

  return (
    <div className="test-runner">
      <header className="review-head">
        <button className="icon-btn" onClick={() => navigate(`doc/${test.docId}?tab=tests`)} aria-label="Закрыть">
          <Icon name="close" />
        </button>
        <div className="review-title">{test.title}</div>
        {phase === 'answer' && (
          <span className="muted small">
            {answered} / {questions.length}
          </span>
        )}
      </header>
      {phase === 'answer' && (
        <div className="review-progress" aria-hidden>
          <span style={{ width: `${((idx + 1) / questions.length) * 100}%` }} />
        </div>
      )}
      <div className="t-body">
        {phase === 'results' ? (
          <Results test={test} questions={questions} answers={answers} results={results} attempt={attempt} onSelf={selfGrade} onRetry={retry} />
        ) : phase === 'checking' ? (
          <p className="muted ai-thinking">
            <span className="spinner" aria-hidden /> Проверяю ответы…
          </p>
        ) : (
          <>
            <div className="t-dots" role="tablist" aria-label="Вопросы">
              {questions.map((x, i) => (
                <button key={x.id} className={'t-dot' + (i === idx ? ' cur' : '') + (isAnswered(answers[i]) ? ' done' : '')} onClick={() => setIdx(i)} aria-label={`Вопрос ${i + 1}`} />
              ))}
            </div>
            <div className="t-kind muted small">
              {idx + 1}. {KIND_LABEL[q.kind]}
            </div>
            <h2 className="t-prompt">
              <Rich text={q.prompt} />
            </h2>
            <QuestionView key={q.id} q={q} a={answers[idx]} onChange={(a) => setAnswers(answers.map((x, i) => (i === idx ? a : x)))} />
          </>
        )}
      </div>
      {phase === 'answer' && (
        <footer className="review-foot t-foot">
          <button className="btn" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>
            Назад
          </button>
          {idx < questions.length - 1 ? (
            <button className="btn primary big" onClick={() => setIdx(idx + 1)}>
              Далее
            </button>
          ) : (
            <button className="btn primary big" onClick={finish}>
              Завершить тест
            </button>
          )}
        </footer>
      )}
    </div>
  );
}
