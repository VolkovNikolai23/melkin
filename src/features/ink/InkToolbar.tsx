import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '../../components/Icon';
import { MARKER_COLORS, MARKER_SIZES, PALETTE, PEN_COLORS, PEN_SIZES } from './geometry';
import { inkStore, useInk, type Tool } from './inkStore';

const TOOLS: { tool: Tool; icon: IconName; label: string }[] = [
  { tool: 'pen', icon: 'pen', label: 'Ручка' },
  { tool: 'marker', icon: 'marker', label: 'Маркер-выделитель' },
  { tool: 'eraser', icon: 'eraser', label: 'Ластик (стирает штрих целиком)' },
  { tool: 'lasso', icon: 'lasso', label: 'Лассо: выделить, перенести, масштабировать' },
  { tool: 'eyedropper', icon: 'eyedropper', label: 'Пипетка: взять цвет с листа' },
];

const swatchBg = (c: string) => (c === 'auto' ? 'var(--ink-auto)' : c);

/** Всплывающая палитра: фиксированное положение, потому что панель прокручивается по горизонтали. */
function PalettePopover({ anchor, onClose, current, onPick }: { anchor: HTMLElement; onClose: () => void; current: string; onPick: (c: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const r = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, window.innerWidth - 300));
  const below = r.bottom + 330 < window.innerHeight;
  useEffect(() => {
    const on = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', on, true);
    return () => window.removeEventListener('pointerdown', on, true);
  }, [anchor, onClose]);
  return createPortal(
    <div ref={ref} className="palette-pop" style={{ left, ...(below ? { top: r.bottom + 6 } : { bottom: window.innerHeight - r.top + 6 }) }} role="dialog" aria-label="Палитра">
      <div className="palette-grid">
        {PALETTE.map((c) => (
          <button key={c} className={'swatch' + (current === c ? ' active' : '')} aria-label={c} onClick={() => (onPick(c), onClose())}>
            <span style={{ background: c }} />
          </button>
        ))}
      </div>
      <label className="palette-custom">
        <input type="color" value={current.startsWith('#') ? current : '#1f2937'} onChange={(e) => onPick(e.target.value)} />
        Любой цвет…
      </label>
    </div>,
    document.body,
  );
}

/** Панель инструментов рукописного ввода. withText — инструмент «Текст» (только на листах тетради). */
export function InkToolbar({ floating, withText }: { floating?: boolean; withText?: boolean }) {
  const ink = useInk();
  const [palette, setPalette] = useState<HTMLElement | null>(null);
  const drawing = ink.tool === 'pen' || ink.tool === 'marker' || ink.tool === 'text';
  const isMarker = ink.tool === 'marker';
  const base = isMarker ? MARKER_COLORS : PEN_COLORS;
  const current = isMarker ? ink.markerColor : ink.penColor;
  // выбранный из палитры цвет показываем рядом с основными
  const colors = [...base, ...ink.recent.filter((c) => !base.includes(c)).slice(0, 3)];
  if (!colors.includes(current)) colors.push(current);
  const tools = withText ? [...TOOLS, { tool: 'text' as Tool, icon: 'text' as IconName, label: 'Текст и картинки на листе' }] : TOOLS;

  return (
    <div className={'ink-toolbar' + (floating ? ' floating' : '')} onPointerDown={(e) => e.target instanceof HTMLInputElement || e.preventDefault()}>
      {tools.map((t) => (
        <button
          key={t.tool}
          className={'tool-btn' + (ink.tool === t.tool ? ' active' : '')}
          aria-label={t.label}
          title={t.label}
          aria-pressed={ink.tool === t.tool}
          onClick={() => inkStore.set(t.tool === 'eyedropper' ? { tool: t.tool, prevTool: ink.tool === 'eyedropper' ? ink.prevTool : ink.tool } : { tool: t.tool })}
        >
          <Icon name={t.icon} />
        </button>
      ))}
      {drawing && <span className="tb-sep" />}
      {drawing &&
        colors.map((c) => (
          <button key={c} className={'swatch' + (current === c ? ' active' : '')} aria-label="Цвет" title={c === 'auto' ? 'Цвет текста' : c} onClick={() => inkStore.setColor(c)}>
            <span style={{ background: swatchBg(c) }} />
          </button>
        ))}
      {drawing && (
        <button className={'tool-btn' + (palette ? ' active' : '')} aria-label="Палитра" title="Палитра и любой цвет" onClick={(e) => setPalette(palette ? null : e.currentTarget)}>
          <Icon name="palette" />
        </button>
      )}
      {palette && <PalettePopover anchor={palette} current={current} onClose={() => setPalette(null)} onPick={(c) => inkStore.setColor(c)} />}
      {(ink.tool === 'pen' || isMarker) && <span className="tb-sep" />}
      {(ink.tool === 'pen' || isMarker) &&
        (isMarker ? MARKER_SIZES : PEN_SIZES).map((s) => {
          const active = (isMarker ? ink.markerWidth : ink.penWidth) === s;
          const dot = isMarker ? s / 2 + 4 : s * 1.6 + 3;
          return (
            <button key={s} className={'tool-btn size' + (active ? ' active' : '')} aria-label={`Толщина ${s}`} onClick={() => inkStore.set(isMarker ? { markerWidth: s } : { penWidth: s })}>
              <span className="size-dot" style={{ width: dot, height: dot, opacity: isMarker ? 0.5 : 1 }} />
            </button>
          );
        })}
      {ink.tool === 'pen' && (
        <button
          className={'tool-btn' + (ink.autoShapes ? ' active' : '')}
          aria-pressed={ink.autoShapes}
          aria-label="Автофигуры"
          title="Автофигуры: нарисуйте линию, круг, прямоугольник или стрелку и задержите Pencil"
          onClick={() => inkStore.set({ autoShapes: !ink.autoShapes })}
        >
          <Icon name="shapes" />
        </button>
      )}
      <span className="tb-sep" />
      <button className="tool-btn" aria-label="Отменить" title="Отменить" disabled={!ink.active?.canUndo} onClick={() => ink.active?.undo()}>
        <Icon name="undo" />
      </button>
      <button className="tool-btn" aria-label="Повторить" title="Повторить" disabled={!ink.active?.canRedo} onClick={() => ink.active?.redo()}>
        <Icon name="redo" />
      </button>
    </div>
  );
}
