import { Icon } from '../../components/Icon';
import { MARKER_COLORS, PEN_COLORS, PEN_SIZES } from './geometry';
import { inkStore, useInk, type Tool } from './inkStore';

const TOOLS: { tool: Tool; icon: 'pen' | 'marker' | 'eraser' | 'lasso'; label: string }[] = [
  { tool: 'pen', icon: 'pen', label: 'Перо' },
  { tool: 'marker', icon: 'marker', label: 'Маркер' },
  { tool: 'eraser', icon: 'eraser', label: 'Ластик' },
  { tool: 'lasso', icon: 'lasso', label: 'Лассо: выделить и перенести' },
];

export function InkToolbar({ floating }: { floating?: boolean }) {
  const ink = useInk();
  const colors = ink.tool === 'marker' ? MARKER_COLORS : PEN_COLORS;
  const current = ink.tool === 'marker' ? ink.markerColor : ink.penColor;
  return (
    <div className={'ink-toolbar' + (floating ? ' floating' : '')} onPointerDown={(e) => e.preventDefault()}>
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          className={'tool-btn' + (ink.tool === t.tool ? ' active' : '')}
          aria-label={t.label}
          title={t.label}
          onClick={() => inkStore.set({ tool: t.tool })}
        >
          <Icon name={t.icon} />
        </button>
      ))}
      {(ink.tool === 'pen' || ink.tool === 'marker') && <span className="tb-sep" />}
      {(ink.tool === 'pen' || ink.tool === 'marker') &&
        colors.map((c) => (
          <button
            key={c}
            className={'swatch' + (current === c ? ' active' : '')}
            aria-label="Цвет"
            onClick={() => inkStore.set(ink.tool === 'marker' ? { markerColor: c } : { penColor: c })}
          >
            <span style={{ background: c === 'auto' ? 'var(--ink-auto)' : c }} />
          </button>
        ))}
      {ink.tool === 'pen' && <span className="tb-sep" />}
      {ink.tool === 'pen' &&
        PEN_SIZES.map((s, i) => (
          <button key={s} className={'tool-btn' + (ink.penSize === i ? ' active' : '')} aria-label="Толщина" onClick={() => inkStore.set({ penSize: i })}>
            <span className="size-dot" style={{ width: s * 2 + 2, height: s * 2 + 2 }} />
          </button>
        ))}
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
