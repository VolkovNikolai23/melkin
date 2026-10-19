import katex from 'katex';
// \ce{…} и \pu{…}: химические формулы и уравнения реакций (H2O, 2H2 + O2 -> 2H2O, стрелки равновесия)
import 'katex/contrib/mhchem';
import { tokenize, type SepKind } from '../../lib/markup';

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

export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'red', 'purple'] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

/**
 * Форматирование внутри текста:
 * **жирный**, *курсив*, __подчёркнутый__, ==выделение==, =={green}выделение цветом==.
 */
function renderInline(s: string): string {
  return escapeHtml(s)
    .replace(/==\{(yellow|green|blue|pink|red|purple)\}(.+?)==/g, '<mark class="hl-$1">$2</mark>')
    .replace(/==(.+?)==/g, '<mark class="hl-yellow">$1</mark>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>')
    .replace(/\n/g, '<br>');
}

const SEP_VIEW: Record<SepKind, { sym: string; title: string }> = {
  '>>': { sym: '→', title: 'карточка вперёд' },
  '<<': { sym: '←', title: 'обратная карточка' },
  '<>': { sym: '↔', title: 'карточка в обе стороны' },
  '::': { sym: '↔', title: 'понятие' },
  ';;': { sym: '→', title: 'описание' },
  '>>>': { sym: '⤵', title: 'ответ — вложенные блоки' },
  '>>1.': { sym: '⤵ 1.', title: 'карточка-список' },
  '>>A)': { sym: '⤵ A)', title: 'множественный выбор' },
};

export interface RenderOptions {
  /** Для карточки-клоза: какую группу скрыть/подсветить */
  cloze?: { group: string; reveal: boolean };
  /** Показывать ли разделитель (в заметке — да, в карточке — нет) */
  showSeparator?: boolean;
  /** Выделить текст как понятие */
  concept?: boolean;
}

export function renderText(text: string, opts: RenderOptions = {}): string {
  const showSep = opts.showSeparator ?? true;
  const parts: string[] = [];
  let conceptUntil = -1;
  for (const seg of tokenize(text)) {
    switch (seg.t) {
      case 'text':
        parts.push(renderInline(seg.v));
        break;
      case 'math':
        parts.push(renderMath(seg.v, seg.display));
        break;
      case 'code':
        parts.push(`<code>${escapeHtml(seg.v)}</code>`);
        break;
      case 'link':
        parts.push(`<a class="wikilink" data-link="${escapeHtml(seg.v)}">${escapeHtml(seg.v)}</a>`);
        break;
      case 'tag':
        // теги в SPEC.md не нужны — показываем как обычный текст
        parts.push(renderInline('#' + seg.v));
        break;
      case 'sep':
        if (seg.v === '::') conceptUntil = parts.length;
        if (showSep) parts.push(`<span class="sep" title="${SEP_VIEW[seg.v].title}">${SEP_VIEW[seg.v].sym}</span>`);
        break;
      case 'cloze': {
        const inner = renderText(seg.v, { showSeparator: false });
        if (!opts.cloze) parts.push(`<span class="cloze">${inner}</span>`);
        else if (seg.group !== opts.cloze.group) parts.push(`<span>${inner}</span>`);
        else parts.push(opts.cloze.reveal ? `<span class="cloze-answer">${inner}</span>` : `<span class="cloze-blank">[…]</span>`);
        break;
      }
    }
  }
  // Понятие (левая часть «::») выделяется стилем
  if (conceptUntil > 0) return `<span class="concept">${parts.slice(0, conceptUntil).join('')}</span>${parts.slice(conceptUntil).join('')}`;
  if (opts.concept) return `<span class="concept">${parts.join('')}</span>`;
  return parts.join('');
}

export function escapeForSnippet(s: string) {
  return escapeHtml(s);
}
