import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import { Icon } from '../../components/Icon';
import { useFileUrl } from '../../components/useFileUrl';
import type { PageItem } from '../../db/schema';
import { DEFAULT_TEXT_SIZE, moveItems, TEXT_SIZES } from './items';
import { inkStore } from './inkStore';

const pct = (v: number, of: number) => `${(v / of) * 100}%`;
const fillOf = (color?: string) => (!color || color === 'auto' ? 'var(--ink-auto)' : color);

/** Картинка листа рисуется внутри SVG — под штрихами, чтобы поверх фото можно было писать. */
export const SvgImage = memo(function SvgImage({ item }: { item: PageItem }) {
  const url = useFileUrl(item.fileId);
  if (!url) return <rect x={item.x} y={item.y} width={item.w} height={item.h} fill="var(--surface-2)" />;
  return <image href={url} x={item.x} y={item.y} width={item.w} height={item.h} preserveAspectRatio="none" />;
});

interface Props {
  items: PageItem[];
  width: number;
  height: number;
  /** Инструмент «Текст»: объекты можно выбирать, двигать, менять размер */
  interactive: boolean;
  activeId: string | null;
  editingId: string | null;
  setActive: (id: string | null) => void;
  setEditing: (id: string | null) => void;
  /** Изменение с записью в историю (отмена/повтор) */
  onCommit: (next: PageItem[]) => void;
  /** Изменение без истории (пересчёт высоты текста) */
  onSilent: (next: PageItem[]) => void;
  /** Выделенные лассо — во время переноса им задаётся transform извне */
  lassoIds: Set<string>;
}

type Drag = { id: string; mode: 'move' | 'resize'; x: number; y: number; k: number; moved: boolean; wasActive: boolean; pointerId: number };

