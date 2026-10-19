import { useLiveQuery } from 'dexie-react-hooks';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/Icon';
import { MenuButton } from '../../components/Menu';
import { dialog } from '../../components/dialog';
import { deliverFile } from '../../db/backup';
import { db } from '../../db/db';
import { markInkDirty } from '../ai/recognize';
import type { Doc, PageBackground, PageItem, Stroke } from '../../db/schema';
import { uid } from '../../lib/id';
import { pickCamera, pickFiles, storeImage } from '../notes/images';
import { InkCanvas } from './InkCanvas';
import { InkToolbar } from './InkToolbar';
import { placeImage } from './items';
import { appendPage, ensureSparePage, PAGE_H, PAGE_W, pageIds, setPageLook } from './notebook';
import { BG_LABEL, dotsPath, LINE_COLORS, PAPER_COLORS, paperGeometry, segmentsPath } from './paper';
import { ScanDialog } from './ScanDialog';

export { PAGE_H, PAGE_W } from './notebook';

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

/** Мини-превью фона для выбора в меню «Вид листа». */
function BgThumb({ bg }: { bg: PageBackground }) {
  const g = paperGeometry(bg, PAGE_W, PAGE_H);
  return (
    <svg viewBox={`0 0 ${PAGE_W} ${PAGE_H}`} className="bg-thumb" aria-hidden>
      <rect width={PAGE_W} height={PAGE_H} fill="var(--paper)" />
      <path d={segmentsPath(g.lines)} stroke="var(--muted)" strokeWidth={6} opacity={0.5} />
      <path d={dotsPath(g.dots.map(([x, y]) => [x, y, 7]))} fill="var(--muted)" opacity={0.6} />
      <path d={segmentsPath(g.margins)} stroke="var(--accent)" strokeWidth={8} opacity={0.6} />
    </svg>
  );
}

