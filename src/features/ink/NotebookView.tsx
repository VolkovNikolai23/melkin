import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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

/** Страница рисуется, только когда она близко к экрану: длинные тетради не тормозят. */
function useNearViewport(root: HTMLElement | null, initial: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  // первые страницы видны сразу, не дожидаясь наблюдателя
  const [near, setNear] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el || !root || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { root, rootMargin: '1200px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);
  return [ref, near] as const;
}

function PageView({
  page,
  index,
  total,
  zoom,
  root,
  onPinch,
}: {
  page: Page;
  index: number;
  total: number;
  zoom: number;
  root: HTMLElement | null;
  onPinch: (r: number) => void;
}) {
  const [ref, near] = useNearViewport(root, index < 3);
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
    const msg = page.strokes.length ? `На странице ${page.strokes.length} штрихов.` : undefined;
    if (await dialog.confirm(`Удалить страницу ${index + 1}?`, 'Удалить', msg)) await db.pages.delete(page.id);
  };

  return (
    <div ref={ref} className="nb-page-wrap" data-page={index} style={{ width: `${zoom * 100}%` }}>
      <div className="nb-page-head">
        <span>
          Стр. {index + 1} из {total}
        </span>
        <select value={page.background} onChange={(e) => db.pages.update(page.id, { background: e.target.value as PageBackground })} aria-label="Фон страницы">
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
      {near ? (
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
      ) : (
        <div className="nb-page nb-page-placeholder" style={{ aspectRatio: `${PAGE_W} / ${PAGE_H}` }} />
      )}
    </div>
  );
}

export function NotebookView({ doc }: { doc: Doc }) {
  const pages = useLiveQuery(() => db.pages.where('docId').equals(doc.id).sortBy('order'), [doc.id]);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const anchor = useRef<{ cx: number; cy: number } | null>(null);
  const [current, setCurrent] = useState(0);

  // Масштаб меняется вокруг центра экрана: запоминаем точку и возвращаем её на место
  const changeZoom = useCallback(
    (z: number) => {
      const v = Math.min(3, Math.max(0.5, z));
      if (Math.abs(v - zoomRef.current) < 0.001) return;
      if (scroller) {
        anchor.current = {
          cx: (scroller.scrollLeft + scroller.clientWidth / 2) / scroller.scrollWidth,
          cy: (scroller.scrollTop + scroller.clientHeight / 2) / scroller.scrollHeight,
        };
      }
      zoomRef.current = v;
      setZoom(v);
    },
    [scroller],
  );
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a || !scroller) return;
    anchor.current = null;
    scroller.scrollLeft = a.cx * scroller.scrollWidth - scroller.clientWidth / 2;
    scroller.scrollTop = a.cy * scroller.scrollHeight - scroller.clientHeight / 2;
  }, [zoom, scroller]);
  const onPinch = useCallback((r: number) => changeZoom(zoomRef.current * r), [changeZoom]);

  // Щипок на трекпаде Mac приходит как wheel с ctrlKey. Слушатель не пассивный,
  // иначе браузер масштабирует всю страницу вместо тетради.
  useEffect(() => {
    if (!scroller) return;
    const on = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      changeZoom(zoomRef.current * Math.exp(-e.deltaY / 200));
    };
    scroller.addEventListener('wheel', on, { passive: false });
    return () => scroller.removeEventListener('wheel', on);
  }, [scroller, changeZoom]);

  // Номер текущей страницы — по середине экрана
  useEffect(() => {
    if (!scroller) return;
    const on = () => {
      const mid = scroller.getBoundingClientRect().top + scroller.clientHeight / 2;
      let best = 0;
      scroller.querySelectorAll<HTMLElement>('[data-page]').forEach((el) => {
        if (el.getBoundingClientRect().top <= mid) best = Number(el.dataset.page);
      });
      setCurrent(best);
    };
    on();
    scroller.addEventListener('scroll', on, { passive: true });
    return () => scroller.removeEventListener('scroll', on);
  }, [scroller, pages?.length]);

  const goTo = (i: number) => {
    const el = scroller?.querySelector<HTMLElement>(`[data-page="${i}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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
    requestAnimationFrame(() => scroller?.scrollTo({ top: 1e9, behavior: 'smooth' }));
  };

  if (!pages) return null;
  return (
    <div className="notebook">
      <div className="nb-toolbar">
        <InkToolbar />
        <div className="nb-zoom">
          <button className="tool-btn" disabled={current <= 0} onClick={() => goTo(current - 1)} aria-label="Предыдущая страница">
            <Icon name="arrowUp" />
          </button>
          <span className="nb-pagenum">
            {current + 1} / {pages.length}
          </span>
          <button className="tool-btn" disabled={current >= pages.length - 1} onClick={() => goTo(current + 1)} aria-label="Следующая страница">
            <Icon name="arrowDown" />
          </button>
          <span className="tb-sep" />
          <button className="tool-btn" onClick={() => changeZoom(zoom / 1.25)} aria-label="Уменьшить">
            <Icon name="zoomOut" />
          </button>
          <button className="tool-btn text" onClick={() => changeZoom(1)} title="Масштаб по ширине">
            {Math.round(zoom * 100)}%
          </button>
          <button className="tool-btn" onClick={() => changeZoom(zoom * 1.25)} aria-label="Увеличить">
            <Icon name="zoomIn" />
          </button>
        </div>
      </div>
      <div ref={setScroller} className="nb-scroll">
        <div className="nb-pages">
          {pages.map((p, i) => (
            <PageView key={p.id} page={p} index={i} total={pages.length} zoom={zoom} root={scroller} onPinch={onPinch} />
          ))}
          <button className="btn add-page" onClick={addPage}>
            <Icon name="plus" /> Новая страница
          </button>
        </div>
      </div>
    </div>
  );
}
