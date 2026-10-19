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
import { createDoc } from './docs';
import { insertImages, pickCamera, pickFiles } from './images';
import { SuggestPopup, useSuggestions, type SlashCommand } from './Suggest';
import { BUILTIN_TEMPLATES, insertTemplate, listTemplates } from './templates';
import { detectTrigger, type Trigger } from './trigger';
import { fixRussianLayout } from '../../lib/layout';

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

  // ---------- Автодополнение: [[ссылка, ((портал, #тег, /команда ----------
  const [trig, setTrig] = useState<Trigger | null>(null);
  const [active, setActive] = useState(0);
  const dismissed = useRef<number | null>(null);

  const updateTrigger = () => {
    const ta = ref.current;
    if (!ta) return;
    const found = ta.selectionStart === ta.selectionEnd ? detectTrigger(textRef.current, ta.selectionStart) : null;
    const t = found?.kind === 'tag' ? null : found; // подсказки тегов отключены (теги не нужны)
    if (!t) dismissed.current = null;
    const next = t && dismissed.current === t.start ? null : t;
    setTrig((prev) => (prev?.kind === next?.kind && prev?.start === next?.start && prev?.query === next?.query ? prev : next));
    if (next?.query !== trig?.query || next?.kind !== trig?.kind) setActive(0);
  };

  /** Заменяет текст от `start` до курсора на `insert` и ставит курсор после вставки. */
  const replaceRange = (start: number, insert: string, caretOffset = insert.length) => {
    const ta = ref.current!;
    const v = textRef.current;
    const end = Math.max(start, ta.selectionStart);
    setLocal(v.slice(0, start) + insert + v.slice(end));
    setTrig(null);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 400);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + caretOffset, start + caretOffset);
      autosize(ta);
      updateTrigger();
    });
  };

  /** Блок пуст и без детей — его можно превратить во что-то другое (картинку, код, портал). */
  const isBlank = () => !textRef.current.trim() && !hasKids();

  const runSlash = async (cmd: SlashCommand, start: number) => {
    // выбор файла должен начаться синхронно, внутри жеста пользователя (требование iPadOS)
    const files = cmd === 'image' ? pickFiles('image/*') : cmd === 'camera' ? pickCamera() : cmd === 'pdf' ? pickFiles('application/pdf,.pdf', false) : null;
    replaceRange(start, '');
    switch (cmd) {
      case 'camera':
      case 'image': {
        const list = await files!;
        if (!list.length) return;
        await flush();
        const blank = isBlank();
        const fresh = (await db.blocks.get(block.id))!;
        await insertImages(block.docId, list, fresh);
        if (blank) await deleteBlock(fresh);
        ctx.setEditing(null);
        return;
      }
      case 'code': {
        await flush();
        if (isBlank()) {
          await db.blocks.update(block.id, { kind: 'code', code: { lang: 'python' }, tags: [], links: [] });
          await syncBlockCards(block.id);
          ctx.setEditing({ id: block.id, caret: 'start' });
        } else {
          const nb = await insertAfter((await db.blocks.get(block.id))!, '', 'code', false);
          await db.blocks.update(nb.id, { code: { lang: 'python' } });
          ctx.setEditing({ id: nb.id, caret: 'start' });
        }
        return;
      }
      case 'draw':
        return run('draw');
      case 'portal':
        return replaceRange(start, '((');
      case 'link':
        return replaceRange(start, '[[');
      case 'math':
        return replaceRange(start, '$$  $$', 3);
      case 'chem':
        // $\ce{…}$ — курсор внутри скобок: H2SO4, Fe^{3+}, 2H2 + O2 -> 2H2O
        return replaceRange(start, '$\\ce{}$', 5);
      case 'card':
        return run('sep:>>');
      case 'pdf': {
        const [file] = await files!;
        if (!file) return;
        const { importPdf } = await import('../pdf/annotations');
        const pdfDoc = await importPdf(file, null);
        replaceRange(ref.current?.selectionStart ?? start, `[[${pdfDoc.title}]]`);
        await flush();
        return;
      }
      case 'h1':
      case 'h2':
      case 'h3':
        return setBlockProps(block.id, { heading: Number(cmd[1]) as 1 | 2 | 3 });
      case 'number':
        return setBlockProps(block.id, { list: 'number' });
      case 'props':
        await flush();
        ctx.setPropsOpen(block.id);
        return;
      case 'template': {
        // свои шаблоны (документ → «Сделать шаблоном») и встроенные «Лекция», «Сводка по теме»
        const templates = [...(await listTemplates()).map((t) => ({ value: t.id, label: t.title })), ...BUILTIN_TEMPLATES.map((t) => ({ value: t.id, label: t.title }))];
        const id = await dialog.select('Какой шаблон вставить?', templates, templates[0].value, 'Свой шаблон: меню «⋯» документа в боковой панели → «Сделать шаблоном».');
        if (!id) return;
        await flush();
        const blank = isBlank();
        const fresh = (await db.blocks.get(block.id))!;
        await insertTemplate(id, block.docId, fresh);
        if (blank) await deleteBlock(fresh);
        ctx.setEditing(null);
        return;
      }
    }
  };

  const suggestions = useSuggestions(trig, block, {
    replace: (start, insert) => replaceRange(start, insert),
    slash: (cmd, start) => runSlash(cmd, start),
    createAndLink: async (title, start) => {
      replaceRange(start, `[[${title}]]`);
      await createDoc('note', null, title);
      await flush();
    },
    portal: async (target, start) => {
      replaceRange(start, '');
      await flush();
      if (isBlank()) {
        await db.blocks.update(block.id, { kind: 'portal', portalOf: target.id, text: '', tags: [], links: [] });
        await syncBlockCards(block.id);
      } else {
        const nb = await insertAfter((await db.blocks.get(block.id))!, '', 'portal', false);
        await db.blocks.update(nb.id, { portalOf: target.id });
      }
      ctx.setEditing(null);
    },
  });
  const suggestHint =
    trig?.kind === 'portal' ? 'Начните вводить текст блока, который нужно вставить…' : trig?.kind === 'link' && !trig.query ? 'Название документа…' : undefined;

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
      case 'props':
        await flush();
        ctx.setPropsOpen(ctx.propsOpen === block.id ? null : block.id);
        break;
      case 'slash': {
        // кнопка «+» на панели: открываем слэш-меню в позиции курсора
        if (!ta) break;
        const at = ta.selectionStart;
        const v = textRef.current;
        const pre = at > 0 && !/\s/.test(v[at - 1]) ? ' /' : '/';
        setLocal(v.slice(0, at) + pre + v.slice(at));
        requestAnimationFrame(() => {
          ta.focus();
          ta.setSelectionRange(at + pre.length, at + pre.length);
          updateTrigger();
        });
        break;
      }
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
    if (trig && (suggestions.length || suggestHint)) {
      const n = suggestions.length;
      if (e.key === 'ArrowDown' && n) {
        e.preventDefault();
        setActive((a) => (a + 1) % n);
        return;
      }
      if (e.key === 'ArrowUp' && n) {
        e.preventDefault();
        setActive((a) => (a - 1 + n) % n);
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && n) {
        e.preventDefault();
        suggestions[Math.min(active, n - 1)].apply();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        dismissed.current = trig.start;
        setTrig(null);
        return;
      }
    }
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
    <div className="editor-wrap">
    <textarea
      ref={ref}
      className={'block-input' + (block.heading ? ` h${block.heading}` : '')}
      value={text}
      rows={1}
      spellCheck
      autoCapitalize="sentences"
      placeholder="Текст, $формула$, вопрос >> ответ, [[ссылка]], / — команды"
      onChange={(e) => {
        // Быстрый ввод как в Markdown: «# » → H1, «## » → H2, «### » → H3, «1. » → нумерация
        const ta = e.target;
        // «ЮЮ», «ХХ…ЪЪ» и т. п. — разметка, набранная в русской раскладке; длина не меняется
        const fixed = fixRussianLayout(ta.value);
        if (fixed !== ta.value) {
          const pos = ta.selectionStart;
          ta.value = fixed;
          ta.setSelectionRange(pos, pos);
        }
        const md = ta.value.match(/^(#{1,3}|1\.) /);
        if (md && !textRef.current.startsWith(md[0])) {
          if (md[1] === '1.') setBlockProps(block.id, { list: 'number' });
          else setBlockProps(block.id, { heading: md[1].length as 1 | 2 | 3 });
          const caretPos = Math.max(0, ta.selectionStart - md[0].length);
          setLocal(ta.value.slice(md[0].length));
          requestAnimationFrame(() => ta.setSelectionRange(caretPos, caretPos));
        } else setLocal(ta.value);
        // «```» в пустом блоке — превращаем его в блок кода (```python → сразу с языком)
        const fence = ta.value.match(/^```(\w*)$/);
        if (fence && !hasKids()) {
          const lang = fence[1] || 'python';
          setLocal('');
          db.blocks.update(block.id, { kind: 'code', code: { lang }, text: '', tags: [], links: [] }).then(() => syncBlockCards(block.id));
          return;
        }
        autosize(e.target);
        updateTrigger();
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(flush, 600);
      }}
      onKeyDown={onKeyDown}
      onSelect={updateTrigger}
      onPaste={async (e) => {
        // Картинка из буфера обмена → блок-картинка после текущего
        const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
        if (!files.length) return;
        e.preventDefault();
        await flush();
        const blank = isBlank();
        const fresh = (await db.blocks.get(block.id))!;
        await insertImages(block.docId, files, fresh);
        if (blank) await deleteBlock(fresh);
        ctx.setEditing(null);
      }}
      onBlur={() => {
        setTrig(null);
        flush();
        // если фокус ушёл не в другой блок — выходим из редактирования
        setTimeout(() => {
          const a = document.activeElement;
          if (a?.id === 'kb-keeper' || a?.classList.contains('block-input')) return;
          ctx.setEditing(null);
        }, 0);
      }}
    />
    {trig && <SuggestPopup items={suggestions} active={active} onPick={(i) => suggestions[i]?.apply()} hint={suggestHint} />}
    </div>
  );
}
