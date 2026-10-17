import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { keepKeyboard } from '../../lib/keyboard';
import type { Block } from '../../db/schema';
import { insertAfter, setBlockProps, setText } from './blocks';
import { CODE_LANGS, highlight, normLang } from './highlight';
import { useOutliner } from './outlinerContext';

function autosize(ta: HTMLTextAreaElement) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

function CodeEditor({ block }: { block: Block }) {
  const ctx = useOutliner();
  const [text, setLocal] = useState(block.text);
  const textRef = useRef(block.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<number | undefined>(undefined);

  const flush = () => {
    window.clearTimeout(timer.current);
    return setText(block.id, textRef.current);
  };
  const set = (v: string) => {
    textRef.current = v;
    setLocal(v);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 600);
  };

  useLayoutEffect(() => {
    const ta = ref.current!;
    ta.focus({ preventScroll: true });
    autosize(ta);
  }, []);
  useEffect(() => () => void setText(block.id, textRef.current), [block.id]);

  // Вставка/замена текста с сохранением истории отмены браузера
  const insert = (ta: HTMLTextAreaElement, s: number, e: number, str: string, caret: number) => {
    ta.setRangeText(str, s, e, 'end');
    set(ta.value);
    ta.setSelectionRange(caret, caret);
    autosize(ta);
  };

  const onKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const s = ta.selectionStart;
    const v = ta.value;
    const lineStart = v.lastIndexOf('\n', s - 1) + 1;
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        const n = v.slice(lineStart, lineStart + 2) === '  ' ? 2 : v[lineStart] === ' ' ? 1 : 0;
        if (n) insert(ta, lineStart, lineStart + n, '', Math.max(lineStart, s - n));
      } else insert(ta, s, ta.selectionEnd, '  ', s + 2);
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      // ⌘Enter — выйти из кода в новый текстовый блок
      e.preventDefault();
      keepKeyboard();
      await flush();
      const nb = await insertAfter(block, '', 'text', false);
      ctx.setEditing({ id: nb.id, caret: 'start' });
      return;
    }
    if (e.key === 'Enter') {
      // сохраняем отступ строки (а после «:» в Python — добавляем)
      e.preventDefault();
      const indent = v.slice(lineStart, s).match(/^\s*/)![0];
      const extra = /[:{[(]\s*$/.test(v.slice(lineStart, s)) ? '  ' : '';
      insert(ta, s, ta.selectionEnd, '\n' + indent + extra, s + 1 + indent.length + extra.length);
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
      className="block-input code-input"
      value={text}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      rows={2}
      placeholder="Код… (Tab — отступ, ⌘Enter — выйти)"
      onChange={(e) => {
        set(e.target.value);
        autosize(e.target);
      }}
      onKeyDown={onKeyDown}
      onBlur={() => {
        flush();
        setTimeout(() => {
          const a = document.activeElement;
          if (a?.id === 'kb-keeper' || a?.classList.contains('block-input')) return;
          ctx.setEditing(null);
        }, 0);
      }}
    />
  );
}

export function CodeBlock({ block, editing }: { block: Block; editing: boolean }) {
  const ctx = useOutliner();
  const lang = normLang(block.code?.lang);
  const html = useMemo(() => highlight(block.text, lang), [block.text, lang]);
  return (
    <div className="code-block">
      <select className="code-lang" value={lang} aria-label="Язык" onChange={(e) => setBlockProps(block.id, { code: { lang: e.target.value } })}>
        {CODE_LANGS.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
      {editing ? (
        <CodeEditor block={block} />
      ) : (
        <pre
          className={`code-view language-${lang}`}
          onClick={() => {
            keepKeyboard();
            ctx.setEditing({ id: block.id, caret: 'end' });
          }}
        >
          <code dangerouslySetInnerHTML={{ __html: html || '<span class="placeholder">Пустой блок кода</span>' }} />
        </pre>
      )}
    </div>
  );
}
