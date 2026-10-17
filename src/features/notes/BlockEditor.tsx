import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { db } from '../../db/db';
import type { Block } from '../../db/schema';
import { keepKeyboard, takeKeeperText } from '../../lib/keyboard';
import { dialog } from '../../components/dialog';
import {
  convertToInk,
  deleteBlock,
  indent,
  insertAfter,
  insertBefore,
  moveBlock,
  outdent,
  setBlockProps,
  setText as saveText,
} from './blocks';
import { syncBlockCards } from '../cards/sync';
import { analyze } from '../../lib/markup';
import { useOutliner, type Caret, type EditorAction } from './outlinerContext';

const DRAW_COMMANDS = ['/draw', '/рисунок', '/рис'];

function autosize(ta: HTMLTextAreaElement) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

/** Курсор в первой/последней визуальной строке? (для стрелок вверх/вниз) */
function caretOnEdgeLine(ta: HTMLTextAreaElement, dir: 'up' | 'down') {
  const pos = ta.selectionStart;
  const v = ta.value;
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 24;
  const singleLine = ta.scrollHeight < lh * 1.8;
  if (dir === 'up') return pos === 0 || (singleLine && !v.slice(0, pos).includes('\n'));
  return pos === v.length || (singleLine && !v.slice(pos).includes('\n'));
}

