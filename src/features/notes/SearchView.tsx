import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { db } from '../../db/db';
import { navigate } from '../../lib/router';
import { escapeForSnippet } from './render';

function snippet(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q);
  const start = Math.max(0, i - 50);
  const end = Math.min(text.length, i + q.length + 80);
  const pre = (start > 0 ? '…' : '') + text.slice(start, i);
  const post = text.slice(i + q.length, end) + (end < text.length ? '…' : '');
  return escapeForSnippet(pre) + '<mark>' + escapeForSnippet(text.slice(i, i + q.length)) + '</mark>' + escapeForSnippet(post);
}

export function SearchView({ initial }: { initial: string }) {
  const [q, setQ] = useState(initial);
  const [dq, setDq] = useState(initial);
  useEffect(() => setQ(initial), [initial]);
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const res = useLiveQuery(async () => {
    if (!dq) return null;
    const docs = await db.docs.filter((d) => !d.deletedAt).toArray();
    const titles = new Map(docs.map((d) => [d.id, d.title]));
    const live = (docId: string) => titles.has(docId);
    const docHits = docs.filter((d) => d.title.toLowerCase().includes(dq)).slice(0, 20);
    // ищем и в распознанном рукописном тексте (заполняется на этапе ИИ)
    const blockHits = await db.blocks
      .filter((b) => live(b.docId) && ((b.kind === 'text' && b.text.toLowerCase().includes(dq)) || !!b.recognizedText?.toLowerCase().includes(dq)))
      .limit(200)
      .toArray();
    // выделения в PDF тоже ищутся
    const annHits = await db.annotations.filter((a) => live(a.docId) && a.kind === 'highlight' && !!a.text && a.text.toLowerCase().includes(dq)).limit(50).toArray();
    return {
      docHits,
      blockHits: blockHits.map((b) => ({ b, title: titles.get(b.docId) ?? '' })),
      annHits: annHits.map((a) => ({ a, title: titles.get(a.docId) ?? '' })),
    };
  }, [dq]);

  return (
    <div className="page-pad search-view">
      <div className="search-box">
        <Icon name="search" />
        <input autoFocus type="search" placeholder="Что ищем?" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" />
      </div>
      {res && (
        <div className="search-results">
          {res.docHits.length === 0 && res.blockHits.length === 0 && res.annHits.length === 0 && <p className="muted">Ничего не найдено.</p>}
          {res.docHits.map((d) => (
            <button key={d.id} className="search-hit" onClick={() => navigate(`doc/${d.id}`)}>
              <strong>{d.title}</strong>
              <small>документ</small>
            </button>
          ))}
          {res.annHits.map(({ a, title }) => (
            <button key={a.id} className="search-hit" onClick={() => navigate(`doc/${a.docId}?page=${a.page}&a=${a.id}`)}>
              <span dangerouslySetInnerHTML={{ __html: snippet(a.text!, dq) }} />
              <small>
                выделение в PDF · {title}, стр. {a.page}
              </small>
            </button>
          ))}
          {res.blockHits.map(({ b, title }) => (
            <button key={b.id} className="search-hit" onClick={() => navigate(`doc/${b.docId}?b=${b.id}`)}>
              <span dangerouslySetInnerHTML={{ __html: snippet(b.text.toLowerCase().includes(dq) ? b.text : (b.recognizedText ?? ''), dq) }} />
              <small>{title}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
