import { useState, useSyncExternalStore } from 'react';
import { db } from '../db/db';
import type { Doc } from '../db/schema';
import { docIcon, PICKABLE_COLORS, PICKABLE_ICONS } from '../features/notes/docIcons';
import { Icon, type IconName } from './Icon';

// Окно выбора иконки и цвета для предмета, темы, папки или лекции.

let current: Doc | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function pickIconAndColor(doc: Doc) {
  current = doc;
  emit();
}

export function IconPickerHost() {
  const doc = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  if (!doc) return null;
  return <IconPicker key={doc.id} doc={doc} />;
}

function IconPicker({ doc }: { doc: Doc }) {
  const [icon, setIcon] = useState<IconName>(docIcon(doc));
  const [color, setColor] = useState(doc.color ?? '');
  const close = () => {
    current = null;
    emit();
  };
  const save = async () => {
    await db.docs.update(doc.id, { icon, color: color || undefined });
    close();
  };
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal icon-picker" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <h3>Иконка и цвет</h3>
        <div className="picker-preview" style={{ color: color || undefined }}>
          <Icon name={icon} size={28} /> <span>{doc.title}</span>
        </div>
        <div className="icon-grid">
          {PICKABLE_ICONS.map((n) => (
            <button key={n} className={'icon-choice' + (n === icon ? ' active' : '')} aria-label={n} onClick={() => setIcon(n)} style={{ color: color || undefined }}>
              <Icon name={n} size={22} />
            </button>
          ))}
        </div>
        <div className="color-row">
          {PICKABLE_COLORS.map((c) => (
            <button key={c.id} className={'color-choice' + (c.value === color ? ' active' : '')} title={c.label} aria-label={c.label} onClick={() => setColor(c.value)}>
              <span style={{ background: c.value || 'var(--text)' }} />
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={close}>
            Отмена
          </button>
          <button className="btn primary" onClick={save}>
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}
