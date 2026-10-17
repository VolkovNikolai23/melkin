// Перетаскивание на Pointer Events (HTML5 drag&drop ненадёжен на iPad).
// Мышь и Pencil начинают тащить сразу после сдвига, палец — после долгого нажатия,
// чтобы обычная прокрутка пальцем продолжала работать.

export type DropPos = 'before' | 'after' | 'inside';

export interface DragOptions {
  /** Атрибут, которым помечены цели: например 'data-drop-block' */
  attr: string;
  id: string;
  label: string;
  /** Можно ли положить внутрь этой цели */
  canNest: (targetId: string) => boolean;
  onDrop: (targetId: string, pos: DropPos) => void;
}

const HOLD_MS = 380;
const MOVE_TOLERANCE = 8;

function scrollParent(el: Element | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

export function beginDrag(e: React.PointerEvent, opts: DragOptions) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const source = e.currentTarget as HTMLElement;
  const startX = e.clientX;
  const startY = e.clientY;
  const isTouch = e.pointerType === 'touch';
  let active = false;
  let ghost: HTMLDivElement | null = null;
  let marked: HTMLElement | null = null;
  let target: { id: string; pos: DropPos } | null = null;
  let lastY = startY;
  let raf = 0;
  const scroller = scrollParent(source);

  const holdTimer = isTouch ? window.setTimeout(() => start(), HOLD_MS) : 0;

  function start() {
    active = true;
    navigator.vibrate?.(10);
    document.body.classList.add('dragging');
    source.closest(`[${opts.attr}]`)?.classList.add('drag-source');
    ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent = opts.label || '…';
    document.body.appendChild(ghost);
    place(startX, startY);
    autoScroll();
  }

  function place(x: number, y: number) {
    if (ghost) ghost.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
    marked?.classList.remove('drop-before', 'drop-after', 'drop-inside');
    marked = null;
    target = null;
    const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest(`[${opts.attr}]`) as HTMLElement | null;
    if (!el) return;
    const id = el.getAttribute(opts.attr)!;
    if (id === opts.id) return;
    const r = el.getBoundingClientRect();
    const f = (y - r.top) / r.height;
    let pos: DropPos;
    if (opts.canNest(id)) pos = f < 0.3 ? 'before' : f > 0.7 ? 'after' : 'inside';
    else pos = f < 0.5 ? 'before' : 'after';
    target = { id, pos };
    marked = el;
    el.classList.add('drop-' + pos);
  }

  // Автопрокрутка у краёв контейнера
  function autoScroll() {
    if (!active) return;
    if (scroller) {
      const r = scroller.getBoundingClientRect();
      if (lastY < r.top + 50) scroller.scrollTop -= 12;
      else if (lastY > r.bottom - 50) scroller.scrollTop += 12;
    }
    raf = requestAnimationFrame(autoScroll);
  }

  const onMove = (ev: PointerEvent) => {
    lastY = ev.clientY;
    const moved = Math.hypot(ev.clientX - startX, ev.clientY - startY) > MOVE_TOLERANCE;
    if (!active) {
      if (!moved) return;
      if (isTouch) return finish(false); // палец сдвинулся до долгого нажатия — это прокрутка
      start();
    }
    place(ev.clientX, ev.clientY);
  };

  // Пока тащим пальцем, запрещаем прокрутку страницы
  const onTouchMove = (ev: TouchEvent) => {
    if (active) ev.preventDefault();
  };

  const onUp = () => finish(true);
  const onCancel = () => finish(false);

  function finish(drop: boolean) {
    window.clearTimeout(holdTimer);
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('touchmove', onTouchMove);
    marked?.classList.remove('drop-before', 'drop-after', 'drop-inside');
    document.querySelectorAll('.drag-source').forEach((n) => n.classList.remove('drag-source'));
    ghost?.remove();
    document.body.classList.remove('dragging');
    if (active) {
      // гасим «клик» после перетаскивания
      const stop = (ce: Event) => {
        ce.stopPropagation();
        ce.preventDefault();
      };
      window.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 50);
      if (drop && target) opts.onDrop(target.id, target.pos);
    }
    active = false;
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('touchmove', onTouchMove, { passive: false });
}
