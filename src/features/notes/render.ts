import katex from 'katex';
import { tokenize } from '../../lib/markup';

const cache = new Map<string, string>();

function renderMath(tex: string, display: boolean): string {
  const key = (display ? 'D' : 'I') + tex;
  let html = cache.get(key);
  if (html === undefined) {
    html = katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'html' });
    if (cache.size > 2000) cache.clear();
    cache.set(key, html);
  }
  return html;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Простая разметка в тексте: **жирный**, *курсив*, `код`, переносы строк. */
function renderInline(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

export interface RenderOptions {
  /** Для карточки-клоза: какой клоз скрыть/подсветить */
  cloze?: { index: number; reveal: boolean };
  /** Показывать ли разделитель :: / ;; (в заметке — да, в карточке — нет) */
  showSeparator?: boolean;
}

export function renderText(text: string, opts: RenderOptions = {}): string {
  const showSep = opts.showSeparator ?? true;
  return tokenize(text)
    .map((seg) => {
      switch (seg.t) {
        case 'text':
          return renderInline(seg.v);
        case 'math':
          return renderMath(seg.v, seg.display);
        case 'sep':
          return showSep ? `<span class="sep" title="карточка">${seg.v === '::' ? '→' : '↔'}</span>` : '';
        case 'cloze': {
          const inner = renderText(seg.v, { showSeparator: false });
          if (!opts.cloze) return `<span class="cloze">${inner}</span>`;
          if (seg.index !== opts.cloze.index) return `<span>${inner}</span>`;
          return opts.cloze.reveal
            ? `<span class="cloze-answer">${inner}</span>`
            : `<span class="cloze-blank">[…]</span>`;
        }
      }
    })
    .join('');
}

export function escapeForSnippet(s: string) {
  return escapeHtml(s);
}
