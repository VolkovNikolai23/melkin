// Перетаскивание фишек пальцем, Pencil и мышью (Pointer Events — работает в Safari на iPad,
// где HTML5 drag-and-drop неудобен). Короткое касание без движения — это «тап».

export interface DragOptions {
  /** Текст «призрака», который едет за пальцем */
  label: string;
  /** Отпустили над элементом с data-drop — его значение (или null) */
  onDrop: (target: string | null) => void;
  /** Касание без перетаскивания */
  onTap?: () => void;
}

export function startDrag(e: React.PointerEvent, opts: DragOptions) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const sx = e.clientX;
  const sy = e.clientY;
  const id = e.pointerId;
  let ghost: HTMLDivElement | null = null;
  let over: HTMLElement | null = null;

  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
    if (!ghost) {
      ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      ghost.textContent = opts.label;
      document.body.appendChild(ghost);
    }
    ev.preventDefault();
    ghost.style.transform = `translate(${ev.clientX + 8}px, ${ev.clientY + 8}px)`;
    const t = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-drop]') ?? null;
    if (t !== over) {
      over?.classList.remove('drop-over');
      t?.classList.add('drop-over');
      over = t;
    }
  };
  const end = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    over?.classList.remove('drop-over');
    if (ghost) {
      ghost.remove();
      opts.onDrop(ev.type === 'pointerup' ? (over?.dataset.drop ?? null) : null);
    } else if (ev.type === 'pointerup') opts.onTap?.();
  };
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}
