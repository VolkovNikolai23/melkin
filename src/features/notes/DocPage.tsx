import { useLiveQuery } from 'dexie-react-hooks';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { db } from '../../db/db';
import type { Doc } from '../../db/schema';
import { navigate } from '../../lib/router';
import { NotebookView } from '../ink/NotebookView';
import { dialog } from '../../components/dialog';
import { openSplit } from '../../lib/splitStore';
import { openAsk } from '../ai/AskDialog';
import { TestsTab } from '../tests/TestsTab';
import { Backlinks } from '../links/LinkViews';
import { docIcon } from './docIcons';
import { createDoc, createFolder, docLabel, renameDoc, restoreDoc, sortDocs } from './docs';
import { LecturePage, useKnowledge } from './LecturePage';
import { Outliner } from './Outliner';

// pdf.js подгружается только при открытии PDF
const PdfView = lazy(() => import('../pdf/PdfView'));

function TitleInput({ doc }: { doc: Doc }) {
  const [title, setTitle] = useState(doc.title);
  useEffect(() => setTitle(doc.title), [doc.id, doc.title]);
  const save = () => {
    const t = title.trim() || 'Без названия';
    if (t !== doc.title) renameDoc(doc.id, t);
    setTitle(t);
  };
  return (
    <input
      className="doc-title"
      value={title}
      aria-label="Название"
      onChange={(e) => setTitle(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function Breadcrumbs({ doc }: { doc: Doc }) {
  const docs = useLiveQuery(() => db.docs.toArray(), []);
  if (!docs) return null;
  const chain: Doc[] = [];
  let p = docs.find((d) => d.id === doc.parentId);
  while (p) {
    chain.unshift(p);
    p = docs.find((d) => d.id === p!.parentId);
  }
  if (!chain.length) return null;
  return (
    <div className="breadcrumbs">
      {chain.map((c) => (
        <button key={c.id} onClick={() => navigate(`doc/${c.id}`)} style={{ color: c.color || undefined }}>
          <Icon name={docIcon(c)} size={14} /> {c.title} /
        </button>
      ))}
    </div>
  );
}

function FolderView({ doc }: { doc: Doc }) {
  const kids = useLiveQuery(() => db.docs.where('parentId').equals(doc.id).filter((d) => !d.deletedAt).toArray(), [doc.id]);
  const knowledge = useKnowledge(doc.id);
  const add = async (type: 'note' | 'notebook' | 'lecture' | 'topic') => {
    if (type === 'topic') {
      const t = await dialog.prompt('Название темы', '');
      if (t !== null) await createFolder('topic', doc.id, t.trim() || undefined);
      return;
    }
    let title: string | undefined;
    if (type === 'lecture') {
      const t = await dialog.prompt('Название лекции', '');
      if (t === null) return;
      title = t.trim() || undefined;
    }
    navigate(`doc/${(await createDoc(type, doc.id, title)).id}`);
  };
  return (
    <div className="folder-view">
      {knowledge && (knowledge.total > 0 || knowledge.tests > 0) && (
        <p className="muted">
          Знание {doc.role === 'subject' ? 'предмета' : doc.role === 'topic' ? 'темы' : 'папки'}: <strong>{knowledge.percent}%</strong>
          {knowledge.total > 0 && ` · выучено ${knowledge.known} из ${knowledge.total}`}
          {knowledge.testPercent !== null && ` · тесты ${knowledge.testPercent}%`}
        </p>
      )}
      <div className="doc-list">
        {(kids ?? []).sort(sortDocs).map((d) => (
          <button key={d.id} className="doc-card" onClick={() => navigate(`doc/${d.id}`)} style={{ color: d.color || undefined }}>
            <Icon name={docIcon(d)} />
            <span>{d.title}</span>
            <small>{docLabel(d)}</small>
          </button>
        ))}
      </div>
      <div className="row-gap">
        {doc.role === 'subject' && (
          <button className="btn primary" onClick={() => add('topic')}>
            <Icon name="folderPlus" /> Новая тема
          </button>
        )}
        {(doc.role === 'subject' || doc.role === 'topic') && (
          <button className={'btn' + (doc.role === 'topic' ? ' primary' : '')} onClick={() => add('lecture')}>
            <Icon name="lecture" /> Новая лекция
          </button>
        )}
        <button className="btn" onClick={() => add('note')}>
          <Icon name="note" /> Заметка
        </button>
        <button className="btn" onClick={() => add('notebook')}>
          <Icon name="notebook" /> Тетрадь
        </button>
      </div>
      {(doc.role === 'topic' || doc.role === 'subject') && (
        <div className="folder-tests">
          <TestsTab doc={doc} />
        </div>
      )}
    </div>
  );
}

const FULL_HEIGHT = new Set(['notebook', 'pdf', 'lecture']);

export function DocPage({ id, highlight, page, ann, inSplit }: { id: string; highlight: string | null; page?: number | null; ann?: string | null; inSplit?: boolean }) {
  // null — документа нет (удалён); undefined — ещё загружается
  const doc = useLiveQuery(() => db.docs.get(id).then((d) => d ?? null), [id]);
  const cardsDue = useLiveQuery(() => db.cards.where('docId').equals(id).count(), [id]);
  if (doc === undefined) return <div className="page-pad muted">Загрузка…</div>;
  if (doc === null) return <div className="page-pad muted">Документ не найден.</div>;

  const reviewScope = doc.type === 'folder' || doc.type === 'lecture' ? 'folder' : 'doc';
  return (
    <div className={'doc-page' + (FULL_HEIGHT.has(doc.type) ? ' is-notebook' : '')}>
      <header className="doc-head">
        <Breadcrumbs doc={doc} />
        <div className="doc-head-row">
          <span className="doc-head-icon" style={{ color: doc.color || undefined }}>
            <Icon name={docIcon(doc)} size={24} />
          </span>
          <TitleInput doc={doc} />
          {(doc.type === 'folder' || doc.type === 'lecture' || (cardsDue ?? 0) > 0) && doc.type !== 'notebook' && (
            <button className="btn small" onClick={() => navigate(`review?scope=${reviewScope}:${doc.id}`)}>
              <Icon name="cards" size={18} /> Повторить
            </button>
          )}
          {doc.type !== 'folder' && (
            <button className="icon-btn" title="Спросить ИИ (можно от руки)" aria-label="Спросить ИИ" onClick={() => openAsk(doc.id)}>
              <Icon name="sparkle" />
            </button>
          )}
          {!inSplit && (
            <button className="icon-btn" title="Открыть рядом (разделить экран)" aria-label="Открыть рядом" onClick={() => openSplit(doc.id)}>
              <Icon name="split" />
            </button>
          )}
        </div>
      </header>
      {doc.deletedAt && (
        <div className="banner warn">
          <Icon name="trash2" />
          <span>Этот документ в корзине.</span>
          <button className="btn small" onClick={() => restoreDoc(doc.id)}>
            <Icon name="restore" size={18} /> Вернуть
          </button>
        </div>
      )}
      {(doc.type === 'note' || doc.type === 'daily') && <Outliner docId={doc.id} highlight={highlight} />}
      {doc.isTemplate && <p className="muted small template-note">Это шаблон: вставляется в другие документы командой /шаблон. Карточки шаблона не повторяются.</p>}
      {(doc.type === 'note' || doc.type === 'daily') && <Backlinks docId={doc.id} />}
      {doc.type === 'notebook' && <NotebookView doc={doc} initialPage={page ?? null} />}
      {doc.type === 'pdf' && (
        <Suspense fallback={<div className="page-pad muted">Открываю PDF…</div>}>
          <PdfView doc={doc} initialPage={page ?? null} flashId={ann ?? null} />
        </Suspense>
      )}
      {doc.type === 'lecture' && <LecturePage lecture={doc} />}
      {doc.type === 'folder' && <FolderView doc={doc} />}
    </div>
  );
}
