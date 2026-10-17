import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';

export interface MenuItem {
  label: string;
  icon?: IconName;
  danger?: boolean;
  /** Цветной кружок вместо иконки (для выбора цвета выделения) */
  swatch?: string;
  onClick: () => void;
}

/** Кнопка «⋯» с выпадающим меню (портал, чтобы не обрезалось прокруткой). */
export function MenuButton({ items, label = 'Действия', children, className = 'icon-btn small' }: { items: MenuItem[]; label?: string; children?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const mh = menu.current?.offsetHeight ?? 200;
    const mw = menu.current?.offsetWidth ?? 220;
    let top = r.bottom + 4;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
    const left = Math.min(Math.max(8, r.right - mw), window.innerWidth - mw - 8);
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        className={className}
        aria-label={label}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {children ?? <Icon name="more" />}
      </button>
      {open &&
        createPortal(
          // preventDefault — чтобы меню не забирало фокус у редактируемого блока
          <div ref={menu} className="menu" style={{ top: pos.top, left: pos.left }} onPointerDown={(e) => e.preventDefault()}>
            {items.map((it) => (
              <button
                key={it.label}
                className={'menu-item' + (it.danger ? ' danger' : '')}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  it.onClick();
                }}
              >
                {it.icon && <Icon name={it.icon} size={18} />}
                {it.swatch && <span className={'menu-swatch hl-' + it.swatch} />}
                {it.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
