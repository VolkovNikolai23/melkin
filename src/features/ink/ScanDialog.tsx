import { useEffect, useRef, useState } from 'react';
import { detectQuad, enhance, outputSize, warp, type EnhanceMode, type Img, type Quad } from './scan';

const MODES: { mode: EnhanceMode; label: string }[] = [
  { mode: 'color', label: 'Улучшить' },
  { mode: 'bw', label: 'Ч/Б документ' },
  { mode: 'none', label: 'Как есть' },
];

/** Фото с камеры iPad до 12 Мп; для выпрямления хватает 3000 px по длинной стороне. */
const MAX_SOURCE = 3000;

async function loadPixels(file: Blob): Promise<{ img: Img; url: string }> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_SOURCE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k);
  const h = Math.round(bmp.height * k);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const data = ctx.getImageData(0, 0, w, h);
  const url = URL.createObjectURL(file);
  return { img: { data: data.data, width: w, height: h }, url };
}

async function toBlob(img: Img): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Не удалось сохранить картинку'))), 'image/jpeg', 0.88));
}

/**
 * «Сканер» для фото доски и слайдов: углы находятся сами, их можно поправить пальцем
 * или Pencil; затем перспектива выпрямляется и фото улучшается.
 */
export function ScanDialog({ file, onDone, onCancel }: { file: File; onDone: (blob: Blob) => void; onCancel: () => void }) {
  const [src, setSrc] = useState<{ img: Img; url: string } | null>(null);
  const [quad, setQuad] = useState<Quad | null>(null);
  const [mode, setMode] = useState<EnhanceMode>('color');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const svgRef = useRef<SVGSVGElement>(null);
  const dragIdx = useRef<number | null>(null);

  useEffect(() => {
    let url = '';
    loadPixels(file)
      .then((s) => {
        url = s.url;
        setSrc(s);
        setQuad(detectQuad(s.img));
      })
      .catch(() => setError('Не удалось открыть фото'));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [file]);

  const toImg = (e: React.PointerEvent): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    const { width, height } = src!.img;
    return [Math.max(0, Math.min(width, ((e.clientX - r.left) / r.width) * width)), Math.max(0, Math.min(height, ((e.clientY - r.top) / r.height) * height))];
  };

  const done = async () => {
    if (!src || !quad) return;
    setBusy(true);
    // даём интерфейсу показать «Обработка…» до тяжёлого расчёта
    await new Promise((r) => setTimeout(r, 30));
    try {
      const { width, height } = outputSize(quad);
      const out = enhance(warp(src.img, quad, width, height), mode);
      onDone(await toBlob(out));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const w = src?.img.width ?? 1;
  const h = src?.img.height ?? 1;
  const handle = Math.max(w, h) / 40;

  return (
    <div className="modal-backdrop">
      <div className="modal scan-modal" role="dialog" aria-modal aria-label="Скан фото">
        <h3>Выпрямить фото</h3>
        <p className="modal-msg">Перетащите углы на края доски, листа или слайда.</p>
        {error && <p className="error">{error}</p>}
        {src && quad ? (
          <svg
            ref={svgRef}
            className="scan-stage"
            viewBox={`0 0 ${w} ${h}`}
            onPointerMove={(e) => {
              if (dragIdx.current === null) return;
              const p = toImg(e);
              setQuad((q) => q && (q.map((c, i) => (i === dragIdx.current ? p : c)) as Quad));
            }}
            onPointerUp={() => (dragIdx.current = null)}
            onPointerCancel={() => (dragIdx.current = null)}
          >
            <image href={src.url} width={w} height={h} />
            <path d={`M${quad.map((p) => p.join(' ')).join('L')}Z`} className="scan-quad" vectorEffect="non-scaling-stroke" />
            {quad.map((p, i) => (
              <circle
                key={i}
                cx={p[0]}
                cy={p[1]}
                r={handle}
                className="scan-handle"
                vectorEffect="non-scaling-stroke"
                onPointerDown={(e) => {
                  e.preventDefault();
                  dragIdx.current = i;
                  try {
                    (e.target as Element).setPointerCapture(e.pointerId);
                  } catch {
                    /* указатель уже отпущен */
                  }
                }}
              />
            ))}
          </svg>
        ) : (
          !error && <p className="muted">Ищу края…</p>
        )}
        <div className="segmented scan-modes">
          {MODES.map((m) => (
            <button key={m.mode} className={mode === m.mode ? 'active' : ''} onClick={() => setMode(m.mode)}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>
            Отмена
          </button>
          <button className="btn primary" disabled={!quad || busy} onClick={done}>
            {busy ? 'Обработка…' : 'Вставить'}
          </button>
        </div>
      </div>
    </div>
  );
}
