// Упрощённое чтение PowerPoint (.pptx): из XML слайдов берём текст, картинки, заливки
// и таблицы с положением на слайде. Точной вёрстки PowerPoint тут нет — для точного вида
// лучше экспортировать презентацию в PDF (Keynote/PowerPoint делают это в два нажатия).
import { unzipSync, strFromU8 } from 'fflate';
import { child, childrenOf, descendants, parseXml, path, type XNode } from '../../lib/xml';

/** 1 пункт = 12700 EMU */
const EMU = 12700;

export interface Run {
  t: string;
  /** Размер в пунктах (если не задан — по роли плейсхолдера) */
  size?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
}

export interface Para {
  runs: Run[];
  align: 'l' | 'ctr' | 'r';
  /** Маркер списка: «•», «1.» … или null */
  bullet: string | null;
  level: number;
}

export type SlideEl =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string }
  | { kind: 'image'; x: number; y: number; w: number; h: number; path: string }
  | { kind: 'text'; x: number; y: number; w: number; h: number; paras: Para[]; anchor: 't' | 'ctr' | 'b'; role: 'title' | 'body' | 'other'; scale: number };

export interface Slide {
  bg?: string;
  els: SlideEl[];
}

export interface Pptx {
  /** Размер слайда в пунктах */
  width: number;
  height: number;
  slides: Slide[];
  /** Файлы картинок из архива: путь → байты */
  media: Record<string, Uint8Array>;
  /** Размеры шрифта по умолчанию из мастера */
  defaults: { title: number; body: number[]; other: number };
}

interface Xf {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Преобразование группы: координаты детей → координаты слайда */
type Tf = (r: Xf) => Xf;
const ID: Tf = (r) => r;

function dirOf(p: string) {
  return p.slice(0, p.lastIndexOf('/') + 1);
}

/** Относительный путь из .rels → путь в архиве ("../media/image1.png" от ppt/slides/). */
export function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (dirOf(base) + target).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}

function relsOf(files: Record<string, Uint8Array>, part: string): Record<string, string> {
  const relPath = dirOf(part) + '_rels/' + part.slice(part.lastIndexOf('/') + 1) + '.rels';
  const f = files[relPath];
  if (!f) return {};
  const out: Record<string, string> = {};
  for (const r of descendants(parseXml(strFromU8(f)), 'Relationship')) {
    if (r.attrs.TargetMode === 'External') continue;
    out[r.attrs.Id] = resolvePath(part, r.attrs.Target);
  }
  return out;
}

function xml(files: Record<string, Uint8Array>, p: string): XNode | undefined {
  const f = files[p];
  return f ? parseXml(strFromU8(f)) : undefined;
}

function readXfrm(x: XNode | undefined): Xf | null {
  const off = child(x, 'a:off');
  const ext = child(x, 'a:ext');
  if (!off || !ext) return null;
  return { x: +off.attrs.x / EMU, y: +off.attrs.y / EMU, w: +ext.attrs.cx / EMU, h: +ext.attrs.cy / EMU };
}

type Theme = Record<string, string>;

function readTheme(t: XNode | undefined): Theme {
  const out: Theme = {};
  const scheme = t && descendants(t, 'a:clrScheme')[0];
  for (const c of scheme?.children ?? []) {
    const key = c.name.replace('a:', '');
    const v = child(c, 'a:srgbClr')?.attrs.val ?? child(c, 'a:sysClr')?.attrs.lastClr;
    if (v) out[key] = '#' + v.toLowerCase();
  }
  out.tx1 = out.dk1 ?? '#000000';
  out.bg1 = out.lt1 ?? '#ffffff';
  out.tx2 = out.dk2 ?? out.tx1;
  out.bg2 = out.lt2 ?? out.bg1;
  return out;
}

