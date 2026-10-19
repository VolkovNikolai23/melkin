import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { dialog } from '../../components/dialog';
import { db } from '../../db/db';
import type { Doc, Outline } from '../../db/schema';
import { uid } from '../../lib/id';
import { navigate } from '../../lib/router';
import { plural } from '../../lib/time';
import { Outliner } from '../notes/Outliner';
import { aiErrorText, aiReady } from './client';
import { addCards, draftCards, lectureMaterial, proposeOutline, saveOutline, summarize, type DraftCard, type Material, type SummaryMode } from './lecture';
import { recognizeNotebook } from './recognize';

const parsePages = (s: string) => [...new Set(s.split(/[^\d]+/).map(Number).filter((n) => n > 0))].sort((a, b) => a - b);

function move<T>(list: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Правка разбивки: названия, порядок, страницы, добавить/удалить. */
function OutlineEditor({ value, onChange }: { value: Outline; onChange: (o: Outline) => void }) {
  const setTopic = (i: number, patch: Partial<Outline[number]>) => onChange(value.map((t, k) => (k === i ? { ...t, ...patch } : t)));
  return (
    <div className="outline-editor">
      {value.map((t, i) => (
        <div key={t.id} className="oe-topic">
          <div className="oe-row">
            <span className="oe-num">{i + 1}</span>
            <input className="text-input oe-title" value={t.title} onChange={(e) => setTopic(i, { title: e.target.value })} aria-label="Название темы" />
            <button className="icon-btn small" onClick={() => onChange(move(value, i, -1))} disabled={i === 0} aria-label="Тему выше">
              <Icon name="arrowUp" size={18} />
            </button>
            <button className="icon-btn small" onClick={() => onChange(move(value, i, 1))} disabled={i === value.length - 1} aria-label="Тему ниже">
              <Icon name="arrowDown" size={18} />
            </button>
            <button className="icon-btn small" onClick={() => onChange(value.filter((_, k) => k !== i))} aria-label="Удалить тему">
              <Icon name="trash" size={18} />
            </button>
          </div>
          {t.subtopics.map((s, j) => {
            const setSub = (patch: Partial<typeof s>) => setTopic(i, { subtopics: t.subtopics.map((x, k) => (k === j ? { ...x, ...patch } : x)) });
            return (
              <div key={s.id} className="oe-row oe-sub">
                <input className="text-input oe-title" value={s.title} onChange={(e) => setSub({ title: e.target.value })} aria-label="Название подтемы" />
                <input
                  className="text-input oe-pages"
                  defaultValue={(s.pages ?? []).join(', ')}
                  placeholder="слайды"
                  onBlur={(e) => setSub({ pages: parsePages(e.target.value) })}
                  aria-label="Слайды подтемы"
                  inputMode="numeric"
                />
                <button className="icon-btn small" onClick={() => setTopic(i, { subtopics: move(t.subtopics, j, -1) })} disabled={j === 0} aria-label="Подтему выше">
                  <Icon name="arrowUp" size={18} />
                </button>
                <button className="icon-btn small" onClick={() => setTopic(i, { subtopics: move(t.subtopics, j, 1) })} disabled={j === t.subtopics.length - 1} aria-label="Подтему ниже">
                  <Icon name="arrowDown" size={18} />
                </button>
                <button className="icon-btn small" onClick={() => setTopic(i, { subtopics: t.subtopics.filter((_, k) => k !== j) })} aria-label="Удалить подтему">
                  <Icon name="trash" size={18} />
                </button>
              </div>
            );
          })}
          <button className="btn small ghost oe-add" onClick={() => setTopic(i, { subtopics: [...t.subtopics, { id: uid(), title: 'Новая подтема', pages: [] }] })}>
            <Icon name="plus" size={16} /> Подтема
          </button>
        </div>
      ))}
      <button className="btn small" onClick={() => onChange([...value, { id: uid(), title: 'Новая тема', subtopics: [{ id: uid(), title: 'Подтема', pages: [] }] }])}>
        <Icon name="plus" size={16} /> Тема
      </button>
    </div>
  );
}

const KIND_LABEL: Record<DraftCard['kind'], string> = { term: 'Термин ↔ определение', qa: 'Вопрос → ответ', cloze: 'Пропуск {{…}}', list: 'Перечисление' };

/** Экран одобрения карточек: оставить, изменить, удалить. */
export function CardApproval({ title, cards: initial, onCancel, onAdd }: { title: string; cards: DraftCard[]; onCancel: () => void; onAdd: (c: DraftCard[]) => Promise<void> }) {
  const [cards, setCards] = useState(initial.map((c) => ({ ...c, keep: true, id: uid() })));
  const [busy, setBusy] = useState(false);
  const kept = cards.filter((c) => c.keep);
  const set = (id: string, patch: Partial<DraftCard & { keep: boolean }>) => setCards(cards.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  return (
    <div className="modal-backdrop">
      <div className="modal approve-modal" role="dialog" aria-modal aria-label="Карточки от ИИ">
        <h3>Карточки: {title}</h3>
        <p className="modal-msg">Оставьте нужные, поправьте текст, лишние снимите или удалите.</p>
        <div className="approve-list">
          {cards.map((c) => (
            <div key={c.id} className={'approve-card' + (c.keep ? '' : ' off')}>
              <div className="approve-head">
                <label className="check-row">
                  <input type="checkbox" checked={c.keep} onChange={(e) => set(c.id, { keep: e.target.checked })} /> {KIND_LABEL[c.kind]}
                </label>
                <button className="icon-btn small" onClick={() => setCards(cards.filter((x) => x.id !== c.id))} aria-label="Удалить карточку">
                  <Icon name="trash" size={18} />
                </button>
              </div>
              <textarea className="text-input" rows={2} value={c.front} onChange={(e) => set(c.id, { front: e.target.value })} aria-label="Вопрос" />
              {(c.kind === 'term' || c.kind === 'qa') && <textarea className="text-input" rows={2} value={c.back ?? ''} onChange={(e) => set(c.id, { back: e.target.value })} aria-label="Ответ" />}
              {c.kind === 'list' && (
                <textarea
                  className="text-input"
                  rows={Math.min(8, (c.items ?? []).length + 1)}
                  value={(c.items ?? []).join('\n')}
                  onChange={(e) => set(c.id, { items: e.target.value.split('\n') })}
                  aria-label="Пункты — по одному в строке"
                />
              )}
            </div>
          ))}
          {!cards.length && <p className="muted">Карточек не осталось.</p>}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>
            Отмена
          </button>
          <button
            className="btn primary"
            disabled={!kept.length || busy}
            onClick={async () => {
              setBusy(true);
              await onAdd(kept.map(({ kind, front, back, items }) => ({ kind, front: front.trim(), back: back?.trim(), items: items?.map((x) => x.trim()).filter(Boolean) })));
            }}
          >
            Добавить {kept.length} {plural(kept.length, 'карточку', 'карточки', 'карточек')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Вкладка лекции «Сводки ИИ». */
export function SummaryTab({ lecture }: { lecture: Doc }) {
  const ready = useLiveQuery(aiReady, []);
  const [material, setMaterial] = useState<Material | null>(null);
  const [draft, setDraft] = useState<Outline | null>(null);
  const [mode, setMode] = useState<SummaryMode>('short');
  const [status, setStatus] = useState('');
  const [approve, setApprove] = useState<{ subId: string; title: string; cards: DraftCard[] } | null>(null);
  const outline = lecture.lecture?.outline;
  const summaryId = lecture.lecture?.summaryId;
  const summaryExists = useLiveQuery(async () => {
    const d = summaryId ? await db.docs.get(summaryId) : undefined;
    return !!d && !d.deletedAt;
  }, [summaryId]);

  useEffect(() => {
    lectureMaterial(lecture).then(setMaterial);
  }, [lecture]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setStatus(label);
    try {
      await fn();
    } catch (e) {
      await dialog.alert('Не получилось', aiErrorText(e));
    } finally {
      setStatus('');
    }
  };

  const fresh = async () => (await db.docs.get(lecture.id))!;

  const recognize = () =>
    run('Распознаю конспект…', async () => {
      await recognizeNotebook(lecture.lecture!.notebookId!, (d, t) => setStatus(`Распознаю конспект: ${d} из ${t}`));
      setMaterial(await lectureMaterial(await fresh()));
    });

  const propose = () => run('ИИ делит лекцию на темы…', async () => setDraft(await proposeOutline(await fresh())));

  const save = () =>
    run('Сохраняю разбивку…', async () => {
      const clean = draft!.map((t) => ({ ...t, title: t.title.trim() || 'Тема', subtopics: t.subtopics.filter((s) => s.title.trim()) })).filter((t) => t.subtopics.length);
      const removed = (outline ?? []).flatMap((t) => t.subtopics).filter((s) => !clean.some((t) => t.subtopics.some((x) => x.id === s.id)));
      if (removed.length && !(await dialog.confirm('Удалить подтемы вместе со сводками?', 'Удалить', removed.map((s) => s.title).join(', ')))) return;
      await saveOutline(await fresh(), clean);
      setDraft(null);
    });

  const doSummary = (subId: string) =>
    run('ИИ пишет сводку…', async () => {
      const warn = await summarize(await fresh(), subId, mode, setStatus);
      if (warn.length) await dialog.alert('Сводка готова, но не всё получилось', warn.join('\n'));
    });

  const doAll = () =>
    run('Пишу сводки…', async () => {
      const subs = (outline ?? []).flatMap((t) => t.subtopics);
      for (const [i, s] of subs.entries()) {
        setStatus(`Сводка ${i + 1} из ${subs.length}: ${s.title}`);
        await summarize(await fresh(), s.id, mode);
      }
    });

  const doCards = (subId: string, title: string) =>
    run('ИИ составляет карточки…', async () => {
      const cards = await draftCards(await fresh(), subId);
      if (!cards.length) throw new Error('ИИ не предложил карточек — попробуйте сначала сделать сводку.');
      setApprove({ subId, title, cards });
    });

  if (ready === false)
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <Icon name="sparkle" size={36} />
        </div>
        <h3>Нужен ключ ИИ</h3>
        <p className="muted">Сводки, разбивку на темы и карточки делает ИИ (Gemini бесплатно или Claude). Вставьте ключ в настройках — он хранится только на этом iPad.</p>
        <button className="btn primary" onClick={() => navigate('settings')}>
          <Icon name="settings" /> Открыть настройки
        </button>
      </div>
    );

  const info = material && (
    <p className="muted small">
      Материал: {material.slides.length ? `${material.slides.length} ${plural(material.slides.length, 'слайд', 'слайда', 'слайдов')}` : 'презентации нет'}
      {' · '}
      {material.notes.length ? `${material.notes.length} ${plural(material.notes.length, 'лист', 'листа', 'листов')} конспекта с текстом` : 'текста конспекта нет'}
      {material.unrecognized > 0 && (
        <>
          {' · '}
          не распознано листов: {material.unrecognized}{' '}
          <button className="btn small ghost" disabled={!!status} onClick={recognize}>
            Распознать
          </button>
        </>
      )}
    </p>
  );

  return (
    <div className="page-pad summary-tab">
      {status && (
        <div className="ai-status" role="status">
          <span className="spinner" aria-hidden /> {status}
        </div>
      )}
      {draft ? (
        <section className="panel">
          <h2>Разбивка лекции</h2>
          <p className="muted small">Поправьте названия, порядок и слайды подтем. Сводки и карточки делаются по подтемам.</p>
          <OutlineEditor value={draft} onChange={setDraft} />
          <div className="row-gap oe-actions">
            <button className="btn primary" disabled={!!status || !draft.length} onClick={save}>
              <Icon name="check" /> Сохранить разбивку
            </button>
            <button className="btn" disabled={!!status} onClick={propose}>
              <Icon name="sparkle" /> Предложить заново
            </button>
            <button className="btn ghost" onClick={() => setDraft(null)}>
              Отмена
            </button>
          </div>
        </section>
      ) : !outline?.length ? (
        <div className="empty-state">
          <div className="empty-icon">
            <Icon name="sparkle" size={36} />
          </div>
          <h3>Сводки по лекции</h3>
          <p className="muted">ИИ разделит презентацию и конспект на темы и подтемы — вы поправите разбивку, — а потом напишет по каждой простую цветную сводку и предложит карточки.</p>
          {info}
          <button className="btn primary" disabled={!!status || !material} onClick={propose}>
            <Icon name="sparkle" /> Разбить на темы
          </button>
        </div>
      ) : (
        <>
          <section className="panel ai-controls">
            <div className="ai-controls-row">
              <div className="segmented" role="radiogroup" aria-label="Длина сводки">
                <button className={mode === 'short' ? 'active' : ''} onClick={() => setMode('short')} aria-pressed={mode === 'short'}>
                  Коротко
                </button>
                <button className={mode === 'detailed' ? 'active' : ''} onClick={() => setMode('detailed')} aria-pressed={mode === 'detailed'}>
                  Подробно, как конспект
                </button>
              </div>
              <button className="btn" disabled={!!status} onClick={doAll}>
                <Icon name="sparkle" /> Сводки для всех подтем
              </button>
              <button className="btn ghost" disabled={!!status} onClick={() => setDraft(outline)}>
                <Icon name="edit" /> Изменить разбивку
              </button>
            </div>
            {info}
            <div className="sub-list">
              {outline.map((t) => (
                <div key={t.id} className="sub-topic">
                  <div className="sub-topic-title">{t.title}</div>
                  {t.subtopics.map((s) => (
                    <div key={s.id} className="sub-row">
                      <span className="sub-title">
                        {s.title}
                        {!!s.pages?.length && <small className="muted"> · слайды {s.pages.join(', ')}</small>}
                      </span>
                      <button className="btn small" disabled={!!status} onClick={() => doSummary(s.id)}>
                        <Icon name="sparkle" size={16} /> Сводка
                      </button>
                      <button className="btn small ghost" disabled={!!status} onClick={() => doCards(s.id, s.title)}>
                        <Icon name="cards" size={16} /> Карточки
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
          {summaryId && summaryExists && (
            <section className="summary-doc">
              <Outliner docId={summaryId} highlight={null} />
            </section>
          )}
        </>
      )}
      {approve && (
        <CardApproval
          title={approve.title}
          cards={approve.cards}
          onCancel={() => setApprove(null)}
          onAdd={async (cards) => {
            try {
              await addCards(await fresh(), approve.subId, cards);
            } catch (e) {
              await dialog.alert('Не получилось', aiErrorText(e));
            }
            setApprove(null);
          }}
        />
      )}
    </div>
  );
}
