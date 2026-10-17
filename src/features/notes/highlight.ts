// Подсветка кода: в бандл попадают только нужные языки.
import Prism from 'prismjs';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-matlab';

export const CODE_LANGS: { id: string; label: string }[] = [
  { id: 'python', label: 'Python' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'java', label: 'Java' },
  { id: 'matlab', label: 'MATLAB' },
  { id: 'text', label: 'Текст' },
];

const ALIASES: Record<string, string> = { py: 'python', js: 'javascript', ts: 'typescript', 'c++': 'cpp', m: 'matlab' };

export function normLang(lang: string | undefined): string {
  const l = (lang ?? '').toLowerCase();
  return ALIASES[l] ?? (CODE_LANGS.some((x) => x.id === l) ? l : 'text');
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function highlight(code: string, lang: string): string {
  const grammar = Prism.languages[normLang(lang)];
  return grammar ? Prism.highlight(code, grammar, normLang(lang)) : escape(code);
}
