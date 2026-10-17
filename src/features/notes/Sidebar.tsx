import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { MenuButton, type MenuItem } from '../../components/Menu';
import { dialog } from '../../components/dialog';
import { db } from '../../db/db';
import type { Doc, DocType } from '../../db/schema';
import { navigate } from '../../lib/router';
import { beginDrag } from '../../components/dnd';
import { TYPE_ICON } from './docIcons';
import { getOrCreateDaily } from './daily';
import { setTemplate } from './templates';
import { collectSubtree, createDoc, deleteDoc, moveDoc, moveDocTo, renameDoc, shiftDoc, sortDocs } from './docs';


async function create(type: DocType, parentId: string | null) {
  const doc = await createDoc(type, parentId);
  if (type === 'folder') {
    const name = await dialog.prompt('Название папки', doc.title);
    if (name?.trim()) await renameDoc(doc.id, name.trim());
  } else navigate(`doc/${doc.id}`);
}

async function moveDialog(doc: Doc, docs: Doc[]) {
  const banned = new Set(collectSubtree(docs, doc.id));
  const folders = docs.filter((d) => d.type === 'folder' && !banned.has(d.id));
  const path = (d: Doc): string => {
    const p = docs.find((x) => x.id === d.parentId);
    return p ? path(p) + ' / ' + d.title : d.title;
  };
  const target = await dialog.select(
    `Переместить «${doc.title}»`,
    [{ value: '', label: '— Корень —' }, ...folders.map((f) => ({ value: f.id, label: path(f) })).sort((a, b) => a.label.localeCompare(b.label))],
    doc.parentId ?? '',
  );
  if (target !== null) await moveDoc(doc.id, target || null);
}

