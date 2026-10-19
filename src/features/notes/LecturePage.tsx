import { useLiveQuery } from 'dexie-react-hooks';
import { lazy, Suspense } from 'react';
import { Icon } from '../../components/Icon';
import { SplitPane } from '../../components/SplitPane';
import { db } from '../../db/db';
import type { Doc } from '../../db/schema';
import { navigate, useRoute } from '../../lib/router';
import { plural } from '../../lib/time';
import { NotebookView } from '../ink/NotebookView';
import { SummaryTab } from '../ai/SummaryTab';
import { TestsTab } from '../tests/TestsTab';
import { askScan, importSlides, SLIDES_ACCEPT } from '../pdf/importSlides';
import { showBusy } from '../../components/busy';
import { dialog } from '../../components/dialog';
import { knowledgeOf } from '../review/stats';
import { combineKnowledge, latestScores } from '../tests/model';
import { docIcon } from './docIcons';
import { collectSubtree, createDoc, sortDocs } from './docs';
import { pickFiles } from './images';

const PdfView = lazy(() => import('../pdf/PdfView'));

type Tab = 'notes' | 'summary' | 'tests' | 'knowledge';
const TABS: { id: Tab; label: string; icon: 'notebook' | 'sparkle' | 'check' | 'star' }[] = [
  { id: 'notes', label: 'Конспект и презентация', icon: 'notebook' },
  { id: 'summary', label: 'Сводки ИИ', icon: 'sparkle' },
  { id: 'tests', label: 'Тесты', icon: 'check' },
  { id: 'knowledge', label: 'Знание', icon: 'star' },
];

/** Знание лекции/темы: доля выученных карточек во всём поддереве. */
export function useKnowledge(rootId: string) {
  return useLiveQuery(async () => {
    const docs = await db.docs.filter((d) => !d.deletedAt).toArray();
    const ids = collectSubtree(docs, rootId);
    const cards = await db.cards.where('docId').anyOf(ids).toArray();
    const k = knowledgeOf(cards, Date.now());
    // результаты тестов (последняя попытка каждого) тоже влияют на процент знания
    const tests = latestScores(await db.testAttempts.where('docId').anyOf(ids).toArray());
    return { ...k, cardPercent: k.percent, percent: combineKnowledge(k.percent, k.total, tests), tests: tests.length, testPercent: tests.length ? Math.round((tests.reduce((s, x) => s + x, 0) / tests.length) * 100) : null };
  }, [rootId]);
}


function NotesTab({ lecture }: { lecture: Doc }) {
  const notebook = useLiveQuery(() => (lecture.lecture?.notebookId ? db.docs.get(lecture.lecture.notebookId) : undefined), [lecture.lecture?.notebookId]);
  const slides = useLiveQuery(() => (lecture.lecture?.slidesId ? db.docs.get(lecture.lecture.slidesId) : undefined), [lecture.lecture?.slidesId]);

  const ensureNotebook = async () => {
    const nb = await createDoc('notebook', lecture.id, 'Конспект');
    await db.docs.update(lecture.id, { lecture: { ...lecture.lecture, notebookId: nb.id } });
  };
  const uploadSlides = async () => {
    const files = await pickFiles(SLIDES_ACCEPT, true);
    if (!files.length) return;
    const opts = await askScan(files);
    if (!opts) return;
    const done = showBusy('Импортирую презентацию…');
    try {
      const d = await importSlides(files, lecture.id, opts);
      if (d) await db.docs.update(lecture.id, { lecture: { ...lecture.lecture, slidesId: d.id } });
    } catch (e) {
      dialog.alert('Не удалось импортировать', e instanceof Error ? e.message : String(e));
    } finally {
      done();
    }
  };

  const left =
    notebook && !notebook.deletedAt ? (
      <NotebookView doc={notebook} />
    ) : (
      <div className="empty-state">
        <button className="btn primary" onClick={ensureNotebook}>
          <Icon name="notebook" /> Создать конспект
        </button>
      </div>
    );
  const right =
    slides && !slides.deletedAt ? (
      <Suspense fallback={<div className="page-pad muted">Открываю презентацию…</div>}>
        <PdfView doc={slides} initialPage={null} flashId={null} />
      </Suspense>
    ) : (
      <div className="empty-state">
        <div className="empty-icon">
          <Icon name="lecture" size={36} />
        </div>
        <h3>Презентация преподавателя</h3>
        <p className="muted">PDF, PowerPoint (.pptx) или фото слайдов — поверх можно писать Pencil, выделять маркером и делать карточки.</p>
        <button className="btn primary" onClick={uploadSlides}>
          <Icon name="upload" /> Загрузить презентацию
        </button>
      </div>
    );
  return <SplitPane storageKey="lecture" left={left} right={right} />;
}

