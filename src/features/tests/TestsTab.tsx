import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { dialog } from '../../components/dialog';
import { db } from '../../db/db';
import type { Doc } from '../../db/schema';
import { navigate } from '../../lib/router';
import { formatDate, plural } from '../../lib/time';
import { aiErrorText, aiReady } from '../ai/client';
import { cleanupFiles } from '../notes/images';
import { createAiTest, createAiTopicTest, createCardTest } from './data';

/** Тесты лекции или темы: список с последним результатом и создание новых. */
export function TestsTab({ doc }: { doc: Doc }) {
  const [busy, setBusy] = useState('');
  const ready = useLiveQuery(aiReady, []);
  const data = useLiveQuery(async () => {
    const tests = (await db.tests.where('docId').equals(doc.id).toArray()).sort((a, b) => b.createdAt - a.createdAt);
    const attempts = await db.testAttempts.where('docId').equals(doc.id).toArray();
    return tests.map((t) => {
      const mine = attempts.filter((a) => a.testId === t.id).sort((a, b) => b.at - a.at);
      return { t, last: mine[0], count: mine.length };
    });
  }, [doc.id]);
  const outline = doc.type === 'lecture' ? (doc.lecture?.outline ?? []) : [];

  const make = async (label: string, fn: () => Promise<{ id: string }>) => {
    setBusy(label);
    try {
      const t = await fn();
      navigate(`test/${t.id}`);
    } catch (e) {
      await dialog.alert('Тест не создан', aiErrorText(e));
    } finally {
      setBusy('');
    }
  };

  const fresh = async () => (await db.docs.get(doc.id))!;

  const bySub = async () => {
    const subs = outline.flatMap((t) => t.subtopics.map((s) => ({ value: s.id, label: `${t.title} → ${s.title}` })));
    if (!subs.length) {
      await dialog.alert('Сначала разбивка', 'Тест по подтеме строится по разбивке лекции — сделайте её на вкладке «Сводки ИИ».');
      return;
    }
    const sub = await dialog.select('Тест по какой подтеме?', subs, subs[0].value);
    if (sub) make('ИИ составляет тест…', async () => createAiTest(await fresh(), sub));
  };

  const remove = async (id: string, title: string) => {
    if (!(await dialog.confirm(`Удалить тест «${title}»?`, 'Удалить', 'Результаты попыток тоже удалятся.'))) return;
    const t = await db.tests.get(id);
    await db.testAttempts.where('testId').equals(id).delete();
    await db.tests.delete(id);
    const files = (t?.questions ?? []).flatMap((q) => ((q.data as { fileId?: string })?.fileId ? [(q.data as { fileId: string }).fileId] : []));
    if (files.length) await cleanupFiles(files);
  };

  return (
    <div className="tests-tab">
      {busy && (
        <div className="ai-status" role="status">
          <span className="spinner" aria-hidden /> {busy}
        </div>
      )}
      <section className="panel">
        <h2>Новый тест</h2>
        <p className="muted small">
          7 типов вопросов: один ответ, несколько правильных, верно/неверно, открытый, сопоставление, подписи на картинке, порядок. После теста — разбор ошибок, а ошибки можно сразу превратить в карточки.
        </p>
        <div className="row-gap">
          <button className="btn primary" disabled={!!busy} onClick={() => make('Собираю тест из карточек…', () => createCardTest(doc))}>
            <Icon name="cards" /> Из карточек {doc.type === 'lecture' ? 'лекции' : 'темы'}
          </button>
          {doc.type === 'folder' && (
            <button className="btn" disabled={!!busy || !ready} onClick={() => make('ИИ составляет тест по теме…', async () => createAiTopicTest(await fresh()))}>
              <Icon name="sparkle" /> ИИ: по всей {doc.role === 'subject' ? 'дисциплине' : 'теме'}
            </button>
          )}
          {doc.type === 'lecture' && (
            <>
              <button className="btn" disabled={!!busy || !ready} onClick={bySub}>
                <Icon name="sparkle" /> ИИ: по подтеме
              </button>
              <button className="btn" disabled={!!busy || !ready} onClick={() => make('ИИ составляет тест по лекции…', async () => createAiTest(await fresh()))}>
                <Icon name="sparkle" /> ИИ: по всей лекции
              </button>
            </>
          )}
        </div>
        {ready === false && <p className="muted small">Тесты от ИИ по материалу появятся, когда вы добавите ключ ИИ в настройках. Тест из карточек работает и без него.</p>}
      </section>

      {data && data.length > 0 && (
        <section className="panel">
          <h2>Тесты</h2>
          <div className="queue-list">
            {data.map(({ t, last, count }) => (
              <div key={t.id} className="queue-row">
                <Icon name={t.source === 'ai' ? 'sparkle' : 'cards'} size={18} />
                <span className="queue-title">
                  {t.title}
                  <small className="muted">
                    {' · '}
                    {t.questions.length} {plural(t.questions.length, 'вопрос', 'вопроса', 'вопросов')}
                    {last ? ` · последний результат ${Math.round(last.score * 100)}% (${formatDate(last.at)})` : ' · ещё не пройден'}
                    {count > 1 ? ` · попыток: ${count}` : ''}
                  </small>
                </span>
                <button className="btn small" onClick={() => navigate(`test/${t.id}`)}>
                  {last ? 'Ещё раз' : 'Пройти'}
                </button>
                <button className="icon-btn small" onClick={() => remove(t.id, t.title)} aria-label="Удалить тест">
                  <Icon name="trash" size={18} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