function TreeNode({ doc, docs, depth, activeId, onNavigate }: { doc: Doc; docs: Doc[]; depth: number; activeId: string | null; onNavigate: () => void }) {
  const kids = docs.filter((d) => d.parentId === doc.id).sort(sortDocs);
  const isFolder = doc.type === 'folder';

  const items: MenuItem[] = [
    ...(isFolder
      ? [
          { label: 'Новая заметка', icon: 'note' as const, onClick: () => create('note', doc.id) },
          { label: 'Новая тетрадь', icon: 'notebook' as const, onClick: () => create('notebook', doc.id) },
          { label: 'Новая папка', icon: 'folder' as const, onClick: () => create('folder', doc.id) },
        ]
      : []),
    { label: 'Повторить карточки', icon: 'cards', onClick: () => navigate(`review?scope=${isFolder ? 'folder' : 'doc'}:${doc.id}`) },
    {
      label: 'Переименовать',
      icon: 'edit',
      onClick: async () => {
        const t = await dialog.prompt('Новое название', doc.title);
        if (t?.trim()) renameDoc(doc.id, t.trim());
      },
    },
    ...(!isFolder && doc.type !== 'daily'
      ? [{ label: doc.isTemplate ? 'Убрать из шаблонов' : 'Сделать шаблоном', icon: 'template' as const, onClick: () => setTemplate(doc.id, !doc.isTemplate) }]
      : []),
    { label: 'Переместить в…', icon: 'move', onClick: () => moveDialog(doc, docs) },
    { label: 'Выше', icon: 'arrowUp', onClick: () => shiftDoc(doc.id, -1) },
    { label: 'Ниже', icon: 'arrowDown', onClick: () => shiftDoc(doc.id, 1) },
    {
      label: 'Удалить',
      icon: 'trash',
      danger: true,
      onClick: async () => {
        const n = collectSubtree(docs, doc.id).length - 1;
        const msg = n > 0 ? `Вместе с ним удалится вложенных документов: ${n}. Карточки и история тоже удалятся.` : 'Карточки этого документа тоже удалятся.';
        if (await dialog.confirm(`Удалить «${doc.title}»?`, 'Удалить', msg)) {
          if (activeId && collectSubtree(docs, doc.id).includes(activeId)) navigate('');
          await deleteDoc(doc.id);
        }
      },
    },
  ];

  return (
    <div>
      <div
        className={'tree-row' + (activeId === doc.id ? ' active' : '')}
        data-drop-doc={doc.id}
        style={{ paddingLeft: 8 + depth * 16 }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          beginDrag(e, {
            attr: 'data-drop-doc',
            id: doc.id,
            label: doc.title,
            canNest: (tid) => docs.find((d) => d.id === tid)?.type === 'folder',
            onDrop: (tid, pos) => moveDocTo(doc.id, tid, pos),
          });
        }}
        onClick={() => {
          if (isFolder) db.docs.update(doc.id, { collapsed: !doc.collapsed });
          else {
            navigate(`doc/${doc.id}`);
            onNavigate();
          }
        }}
      >
        <span className="tree-chevron">{isFolder && <Icon name={doc.collapsed ? 'right' : 'down'} size={16} />}</span>
        <Icon name={TYPE_ICON[doc.type]} size={18} />
        <span className="tree-title">{doc.title || 'Без названия'}</span>
        {doc.isTemplate && <span className="tree-badge">шаблон</span>}
        <MenuButton items={items} />
      </div>
      {isFolder && !doc.collapsed && (
        <>
          {kids.map((k) => (
            <TreeNode key={k.id} doc={k} docs={docs} depth={depth + 1} activeId={activeId} onNavigate={onNavigate} />
          ))}
          {kids.length === 0 && (
            <div className="tree-empty" style={{ paddingLeft: 40 + depth * 16 }}>
              пусто
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function Sidebar({ activeId, routeName, dueCount, onNavigate, onCollapse }: { activeId: string | null; routeName: string; dueCount: number; onNavigate: () => void; onCollapse: () => void }) {
  const docs = useLiveQuery(() => db.docs.toArray(), []);
  const [q, setQ] = useState('');
  const roots = (docs ?? []).filter((d) => d.parentId === null).sort(sortDocs);

  const nav = (to: string) => {
    navigate(to);
    onNavigate();
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <button className="brand" onClick={() => nav('')}>
          <span className="brand-heart">
            <Icon name="heart" size={18} />
          </span>
          Мелькин
        </button>
        <button className="icon-btn" onClick={onCollapse} aria-label="Скрыть панель">
          <Icon name="sidebar" />
        </button>
      </div>

      <form
        className="sidebar-search"
        onSubmit={(e) => {
          e.preventDefault();
          nav(`search?q=${encodeURIComponent(q)}`);
        }}
      >
        <Icon name="search" size={18} />
        <input type="search" placeholder="Поиск по заметкам" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" />
      </form>

      <nav className="sidebar-nav">
        <button className={'nav-item' + (routeName === '' ? ' active' : '')} onClick={() => nav('')}>
          <Icon name="home" /> Главная
        </button>
        <button
          className="nav-item"
          onClick={async () => {
            const d = await getOrCreateDaily();
            nav(`doc/${d.id}`);
          }}
        >
          <Icon name="today" /> Сегодня
        </button>
        <button className={'nav-item' + (routeName === 'review' ? ' active' : '')} onClick={() => nav('review')}>
          <Icon name="cards" /> Повторить
          {dueCount > 0 && <span className="badge">{dueCount}</span>}
        </button>
        <button className={'nav-item' + (routeName === 'tags' || routeName === 'tag' ? ' active' : '')} onClick={() => nav('tags')}>
          <Icon name="tag" /> Теги
        </button>
        <button className={'nav-item' + (routeName === 'settings' ? ' active' : '')} onClick={() => nav('settings')}>
          <Icon name="settings" /> Настройки и копии
        </button>
      </nav>

      <div className="tree">
        <div className="tree-label">Документы</div>
        {roots.map((d) => (
          <TreeNode key={d.id} doc={d} docs={docs!} depth={0} activeId={activeId} onNavigate={onNavigate} />
        ))}
        {docs && roots.length === 0 && <div className="tree-empty">Пока ничего нет</div>}
      </div>

      <div className="sidebar-foot">
        <button className="btn ghost small" onClick={() => create('note', null)}>
          <Icon name="note" size={18} /> Заметка
        </button>
        <button className="btn ghost small" onClick={() => create('notebook', null)}>
          <Icon name="notebook" size={18} /> Тетрадь
        </button>
        <button className="btn ghost small" onClick={() => create('folder', null)}>
          <Icon name="folder" size={18} /> Папка
        </button>
      </div>
    </aside>
  );
}
