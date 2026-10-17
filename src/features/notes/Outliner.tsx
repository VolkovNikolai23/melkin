import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { beginDrag } from '../../components/dnd';
import { Icon, type IconName } from '../../components/Icon';
import { MenuButton, type MenuItem } from '../../components/Menu';
import { dialog } from '../../components/dialog';
import { db } from '../../db/db';
import type { Block } from '../../db/schema';
import { keepKeyboard } from '../../lib/keyboard';
import { navigate } from '../../lib/router';
import { InkBlock } from '../ink/InkBlock';
import { InkToolbar } from '../ink/InkToolbar';
import { BlockEditor } from './BlockEditor';
import { appendBlock, childrenMap, deleteBlock, indent, insertAfter, moveBlock, moveBlockTo, outdent, setCollapsed, visibleOrder } from './blocks';
import { createDoc } from './docs';
import { CodeBlock } from './CodeBlock';
import { ImageBlock } from './ImageBlock';
import { insertImages, pickFiles } from './images';
import { PropsView } from './PropsView';
import { CardsPanel } from '../cards/CardsPanel';
import { OutlinerContext, useOutliner, type Caret, type EditorAction, type OutlinerCtx } from './outlinerContext';
import { HIGHLIGHT_COLORS, renderText } from './render';

const RenderedText = memo(function RenderedText({ text }: { text: string }) {
  const html = useMemo(() => renderText(text), [text]);
  if (!text.trim()) return <span className="placeholder">&nbsp;</span>;
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
});

/** Переход по [[ссылке]]: открываем документ с таким названием или создаём новый. */
export async function openLink(title: string) {
  const t = title.trim().toLowerCase();
  const doc = await db.docs.filter((d) => d.type !== 'folder' && d.title.trim().toLowerCase() === t).first();
  navigate(`doc/${(doc ?? (await createDoc('note', null, title.trim()))).id}`);
}

/** Номер пункта нумерованного списка: считаем подряд идущих соседей с нумерацией. */
function listNumber(block: Block, siblings: Block[]): number {
  const i = siblings.findIndex((s) => s.id === block.id);
  let n = 1;
  for (let j = i - 1; j >= 0 && siblings[j].list === 'number'; j--) n++;
  return n;
}