function colorOf(fill: XNode | undefined, theme: Theme): string | undefined {
  if (!fill) return undefined;
  const s = child(fill, 'a:srgbClr');
  if (s) return '#' + s.attrs.val.toLowerCase();
  const sc = child(fill, 'a:schemeClr');
  if (sc) return theme[sc.attrs.val];
  const sys = child(fill, 'a:sysClr');
  if (sys?.attrs.lastClr) return '#' + sys.attrs.lastClr.toLowerCase();
  return undefined;
}

interface Placeholder {
  type: string;
  idx: string;
}

function phOf(sp: XNode): Placeholder | null {
  const ph = descendants(child(sp, 'p:nvSpPr') ?? child(sp, 'p:nvPicPr'), 'p:ph')[0];
  if (!ph) return null;
  return { type: ph.attrs.type ?? 'body', idx: ph.attrs.idx ?? '' };
}

const roleOf = (ph: Placeholder | null): 'title' | 'body' | 'other' =>
  !ph ? 'other' : ph.type === 'title' || ph.type === 'ctrTitle' ? 'title' : ph.type === 'body' || ph.type === 'obj' || ph.type === 'subTitle' ? 'body' : 'other';

/** Положение плейсхолдера из макета или мастера: сначала по idx, потом по типу. */
function findPh(trees: (XNode | undefined)[], ph: Placeholder): Xf | null {
  const sameType = (a: string, b: string) => a === b || (a === 'ctrTitle' && b === 'title') || (a === 'title' && b === 'ctrTitle') || ((a === 'obj' || a === 'body') && (b === 'obj' || b === 'body'));
  for (const tree of trees) {
    if (!tree) continue;
    const sps = descendants(tree, 'p:sp');
    const byIdx = ph.idx ? sps.find((s) => phOf(s)?.idx === ph.idx) : undefined;
    const hit = byIdx ?? sps.find((s) => sameType(phOf(s)?.type ?? '', ph.type));
    const xf = hit && readXfrm(path(hit, 'p:spPr', 'a:xfrm'));
    if (xf) return xf;
  }
  return null;
}

const hasAutoNum = (pPr: XNode | undefined) => !!child(pPr, 'a:buAutoNum');

function readParas(body: XNode | undefined, theme: Theme, role: 'title' | 'body' | 'other'): Para[] {
  const out: Para[] = [];
  const numbers = new Map<number, number>();
  for (const p of childrenOf(body, 'a:p')) {
    const pPr = child(p, 'a:pPr');
    const level = +(pPr?.attrs.lvl ?? 0);
    const runs: Run[] = [];
    for (const r of p.children) {
      if (r.name === 'a:br') {
        runs.push({ t: '\n' });
        continue;
      }
      if (r.name !== 'a:r' && r.name !== 'a:fld') continue;
      const rPr = child(r, 'a:rPr');
      const t = child(r, 'a:t')?.text ?? '';
      if (!t) continue;
      runs.push({
        t,
        size: rPr?.attrs.sz ? +rPr.attrs.sz / 100 : undefined,
        bold: rPr?.attrs.b === '1' || undefined,
        italic: rPr?.attrs.i === '1' || undefined,
        color: colorOf(child(rPr, 'a:solidFill'), theme),
      });
    }
    let bullet: string | null = null;
    const text = runs.map((r) => r.t).join('').trim();
    if (text && !child(pPr, 'a:buNone')) {
      const ch = child(pPr, 'a:buChar')?.attrs.char;
      const auto = child(pPr, 'a:buAutoNum');
      if (auto) {
        const n = (numbers.get(level) ?? +(auto.attrs.startAt ?? 1) - 1) + 1;
        numbers.set(level, n);
        bullet = `${n}.`;
      } else if (ch) bullet = ch === '§' || ch === 'Ø' || ch === 'ü' ? '•' : ch; // символы Wingdings → обычный маркер
      else if (role === 'body') bullet = '•';
    }
    if (!hasAutoNum(pPr)) numbers.delete(level);
    const algn = pPr?.attrs.algn;
    out.push({ runs, align: algn === 'ctr' ? 'ctr' : algn === 'r' ? 'r' : 'l', bullet, level });
  }
  return out;
}



