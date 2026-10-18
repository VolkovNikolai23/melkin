import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { docLabel, emptyTrash, purgeDoc, restoreDoc, TRASH_DAYS } from '../features/notes/docs';
import { docIcon } from '../features/notes/docIcons';
import { plural } from '../lib/time';
import { dialog } from './dialog';
import { Icon } from './Icon';

/** Корзина: удалённое лежит 30 дней, потом исчезает само. */
export function TrashView() {
  const items = useLiveQuery(async () => {
    const all = await db.docs.filter((d) => !!d.deletedAt).toArray();
    return all
      .filter((d) => d.trashRoot)
      .sort((a, b) => b.deletedAt! - a.deletedAt!)
      .map((d) => ({ d, inside: all.filter((x) => x.deletedAt === d.deletedAt && x.id !== d.id).length }));
  }, []);
  if (!items) return null;

  const daysLeft = (at: number) => Math.max(0, TRASH_DAYS - Math.floor((Date.now() - at) / 86400000));

  return (
    <div className="page-pad">
      <div className="doc-head-row">
        <h1 className="grow-title">Корзина</h1>
        {items.length > 0 && (
          <button
            className="btn small danger"
            onClick={async () => {
              if (await dialog.confirm('Очистить корзину?', 'Удалить', 'Всё удалится насовсем вместе с карточками и историей повторений.')) emptyTrash();
            }}
          >
            Очистить
          </button>
        )}
      </div>
      <p className="muted">Удалённое хранится {TRASH_DAYS} дней, затем удаляется насовсем.</p>
      {items.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">
            <Icon name="trash2" size={36} />
          </div>
          <p className="muted">Корзина пуста</p>
        </div>
      )}
      <div className="trash-list">
        {items.map(({ d, inside }) => (
          <div key={d.id} className="trash-row">
            <Icon name={docIcon(d)} size={20} />
            <div className="trash-main">
              <div className="trash-title">{d.title}</div>
              <small className="muted">
                {docLabel(d)}
                {inside ? ` · вложенных: ${inside}` : ''} · удалится через {daysLeft(d.deletedAt!)} {plural(daysLeft(d.deletedAt!), 'день', 'дня', 'дней')}
              </small>
            </div>
            <button className="btn small" onClick={() => restoreDoc(d.id)}>
              <Icon name="restore" size={18} /> Вернуть
            </button>
            <button
              className="icon-btn small"
              aria-label="Удалить насовсем"
              onClick={async () => {
                if (await dialog.confirm(`Удалить «${d.title}» насовсем?`, 'Удалить')) purgeDoc(d.id);
              }}
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