export function BlockItem({ block }: { block: Block }) {
  const ctx = useOutliner();
  const kids = ctx.kids.get(block.id) ?? [];
  const editing = ctx.editing?.id === block.id;
  const cards = ctx.cardCount.get(block.id) ?? 0;
  const rowRef = useRef<HTMLDivElement>(null);
  const highlighted = ctx.highlight === block.id;
  const [cardsOpen, setCardsOpen] = useState(false);

  useEffect(() => {
    if (highlighted) rowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlighted]);

  const startEdit = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    const link = t.closest('[data-link]');
    if (link) return openLink(link.getAttribute('data-link')!);
    const tag = t.closest('[data-tag]');
    if (tag) return navigate(`tag/${encodeURIComponent(tag.getAttribute('data-tag')!.toLowerCase())}`);
    if (window.getSelection()?.toString()) return;
    e.preventDefault();
    keepKeyboard();
    ctx.setEditing({ id: block.id, caret: 'end' });
  };

  const onBulletDown = (e: React.PointerEvent) =>
    beginDrag(e, {
      attr: 'data-drop-block',
      id: block.id,
      label: { ink: 'Рисунок', image: 'Картинка', portal: 'Портал', code: 'Код' }[block.kind as string] ?? block.text.slice(0, 40),
      canNest: () => true,
      onDrop: (tid, pos) => moveBlockTo(block.id, tid, pos),
    });

  const kindLabel = block.kind === 'ink' ? 'рисунок' : 'портал';
  const inkMenu: MenuItem[] = [
    { label: 'Текстовый блок ниже', icon: 'plus', onClick: async () => ctx.setEditing({ id: (await insertAfter(block, '', 'text', false)).id, caret: 'start' }) },
    { label: 'Вложить', icon: 'indent', onClick: () => indent(block) },
    { label: 'Вынести', icon: 'outdent', onClick: () => outdent(block) },
    { label: 'Выше', icon: 'arrowUp', onClick: () => moveBlock(block, -1) },
    { label: 'Ниже', icon: 'arrowDown', onClick: () => moveBlock(block, 1) },
    {
      label: `Удалить ${kindLabel}`,
      icon: 'trash',
      danger: true,
      onClick: async () => {
        if (await dialog.confirm(`Удалить ${kindLabel}?`, 'Удалить')) deleteBlock(block);
      },
    },
  ];

  const siblings = ctx.kids.get(block.parentId) ?? [];
  const numbered = block.list === 'number';

  return (
    <div className="block">
      <div
        ref={rowRef}
        data-drop-block={block.id}
        className={
          'block-row' +
          (highlighted ? ' flash' : '') +
          (block.kind === 'ink' ? ' ink-row' : '') +
          (block.heading ? ` h${block.heading}` : '')
        }
      >
        <button
          className={'bullet' + (kids.length ? ' has-kids' : '') + (block.collapsed && kids.length ? ' collapsed' : '') + (numbered ? ' numbered' : '')}
          aria-label={kids.length ? (block.collapsed ? 'Развернуть' : 'Свернуть') : 'Блок'}
          title="Нажмите — свернуть, удерживайте — перетащить"
          onPointerDown={onBulletDown}
          onClick={() => (kids.length ? setCollapsed(block.id, !block.collapsed) : block.kind === 'text' && ctx.setEditing({ id: block.id, caret: 'end' }))}
        >
          {numbered ? <span className="num">{listNumber(block, siblings)}.</span> : <span className="dot" />}
        </button>
        <div className="block-body">
          {block.kind === 'ink' ? (
            <InkBlock block={block} />
          ) : block.kind === 'image' ? (
            <ImageBlock block={block} />
          ) : block.kind === 'code' ? (
            <CodeBlock block={block} editing={editing} />
          ) : block.kind === 'portal' ? (
            <PortalBlock block={block} />
          ) : editing ? (
            <BlockEditor block={block} caret={ctx.editing!.caret} />
          ) : (
            <div className="block-text" onClick={startEdit}>
              <RenderedText text={block.text} />
            </div>
          )}
          <PropsView
            block={block}
            open={ctx.propsOpen === block.id}
            onOpen={() => ctx.setPropsOpen(block.id)}
            onClose={() => ctx.setPropsOpen(null)}
          />
        </div>
        {cards > 0 && !editing && (
          <button
            className={'card-badge' + (block.cardsOff ? ' off' : '')}
            title={block.cardsOff ? 'Карточки отключены' : 'Карточки блока'}
            onClick={() => setCardsOpen((o) => !o)}
          >
            <Icon name={block.cardsOff ? 'cardOff' : 'cards'} size={14} />
            {cards > 1 ? cards : ''}
          </button>
        )}
        {(block.kind === 'ink' || block.kind === 'portal') && <MenuButton items={inkMenu} label="Действия с блоком" />}
      </div>
      {cardsOpen && <CardsPanel block={block} onClose={() => setCardsOpen(false)} />}
      {kids.length > 0 && !block.collapsed && (
        <div className="block-children">
          {kids.map((k) => (
            <BlockItem key={k.id} block={k} />
          ))}
        </div>
      )}
    </div>
  );
}

type Tool = { a: EditorAction; icon?: IconName; text?: string; label: string } | { menu: MenuItem[]; icon?: IconName; text?: string; label: string } | 'sep';

const HL_LABEL: Record<string, string> = { yellow: 'Жёлтый', green: 'Зелёный', blue: 'Синий', pink: 'Розовый', red: 'Красный', purple: 'Фиолетовый' };