function parseTree(tree: XNode | undefined, tf: Tf, ctx: { theme: Theme; rels: Record<string, string>; inherit: (XNode | undefined)[] }, els: SlideEl[]) {
  for (const n of tree?.children ?? []) {
    if (n.name === 'p:sp') {
      const ph = phOf(n);
      let xf = readXfrm(path(n, 'p:spPr', 'a:xfrm'));
      if (!xf && ph) xf = findPh(ctx.inherit, ph);
      if (!xf) continue;
      const r = tf(xf);
      const spPr = child(n, 'p:spPr');
      const fill = colorOf(child(spPr, 'a:solidFill'), ctx.theme);
      const ln = child(spPr, 'a:ln');
      const stroke = ln && !child(ln, 'a:noFill') ? colorOf(child(ln, 'a:solidFill'), ctx.theme) : undefined;
      if (fill || stroke) els.push({ kind: 'rect', ...r, fill, stroke });
      const body = child(n, 'p:txBody');
      const role = roleOf(ph);
      const paras = readParas(body, ctx.theme, role);
      if (paras.some((p) => p.runs.some((x) => x.t.trim()))) {
        const bodyPr = child(body, 'a:bodyPr');
        const fit = child(bodyPr, 'a:normAutofit');
        const anchor = bodyPr?.attrs.anchor === 'ctr' ? 'ctr' : bodyPr?.attrs.anchor === 'b' ? 'b' : role === 'title' ? 'ctr' : 't';
        els.push({ kind: 'text', ...r, paras, anchor, role, scale: fit?.attrs.fontScale ? +fit.attrs.fontScale / 100000 : 1 });
      }
    } else if (n.name === 'p:pic') {
      const embed = descendants(child(n, 'p:blipFill'), 'a:blip')[0]?.attrs['r:embed'];
      const xf = readXfrm(path(n, 'p:spPr', 'a:xfrm'));
      const p = embed && ctx.rels[embed];
      if (xf && p) els.push({ kind: 'image', ...tf(xf), path: p });
    } else if (n.name === 'p:grpSp') {
      const gx = path(n, 'p:grpSpPr', 'a:xfrm');
      const off = readXfrm(gx);
      const chOff = child(gx, 'a:chOff');
      const chExt = child(gx, 'a:chExt');
      if (off && chOff && chExt) {
        const cx = +chOff.attrs.x / EMU;
        const cy = +chOff.attrs.y / EMU;
        const kx = off.w / (+chExt.attrs.cx / EMU || 1);
        const ky = off.h / (+chExt.attrs.cy / EMU || 1);
        const inner: Tf = (q) => tf({ x: off.x + (q.x - cx) * kx, y: off.y + (q.y - cy) * ky, w: q.w * kx, h: q.h * ky });
        parseTree(n, inner, ctx, els);
      } else parseTree(n, tf, ctx, els);
    } else if (n.name === 'p:graphicFrame') {
      const tbl = descendants(n, 'a:tbl')[0];
      const xf = readXfrm(child(n, 'p:xfrm'));
      if (!tbl || !xf) continue;
      const cols = descendants(child(tbl, 'a:tblGrid'), 'a:gridCol').map((c) => +c.attrs.w / EMU);
      let y = xf.y;
      for (const tr of childrenOf(tbl, 'a:tr')) {
        const h = +tr.attrs.h / EMU || 24;
        let x = xf.x;
        childrenOf(tr, 'a:tc').forEach((tc, i) => {
          const w = cols[i] ?? xf.w / Math.max(1, cols.length);
          const cell = tf({ x, y, w, h });
          const fill = colorOf(child(child(tc, 'a:tcPr'), 'a:solidFill'), ctx.theme);
          els.push({ kind: 'rect', ...cell, fill, stroke: '#9ca3af' });
          const paras = readParas(child(tc, 'a:txBody'), ctx.theme, 'other');
          if (paras.some((p) => p.runs.length)) els.push({ kind: 'text', ...cell, paras, anchor: 't', role: 'other', scale: 1 });
          x += w;
        });
        y += h;
      }
    }
  }
}

