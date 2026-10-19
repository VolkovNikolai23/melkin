import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useState } from 'react';
import { beginDrag } from '../../components/dnd';
import { Icon } from '../../components/Icon';
import { pickIconAndColor } from '../../components/IconPicker';
import { MenuButton, type MenuItem } from '../../components/Menu';
import { dialog } from '../../components/dialog';
import { db } from '../../db/db';
import type { Doc, DocType, FolderRole } from '../../db/schema';
import { navigate } from '../../lib/router';
import { askScan, importSlides, SLIDES_ACCEPT } from '../pdf/importSlides';
import { showBusy } from '../../components/busy';
import { openAsk } from '../ai/AskDialog';
import { badgeCount, sumDue, type DueCount } from '../review/scheduler';
import { docIcon } from './docIcons';
import { collectSubtree, createDoc, createFolder, isContainer, isLive, moveDoc, moveDocTo, renameDoc, shiftDoc, sortDocs, trashDoc } from './docs';
import { pickFiles } from './images';
import { setTemplate } from './templates';

// Счётчики к повторению по документам (передаются вниз по дереву без лишних пропсов)
const DueCtx = createContext<{ byDoc: Map<string, DueCount>; newLeft: number } | null>(null);

const NEW_TITLE: Record<string, string> = { subject: 'Название предмета', topic: 'Название темы', lecture: 'Название лекции', folder: 'Название папки' };

/** Создать документ; папкам, предметам, темам и лекциям сразу спрашиваем название. */
async function create(type: DocType, parentId: string | null, role?: FolderRole) {
  if (type === 'pdf') {
    // PDF, PowerPoint или фото (несколько фото — одна «презентация»)
    const files = await pickFiles(SLIDES_ACCEPT, true);
    if (!files.length) return;
    const opts = await askScan(files);
    if (!opts) return;
    const busy = showBusy('Импортирую…');
    try {
      const d = await importSlides(files, parentId, opts);
      if (d) navigate(`doc/${d.id}`);
    } catch (e) {
      dialog.alert('Не удалось импортировать', e instanceof Error ? e.message : String(e));
    } finally {
      busy();
    }
    return;
  }
  const askName = type === 'folder' || type === 'lecture';
  let title: string | undefined;
  if (askName) {
    const t = await dialog.prompt(NEW_TITLE[role ?? type], '');
    if (t === null) return;
    title = t.trim() || undefined;
  }
  const doc = type === 'folder' ? await createFolder(role, parentId, title) : await createDoc(type, parentId, title);
  if (type !== 'folder') navigate(`doc/${doc.id}`);
}

async function moveDialog(doc: Doc, docs: Doc[]) {
  const banned = new Set(collectSubtree(docs, doc.id));
  const targets = docs.filter((d) => isContainer(d) && !banned.has(d.id));
  const path = (d: Doc): string => {
    const p = docs.find((x) => x.id === d.parentId);
    return p ? path(p) + ' / ' + d.title : d.title;
  };
  const target = await dialog.select(
    `Переместить «${doc.title}»`,
    [{ value: '', label: '— Корень —' }, ...targets.map((f) => ({ value: f.id, label: path(f) })).sort((a, b) => a.label.localeCompare(b.label))],
    doc.parentId ?? '',
  );
  if (target !== null) await moveDoc(doc.id, target || null);
}

function createItems(doc: Doc): MenuItem[] {
  const id = doc.id;
  if (doc.type === 'lecture')
    return [
      { label: 'Новая заметка', icon: 'note', onClick: () => create('note', id) },
      { label: 'Импорт PDF, PowerPoint или фото', icon: 'pdf', onClick: () => create('pdf', id) },
    ];
  const base: MenuItem[] = [
    { label: 'Новая заметка', icon: 'note', onClick: () => create('note', id) },
    { label: 'Новая тетрадь', icon: 'notebook', onClick: () => create('notebook', id) },
    { label: 'Импорт PDF, PowerPoint или фото', icon: 'pdf', onClick: () => create('pdf', id) },
  ];
  if (doc.role === 'subject')
    return [{ label: 'Новая тема', icon: 'folderPlus', onClick: () => create('folder', id, 'topic') }, { label: 'Новая лекция', icon: 'lecture', onClick: () => create('lecture', id) }, ...base];
  if (doc.role === 'topic') return [{ label: 'Новая лекция', icon: 'lecture', onClick: () => create('lecture', id) }, ...base, { label: 'Новая папка', icon: 'folder', onClick: () => create('folder', id) }];
  return [...base, { label: 'Новая лекция', icon: 'lecture', onClick: () => create('lecture', id) }, { label: 'Новая папка', icon: 'folder', onClick: () => create('folder', id) }];
}