function EditToolbar({ api }: { api: OutlinerCtx['editorApi'] }) {
  const run = (a: EditorAction) => api.current?.(a);
  const tools: Tool[] = [
    { a: 'slash', icon: 'plus', label: 'Вставить… (/)' },
    'sep',
    { a: 'outdent', icon: 'outdent', label: 'Вынести (Shift+Tab)' },
    { a: 'indent', icon: 'indent', label: 'Вложить (Tab)' },
    { a: 'up', icon: 'arrowUp', label: 'Выше (⌘⇧↑)' },
    { a: 'down', icon: 'arrowDown', label: 'Ниже (⌘⇧↓)' },
    'sep',
    { a: 'bold', icon: 'bold', label: 'Жирный (⌘B)' },
    { a: 'italic', icon: 'italic', label: 'Курсив (⌘I)' },
    { a: 'underline', icon: 'underline', label: 'Подчёркнутый (⌘U)' },
    { menu: HIGHLIGHT_COLORS.map((c) => ({ label: HL_LABEL[c], swatch: c, onClick: () => run(`hl:${c}`) })), icon: 'highlight', label: 'Выделение цветом' },
    { a: 'heading', icon: 'heading', label: 'Заголовок H1 → H2 → H3 → текст' },
    { a: 'number', icon: 'listNumber', label: 'Нумерованный пункт' },
    'sep',
    { a: 'math', text: '$x$', label: 'Формула' },
    { a: 'cloze', text: '{{ }}', label: 'Клоз' },
    {
      menu: [
        { label: 'вопрос >> ответ', onClick: () => run('sep:>>') },
        { label: 'понятие :: определение', onClick: () => run('sep:::') },
        { label: 'в обе стороны <>', onClick: () => run('sep:<>') },
        { label: 'обратная <<', onClick: () => run('sep:<<') },
        { label: 'описание ;;', onClick: () => run('sep:;;') },
        { label: 'ответ — вложенные >>>', onClick: () => run('sep:>>>') },
        { label: 'список >>1.', onClick: () => run('sep:>>1.') },
        { label: 'выбор ответа >>A)', onClick: () => run('sep:>>A)') },
      ],
      icon: 'card',
      label: 'Сделать карточкой',
    },
    { a: 'cardsOff', icon: 'cardOff', label: 'Отключить/включить карточки блока' },
    { a: 'props', icon: 'props', label: 'Свойства блока' },
    'sep',
    { a: 'draw', icon: 'pen', label: 'Рукописный блок' },
    { a: 'delete', icon: 'trash', label: 'Удалить блок' },
    { a: 'done', icon: 'keyboard', label: 'Готово' },
  ];
  return (
    <div className="edit-toolbar" onPointerDown={(e) => e.preventDefault()}>
      {tools.map((t, i) =>
        t === 'sep' ? (
          <span key={i} className="tb-sep" />
        ) : 'menu' in t ? (
          <MenuButton key={i} items={t.menu} label={t.label} className="tool-btn">
            {t.icon ? <Icon name={t.icon} /> : <span className="tool-text">{t.text}</span>}
          </MenuButton>
        ) : (
          <button key={i} className="tool-btn" title={t.label} aria-label={t.label} onClick={() => run(t.a)}>
            {t.icon ? <Icon name={t.icon} /> : <span className="tool-text">{t.text}</span>}
          </button>
        ),
      )}
    </div>
  );
}

/** Состояние outliner'а для документа: дерево блоков, редактирование, счётчики карточек. */
function useOutlinerState(docId: string, highlight: string | null): OutlinerCtx | null {
  const blocks = useLiveQuery(() => db.blocks.where('docId').equals(docId).toArray(), [docId]);
  const cards = useLiveQuery(() => db.cards.where('docId').equals(docId).toArray(), [docId]);
  const [editing, setEditing] = useState<{ id: string; caret: Caret } | null>(null);
  const [propsOpen, setPropsOpen] = useState<string | null>(null);
  const editorApi = useRef<((a: EditorAction) => void) | null>(null);

  const kids = useMemo(() => childrenMap(blocks ?? []), [blocks]);
  const visible = useMemo(() => visibleOrder(kids), [kids]);
  const cardCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards ?? []) m.set(c.blockId, (m.get(c.blockId) ?? 0) + 1);
    return m;
  }, [cards]);

  // Переход из поиска/карточки: раскрываем свёрнутых предков найденного блока
  useEffect(() => {
    if (!highlight || !blocks) return;
    const byId = new Map(blocks.map((b) => [b.id, b]));
    let p = byId.get(highlight)?.parentId;
    while (p) {
      const pb = byId.get(p);
      if (pb?.collapsed) setCollapsed(pb.id, false);
      p = pb?.parentId ?? null;
    }
  }, [highlight, blocks]);

  useEffect(() => {
    setEditing(null);
    setPropsOpen(null);
  }, [docId]);

  if (!blocks) return null;
  return { docId, kids, visible, editing, setEditing, cardCount, highlight, editorApi, propsOpen, setPropsOpen };
}

