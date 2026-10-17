import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import type { Block } from '../../db/schema';
import { setBlockProps } from './blocks';

/** Свойства блока: «поле → значение». Свёрнуто — строка чипов, открыто — редактор. */
export function PropsView({ block, open, onOpen, onClose }: { block: Block; open: boolean; onOpen: () => void; onClose: () => void }) {
  const props = block.props ?? {};
  const [rows, setRows] = useState<[string, string][]>([]);

  useEffect(() => {
    if (open) setRows(Object.keys(props).length ? Object.entries(props) : [['', '']]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) {
    const entries = Object.entries(props);
    if (!entries.length) return null;
    return (
      <div className="props-chips" onClick={onOpen}>
        {entries.map(([k, v]) => (
          <span key={k} className="prop-chip">
            <span className="prop-key">{k}</span>
            {v}
          </span>
        ))}
      </div>
    );
  }

  const save = async () => {
    const next: Record<string, string> = {};
    for (const [k, v] of rows) if (k.trim()) next[k.trim()] = v.trim();
    await setBlockProps(block.id, { props: Object.keys(next).length ? next : undefined });
    onClose();
  };

  return (
    <div className="props-editor">
      {rows.map(([k, v], i) => (
        <div key={i} className="prop-row">
          <input
            className="text-input"
            placeholder="Поле"
            value={k}
            autoFocus={i === rows.length - 1 && !k}
            onChange={(e) => setRows(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))}
          />
          <input
            className="text-input"
            placeholder="Значение"
            value={v}
            onChange={(e) => setRows(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
          <button className="icon-btn small" aria-label="Удалить поле" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
            <Icon name="close" size={18} />
          </button>
        </div>
      ))}
      <div className="row-gap">
        <button className="btn small ghost" onClick={() => setRows([...rows, ['', '']])}>
          <Icon name="plus" size={18} /> Поле
        </button>
        <button className="btn small primary" onClick={save}>
          Готово
        </button>
      </div>
    </div>
  );
}
