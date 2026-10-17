import { useLiveQuery } from 'dexie-react-hooks';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from '../../components/Icon';
import { MenuButton } from '../../components/Menu';
import { dialog } from '../../components/dialog';
import { db } from '../../db/db';
import type { Block } from '../../db/schema';
import { keepKeyboard } from '../../lib/keyboard';
import { InkBlock } from '../ink/InkBlock';
import { InkToolbar } from '../ink/InkToolbar';
import { BlockEditor } from './BlockEditor';
import { appendBlock, childrenMap, deleteBlock, indent, insertAfter, moveBlock, outdent, setCollapsed, visibleOrder } from './blocks';
import { OutlinerContext, useOutliner, type Caret, type EditorAction, type OutlinerCtx } from './outlinerContext';
import { renderText } from './render';

const RenderedText = memo(function RenderedText({ text }: { text: string }) {
  const html = useMemo(() => renderText(text), [text]);
  if (!text.trim()) return <span className="placeholder">&nbsp;</span>;
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
});

function BlockItem({ block }: { block: Block }) {
  const ctx = useOutliner();
  const kids = ctx.kids.get(block.id) ?? [];
  const editing = ctx.editing?.id === block.id;
  const cards = ctx.cardCount.get(block.id) ?? 0;
  const rowRef = useRef<HTMLDivElement>(null);
  const highlighted = ctx.highlight === block.id;

  useEffect(() => {
    if (highlighted) rowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlighted]);

  const startEdit = (e: React.MouseEvent) => {
    // клик по ссылке/выделению внутри формулы не должен мешать
    if (window.getSelection()?.toString()) return;
    e.preventDefault();
    keepKeyboard();
    ctx.setEditing({ id: block.id, caret: 'end' });
  };

  const inkMenu = [
    { label: 'Текстовый блок ниже', icon: 'plus' as const, onClick: async () => ctx.setEditing({ id: (await insertAfter(block, '', 'text', false)).id, caret: 'start' }) },
    { label: 'Вложить', icon: 'indent' as const, onClick: () => indent(block) },
    { label: 'Вынести', icon: 'outdent' as const, onClick: () => outdent(block) },
    { label: 'Выше', icon: 'arrowUp' as const, onClick: () => moveBlock(block, -1) },
    { label: 'Ниже', icon: 'arrowDown' as const, onClick: () => moveBlock(block, 1) },
    {
      label: 'Удалить рисунок',
      icon: 'trash' as const,
      danger: true,
      onClick: async () => {
        if (await dialog.confirm('Удалить рисунок?', 'Удалить')) deleteBlock(block);
      },
    },
  ];

  return (
    <div className="block">
      <div ref={rowRef} className={'block-row' + (highlighted ? ' flash' : '') + (block.kind === 'ink' ? ' ink-row' : '')}>
        <button
          className={'bullet' + (kids.length ? ' has-kids' : '') + (block.collapsed && kids.length ? ' collapsed' : '')}
          aria-label={kids.length ? (block.collapsed ? 'Развернуть' : 'Свернуть') : 'Блок'}
          onClick={() => (kids.length ? setCollapsed(block.id, !block.collapsed) : block.kind === 'text' && ctx.setEditing({ id: block.id, caret: 'end' }))}
        >
          <span className="dot" />
        </button>
        <div className="block-body">
          {block.kind === 'ink' ? (
            <InkBlock block={block} />
          ) : editing ? (
            <BlockEditor block={block} caret={ctx.editing!.caret} />
          ) : (
            <div className="block-text" onClick={startEdit}>
              <RenderedText text={block.text} />
            </div>
          )}
        </div>
        {cards > 0 && !editing && (
          <span className="card-badge" title="Карточек в блоке">
            <Icon name="cards" size={14} />
            {cards > 1 ? cards : ''}
          </span>
        )}
        {block.kind === 'ink' && <MenuButton items={inkMenu} label="Действия с рисунком" />}
      </div>
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

const EDIT_TOOLS: { a: EditorAction; icon?: IconName; text?: string; label: string }[] = [
  { a: 'outdent', icon: 'outdent', label: 'Вынести (Shift+Tab)' },
  { a: 'indent', icon: 'indent', label: 'Вложить (Tab)' },
  { a: 'up', icon: 'arrowUp', label: 'Переместить выше' },
  { a: 'down', icon: 'arrowDown', label: 'Переместить ниже' },
  { a: 'math', text: '$x$', label: 'Формула' },
  { a: 'cloze', text: '{{ }}', label: 'Клоз' },
  { a: 'card', text: '::', label: 'Карточка вопрос :: ответ' },
  { a: 'draw', icon: 'pen', label: 'Рукописный блок' },
  { a: 'delete', icon: 'trash', label: 'Удалить блок' },
  { a: 'done', icon: 'keyboard', label: 'Готово' },
];

function EditToolbar({ api }: { api: OutlinerCtx['editorApi'] }) {
  return (
    <div className="edit-toolbar" onPointerDown={(e) => e.preventDefault()}>
      {EDIT_TOOLS.map((t) => (
        <button key={t.a} className="tool-btn" title={t.label} aria-label={t.label} onClick={() => api.current?.(t.a)}>
          {t.icon ? <Icon name={t.icon} /> : <span className="tool-text">{t.text}</span>}
        </button>
      ))}
    </div>
  );
}

export function Outliner({ docId, highlight }: { docId: string; highlight: string | null }) {
  const blocks = useLiveQuery(() => db.blocks.where('docId').equals(docId).toArray(), [docId]);
  const cards = useLiveQuery(() => db.cards.where('docId').equals(docId).toArray(), [docId]);
  const [editing, setEditing] = useState<{ id: string; caret: Caret } | null>(null);
  const editorApi = useRef<((a: EditorAction) => void) | null>(null);

  const kids = useMemo(() => childrenMap(blocks ?? []), [blocks]);
  const visible = useMemo(() => visibleOrder(kids), [kids]);
  const cardCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards ?? []) m.set(c.blockId, (m.get(c.blockId) ?? 0) + 1);
    return m;
  }, [cards]);

  // Переход из поиска: раскрываем свёрнутых предков найденного блока
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

  useEffect(() => setEditing(null), [docId]);

  const ctx: OutlinerCtx = { docId, kids, visible, editing, setEditing, cardCount, highlight, editorApi };
  if (!blocks) return null;
  const roots = kids.get(null) ?? [];
  const hasInk = blocks.some((b) => b.kind === 'ink');

  const addText = async () => {
    keepKeyboard();
    const b = await appendBlock(docId);
    setEditing({ id: b.id, caret: 'start' });
  };

  return (
    <OutlinerContext.Provider value={ctx}>
      <div className="outliner">
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
        </div>
      </div>
      {editing ? <EditToolbar api={editorApi} /> : hasInk && <InkToolbar floating />}
    </OutlinerContext.Provider>
  );
}
