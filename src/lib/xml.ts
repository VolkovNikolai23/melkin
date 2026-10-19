// Небольшой XML-парсер для файлов Office (PPTX): элементы, атрибуты, текст, сущности.
// Свой, а не DOMParser — чтобы разбор работал и в тестах (Node), и в воркере.

export interface XNode {
  name: string;
  attrs: Record<string, string>;
  children: XNode[];
  /** Текст непосредственно внутри элемента */
  text: string;
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENT[e] ?? m;
  });
}

export function parseXml(src: string): XNode {
  const root: XNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XNode[] = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) stack[stack.length - 1].text += decodeEntities(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt);
      stack[stack.length - 1].text += src.slice(lt + 9, e < 0 ? n : e);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (src[lt + 1] === '?' || src[lt + 1] === '!') {
      const e = src.indexOf('>', lt);
      i = e < 0 ? n : e + 1;
      continue;
    }
    // ищем конец тега с учётом кавычек в атрибутах
    let j = lt + 1;
    let q = '';
    while (j < n) {
      const c = src[j];
      if (q) {
        if (c === q) q = '';
      } else if (c === '"' || c === "'") q = c;
      else if (c === '>') break;
      j++;
    }
    const body = src.slice(lt + 1, j);
    i = j + 1;
    if (body[0] === '/') {
      // закрывающий тег: снимаем со стека до совпадающего имени
      const name = body.slice(1).trim();
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
      continue;
    }
    const selfClose = body.endsWith('/');
    const inner = selfClose ? body.slice(0, -1) : body;
    const m = inner.match(/^\s*([^\s/>]+)/);
    if (!m) continue;
    const node: XNode = { name: m[1], attrs: {}, children: [], text: '' };
    const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a: RegExpExecArray | null;
    const rest = inner.slice(m[0].length);
    while ((a = re.exec(rest))) node.attrs[a[1]] = decodeEntities(a[3] ?? a[4] ?? '');
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}

/** Первый дочерний элемент с именем (или по одному из имён). */
export function child(n: XNode | undefined, name: string): XNode | undefined {
  return n?.children.find((c) => c.name === name);
}

export function childrenOf(n: XNode | undefined, name: string): XNode[] {
  return n ? n.children.filter((c) => c.name === name) : [];
}

/** Путь по дочерним элементам: path(n, 'p:cSld', 'p:spTree'). */
export function path(n: XNode | undefined, ...names: string[]): XNode | undefined {
  let cur = n;
  for (const nm of names) cur = child(cur, nm);
  return cur;
}

/** Все потомки с именем (в порядке документа). */
export function descendants(n: XNode | undefined, name: string, out: XNode[] = []): XNode[] {
  if (!n) return out;
  for (const c of n.children) {
    if (c.name === name) out.push(c);
    descendants(c, name, out);
  }
  return out;
}
