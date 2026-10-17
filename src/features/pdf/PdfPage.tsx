import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import type { Annotation, Rect, Stroke } from '../../db/schema';
import { InkCanvas } from '../ink/InkCanvas';
import { saveInk } from './annotations';
import { HIGHLIGHT_HEX } from './geometry';
import { pdfjs } from './pdfjs';

export type PdfTool = 'text' | 'ink' | 'region';

interface Props {
  pdf: PDFDocumentProxy;
  docId: string;
  n: number;
  /** Размер страницы в пунктах PDF (масштаб 1) */
  size: [number, number];
  /** Ширина страницы на экране, CSS px */
  width: number;
  tool: PdfTool;
  annotations: Annotation[];
  root: HTMLElement | null;
  query: string;
  flash: string | null;
  onRegion: (page: number, rect: Rect, at: { x: number; y: number }) => void;
  onPinch: (ratio: number) => void;
}

/** Рисуем страницу, только когда она рядом с экраном. */
function useNear(root: HTMLElement | null, initial: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el || !root || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { root, rootMargin: '1500px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);
  return [ref, near] as const;
}

export const PdfPage = memo(function PdfPage({ pdf, docId, n, size, width, tool, annotations, root, query, flash, onRegion, onPinch }: Props) {
  const [ref, near] = useNear(root, n <= 2);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);
  const height = (width * size[1]) / size[0];
  const scale = width / size[0];

  // Отрисовка страницы и текстового слоя (для выделения и поиска)
  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    let textLayer: InstanceType<typeof pdfjs.TextLayer> | null = null;
    (async () => {
      const page = await pdf.getPage(n);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const canvas = canvasRef.current!;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      task = page.render({ canvas, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      try {
        await task.promise;
      } catch {
        return; // отменено при смене масштаба
      }
      if (cancelled) return;
      setRendered(true);
      const container = textRef.current!;
      container.replaceChildren();
      textLayer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container, viewport });
      await textLayer.render().catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
      textLayer?.cancel();
    };
  }, [pdf, n, scale, near]);

  // Подсветка найденного текста
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const q = query.trim().toLowerCase();
    el.querySelectorAll('span').forEach((s) => s.classList.toggle('search-hit', q.length >= 2 && (s.textContent ?? '').toLowerCase().includes(q)));
  }, [query, rendered]);

  const ink = annotations.find((a) => a.kind === 'ink');
  const highlights = annotations.filter((a) => a.kind === 'highlight');
  const onInk = useCallback((strokes: Stroke[]) => saveInk(docId, n, strokes), [docId, n]);

  // Инструмент «область»: прямоугольник для вырезки (картинка / image occlusion)
  const [region, setRegion] = useState<Rect | null>(null);
  const regionStart = useRef<{ x: number; y: number } | null>(null);
  const toFrac = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  return (
    <div
      ref={ref}
      className="pdf-page"
      data-pdf-page={n}
      style={
        {
          width,
          height,
          '--scale-factor': scale,
          '--total-scale-factor': scale,
          '--user-unit': 1,
          '--scale-round-x': '1px',
          '--scale-round-y': '1px',
        } as React.CSSProperties
      }
    >
      {near ? (
        <>
          <canvas ref={canvasRef} className="pdf-canvas" style={{ width, height }} />
          <div className="pdf-highlights">
            {highlights.map((a) =>
              (a.rects ?? []).map((r) => (
                <div
                  key={a.id + r.id}
                  data-ann={a.id}
                  className={'pdf-hl' + (flash === a.id ? ' flash' : '')}
                  style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, background: HIGHLIGHT_HEX[a.color] ?? a.color }}
                />
              )),
            )}
          </div>
          <div ref={textRef} className={'textLayer' + (tool === 'text' ? '' : ' inactive')} />
          <div className={'pdf-ink-layer' + (tool === 'ink' ? ' active' : '')}>
            <InkCanvas
              id={`pdf-${docId}-${n}`}
              className="pdf-ink"
              width={size[0]}
              height={size[1]}
              strokes={ink?.strokes ?? []}
              readOnly={tool !== 'ink'}
              onChange={onInk}
              onPinch={onPinch}
            />
          </div>
          {tool === 'region' && (
            <div
              className="pdf-region-layer"
              onPointerDown={(e) => {
                e.preventDefault();
                try {
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                } catch {
                  /* без захвата тоже работает */
                }
                regionStart.current = toFrac(e);
                setRegion({ id: 'r', ...regionStart.current, w: 0, h: 0 });
              }}
              onPointerMove={(e) => {
                const s = regionStart.current;
                if (!s) return;
                const p = toFrac(e);
                setRegion({ id: 'r', x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
              }}
              onPointerUp={(e) => {
                // прямоугольник считаем по точкам, а не по состоянию: оно может не успеть обновиться
                const s = regionStart.current;
                regionStart.current = null;
                setRegion(null);
                if (!s) return;
                const p = toFrac(e);
                const r = { id: 'r', x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) };
                if (r.w > 0.02 && r.h > 0.01) onRegion(n, r, { x: e.clientX, y: e.clientY });
              }}
            >
              {region && (
                <div className="pdf-region" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.w * 100}%`, height: `${region.h * 100}%` }} />
              )}
            </div>
          )}
        </>
      ) : (
        <div className="pdf-placeholder" />
      )}
      <div className="pdf-page-num">{n}</div>
    </div>
  );
});

/** Миниатюра страницы для боковой колонки. */
export const PdfThumb = memo(function PdfThumb({ pdf, n, size, root, active, onClick }: { pdf: PDFDocumentProxy; n: number; size: [number, number]; root: HTMLElement | null; active: boolean; onClick: () => void }) {
  const [ref, near] = useNear(root, n <= 8);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const W = 104;
  useEffect(() => {
    if (!near) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    (async () => {
      const page = await pdf.getPage(n);
      if (cancelled) return;
      const viewport = page.getViewport({ scale: (W * 2) / size[0] });
      const c = canvasRef.current!;
      c.width = Math.floor(viewport.width);
      c.height = Math.floor(viewport.height);
      task = page.render({ canvas: c, viewport });
      await task.promise.catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, n, near, size]);
  return (
    <button ref={ref as unknown as React.Ref<HTMLButtonElement>} className={'pdf-thumb' + (active ? ' active' : '')} onClick={onClick}>
      <canvas ref={canvasRef} style={{ width: W, height: (W * size[1]) / size[0] }} />
      <span>{n}</span>
    </button>
  );
});

/** Вырезает область страницы в PNG (в хорошем разрешении — для картинки и image occlusion). */
export async function renderClip(pdf: PDFDocumentProxy, n: number, rect: Rect): Promise<Blob> {
  const page = await pdf.getPage(n);
  const base = page.getViewport({ scale: 1 });
  // целимся в ~1600 px по ширине области, но не больше 4× от исходного размера
  const scale = Math.min(4, Math.max(1.5, 1600 / (base.width * rect.w)));
  const viewport = page.getViewport({ scale });
  const full = document.createElement('canvas');
  full.width = Math.floor(viewport.width);
  full.height = Math.floor(viewport.height);
  await page.render({ canvas: full, viewport }).promise;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(rect.w * full.width));
  out.height = Math.max(1, Math.round(rect.h * full.height));
  out.getContext('2d')!.drawImage(full, rect.x * full.width, rect.y * full.height, out.width, out.height, 0, 0, out.width, out.height);
  return new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'));
}
