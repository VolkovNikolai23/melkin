import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Две панели рядом с перетаскиваемым разделителем (доля сохраняется).
 * В вертикальной ориентации на узком экране панели встают друг под другом.
 */
export function SplitPane({ left, right, storageKey, onClose }: { left: ReactNode; right: ReactNode; storageKey: string; onClose?: () => void }) {
  const [ratio, setRatio] = useState(() => {
    try {
      const v = Number(localStorage.getItem(`split:${storageKey}`));
      return v > 0.15 && v < 0.85 ? v : 0.5;
    } catch {
      return 0.5;
    }
  });
  const box = useRef<HTMLDivElement>(null);
  const [vertical, setVertical] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVertical(el.clientWidth < 700 && el.clientHeight > el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = box.current!;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const v = vertical ? (ev.clientY - r.top) / r.height : (ev.clientX - r.left) / r.width;
      setRatio(Math.min(0.85, Math.max(0.15, v)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setRatio((r) => {
        try {
          localStorage.setItem(`split:${storageKey}`, String(r));
        } catch {
          /* приватный режим */
        }
        return r;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div ref={box} className={'split' + (vertical ? ' vertical' : '')}>
      <div className="split-pane" style={{ flexBasis: `${ratio * 100}%` }}>
        {left}
      </div>
      <div className="split-divider" onPointerDown={startDrag} role="separator" aria-label="Перетащите, чтобы изменить размер панелей">
        <span />
      </div>
      <div className="split-pane" style={{ flexBasis: `${(1 - ratio) * 100}%` }}>
        {onClose && (
          <button className="icon-btn small split-close" onClick={onClose} aria-label="Закрыть панель">
            ×
          </button>
        )}
        {right}
      </div>
    </div>
  );
}
