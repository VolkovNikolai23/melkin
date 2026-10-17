import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { BACKUP_REMIND_DAYS, getLastBackup } from '../db/backup';
import { createDoc, DOC_LABEL } from '../features/notes/docs';
import { navigate } from '../lib/router';
import { plural } from '../lib/time';
import { Icon } from './Icon';
import { useDueCount } from './useDue';

export function BackupReminder() {
  const info = useLiveQuery(async () => ({ last: await getLastBackup(), docs: await db.docs.count() }), []);
  if (!info || info.docs === 0) return null;
  const days = info.last ? Math.floor((Date.now() - info.last) / 86400000) : null;
  if (days !== null && days < BACKUP_REMIND_DAYS) return null;
  return (
    <div className="banner">
      <Icon name="download" />
      <span>{days === null ? 'Вы ещё ни разу не сохраняли резервную копию.' : `Последняя копия была ${days} ${plural(days, 'день', 'дня', 'дней')} назад.`}</span>
      <button className="btn small primary" onClick={() => navigate('settings')}>
        Сохранить копию
      </button>
    </div>
  );
}

export function Home() {
  const due = useDueCount();
  const recent = useLiveQuery(() => db.docs.orderBy('updatedAt').reverse().filter((d) => d.type !== 'folder').limit(8).toArray(), []);

  const create = async (type: 'note' | 'notebook') => navigate(`doc/${(await createDoc(type, null)).id}`);

  return (
    <div className="page-pad home">
      <BackupReminder />
      <section className="due-card">
        <div>
          <div className="due-num">{due?.total ?? '…'}</div>
          <div className="due-label">
            {due ? plural(due.total, 'карточка', 'карточки', 'карточек') : ''} к повторению
            {due && due.total > 0 && (
              <span className="muted">
                {' '}
                · повторить {due.due}, новых {due.fresh}
              </span>
            )}
          </div>
        </div>
        <button className="btn primary big" disabled={!due?.total} onClick={() => navigate('review')}>
          <Icon name="cards" /> Повторить
        </button>
      </section>

      <section>
        <h2 className="section-title">Недавние</h2>
        <div className="doc-list">
          {recent?.map((d) => (
            <button key={d.id} className="doc-card" onClick={() => navigate(`doc/${d.id}`)}>
              <Icon name={d.type === 'note' ? 'note' : 'notebook'} />
              <span>{d.title}</span>
              <small>{DOC_LABEL[d.type]}</small>
            </button>
          ))}
          <button className="doc-card new" onClick={() => create('note')}>
            <Icon name="plus" />
            <span>Новая заметка</span>
          </button>
          <button className="doc-card new" onClick={() => create('notebook')}>
            <Icon name="plus" />
            <span>Новая тетрадь</span>
          </button>
        </div>
      </section>

      <section className="cheatsheet">
        <h2 className="section-title">Шпаргалка</h2>
        <dl>
          <dt>вопрос :: ответ</dt>
          <dd>карточка; вложенные блоки тоже входят в ответ</dd>
          <dt>термин ;; определение</dt>
          <dd>двусторонняя карточка</dd>
          <dt>{'Ранг — это {{размерность образа}}'}</dt>
          <dd>клоз: каждый {'{{…}}'} — отдельная карточка</dd>
          <dt>$x^2$ и $$\int f$$</dt>
          <dd>формулы KaTeX (строчная и блочная)</dd>
          <dt>/draw</dt>
          <dd>рукописный блок для Apple Pencil</dd>
          <dt>Enter · Shift+Enter · Tab · Shift+Tab</dt>
          <dd>новый блок · перенос строки · вложить · вынести</dd>
        </dl>
      </section>
    </div>
  );
}