function bgOf(sld: XNode | undefined, theme: Theme, rels: Record<string, string>): { color?: string; image?: string } {
  const bgPr = child(descendants(sld, 'p:bg')[0], 'p:bgPr');
  if (!bgPr) return {};
  const embed = descendants(child(bgPr, 'a:blipFill'), 'a:blip')[0]?.attrs['r:embed'];
  return { color: colorOf(child(bgPr, 'a:solidFill'), theme), image: embed ? rels[embed] : undefined };
}

export function parsePptx(bytes: Uint8Array): Pptx {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('Файл не похож на презентацию PowerPoint (.pptx)');
  }
  const pres = xml(files, 'ppt/presentation.xml');
  if (!pres) throw new Error('В файле нет презентации (ppt/presentation.xml)');
  const presRels = relsOf(files, 'ppt/presentation.xml');
  const sz = descendants(pres, 'p:sldSz')[0];
  const width = sz ? +sz.attrs.cx / EMU : 720;
  const height = sz ? +sz.attrs.cy / EMU : 540;
  const ids = descendants(pres, 'p:sldId').map((s) => presRels[s.attrs['r:id']]).filter(Boolean);
  const themePath = Object.values(presRels).find((p) => p.includes('theme/'));
  const theme = readTheme(themePath ? xml(files, themePath) : undefined);

  const defaults = { title: 44, body: [28, 24, 20, 20, 20], other: 18 };
  let masterRead = false;
  const slides: Slide[] = [];
  for (const sp of ids) {
    const sld = xml(files, sp);
    if (!sld) continue;
    const rels = relsOf(files, sp);
    const layoutPath = Object.values(rels).find((p) => p.includes('slideLayouts/'));
    const layout = layoutPath ? xml(files, layoutPath) : undefined;
    const masterPath = layoutPath ? Object.values(relsOf(files, layoutPath)).find((p) => p.includes('slideMasters/')) : undefined;
    const master = masterPath ? xml(files, masterPath) : undefined;
    if (master && !masterRead) {
      masterRead = true;
      const ts = descendants(master, 'p:txStyles')[0];
      const sz1 = (n: XNode | undefined) => {
        const v = descendants(n, 'a:defRPr')[0]?.attrs.sz;
        return v ? +v / 100 : undefined;
      };
      defaults.title = sz1(child(child(ts, 'p:titleStyle'), 'a:lvl1pPr')) ?? defaults.title;
      const body = child(ts, 'p:bodyStyle');
      defaults.body = defaults.body.map((d, i) => sz1(child(body, `a:lvl${i + 1}pPr`)) ?? d);
      defaults.other = sz1(child(child(ts, 'p:otherStyle'), 'a:lvl1pPr')) ?? defaults.other;
    }
    const layoutRels = layoutPath ? relsOf(files, layoutPath) : {};
    const bg = [bgOf(sld, theme, rels), bgOf(layout, theme, layoutRels), masterPath ? bgOf(master, theme, relsOf(files, masterPath)) : {}].find((b) => b.color || b.image) ?? {};
    const els: SlideEl[] = [];
    if (bg.image) els.push({ kind: 'image', x: 0, y: 0, w: width, h: height, path: bg.image });
    parseTree(path(sld, 'p:sld', 'p:cSld', 'p:spTree') ?? descendants(sld, 'p:spTree')[0], ID, { theme, rels, inherit: [layout, master] }, els);
    slides.push({ bg: bg.color, els });
  }
  const media: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) if (k.startsWith('ppt/media/')) media[k] = v;
  return { width, height, slides, media, defaults };
}

/** Текст слайда целиком (для проверки и поиска). */
export function slideText(s: Slide): string {
  return s.els
    .flatMap((e) => (e.kind === 'text' ? e.paras.map((p) => p.runs.map((r) => r.t).join('')) : []))
    .join('\n');
}