// Цепочка порталов, внутри которых мы находимся: защита от бесконечной вложенности.
const PortalChain = createContext<string[]>([]);

/** Портал: живой блок из другого места. Правка здесь меняет оригинал. */
function PortalBlock({ block }: { block: Block }) {
  const chain = useContext(PortalChain);
  const target = useLiveQuery(() => (block.portalOf ? db.blocks.get(block.portalOf).then((b) => b ?? null) : null), [block.portalOf]);
  const srcDoc = useLiveQuery(() => (target ? db.docs.get(target.docId) : undefined), [target?.docId]);
  if (target === undefined) return null;
  if (!target) return <div className="portal portal-missing">Оригинал портала удалён</div>;
  if (chain.includes(target.id) || chain.length >= 3) return <div className="portal portal-missing">↻ Портал ссылается сам на себя</div>;
  return (
    <div className="portal">
      <button className="portal-src" onClick={() => navigate(`doc/${target.docId}?b=${target.id}`)}>
        <Icon name="portal" size={14} /> {srcDoc?.title ?? '…'}
      </button>
      <PortalChain.Provider value={[...chain, target.id]}>
        <PortalOutline docId={target.docId} rootId={target.id} />
      </PortalChain.Provider>
    </div>
  );
}

function PortalOutline({ docId, rootId }: { docId: string; rootId: string }) {
  const ctx = useOutlinerState(docId, null);
  const root = ctx?.visible.find((b) => b.id === rootId) ?? (ctx ? [...ctx.kids.values()].flat().find((b) => b.id === rootId) : undefined);
  if (!ctx || !root) return null;
  return (
    <OutlinerContext.Provider value={ctx}>
      <BlockItem block={root} />
      {ctx.editing && <EditToolbar api={ctx.editorApi} />}
    </OutlinerContext.Provider>
  );
}

export function Outliner({ docId, highlight }: { docId: string; highlight: string | null }) {
  const ctx = useOutlinerState(docId, highlight);
  const [dropping, setDropping] = useState(false);
  if (!ctx) return null;
  const { kids, editing, setEditing, editorApi } = ctx;
  const roots = kids.get(null) ?? [];
  const hasInk = [...kids.values()].some((l) => l.some((b) => b.kind === 'ink'));

  const addText = async () => {
    keepKeyboard();
    const b = await appendBlock(docId);
    setEditing({ id: b.id, caret: 'start' });
  };

  // Перетаскивание картинок из «Файлов»/Finder прямо в заметку
  const onDrop = async (e: React.DragEvent) => {
    setDropping(false);
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    const id = (e.target as HTMLElement).closest('[data-drop-block]')?.getAttribute('data-drop-block');
    const after = id ? ((await db.blocks.get(id)) ?? null) : null;
    await insertImages(docId, files, after && after.docId === docId ? after : null);
  };

  return (
    <OutlinerContext.Provider value={ctx}>
      <div
        className={'outliner' + (dropping ? ' file-over' : '')}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDropping(true);
          }
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={onDrop}
      >
        {roots.map((b) => (
          <BlockItem key={b.id} block={b} />
        ))}
        {roots.length === 0 && (
          <button className="empty-doc" onClick={addText}>
            Нажмите, чтобы начать писать…
          </button>
        )}
        <div className="outliner-add">
          <button className="btn ghost" onClick={addText}>
            <Icon name="plus" /> Блок
          </button>
          <button className="btn ghost" onClick={() => appendBlock(docId, 'ink')}>
            <Icon name="pen" /> Рисунок
          </button>
          <button
            className="btn ghost"
            onClick={async () => {
              const files = await pickFiles('image/*');
              if (files.length) await insertImages(docId, files, null);
            }}
          >
            <Icon name="image" /> Картинка
          </button>
        </div>
      </div>
      {editing ? <EditToolbar api={editorApi} /> : hasInk && <InkToolbar floating />}
    </OutlinerContext.Provider>
  );
}
