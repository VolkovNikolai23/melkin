import { useEffect } from 'react';

/**
 * iPadOS показывает клавиатуру только при focus() внутри жеста пользователя.
 * При переходе между блоками сначала синхронно фокусируем скрытое поле-«держатель»,
 * а потом — новый textarea; так клавиатура не прячется и не прыгает.
 */
export function keepKeyboard() {
  let el = document.getElementById('kb-keeper') as HTMLTextAreaElement | null;
  if (!el) {
    el = document.createElement('textarea');
    el.id = 'kb-keeper';
    el.setAttribute('aria-hidden', 'true');
    el.tabIndex = -1;
    document.body.appendChild(el);
  }
  el.value = '';
  el.focus({ preventScroll: true });
}

/** Текст, который пользователь успел набрать, пока новый блок создавался (его нельзя терять). */
export function takeKeeperText(): string {
  const el = document.getElementById('kb-keeper') as HTMLTextAreaElement | null;
  if (!el || !el.value) return '';
  const v = el.value;
  el.value = '';
  return v;
}

/** Высота экранной клавиатуры → CSS-переменная --kb-inset (для нижней панели). */
export function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb-inset', `${Math.round(inset)}px`);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
}