export function PageItems({ items, width, height, interactive, activeId, editingId, setActive, setEditing, onCommit, onSilent, lassoIds }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Высота текстовых блоков — по содержимому (нужна для лассо и экспорта)
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !root.clientWidth) return;
    const k = width / root.clientWidth;
    let changed = false;
    const next = itemsRef.current.map((it) => {
      if (it.kind !== 'text') return it;
      const el = root.querySelector<HTMLElement>(`[data-item-id="${it.id}"]`);
      if (!el) return it;
      const h = Math.round(el.offsetHeight * k);
      if (Math.abs(h - it.h) <= 2) return it;
      changed = true;
      return { ...it, h };
    });
    if (changed) onSilent(next);
  });

  const unitsPerPx = () => width / (rootRef.current?.clientWidth || width);

  const onDown = (e: React.PointerEvent, it: PageItem, mode: Drag['mode']) => {
    if (!interactive || editingId === it.id) return;
    e.stopPropagation();
    // неактивный объект пальцем можно только выбрать касанием — перетаскивание прокручивает лист
    if (e.pointerType === 'touch' && activeId !== it.id) {
      drag.current = { id: it.id, mode, x: e.clientX, y: e.clientY, k: unitsPerPx(), moved: false, wasActive: false, pointerId: e.pointerId };
      return;
    }
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* указатель уже отпущен */
    }
    drag.current = { id: it.id, mode, x: e.clientX, y: e.clientY, k: unitsPerPx(), moved: false, wasActive: activeId === it.id, pointerId: e.pointerId };
    if (activeId !== it.id) setActive(it.id);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = (e.clientX - d.x) * d.k;
    const dy = (e.clientY - d.y) * d.k;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
    if (e.pointerType === 'touch' && !d.wasActive) {
      drag.current = null; // это прокрутка
      return;
    }
    d.moved = true;
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-item-id="${d.id}"]`);
    const it = itemsRef.current.find((x) => x.id === d.id);
    if (!el || !it) return;
    if (d.mode === 'move') el.style.transform = `translate(${dx / d.k}px, ${dy / d.k}px)`;
    else {
      const w = Math.max(60, it.w + dx);
      el.style.width = pct(w, width);
      if (it.kind === 'image') el.style.height = pct((w * it.h) / it.w, height);
    }
  };

  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    const it = itemsRef.current.find((x) => x.id === d.id);
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-item-id="${d.id}"]`);
    // сбрасываем только сдвиг; размеры при изменении сразу перезапишет React новыми значениями
    if (el) el.style.transform = '';
    if (!it) return;
    if (!d.moved) {
      // касание: выбрать; повторное касание текста — редактировать
      if (activeId !== it.id) setActive(it.id);
      else if (d.wasActive && it.kind === 'text') setEditing(it.id);
      return;
    }
    const dx = (e.clientX - d.x) * d.k;
    const dy = (e.clientY - d.y) * d.k;
    if (d.mode === 'move') onCommit(moveItems(itemsRef.current, [it.id], dx, dy));
    else {
      const w = Math.round(Math.max(60, it.w + dx));
      onCommit(itemsRef.current.map((x) => (x.id === it.id ? { ...x, w, h: it.kind === 'image' ? Math.round((w * it.h) / it.w) : x.h } : x)));
    }
  };

  const update = (id: string, patch: Partial<PageItem>) => onCommit(itemsRef.current.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const remove = (id: string) => {
    onCommit(itemsRef.current.filter((x) => x.id !== id));
    setActive(null);
  };

  // Черновик текста обновляется при каждом вводе и сохраняется, когда редактирование
  // закончилось любым способом: потеря фокуса, касание листа Pencil, смена инструмента.
  const draft = useRef<{ id: string; text: string } | null>(null);
  const commitDraft = (canRemove: boolean) => {
    const d = draft.current;
    if (!d) return;
    const it = itemsRef.current.find((x) => x.id === d.id);
    const text = d.text.replace(/\n$/, '');
    if (!it) return void (draft.current = null);
    if (!text.trim()) {
      if (!canRemove) return; // пустой блок при размонтировании не трогаем
      draft.current = null;
      remove(it.id);
    } else {
      draft.current = null;
      if (text !== it.text) update(it.id, { text });
    }
  };
  useEffect(() => {
    if (draft.current && draft.current.id !== editingId) commitDraft(true);
  });
  // лист прокрутили далеко или ушли со страницы — сохраняем набранный текст
  useEffect(() => () => commitDraft(false), []);

  const active = items.find((x) => x.id === activeId);

  return (
    <div ref={rootRef} className={'page-items' + (interactive ? ' interactive' : '')}>
      {items.map((it) => {
        const isActive = interactive && it.id === activeId;
        const editing = it.id === editingId;
        const style: React.CSSProperties = {
          left: pct(it.x, width),
          top: pct(it.y, height),
          width: pct(it.w, width),
        };
        if (it.kind === 'image') style.height = pct(it.h, height);
        else {
          style.fontSize = `${((it.fontSize ?? DEFAULT_TEXT_SIZE) / width) * 100}cqw`;
          style.color = fillOf(it.color);
        }
        return (
          <div
            key={it.id}
            data-item-id={it.id}
            className={`pi pi-${it.kind}` + (isActive ? ' active' : '') + (editing ? ' editing' : '') + (lassoIds.has(it.id) ? ' lassoed' : '')}
            style={style}
            onPointerDown={(e) => onDown(e, it, 'move')}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={() => (drag.current = null)}
          >
            {it.kind === 'text' &&
              (editing ? (
                <div
                  key="edit"
                  className="pi-text-body"
                  contentEditable="plaintext-only"
                  suppressContentEditableWarning
                  ref={(el) => {
                    if (el && !el.dataset.init) {
                      el.dataset.init = '1';
                      el.innerText = it.text ?? '';
                      draft.current = { id: it.id, text: it.text ?? '' };
                      el.focus();
                      // каретка в конец
                      const r = document.createRange();
                      r.selectNodeContents(el);
                      r.collapse(false);
                      getSelection()?.removeAllRanges();
                      getSelection()?.addRange(r);
                    }
                  }}
                  onInput={(e) => (draft.current = { id: it.id, text: e.currentTarget.innerText })}
                  onBlur={() => setEditing(null)}
                  onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
                  onPointerDown={(e) => e.stopPropagation()}
                />
              ) : (
                <div key="view" className="pi-text-body">
                  {it.text || ' '}
                </div>
              ))}
            {isActive && !editing && (
              <span className="pi-resize" onPointerDown={(e) => onDown(e, it, 'resize')} onPointerMove={onMove} onPointerUp={onUp} aria-label="Изменить размер" />
            )}
          </div>
        );
      })}
      {active && interactive && !editingId && (
        <div
          className="lasso-menu pi-menu"
          style={{ left: pct(Math.max(0, active.x), width), top: pct(Math.max(0, active.y - 6), height) }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {active.kind === 'text' && (
            <>
              <button className="tool-btn" title="Изменить текст" aria-label="Изменить текст" onClick={() => setEditing(active.id)}>
                <Icon name="edit" size={18} />
              </button>
              <button
                className="tool-btn text"
                title="Меньше"
                aria-label="Шрифт меньше"
                onClick={() => update(active.id, { fontSize: TEXT_SIZES.filter((s) => s < (active.fontSize ?? DEFAULT_TEXT_SIZE)).at(-1) ?? TEXT_SIZES[0] })}
              >
                A−
              </button>
              <button
                className="tool-btn text"
                title="Больше"
                aria-label="Шрифт больше"
                onClick={() => update(active.id, { fontSize: TEXT_SIZES.find((s) => s > (active.fontSize ?? DEFAULT_TEXT_SIZE)) ?? TEXT_SIZES.at(-1)! })}
              >
                A+
              </button>
              <button className="tool-btn" title="Цвет ручки" aria-label="Покрасить в цвет ручки" onClick={() => update(active.id, { color: inkStore.get().penColor })}>
                <span className="swatch-dot" style={{ background: fillOf(inkStore.get().penColor) }} />
              </button>
            </>
          )}
          <button className="tool-btn" title="Удалить" aria-label="Удалить" onClick={() => remove(active.id)}>
            <Icon name="trash" size={18} />
          </button>
          <button className="tool-btn" title="Готово" aria-label="Снять выделение" onClick={() => setActive(null)}>
            <Icon name="check" size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