function KnowledgeTab({ lecture }: { lecture: Doc }) {
  const k = useKnowledge(lecture.id);
  if (!k) return null;
  return (
    <div className="page-pad knowledge">
      <div className="knowledge-ring" style={{ '--p': `${k.percent}%` } as React.CSSProperties}>
        <span>{k.percent}%</span>
      </div>
      <h3>Знание лекции</h3>
      {k.total ? (
        <p className="muted">
          Выучено {k.known} из {k.total} {plural(k.total, 'карточки', 'карточек', 'карточек')}
          {k.due ? ` · к повторению сейчас ${k.due}` : ''}
          {k.fresh ? ` · новых ${k.fresh}` : ''}
        </p>
      ) : (
        <p className="muted">В этой лекции пока нет карточек.</p>
      )}
      {k.testPercent !== null && (
        <p className="muted">
          Тесты: {k.testPercent}% (последние попытки, {k.tests} {plural(k.tests, 'тест', 'теста', 'тестов')}){k.total ? ` · карточки: ${k.cardPercent}% · в итоге карточки весят 70%, тесты 30%` : ''}
        </p>
      )}
      {k.total > 0 && (
        <button className="btn primary" onClick={() => navigate(`review?scope=folder:${lecture.id}`)}>
          <Icon name="cards" /> Повторить лекцию
        </button>
      )}
    </div>
  );
}

/** Лекция: вкладки «Конспект и презентация», «Сводки ИИ», «Тесты», «Знание». */
export function LecturePage({ lecture }: { lecture: Doc }) {
  const route = useRoute();
  const tab = (route.query.get('tab') as Tab) || 'notes';
  const knowledge = useKnowledge(lecture.id);
  const others = useLiveQuery(
    () =>
      db.docs
        .where('parentId')
        .equals(lecture.id)
        .filter((d) => !d.deletedAt && d.id !== lecture.lecture?.notebookId && d.id !== lecture.lecture?.slidesId && d.id !== lecture.lecture?.summaryId)
        .toArray(),
    [lecture.id, lecture.lecture?.notebookId, lecture.lecture?.slidesId, lecture.lecture?.summaryId],
  );

  return (
    <div className="lecture">
      <div className="lecture-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={'lecture-tab' + (tab === t.id ? ' active' : '')}
            onClick={() => navigate(`doc/${lecture.id}?tab=${t.id}`)}
          >
            <Icon name={t.icon} size={18} />
            {t.label}
            {t.id === 'knowledge' && knowledge && (knowledge.total > 0 || knowledge.tests > 0) && <span className="tab-pill">{knowledge.percent}%</span>}
          </button>
        ))}
        {(others ?? []).sort(sortDocs).map((d) => (
          <button key={d.id} className="lecture-tab extra" onClick={() => navigate(`doc/${d.id}`)} title="Другие материалы лекции">
            <Icon name={docIcon(d)} size={16} /> {d.title}
          </button>
        ))}
      </div>
      <div className="lecture-body">
        {tab === 'notes' && <NotesTab lecture={lecture} />}
        {tab === 'summary' && <SummaryTab lecture={lecture} />}
        {tab === 'tests' && (
          <div className="page-pad">
            <TestsTab doc={lecture} />
          </div>
        )}
        {tab === 'knowledge' && <KnowledgeTab lecture={lecture} />}
      </div>
    </div>
  );
}
