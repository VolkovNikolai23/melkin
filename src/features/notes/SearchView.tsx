import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { db } from '../../db/db';
import { navigate } from '../../lib/router';
import { escapeForSnippet } from './render';
import { searchPdfs } from '../pdf/textIndex';

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
    // листы тетрадей: текстовые блоки на листе и распознанный рукописный текст
    const pageHits: { docId: string; page: number; text: string; title: string }[] = [];
    await db.pages.each((p) => {
      if (pageHits.length >= 50 || !live(p.docId)) return;
      const texts = [...(p.items ?? []).map((i) => i.text ?? ''), p.recognizedText ?? ''];
      const t = texts.find((x) => x.toLowerCase().includes(dq));
      if (t) pageHits.push({ docId: p.docId, page: p.order, text: t, title: titles.get(p.docId) ?? '' });
    });
    // номер листа по порядку (order может идти с пропусками после удаления)
    for (const h of pageHits) {
      const orders = (await db.pages.where('docId').equals(h.docId).toArray()).map((p) => p.order).sort((a, b) => a - b);
      h.page = orders.indexOf(h.page) + 1;
    }
    // полный текст PDF и презентаций
    const pdfHits = await searchPdfs(dq, docs);
    return {
      docHits,
      blockHits: blockHits.map((b) => ({ b, title: titles.get(b.docId) ?? '' })),
      annHits: annHits.map((a) => ({ a, title: titles.get(a.docId) ?? '' })),
      pageHits,
      pdfHits,
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
          {res.docHits.length + res.blockHits.length + res.annHits.length + res.pageHits.length + res.pdfHits.length === 0 && <p className="muted">Ничего не найдено.</p>}
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
          {res.pageHits.map((h) => (
            <button key={h.docId + ':' + h.page} className="search-hit" onClick={() => navigate(`doc/${h.docId}?page=${h.page}`)}>
              <span dangerouslySetInnerHTML={{ __html: snippet(h.text, dq) }} />
              <small>
                тетрадь · {h.title}, лист {h.page}
              </small>
            </button>
          ))}
          {res.pdfHits.map((h) => (
            <button key={h.docId + ':' + h.page} className="search-hit" onClick={() => navigate(`doc/${h.docId}?page=${h.page}`)}>
              <span dangerouslySetInnerHTML={{ __html: snippet(h.text.replace(/\s+/g, ' '), dq) }} />
              <small>
                PDF · {h.title}, стр. {h.page}
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
