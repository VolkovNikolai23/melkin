import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { db } from '../../db/db';
import type { Doc } from '../../db/schema';
import { navigate } from '../../lib/router';
import { NotebookView } from '../ink/NotebookView';
import { createDoc, DOC_LABEL, renameDoc, sortDocs } from './docs';
import { Outliner } from './Outliner';

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
        <button key={c.id} onClick={() => navigate(`doc/${c.id}`)}>
          {c.title} /
        </button>
      ))}
    </div>
  );
}

function FolderView({ doc }: { doc: Doc }) {
  const kids = useLiveQuery(() => db.docs.where('parentId').equals(doc.id).toArray(), [doc.id]);
  const add = async (type: 'note' | 'notebook') => navigate(`doc/${(await createDoc(type, doc.id)).id}`);
  return (
    <div className="folder-view">
      <div className="doc-list">
        {(kids ?? []).sort(sortDocs).map((d) => (
          <button key={d.id} className="doc-card" onClick={() => navigate(`doc/${d.id}`)}>
            <Icon name={d.type === 'folder' ? 'folder' : d.type === 'note' ? 'note' : 'notebook'} />
            <span>{d.title}</span>
            <small>{DOC_LABEL[d.type]}</small>
          </button>
        ))}
      </div>
      <div className="row-gap">
        <button className="btn" onClick={() => add('note')}>
          <Icon name="note" /> Новая заметка
        </button>
        <button className="btn" onClick={() => add('notebook')}>
          <Icon name="notebook" /> Новая тетрадь
        </button>
      </div>
    </div>
  );
}

export function DocPage({ id, highlight }: { id: string; highlight: string | null }) {
  const doc = useLiveQuery(() => db.docs.get(id), [id]);
  const cardsDue = useLiveQuery(() => db.cards.where('docId').equals(id).count(), [id]);
  if (doc === undefined) return <div className="page-pad muted">Загрузка…</div>;
  if (doc === null) return <div className="page-pad muted">Документ не найден.</div>;

  return (
    <div className={'doc-page' + (doc.type === 'notebook' ? ' is-notebook' : '')}>
      <header className="doc-head">
        <Breadcrumbs doc={doc} />
        <div className="doc-head-row">
          <TitleInput doc={doc} />
          {doc.type !== 'notebook' && (cardsDue ?? 0) > 0 && (
            <button className="btn small" onClick={() => navigate(`review?scope=${doc.type === 'folder' ? 'folder' : 'doc'}:${doc.id}`)}>
              <Icon name="cards" size={18} /> Повторить
            </button>
          )}
          {doc.type === 'folder' && (
            <button className="btn small" onClick={() => navigate(`review?scope=folder:${doc.id}`)}>
              <Icon name="cards" size={18} /> Повторить папку
            </button>
          )}
        </div>
      </header>
      {doc.type === 'note' && <Outliner docId={doc.id} highlight={highlight} />}
      {doc.type === 'notebook' && <NotebookView doc={doc} />}
      {doc.type === 'folder' && <FolderView doc={doc} />}
    </div>
  );
}
