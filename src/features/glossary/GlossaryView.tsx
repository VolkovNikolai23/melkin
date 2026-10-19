import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { dialog } from '../../components/dialog';
import { db } from '../../db/db';
import { navigate } from '../../lib/router';
import { plural } from '../../lib/time';
import { renderText } from '../notes/render';
import { allTerms, termKey, upsertTerm, type Term } from './glossary';
import { ZhSettings } from '../zh/ZhSettings';

function TermEditor({ initial, onDone }: { initial?: Term; onDone: () => void }) {
  const [term, setTerm] = useState(initial?.term ?? '');
  const [definition, setDefinition] = useState(initial?.definition ?? '');
  const [zh, setZh] = useState(initial?.zh ?? '');
  const [pinyin, setPinyin] = useState(initial?.pinyin ?? '');
  const save = async () => {
    if (!term.trim() || !definition.trim()) return;
    // переименование: старую запись убираем
    if (initial?.entryId && termKey(term) !== initial.key) await db.glossary.delete(initial.entryId);
    await upsertTerm({ term, definition, zh: zh || undefined, pinyin: pinyin || undefined, docId: initial?.docId }, 'user');
    onDone();
  };
  return (
    <div className="gl-editor">
      <input className="text-input" placeholder="Термин" value={term} onChange={(e) => setTerm(e.target.value)} autoFocus />
      <textarea className="text-input" rows={2} placeholder="Определение — простыми словами" value={definition} onChange={(e) => setDefinition(e.target.value)} />
      <div className="gl-editor-row">
        <input className="text-input" placeholder="По-китайски (необязательно)" value={zh} onChange={(e) => setZh(e.target.value)} lang="zh" />
        <input className="text-input" placeholder="Пиньинь" value={pinyin} onChange={(e) => setPinyin(e.target.value)} />
      </div>
      <div className="row-gap">
        <button className="btn primary small" onClick={save} disabled={!term.trim() || !definition.trim()}>
          Сохранить
        </button>
        <button className="btn small ghost" onClick={onDone}>
          Отмена
        </button>
      </div>
    </div>
  );
}

/** Словарь терминов: всё, что собрал ИИ, карточки-понятия и свои записи. */
export function GlossaryView({ initial }: { initial: string }) {
  const terms = useLiveQuery(allTerms, []);
  const titles = useLiveQuery(async () => new Map((await db.docs.toArray()).map((d) => [d.id, d.title])), []);
  const [q, setQ] = useState(initial);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  if (!terms) return <div className="page-pad muted">Загрузка…</div>;
  const k = termKey(q);
  const list = k ? terms.filter((t) => t.key.includes(k) || termKey(t.definition).includes(k) || (t.zh ?? '').includes(q.trim())) : terms;

  return (
    <div className="page-pad glossary">
      <h1>Словарь терминов</h1>
      <p className="muted">
        {terms.length} {plural(terms.length, 'термин', 'термина', 'терминов')}. Термины собирает ИИ при сводках лекций, сюда же попадают карточки «понятие :: определение». В заметках термины подчёркнуты пунктиром — нажмите, чтобы увидеть определение.
      </p>
      <div className="row-gap">
        <div className="search-box gl-search">
          <Icon name="search" />
          <input type="search" placeholder="Найти термин" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="btn" onClick={() => setEditing('new')}>
          <Icon name="plus" /> Термин
        </button>
      </div>
      {editing === 'new' && <TermEditor onDone={() => setEditing(null)} />}
      <div className="gl-list">
        {list.map((t) =>
          editing === t.key ? (
            <TermEditor key={t.key} initial={t} onDone={() => setEditing(null)} />
          ) : (
            <div key={t.key} className="gl-item">
              <div className="gl-item-head">
                <strong>{t.term}</strong>
                {t.zh && (
                  <span className="gl-zh-inline" lang="zh">
                    {t.zh} <span className="muted">{t.pinyin}</span>
                  </span>
                )}
                <span className="gl-item-actions">
                  {t.entryId ? (
                    <>
                      <button className="icon-btn small" onClick={() => setEditing(t.key)} aria-label="Изменить">
                        <Icon name="edit" size={18} />
                      </button>
                      <button
                        className="icon-btn small"
                        onClick={async () => (await dialog.confirm(`Удалить «${t.term}» из словаря?`, 'Удалить')) && db.glossary.delete(t.entryId!)}
                        aria-label="Удалить"
                      >
                        <Icon name="trash" size={18} />
                      </button>
                    </>
                  ) : (
                    <span className="muted small">из карточки</span>
                  )}
                </span>
              </div>
              <div className="gl-def" dangerouslySetInnerHTML={{ __html: renderText(t.definition) }} />
              {t.docId && titles?.get(t.docId) && (
                <button className="btn small ghost gl-src" onClick={() => navigate(`doc/${t.docId}${t.blockId ? `?b=${t.blockId}` : ''}`)}>
                  <Icon name="note" size={14} /> {titles.get(t.docId)}
                </button>
              )}
            </div>
          ),
        )}
        {!list.length && <p className="muted">{terms.length ? 'Ничего не найдено.' : 'Пока пусто: сделайте сводку лекции или карточку «термин :: определение».'}</p>}
      </div>
      <ZhSettings />
    </div>
  );
}