function LookPopover({ anchor, pageId, docId, look, onClose }: { anchor: HTMLElement; pageId: string; docId: string; look: { background: PageBackground; paper?: string; lineColor?: string }; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [all, setAll] = useState(false);
  const r = anchor.getBoundingClientRect();
  useEffect(() => {
    const on = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', on, true);
    return () => window.removeEventListener('pointerdown', on, true);
  }, [anchor, onClose]);
  const set = (patch: Partial<typeof look>) => setPageLook(pageId, patch, all ? docId : undefined);
  return createPortal(
    <div
      ref={ref}
      className="palette-pop look-pop"
      style={{ left: Math.max(8, Math.min(r.left, window.innerWidth - 360)), top: Math.min(r.bottom + 6, window.innerHeight - 480) }}
      role="dialog"
      aria-label="Вид листа"
    >
      <div className="look-title">Фон</div>
      <div className="bg-grid">
        {(Object.keys(BG_LABEL) as PageBackground[]).map((b) => (
          <button key={b} className={'bg-opt' + (look.background === b ? ' active' : '')} onClick={() => set({ background: b })} title={BG_LABEL[b]}>
            <BgThumb bg={b} />
            <span>{BG_LABEL[b].replace(/ \(.*\)/, '')}</span>
          </button>
        ))}
      </div>
      <div className="look-title">Цвет листа</div>
      <div className="palette-grid">
        {PAPER_COLORS.map((c) => (
          <button key={c.label} className={'swatch' + (look.paper === c.color ? ' active' : '')} title={c.label} aria-label={c.label} onClick={() => set({ paper: c.color })}>
            <span style={{ background: c.color ?? 'var(--paper)' }} className={c.color ? '' : 'theme-swatch'} />
          </button>
        ))}
      </div>
      <div className="look-title">Цвет линий</div>
      <div className="palette-grid">
        {LINE_COLORS.map((c) => (
          <button key={c.label} className={'swatch' + (look.lineColor === c.color ? ' active' : '')} title={c.label} aria-label={c.label} onClick={() => set({ lineColor: c.color })}>
            <span style={{ background: c.color ?? 'var(--paper-line)' }} className={c.color ? '' : 'theme-swatch'} />
          </button>
        ))}
      </div>
      <label className="check-row">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Менять сразу все листы тетради
      </label>
    </div>,
    document.body,
  );
}

const PageView = memo(function PageView({
  pageId,
  index,
  total,
  zoom,
  root,
  onPinch,
  onWrote,
  insertRef,
}: {
  pageId: string;
  index: number;
  total: number;
  zoom: number;
  root: HTMLElement | null;
  onPinch: (r: number) => void;
  onWrote: (index: number) => void;
  insertRef: React.MutableRefObject<Map<string, (it: PageItem) => void>>;
}) {
  const [ref, near] = useNearViewport(root, index < 3);
  const page = useLiveQuery(() => db.pages.get(pageId), [pageId]);
  const [look, setLook] = useState<HTMLElement | null>(null);
  const insert = useRef<((it: PageItem) => void) | null>(null);

  // регистрируем функцию вставки картинки в этот лист
  useEffect(() => {
    const map = insertRef.current;
    map.set(pageId, (it) => insert.current?.(it));
    return () => {
      map.delete(pageId);
    };
  }, [pageId, insertRef]);

  const docId = page?.docId;
  const onChange = useCallback(
    (strokes: Stroke[]) => {
      const now = Date.now();
      db.pages.update(pageId, { strokes, updatedAt: now });
      if (docId) db.docs.update(docId, { updatedAt: now });
      markInkDirty('page', pageId);
    },
    [pageId, docId],
  );
  const onItemsChange = useCallback(
    (items: PageItem[]) => {
      const now = Date.now();
      db.pages.update(pageId, { items, updatedAt: now });
      if (docId) db.docs.update(docId, { updatedAt: now });
    },
    [pageId, docId],
  );
  const onStrokeEnd = useCallback(() => onWrote(index), [onWrote, index]);

  const remove = async () => {
    if (total <= 1 || !page) return;
    const n = page.strokes.length + (page.items?.length ?? 0);
    const msg = n ? `На листе ${page.strokes.length} штрихов${page.items?.length ? ` и ${page.items.length} объектов` : ''}.` : undefined;
    if (await dialog.confirm(`Удалить лист ${index + 1}?`, 'Удалить', msg)) await db.pages.delete(pageId);
  };

  return (
    <div ref={ref} className="nb-page-wrap" data-page={index} data-page-id={pageId} style={{ width: `${zoom * 100}%` }}>
      <div className="nb-page-head">
        <span>
          Лист {index + 1} из {total}
        </span>
        {page && (
          <button className={'btn small ghost' + (look ? ' active' : '')} onClick={(e) => setLook(look ? null : e.currentTarget)} aria-label="Вид листа: фон и цвет">
            <Icon name="sheet" size={18} /> {BG_LABEL[page.background] ? BG_LABEL[page.background].replace(/ \(.*\)/, '') : 'Фон'}
          </button>
        )}
        {look && page && (
          <LookPopover anchor={look} pageId={pageId} docId={page.docId} look={page} onClose={() => setLook(null)} />
        )}
        {total > 1 && (
          <button className="icon-btn small" onClick={remove} aria-label="Удалить лист">
            <Icon name="trash" size={18} />
          </button>
        )}
      </div>
      {near && page ? (
        <InkCanvas
          id={'page-' + pageId}
          className="nb-page"
          width={PAGE_W}
          height={PAGE_H}
          strokes={page.strokes}
          items={page.items}
          background={BG_LABEL[page.background] ? page.background : 'grid'}
          paper={page.paper}
          lineColor={page.lineColor}
          onChange={onChange}
          onItemsChange={onItemsChange}
          onStrokeEnd={onStrokeEnd}
          onPinch={onPinch}
          insertRef={insert}
          aiContext={`рукописный конспект, лист ${index + 1}`}
        />
      ) : (
        <div className="nb-page nb-page-placeholder" style={{ aspectRatio: `${PAGE_W} / ${PAGE_H}`, background: page?.paper }} />
      )}
    </div>
  );
});

export function NotebookView({ doc, initialPage = null }: { doc: Doc; initialPage?: number | null }) {
  const ids = useLiveQuery(() => pageIds(doc.id), [doc.id]);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const anchor = useRef<{ cx: number; cy: number } | null>(null);
  const [current, setCurrent] = useState(0);
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [busy, setBusy] = useState('');
  const inserters = useRef(new Map<string, (it: PageItem) => void>());

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

  // Номер текущего листа — по середине экрана
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
  }, [scroller, ids?.length]);

  // Тетрадь без листов (например, после импорта) — сразу добавляем первый
  useEffect(() => {
    if (ids && !ids.length) appendPage(doc.id);
  }, [ids, doc.id]);

  // переход к листу из поиска (?page=N, с единицы) — один раз, когда листы загрузились
  const jumped = useRef<number | null>(null);
  useEffect(() => {
    if (!initialPage || !ids?.length || !scroller || jumped.current === initialPage) return;
    jumped.current = initialPage;
    requestAnimationFrame(() => goTo(Math.min(ids.length, initialPage) - 1));
  });

  const goTo = (i: number) => {
    const el = scroller?.querySelector<HTMLElement>(`[data-page="${i}"]`);
    if (!scroller || !el) return;
    const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 8;
    scroller.scrollTo({ top, behavior: 'smooth' });
  };

  const addPage = async () => {
    await appendPage(doc.id);
    requestAnimationFrame(() => scroller?.scrollTo({ top: 1e9, behavior: 'smooth' }));
  };

  // Пишем на последнем/предпоследнем листе — в конце появляется чистый лист
  const onWrote = useCallback((index: number) => void ensureSparePage(doc.id, index), [doc.id]);

  /** Вставка картинки на текущий лист — в середину видимой части. */
  const insertImage = async (blob: Blob, name: string) => {
    if (!ids?.length) return;
    setBusy('Сохраняю картинку…');
    try {
      const stored = await storeImage(blob, name);
      const pageId = ids[Math.min(current, ids.length - 1)];
      const el = scroller?.querySelector<HTMLElement>(`[data-page-id="${pageId}"] .nb-page`);
      let centerY = PAGE_H / 2;
      if (el && scroller) {
        const r = el.getBoundingClientRect();
        const s = scroller.getBoundingClientRect();
        centerY = (((s.top + s.bottom) / 2 - r.top) / r.height) * PAGE_H;
      }
      const item: PageItem = { id: uid(), kind: 'image', fileId: stored.fileId, ...placeImage(stored.width, stored.height, PAGE_W, PAGE_H, centerY) };
      const ins = inserters.current.get(pageId);
      if (ins) ins(item);
      else {
        const p = await db.pages.get(pageId);
        if (p) await db.pages.update(pageId, { items: [...(p.items ?? []), item], updatedAt: Date.now() });
      }
      onWrote(Math.min(current, ids.length - 1));
    } catch (e) {
      dialog.alert('Не удалось вставить картинку', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const pickPhoto = async (camera: boolean, scan: boolean) => {
    // На iPad accept="image/*" с capture открывает камеру, без него — выбор: «Фото», «Снять фото», «Файлы»
    const files = camera ? await pickCamera() : await pickFiles('image/*', !scan);
    if (!files.length) return;
    if (scan) setScanFile(files[0]);
    else for (const f of files) await insertImage(f, f.name);
  };

  const exportPdf = async () => {
    setBusy('Готовлю PDF…');
    try {
      const { exportNotebookPdf } = await import('./exportNotebook');
      await deliverFile(await exportNotebookPdf(doc, PAGE_W, PAGE_H));
    } catch (e) {
      dialog.alert('Не удалось экспортировать', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const recognizeAll = async () => {
    setBusy('Распознаю рукопись…');
    try {
      const { recognizeNotebook } = await import('../ai/recognize');
      const n = await recognizeNotebook(doc.id, (d, t) => setBusy(`Распознаю рукопись: ${d} из ${t}`));
      if (!n) dialog.alert('Всё уже распознано', 'Текст листов есть в поиске и используется для сводок.');
    } catch (e) {
      const { aiErrorText } = await import('../ai/client');
      dialog.alert('Не удалось распознать', aiErrorText(e));
    } finally {
      setBusy('');
    }
  };

  if (!ids) return null;
  return (
    <div className="notebook">
      <div className="nb-toolbar">
        <InkToolbar withText />
        <div className="nb-zoom">
          <MenuButton
            label="Вставить"
            className="tool-btn"
            items={[
              { label: 'Фото с камеры', icon: 'camera', onClick: () => pickPhoto(true, false) },
              { label: 'Картинка из «Фото» или «Файлов»', icon: 'image', onClick: () => pickPhoto(false, false) },
              { label: 'Скан доски или слайда (выпрямить)', icon: 'scan', onClick: () => pickPhoto(true, true) },
              { label: 'Скан из готового фото', icon: 'scan', onClick: () => pickPhoto(false, true) },
              { label: 'Новый лист', icon: 'plus', onClick: addPage },
              { label: 'Экспорт тетради в PDF', icon: 'fileExport', onClick: exportPdf },
              { label: 'Распознать рукопись (ИИ)', icon: 'text', onClick: recognizeAll },
            ]}
          >
            <Icon name="plus" />
          </MenuButton>
          <span className="tb-sep" />
          <button className="tool-btn" disabled={current <= 0} onClick={() => goTo(current - 1)} aria-label="Предыдущий лист">
            <Icon name="arrowUp" />
          </button>
          <span className="nb-pagenum">
            {current + 1} / {ids.length}
          </span>
          <button className="tool-btn" disabled={current >= ids.length - 1} onClick={() => goTo(current + 1)} aria-label="Следующий лист">
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
      {busy && <div className="nb-busy">{busy}</div>}
      <div ref={setScroller} className="nb-scroll">
        <div className="nb-pages">
          {ids.map((id, i) => (
            <PageView key={id} pageId={id} index={i} total={ids.length} zoom={zoom} root={scroller} onPinch={onPinch} onWrote={onWrote} insertRef={inserters} />
          ))}
          <button className="btn add-page" onClick={addPage}>
            <Icon name="plus" /> Новый лист
          </button>
        </div>
      </div>
      {scanFile && (
        <ScanDialog
          file={scanFile}
          onCancel={() => setScanFile(null)}
          onDone={(blob) => {
            setScanFile(null);
            insertImage(blob, 'Скан.jpg');
          }}
        />
      )}
    </div>
  );
}
