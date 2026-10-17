import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { dialog } from '../../components/dialog';
import { db } from '../../db/db';
import type { Doc, Page, PageBackground, Stroke } from '../../db/schema';
import { uid } from '../../lib/id';
import { InkCanvas } from './InkCanvas';
import { InkToolbar } from './InkToolbar';

export const PAGE_W = 1000;
export const PAGE_H = 1414; // пропорции A4

const BG_LABEL: Record<PageBackground, string> = { blank: 'Чистый', grid: 'Клетка', lines: 'Линейка' };

function PageView({ page, index, total, zoom, onPinch }: { page: Page; index: number; total: number; zoom: number; onPinch: (r: number) => void }) {
  const onChange = useCallback(
    (strokes: Stroke[]) => {
      const now = Date.now();
      db.pages.update(page.id, { strokes, updatedAt: now });
      db.docs.update(page.docId, { updatedAt: now });
    },
    [page.id, page.docId],
  );

  const remove = async () => {
    if (total <= 1) return;
    if (await dialog.confirm(`Удалить страницу ${index + 1}?`, 'Удалить')) await db.pages.delete(page.id);
  };

  return (
    <div className="nb-page-wrap" style={{ width: `${zoom * 100}%` }}>
      <div className="nb-page-head">
        <span>Стр. {index + 1}</span>
        <select
          value={page.background}
          onChange={(e) => db.pages.update(page.id, { background: e.target.value as PageBackground })}
          aria-label="Фон страницы"
        >
          {(Object.keys(BG_LABEL) as PageBackground[]).map((b) => (
            <option key={b} value={b}>
              {BG_LABEL[b]}
            </option>
          ))}
        </select>
        {total > 1 && (
          <button className="icon-btn small" onClick={remove} aria-label="Удалить страницу">
            <Icon name="trash" size={18} />
          </button>
        )}
      </div>
      <InkCanvas
        id={'page-' + page.id}
        className="nb-page"
        width={PAGE_W}
        height={PAGE_H}
        strokes={page.strokes}
        background={page.background}
        onChange={onChange}
        onPinch={onPinch}
      />
    </div>
  );
}

export function NotebookView({ doc }: { doc: Doc }) {
  const pages = useLiveQuery(() => db.pages.where('docId').equals(doc.id).sortBy('order'), [doc.id]);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);

  const changeZoom = useCallback((z: number) => {
    const v = Math.min(3, Math.max(0.5, z));
    zoomRef.current = v;
    setZoom(v);
  }, []);
  const onPinch = useCallback((r: number) => changeZoom(zoomRef.current * r), [changeZoom]);

  const addPage = async () => {
    const last = pages?.at(-1);
    const now = Date.now();
    await db.pages.add({
      id: uid(),
      docId: doc.id,
      order: (last?.order ?? -1) + 1,
      background: last?.background ?? 'grid',
      strokes: [],
      createdAt: now,
      updatedAt: now,
    });
    requestAnimationFrame(() => document.querySelector('.nb-scroll')?.scrollTo({ top: 1e9, behavior: 'smooth' }));
  };

  if (!pages) return null;
  return (
    <div className="notebook">
      <div className="nb-toolbar">
        <InkToolbar />
        <div className="nb-zoom">
          <button className="tool-btn" onClick={() => changeZoom(zoom / 1.25)} aria-label="Уменьшить">
            <Icon name="zoomOut" />
          </button>
          <button className="tool-btn text" onClick={() => changeZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button className="tool-btn" onClick={() => changeZoom(zoom * 1.25)} aria-label="Увеличить">
            <Icon name="zoomIn" />
          </button>
        </div>
      </div>
      <div className="nb-scroll">
        <div className="nb-pages">
          {pages.map((p, i) => (
            <PageView key={p.id} page={p} index={i} total={pages.length} zoom={zoom} onPinch={onPinch} />
          ))}
          <button className="btn add-page" onClick={addPage}>
            <Icon name="plus" /> Новая страница
          </button>
        </div>
      </div>
    </div>
  );
}