export function BlockEditor({ block, caret }: { block: Block; caret: Caret }) {
  const ctx = useOutliner();
  const [text, setTextState] = useState(block.text);
  const textRef = useRef(block.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const blockRef = useRef(block);
  blockRef.current = block;

  const setLocal = (v: string) => {
    textRef.current = v;
    setTextState(v);
  };

  const flush = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    return saveText(block.id, textRef.current);
  };

  useLayoutEffect(() => {
    const ta = ref.current!;
    ta.focus({ preventScroll: true });
    let pos = caret === 'start' ? 0 : caret === 'end' ? ta.value.length : Math.min(caret, ta.value.length);
    const typed = takeKeeperText();
    if (typed) {
      const v = textRef.current.slice(0, pos) + typed + textRef.current.slice(pos);
      ta.value = v;
      setLocal(v);
      pos += typed.length;
      timer.current = window.setTimeout(flush, 300);
    }
    autosize(ta);
    ta.setSelectionRange(pos, pos);
    // аккуратно прокручиваем к блоку, учитывая клавиатуру
    requestAnimationFrame(() => ta.scrollIntoView({ block: 'nearest' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // При размонтировании — сохраняем
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      saveText(blockRef.current.id, textRef.current);
    },
    [],
  );

  const focusBlock = (b: Block | undefined, c: Caret) => {
    if (!b) return;
    keepKeyboard();
    ctx.setEditing({ id: b.id, caret: c });
  };

  const prevText = () => {
    const i = ctx.visible.findIndex((b) => b.id === block.id);
    for (let j = i - 1; j >= 0; j--) if (ctx.visible[j].kind === 'text') return ctx.visible[j];
  };
  const nextText = () => {
    const i = ctx.visible.findIndex((b) => b.id === block.id);
    for (let j = i + 1; j < ctx.visible.length; j++) if (ctx.visible[j].kind === 'text') return ctx.visible[j];
  };
  const hasKids = () => (ctx.kids.get(block.id)?.length ?? 0) > 0;

  const wrapSelection = (l: string, r: string) => {
    const ta = ref.current!;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const v = textRef.current;
    const nv = v.slice(0, s) + l + v.slice(s, e) + r + v.slice(e);
    setLocal(nv);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(s + l.length, e + l.length);
      autosize(ta);
    });
  };

  const run = async (a: EditorAction) => {
    const ta = ref.current;
    const pos = ta?.selectionStart ?? 0;
    switch (a) {
      case 'indent':
      case 'outdent': {
        keepKeyboard();
        await flush();
        const fresh = (await db.blocks.get(block.id))!;
        await (a === 'indent' ? indent(fresh) : outdent(fresh));
        ctx.setEditing({ id: block.id, caret: pos });
        break;
      }
      case 'up':
      case 'down':
        await flush();
        await moveBlock((await db.blocks.get(block.id))!, a === 'up' ? -1 : 1);
        requestAnimationFrame(() => ref.current?.focus());
        break;
      case 'delete': {
        const ok = !hasKids() || (await dialog.confirm('Удалить блок вместе с вложенными?', 'Удалить'));
        if (!ok) return;
        const prev = prevText();
        await deleteBlock(block);
        if (prev) focusBlock(prev, 'end');
        else ctx.setEditing(null);
        break;
      }
      case 'draw': {
        await flush();
        if (!textRef.current.trim() && !hasKids()) {
          await convertToInk(block);
          ctx.setEditing(null);
        } else {
          await insertAfter(block, '', 'ink', false);
          ctx.setEditing(null);
        }
        break;
      }
      case 'math':
        wrapSelection('$', '$');
        break;
      case 'cloze':
        wrapSelection('{{', '}}');
        break;
      case 'bold':
        wrapSelection('**', '**');
        break;
      case 'italic':
        wrapSelection('*', '*');
        break;
      case 'underline':
        wrapSelection('__', '__');
        break;
      case 'heading': {
        const h = blockRef.current.heading;
        await setBlockProps(block.id, { heading: h === 3 ? undefined : (((h ?? 0) + 1) as 1 | 2 | 3) });
        requestAnimationFrame(() => ta && autosize(ta));
        break;
      }
      case 'number':
        await setBlockProps(block.id, { list: blockRef.current.list === 'number' ? undefined : 'number' });
        break;
      case 'cardsOff':
        await flush();
        await setBlockProps(block.id, { cardsOff: !blockRef.current.cardsOff || undefined });
        await syncBlockCards(block.id);
        break;
      default:
        if (a.startsWith('hl:')) {
          const color = a.slice(3);
          wrapSelection(color === 'yellow' ? '==' : `=={${color}}`, '==');
        } else if (a.startsWith('sep:')) {
          // Ставим разделитель карточки (или меняем существующий)
          const sep = a.slice(4);
          const v = textRef.current;
          const cur = analyze(v).sep;
          const trailing = ['>>>', '>>1.', '>>A)'].includes(sep);
          const nv = cur
            ? v.slice(0, cur.index).trimEnd() + ' ' + sep + (trailing ? '' : ' ' + v.slice(cur.index + cur.sep.length).trimStart())
            : v.trimEnd() + ' ' + sep + (trailing ? '' : ' ');
          setLocal(trailing ? nv.trimEnd() : nv);
          requestAnimationFrame(() => {
            if (!ta) return;
            ta.focus();
            ta.setSelectionRange(textRef.current.length, textRef.current.length);
            autosize(ta);
          });
        }
        break;
      case 'done':
        ta?.blur();
        break;
    }
  };

  useEffect(() => {
    ctx.editorApi.current = run;
    return () => {
      if (ctx.editorApi.current === run) ctx.editorApi.current = null;
    };
  });

  const onKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    const ta = e.currentTarget;
    const v = textRef.current;
    const s = ta.selectionStart;
    const end = ta.selectionEnd;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (DRAW_COMMANDS.includes(v.trim().toLowerCase())) {
        setLocal('');
        await flush();
        await convertToInk(block);
        ctx.setEditing(null);
        return;
      }
      if (s === 0 && end === 0 && v !== '') {
        // курсор в начале — вставляем пустой блок над текущим (фокус остаётся в этом же поле)
        await flush();
        await insertBefore(block);
        return;
      }
      keepKeyboard();
      const before = v.slice(0, s);
      const after = v.slice(end);
      setLocal(before);
      await flush();
      const nb = await insertAfter((await db.blocks.get(block.id))!, after);
      ctx.setEditing({ id: nb.id, caret: 'start' });
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      run(e.shiftKey ? 'outdent' : 'indent');
      return;
    }
    if (e.key === 'Backspace' && s === 0 && end === 0) {
      const prev = prevText();
      if (v === '' && !hasKids()) {
        if (!prev && ctx.visible.length <= 1) return;
        e.preventDefault();
        keepKeyboard();
        await deleteBlock(block);
        if (prev) ctx.setEditing({ id: prev.id, caret: 'end' });
        else ctx.setEditing(null);
        return;
      }
      if (prev && !hasKids() && ctx.visible[ctx.visible.findIndex((b) => b.id === block.id) - 1]?.id === prev.id) {
        // слияние с предыдущим блоком
        e.preventDefault();
        keepKeyboard();
        const p = (await db.blocks.get(prev.id))!;
        const caretPos = p.text.length;
        window.clearTimeout(timer.current);
        textRef.current = block.text; // не сохранять текст удаляемого блока
        await saveText(p.id, p.text + v);
        await deleteBlock(block);
        ctx.setEditing({ id: p.id, caret: caretPos });
      }
      return;
    }
    if (e.key === 'ArrowUp' && !e.shiftKey && !e.altKey && caretOnEdgeLine(ta, 'up')) {
      const p = prevText();
      if (p) {
        e.preventDefault();
        await flush();
        focusBlock(p, 'end');
      }
      return;
    }
    if (e.key === 'ArrowDown' && !e.shiftKey && !e.altKey && caretOnEdgeLine(ta, 'down')) {
      const n = nextText();
      if (n) {
        e.preventDefault();
        await flush();
        focusBlock(n, 'start');
      }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      run(e.key === 'ArrowUp' ? 'up' : 'down');
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && ['b', 'i', 'u', 'и', 'ш', 'г'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      const k = e.key.toLowerCase();
      run(k === 'b' || k === 'и' ? 'bold' : k === 'i' || k === 'ш' ? 'italic' : 'underline');
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      ta.blur();
    }
  };

  return (
    <textarea
      ref={ref}
      className={'block-input' + (block.heading ? ` h${block.heading}` : '')}
      value={text}
      rows={1}
      spellCheck
      autoCapitalize="sentences"
      placeholder="Текст, $формула$, вопрос :: ответ, {{клоз}}, /draw"
      onChange={(e) => {
        // Быстрый ввод как в Markdown: «# » → H1, «## » → H2, «### » → H3, «1. » → нумерация
        const ta = e.target;
        const md = ta.value.match(/^(#{1,3}|1\.) /);
        if (md && !textRef.current.startsWith(md[0])) {
          if (md[1] === '1.') setBlockProps(block.id, { list: 'number' });
          else setBlockProps(block.id, { heading: md[1].length as 1 | 2 | 3 });
          const caretPos = Math.max(0, ta.selectionStart - md[0].length);
          setLocal(ta.value.slice(md[0].length));
          requestAnimationFrame(() => ta.setSelectionRange(caretPos, caretPos));
        } else setLocal(ta.value);
        autosize(e.target);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(flush, 600);
      }}
      onKeyDown={onKeyDown}
      onBlur={() => {
        flush();
        // если фокус ушёл не в другой блок — выходим из редактирования
        setTimeout(() => {
          const a = document.activeElement;
          if (a?.id === 'kb-keeper' || a?.classList.contains('block-input')) return;
          ctx.setEditing(null);
        }, 0);
      }}
    />
  );
}