function TreeNode({ doc, docs, depth, activeId, onNavigate }: { doc: Doc; docs: Doc[]; depth: number; activeId: string | null; onNavigate: () => void }) {
  const isFolder = doc.type === 'folder';
  // содержимое лекции (конспект, презентация) открывается во вкладках лекции, в дереве не дублируем
  const kids = isFolder ? docs.filter((d) => d.parentId === doc.id).sort(sortDocs) : [];
  const dueCtx = useContext(DueCtx);
  const subtree = isFolder || doc.type === 'lecture' ? collectSubtree(docs, doc.id) : [doc.id];
  const dueN = dueCtx ? badgeCount(sumDue(dueCtx.byDoc, subtree), dueCtx.newLeft) : 0;
  const active = activeId !== null && (activeId === doc.id || (doc.type === 'lecture' && subtree.includes(activeId)));

  const items: MenuItem[] = [
    ...(isFolder || doc.type === 'lecture' ? createItems(doc) : []),
    { label: 'Повторить карточки', icon: 'cards', onClick: () => navigate(`review?scope=${isFolder || doc.type === 'lecture' ? 'folder' : 'doc'}:${doc.id}`) },
    {
      label: 'Переименовать',
      icon: 'edit',
      onClick: async () => {
        const t = await dialog.prompt('Новое название', doc.title);
        if (t?.trim()) renameDoc(doc.id, t.trim());
      },
    },
    { label: 'Иконка и цвет…', icon: 'palette', onClick: () => pickIconAndColor(doc) },
    ...(!isFolder && doc.type !== 'daily' && doc.type !== 'lecture'
      ? [{ label: doc.isTemplate ? 'Убрать из шаблонов' : 'Сделать шаблоном', icon: 'template' as const, onClick: () => setTemplate(doc.id, !doc.isTemplate) }]
      : []),
    { label: 'Переместить в…', icon: 'move', onClick: () => moveDialog(doc, docs) },
    { label: 'Выше', icon: 'arrowUp', onClick: () => shiftDoc(doc.id, -1) },
    { label: 'Ниже', icon: 'arrowDown', onClick: () => shiftDoc(doc.id, 1) },
    {
      label: 'В корзину',
      icon: 'trash',
      danger: true,
      onClick: async () => {
        const n = collectSubtree(docs, doc.id).length - 1;
        const msg = `${n > 0 ? `Вместе с ним — вложенных документов: ${n}. ` : ''}В корзине он пролежит 30 дней, оттуда его можно вернуть.`;
        if (await dialog.confirm(`Удалить «${doc.title}» в корзину?`, 'Удалить', msg)) {
          if (activeId && collectSubtree(docs, doc.id).includes(activeId)) navigate('');
          await trashDoc(doc.id);
        }
      },
    },
  ];

  return (
    <div>
      <div
        className={'tree-row' + (active ? ' active' : '') + (doc.role ? ` role-${doc.role}` : '')}
        data-drop-doc={doc.id}
        style={{ paddingLeft: 8 + depth * 16, color: doc.color || undefined }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          beginDrag(e, {
            attr: 'data-drop-doc',
            id: doc.id,
            label: doc.title,
            canNest: (tid) => {
              const t = docs.find((d) => d.id === tid);
              return !!t && isContainer(t);
            },
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
        <span className="tree-icon">
          <Icon name={docIcon(doc)} size={18} />
        </span>
        <span className="tree-title">{doc.title || 'Без названия'}</span>
        {doc.isTemplate && <span className="tree-badge">шаблон</span>}
        {dueN > 0 && (
          <span className="tree-due" title="Карточек к повторению">
            {dueN}
          </span>
        )}
        <MenuButton items={items} />
      </div>
      {isFolder && !doc.collapsed && (
        <>
          {kids.map((k) => (
            <TreeNode key={k.id} doc={k} docs={docs} depth={depth + 1} activeId={activeId} onNavigate={onNavigate} />
          ))}
          {kids.length === 0 && (
            <div className="tree-empty" style={{ paddingLeft: 40 + depth * 16 }}>
              {doc.role === 'subject' ? 'добавьте тему в меню «⋯»' : doc.role === 'topic' ? 'добавьте лекцию в меню «⋯»' : 'пусто'}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function Sidebar({
  activeId,
  routeName,
  due,
  onNavigate,
  onCollapse,
}: {
  activeId: string | null;
  routeName: string;
  due: { total: number; byDoc: Map<string, DueCount>; newLeft: number } | undefined;
  onNavigate: () => void;
  onCollapse: () => void;
}) {
  const dueCount = due?.total ?? 0;
  const docs = useLiveQuery(() => db.docs.filter(isLive).toArray(), []);
  const trashCount = useLiveQuery(() => db.docs.filter((d) => !!d.trashRoot).count(), []);
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
        <input type="search" placeholder="Поиск по всему" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" />
      </form>

      <nav className="sidebar-nav">
        <button className={'nav-item' + (routeName === '' ? ' active' : '')} onClick={() => nav('')}>
          <Icon name="today" /> Сегодня
        </button>
        <button className={'nav-item' + (routeName === 'review' ? ' active' : '')} onClick={() => nav('review')}>
          <Icon name="cards" /> Повторить
          {dueCount > 0 && <span className="badge">{dueCount}</span>}
        </button>
        <button className={'nav-item' + (routeName === 'stats' ? ' active' : '')} onClick={() => nav('stats')}>
          <Icon name="star" /> Статистика
        </button>
        <button className={'nav-item' + (routeName === 'glossary' ? ' active' : '')} onClick={() => nav('glossary')}>
          <Icon name="book" /> Словарь
        </button>
        <button className="nav-item" onClick={() => openAsk(null)}>
          <Icon name="sparkle" /> Спросить ИИ
        </button>
      </nav>

      <DueCtx.Provider value={due ? { byDoc: due.byDoc, newLeft: due.newLeft } : null}>
        <div className="tree">
          <div className="tree-label">Предметы и папки</div>
          {roots.map((d) => (
            <TreeNode key={d.id} doc={d} docs={docs!} depth={0} activeId={activeId} onNavigate={onNavigate} />
          ))}
          {docs && roots.length === 0 && <div className="tree-empty">Начните с предмета — кнопка внизу</div>}
        </div>
      </DueCtx.Provider>

      <nav className="sidebar-nav bottom">
        <button className={'nav-item' + (routeName === 'trash' ? ' active' : '')} onClick={() => nav('trash')}>
          <Icon name="trash2" /> Корзина
          {(trashCount ?? 0) > 0 && <span className="badge muted-badge">{trashCount}</span>}
        </button>
        <button className={'nav-item' + (routeName === 'settings' ? ' active' : '')} onClick={() => nav('settings')}>
          <Icon name="settings" /> Настройки
        </button>
      </nav>

      <div className="sidebar-foot">
        <button className="btn primary small grow" onClick={() => create('folder', null, 'subject')}>
          <Icon name="plus" size={18} /> Предмет
        </button>
        <MenuButton
          label="Создать…"
          className="btn small"
          items={[
            { label: 'Заметка', icon: 'note', onClick: () => create('note', null) },
            { label: 'Тетрадь', icon: 'notebook', onClick: () => create('notebook', null) },
            { label: 'Импорт PDF, PowerPoint или фото', icon: 'pdf', onClick: () => create('pdf', null) },
            { label: 'Лекция', icon: 'lecture', onClick: () => create('lecture', null) },
            { label: 'Папка', icon: 'folder', onClick: () => create('folder', null) },
          ]}
        >
          <Icon name="more" size={18} /> Ещё
        </MenuButton>
      </div>
    </aside>
  );
}
