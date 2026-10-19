import { useLiveQuery } from 'dexie-react-hooks';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { dialog } from '../../components/dialog';
import { db } from '../../db/db';
import { deliverFile } from '../../db/backup';
import type { Annotation, Block, Doc, Rect } from '../../db/schema';
import { uid } from '../../lib/id';
import { navigate } from '../../lib/router';
import { OcclusionEditor } from '../cards/OcclusionEditor';
import { InkToolbar } from '../ink/InkToolbar';
import { addHighlight, clipToBlock, createTargetNote, getTargetNote, highlightToBlock, setTargetNote } from './annotations';
import { exportAnnotatedPdf } from './exportPdf';
import { findInPages, HIGHLIGHT_HEX, selectionRects, type TextHit } from './geometry';
import { PdfPage, PdfThumb, renderClip, type PdfTool } from './PdfPage';
import { loadPdf, pdfText } from './pdfjs';

const COLORS = Object.keys(HIGHLIGHT_HEX);

type Popover =
  | { kind: 'selection'; page: number; rects: Rect[]; text: string; x: number; y: number }
  | { kind: 'highlight'; ann: Annotation; x: number; y: number }
  | { kind: 'region'; page: number; rect: Rect; x: number; y: number };

export default function PdfView({ doc, initialPage, flashId }: { doc: Doc; initialPage: number | null; flashId: string | null }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<[number, number][]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [thumbsEl, setThumbsEl] = useState<HTMLDivElement | null>(null);
  const [fitWidth, setFitWidth] = useState(800);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const anchor = useRef<{ cx: number; cy: number } | null>(null);
  const [tool, setTool] = useState<PdfTool>('text');
  const [current, setCurrent] = useState(1);
  const [thumbs, setThumbs] = useState(() => window.innerWidth > 1000);
  const [pptxHint, setPptxHint] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<TextHit[] | null>(null);
  const [activeQuery, setActiveQuery] = useState('');
  const [pop, setPop] = useState<Popover | null>(null);
  const [occBlock, setOccBlock] = useState<Block | null>(null);
  const [flash, setFlash] = useState<string | null>(flashId);
  const annotations = useLiveQuery(() => db.annotations.where('docId').equals(doc.id).toArray(), [doc.id]);
  const targetId = useLiveQuery(() => getTargetNote(doc), [doc.id]);
  const target = useLiveQuery(() => (targetId ? db.docs.get(targetId) : undefined), [targetId]);

  // Загрузка документа и размеров страниц
  useEffect(() => {
    let alive = true;
    setPdf(null);
    setError(null);
    (async () => {
      try {
        const p = await loadPdf(doc.fileId!);
        const s: [number, number][] = [];
        for (let i = 1; i <= p.numPages; i++) {
          const v = (await p.getPage(i)).getViewport({ scale: 1 });
          s.push([v.width, v.height]);
        }
        if (!alive) return;
        setSizes(s);
        setPdf(p);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [doc.fileId]);

  // Ширина «по ширине окна»
  useEffect(() => {
    if (!scroller) return;
    const ro = new ResizeObserver(() => setFitWidth(Math.max(280, Math.min(1100, scroller.clientWidth - 32))));
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [scroller]);

  const goTo = useCallback(
    (n: number, smooth = true) => {
      // прокручиваем только список страниц (scrollIntoView сдвинул бы и внешние контейнеры)
      const el = scroller?.querySelector<HTMLElement>(`[data-pdf-page="${n}"]`);
      if (!scroller || !el) return;
      const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12;
      scroller.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
    },
    [scroller],
  );

  // Переход к странице из ссылки (pdfRef в конспекте)
  useEffect(() => {
    if (pdf && initialPage) requestAnimationFrame(() => goTo(initialPage, false));
  }, [pdf, initialPage, goTo]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  // Масштаб вокруг центра экрана
  const changeZoom = useCallback(
    (z: number) => {
      const v = Math.min(4, Math.max(0.4, z));
      if (Math.abs(v - zoomRef.current) < 0.001) return;
      if (scroller)
        anchor.current = {
          cx: (scroller.scrollLeft + scroller.clientWidth / 2) / scroller.scrollWidth,
          cy: (scroller.scrollTop + scroller.clientHeight / 2) / scroller.scrollHeight,
        };
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

  // Щипок: трекпад (ctrl+wheel) и два пальца в режиме текста
  useEffect(() => {
    if (!scroller) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      changeZoom(zoomRef.current * Math.exp(-e.deltaY / 200));
    };
    let dist = 0;
    const d = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) dist = d(e.touches);
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !dist) return;
      e.preventDefault();
      const nd = d(e.touches);
      changeZoom(zoomRef.current * (nd / dist));
      dist = nd;
    };
    const onEnd = () => (dist = 0);
    scroller.addEventListener('wheel', onWheel, { passive: false });
    scroller.addEventListener('touchstart', onStart, { passive: true });
    scroller.addEventListener('touchmove', onMove, { passive: false });
    scroller.addEventListener('touchend', onEnd);
    return () => {
      scroller.removeEventListener('wheel', onWheel);
      scroller.removeEventListener('touchstart', onStart);
      scroller.removeEventListener('touchmove', onMove);
      scroller.removeEventListener('touchend', onEnd);
    };
  }, [scroller, changeZoom]);

  // Текущая страница
  useEffect(() => {
    if (!scroller) return;
    const on = () => {
      const mid = scroller.getBoundingClientRect().top + scroller.clientHeight / 3;
      let best = 1;
      scroller.querySelectorAll<HTMLElement>('[data-pdf-page]').forEach((el) => {
        if (el.getBoundingClientRect().top <= mid) best = Number(el.dataset.pdfPage);
      });
      setCurrent(best);
    };
    on();
    scroller.addEventListener('scroll', on, { passive: true });
    return () => scroller.removeEventListener('scroll', on);
  }, [scroller, pdf]);

  // Выделение текста → всплывающее меню (цвет, в конспект, карточка)
  useEffect(() => {
    if (!scroller || tool !== 'text') return;
    let t = 0;
    const check = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        const pageEl = (range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement)?.closest<HTMLElement>('[data-pdf-page]');
        if (!pageEl || !scroller.contains(pageEl)) return;
        const text = sel.toString().trim();
        if (!text) return;
        const rects = selectionRects([...range.getClientRects()], pageEl.getBoundingClientRect(), uid);
        if (!rects.length) return;
        const last = range.getClientRects()[range.getClientRects().length - 1];
        setPop({ kind: 'selection', page: Number(pageEl.dataset.pdfPage), rects, text, x: last.right, y: last.bottom });
      }, 350);
    };
    document.addEventListener('selectionchange', check);
    return () => {
      document.removeEventListener('selectionchange', check);
      window.clearTimeout(t);
    };
  }, [scroller, tool]);

  // Нажатие на существующее выделение
  const onPagesClick = (e: React.MouseEvent) => {
    if (tool !== 'text' || !annotations) return;
    if (!window.getSelection()?.isCollapsed) return;
    const pageEl = (e.target as HTMLElement).closest<HTMLElement>('[data-pdf-page]');
    if (!pageEl) return;
    const r = pageEl.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    const n = Number(pageEl.dataset.pdfPage);
    const ann = annotations.find((a) => a.kind === 'highlight' && a.page === n && (a.rects ?? []).some((q) => fx >= q.x && fx <= q.x + q.w && fy >= q.y && fy <= q.y + q.h));
    if (ann) setPop({ kind: 'highlight', ann, x: e.clientX, y: e.clientY });
    else setPop(null);
  };

  /** Конспект для выделений: запомненный или выбранный/созданный сейчас. */
  const ensureTarget = async (): Promise<string | null> => {
    const saved = await getTargetNote(doc);
    if (saved) return saved;
    return chooseTarget();
  };
  const chooseTarget = async (): Promise<string | null> => {
    const notes = (await db.docs.filter((d) => (d.type === 'note' || d.type === 'daily') && !d.deletedAt).toArray()).sort((a, b) => b.updatedAt - a.updatedAt);
    const choice = await dialog.select(
      'Куда отправлять выделения из этого PDF?',
      [{ value: '__new', label: `Новый конспект «Конспект: ${doc.title}»` }, ...notes.map((d) => ({ value: d.id, label: d.title }))],
      targetId ?? '__new',
    );
    if (!choice) return null;
    if (choice === '__new') return createTargetNote(doc);
    await setTargetNote(doc.id, choice);
    return choice;
  };

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    setPop(null);
  };

  const toNote = async (ann: Annotation, mode: 'quote' | 'card') => {
    setPop(null); // меню не должно висеть поверх диалогов
    let question: string | undefined;
    if (mode === 'card') {
      const q = await dialog.prompt('Вопрос к фрагменту', '', 'Пусто — фрагмент станет клозом {{…}}');
      if (q === null) return;
      question = q.trim() || undefined;
    }
    const noteId = await ensureTarget();
    if (!noteId) return;
    await highlightToBlock(ann, noteId, { question, cloze: mode === 'card' && !question });
    clearSelection();
  };

  const fromSelection = async (color: string, then?: 'quote' | 'card') => {
    if (pop?.kind !== 'selection') return;
    const ann = await addHighlight(doc.id, pop.page, pop.rects, pop.text, color);
    if (then) await toNote(ann, then);
    else clearSelection();
  };

  const regionTo = async (mode: 'image' | 'occlusion') => {
    if (pop?.kind !== 'region' || !pdf) return;
    const { page, rect } = pop;
    setPop(null);
    const noteId = await ensureTarget();
    if (!noteId) return;
    const png = await renderClip(pdf, page, rect);
    const b = await clipToBlock(doc.id, page, { ...rect, id: uid() }, png, noteId);
    if (mode === 'occlusion') setOccBlock(b);
  };

  const runSearch = async () => {
    if (!doc.fileId) return;
    const text = await pdfText(doc.fileId);
    const h = findInPages(text, query);
    setHits(h);
    setActiveQuery(query);
    if (h[0]) goTo(h[0].page);
  };

  const exportPdf = async () => {
    try {
      const f = await exportAnnotatedPdf(doc);
      await deliverFile(f);
    } catch (e) {
      dialog.alert('Не удалось экспортировать', e instanceof Error ? e.message : String(e));
    }
  };

  if (error) return <div className="page-pad muted">Не удалось открыть PDF: {error}</div>;

  const width = fitWidth * zoom;
  const byPage = new Map<number, Annotation[]>();
  for (const a of annotations ?? []) byPage.set(a.page, [...(byPage.get(a.page) ?? []), a]);

  return (
    <div className="pdf-view">
      <div className="pdf-toolbar">
        <button className={'tool-btn' + (thumbs ? ' active' : '')} onClick={() => setThumbs(!thumbs)} aria-label="Миниатюры" title="Миниатюры страниц">
          <Icon name="sidebar" />
        </button>
        <span className="tb-sep" />
        <button className={'tool-btn text' + (tool === 'text' ? ' active' : '')} onClick={() => setTool('text')} title="Выделение текста">
          <Icon name="highlight" /> Текст
        </button>
        <button className={'tool-btn text' + (tool === 'ink' ? ' active' : '')} onClick={() => setTool('ink')} title="Рукописные пометки">
          <Icon name="pen" /> Перо
        </button>
        <button className={'tool-btn text' + (tool === 'region' ? ' active' : '')} onClick={() => setTool('region')} title="Вырезать область страницы">
          <Icon name="image" /> Область
        </button>
        {tool === 'ink' && (
          <>
            <span className="tb-sep" />
            <InkToolbar />
          </>
        )}
        <span className="pdf-toolbar-spacer" />
        <form
          className="pdf-search"
          onSubmit={(e) => {
            e.preventDefault();
            runSearch();
          }}
        >
          <Icon name="search" size={18} />
          <input type="search" placeholder="Поиск в PDF" value={query} onChange={(e) => setQuery(e.target.value)} enterKeyHint="search" />
        </form>
        <span className="nb-pagenum">
          {current} / {sizes.length || '…'}
        </span>
        <button className="tool-btn" onClick={() => changeZoom(zoom / 1.2)} aria-label="Уменьшить">
          <Icon name="zoomOut" />
        </button>
        <button className="tool-btn text" onClick={() => changeZoom(1)} title="По ширине">
          {Math.round(zoom * 100)}%
        </button>
        <button className="tool-btn" onClick={() => changeZoom(zoom * 1.2)} aria-label="Увеличить">
          <Icon name="zoomIn" />
        </button>
        <span className="tb-sep" />
        <button className="tool-btn text" onClick={chooseTarget} title="Куда отправлять выделения">
          <Icon name="note" size={18} /> {target ? target.title : 'Конспект…'}
        </button>
        <button className="tool-btn" onClick={exportPdf} aria-label="Экспорт PDF с пометками" title="Экспорт PDF с пометками">
          <Icon name="download" />
        </button>
      </div>

      {doc.source?.kind === 'pptx' && !pptxHint && (
        <div className="pdf-note">
          <Icon name="lecture" size={18} />
          <span>Презентация PowerPoint показана упрощённо: текст и картинки на месте, но без анимаций и точной вёрстки. Для точного вида сохраните её как PDF в PowerPoint или Keynote и загрузите заново.</span>
          <button className="icon-btn small" onClick={() => setPptxHint(true)} aria-label="Скрыть подсказку">
            <Icon name="close" size={18} />
          </button>
        </div>
      )}

      {hits && (
        <div className="pdf-hits">
          <div className="pdf-hits-head">
            Найдено: {hits.length}
            <button className="icon-btn small" onClick={() => (setHits(null), setActiveQuery(''))} aria-label="Закрыть поиск">
              <Icon name="close" size={18} />
            </button>
          </div>
          {hits.map((h, i) => (
            <button key={i} className="pdf-hit" onClick={() => goTo(h.page)}>
              <small>стр. {h.page}</small> {h.snippet}
            </button>
          ))}
        </div>
      )}

      <div className="pdf-body">
        {thumbs && pdf && (
          <div ref={setThumbsEl} className="pdf-thumbs">
            {sizes.map((s, i) => (
              <PdfThumb key={i} pdf={pdf} n={i + 1} size={s} root={thumbsEl} active={current === i + 1} onClick={() => goTo(i + 1)} />
            ))}
          </div>
        )}
        <div ref={setScroller} className={'pdf-scroll tool-' + tool} onClick={onPagesClick}>
          {!pdf && <div className="page-pad muted">Открываю PDF…</div>}
          {pdf &&
            sizes.map((s, i) => (
              <PdfPage
                key={i}
                pdf={pdf}
                docId={doc.id}
                n={i + 1}
                size={s}
                width={width}
                tool={tool}
                annotations={byPage.get(i + 1) ?? []}
                root={scroller}
                query={activeQuery}
                flash={flash}
                onRegion={(page, rect, at) => setPop({ kind: 'region', page, rect, ...at })}
                onPinch={onPinch}
              />
            ))}
        </div>
      </div>

      {pop && (
        <div className="pdf-pop" style={{ left: Math.min(pop.x, window.innerWidth - 330), top: Math.min(pop.y + 10, window.innerHeight - 70) }} onPointerDown={(e) => e.preventDefault()}>
          {pop.kind === 'region' ? (
            <>
              <button className="btn small" onClick={() => regionTo('image')}>
                <Icon name="image" size={18} /> В конспект
              </button>
              <button className="btn small primary" onClick={() => regionTo('occlusion')}>
                <Icon name="card" size={18} /> Карточки-области
              </button>
              <button className="icon-btn small" onClick={() => setPop(null)} aria-label="Отмена">
                <Icon name="close" size={18} />
              </button>
            </>
          ) : (
            <>
              {COLORS.map((c) => (
                <button
                  key={c}
                  className={'swatch' + (pop.kind === 'highlight' && pop.ann.color === c ? ' active' : '')}
                  aria-label="Цвет выделения"
                  onClick={async () => {
                    if (pop.kind === 'selection') fromSelection(c);
                    else {
                      await db.annotations.update(pop.ann.id, { color: c, updatedAt: Date.now() });
                      setPop(null);
                    }
                  }}
                >
                  <span style={{ background: HIGHLIGHT_HEX[c] }} />
                </button>
              ))}
              <span className="tb-sep" />
              <button className="btn small" onClick={() => (pop.kind === 'selection' ? fromSelection('yellow', 'quote') : toNote(pop.ann, 'quote'))}>
                В конспект
              </button>
              <button className="btn small primary" onClick={() => (pop.kind === 'selection' ? fromSelection('yellow', 'card') : toNote(pop.ann, 'card'))}>
                Карточка
              </button>
              {pop.kind === 'highlight' && pop.ann.blockId && (
                <button className="icon-btn small" title="Открыть блок в конспекте" onClick={async () => {
                  const b = await db.blocks.get(pop.ann.blockId!);
                  if (b) navigate(`doc/${b.docId}?b=${b.id}`);
                }}>
                  <Icon name="note" size={18} />
                </button>
              )}
              {pop.kind === 'highlight' && (
                <button
                  className="icon-btn small"
                  aria-label="Удалить выделение"
                  onClick={async () => {
                    await db.annotations.delete(pop.ann.id);
                    setPop(null);
                  }}
                >
                  <Icon name="trash" size={18} />
                </button>
              )}
            </>
          )}
        </div>
      )}
      {occBlock && <OcclusionEditor block={occBlock} onClose={() => setOccBlock(null)} />}
    </div>
  );
}
