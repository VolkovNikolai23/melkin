// Слайды PPTX → PDF с настоящим текстом (его можно выделять, искать и делать из него
// карточки). Шрифт — PT Sans (латиница и кириллица), греческие буквы — стандартный Symbol.
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Para, Pptx, Run } from './pptx';

export interface FontBytes {
  latin: Uint8Array;
  cyrillic: Uint8Array;
  latinBold: Uint8Array;
  cyrillicBold: Uint8Array;
}

/** Перекодировать картинку, которую PDF не понимает (GIF, BMP, TIFF…), в PNG/JPEG. */
export type ImageConverter = (bytes: Uint8Array, ext: string) => Promise<{ bytes: Uint8Array; png: boolean } | null>;

function hexToRgb(hex: string | undefined, fallback = rgb(0.1, 0.1, 0.12)) {
  const m = hex?.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return fallback;
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

interface FontSet {
  pick: (ch: string, bold: boolean) => PDFFont | null;
}

async function loadFonts(pdf: PDFDocument, f: FontBytes): Promise<FontSet> {
  pdf.registerFontkit(fontkit);
  const [lat, cyr, latB, cyrB, sym] = await Promise.all([
    pdf.embedFont(f.latin, { subset: true }),
    pdf.embedFont(f.cyrillic, { subset: true }),
    pdf.embedFont(f.latinBold, { subset: true }),
    pdf.embedFont(f.cyrillicBold, { subset: true }),
    pdf.embedFont(StandardFonts.Symbol),
  ]);
  const sets = new Map<PDFFont, Set<number>>([lat, cyr, latB, cyrB].map((x) => [x, new Set(x.getCharacterSet())]));
  const symOk = new Map<string, boolean>();
  return {
    pick(ch, bold) {
      const code = ch.codePointAt(0)!;
      for (const font of bold ? [latB, cyrB, lat, cyr] : [lat, cyr]) if (sets.get(font)!.has(code)) return font;
      let ok = symOk.get(ch);
      if (ok === undefined) {
        try {
          sym.encodeText(ch);
          ok = true;
        } catch {
          ok = false;
        }
        symOk.set(ch, ok);
      }
      return ok ? sym : null;
    },
  };
}

interface Piece {
  text: string;
  font: PDFFont;
  size: number;
  color: ReturnType<typeof rgb>;
  width: number;
}

/** Строка из кусочков разными шрифтами (латиница/кириллица/символы). */
function pieces(fonts: FontSet, text: string, run: Run, size: number, color: ReturnType<typeof rgb>): Piece[] {
  const out: Piece[] = [];
  for (const ch of text) {
    const c = ch === '\t' ? ' ' : ch;
    const font = fonts.pick(c, !!run.bold) ?? fonts.pick('?', !!run.bold)!;
    const t = fonts.pick(c, !!run.bold) ? c : '?';
    const last = out[out.length - 1];
    if (last && last.font === font) last.text += t;
    else out.push({ text: t, font, size, color, width: 0 });
  }
  for (const p of out) p.width = p.font.widthOfTextAtSize(p.text, size);
  return out;
}

interface Line {
  pieces: Piece[];
  width: number;
  height: number;
  indent: number;
  bullet?: Piece[];
  align: Para['align'];
}

interface Token {
  ps: Piece[];
  w: number;
  size: number;
  space: boolean;
  br?: boolean;
}

const widthOf = (ps: Piece[]) => ps.reduce((s, p) => s + p.width, 0);

/** Раскладка абзацев по строкам внутри ширины width: перенос по пробелам, длинные слова — по буквам. */
export function layoutParas(fonts: FontSet, paras: Para[], width: number, sizeFor: (p: Para, r: Run) => number, scale: number, defaultColor: string): Line[] {
  const lines: Line[] = [];
  for (const para of paras) {
    const first = para.runs.find((r) => r.t.trim()) ?? para.runs[0] ?? { t: '' };
    const baseSize = sizeFor(para, first) * scale;
    const bullet = para.bullet ? pieces(fonts, para.bullet + ' ', first, baseSize, hexToRgb(first.color ?? defaultColor)) : undefined;
    const bulletW = bullet ? widthOf(bullet) : 0;
    const indent = para.level * 18 + bulletW;
    const maxW = Math.max(10, width - indent);

    const tokens: Token[] = [];
    for (const run of para.runs) {
      if (run.t === '\n') {
        tokens.push({ ps: [], w: 0, size: baseSize, space: false, br: true });
        continue;
      }
      const size = sizeFor(para, run) * scale;
      const color = hexToRgb(run.color ?? defaultColor);
      for (const word of run.t.split(/(\s+)/)) {
        if (!word) continue;
        const space = /^\s+$/.test(word);
        let ps = pieces(fonts, space ? ' ' : word, run, size, color);
        if (!space && widthOf(ps) > maxW) {
          // режем слово на куски, каждый помещается в строку
          let chunk = '';
          for (const ch of word) {
            if (chunk && widthOf(pieces(fonts, chunk + ch, run, size, color)) > maxW) {
              const cp = pieces(fonts, chunk, run, size, color);
              tokens.push({ ps: cp, w: widthOf(cp), size, space: false });
              chunk = '';
            }
            chunk += ch;
          }
          ps = pieces(fonts, chunk, run, size, color);
        }
        tokens.push({ ps, w: widthOf(ps), size, space });
      }
    }

    let cur: Token[] = [];
    let firstLine = true;
    const flush = () => {
      while (cur.length && cur[cur.length - 1].space) cur.pop();
      const w = cur.reduce((s, t) => s + t.w, 0);
      const h = Math.max(baseSize, ...cur.map((t) => t.size)) * 1.2;
      lines.push({ pieces: cur.flatMap((t) => t.ps), width: w, height: h, indent, bullet: firstLine ? bullet : undefined, align: para.align });
      firstLine = false;
      cur = [];
    };
    let curW = 0;
    for (const t of tokens) {
      if (t.br) {
        flush();
        curW = 0;
        continue;
      }
      if (t.space && !cur.length) continue;
      if (!t.space && cur.length && curW + t.w > maxW) {
        flush();
        curW = 0;
      }
      cur.push(t);
      curW += t.w;
    }
    flush();
  }
  return lines;
}

function drawLines(page: PDFPage, lines: Line[], box: { x: number; y: number; w: number; h: number }, anchor: 't' | 'ctr' | 'b', pageH: number) {
  const total = lines.reduce((s, l) => s + l.height, 0);
  let y = anchor === 'ctr' ? box.y + (box.h - total) / 2 : anchor === 'b' ? box.y + box.h - total : box.y;
  for (const l of lines) {
    const base = y + l.height * 0.8;
    let x = box.x + l.indent;
    if (l.align === 'ctr') x = box.x + l.indent + (box.w - l.indent - l.width) / 2;
    else if (l.align === 'r') x = box.x + box.w - l.width;
    if (l.bullet) {
      let bx = box.x + l.indent - l.bullet.reduce((s, p) => s + p.width, 0);
      for (const p of l.bullet) {
        page.drawText(p.text, { x: bx, y: pageH - base, size: p.size, font: p.font, color: p.color });
        bx += p.width;
      }
    }
    for (const p of l.pieces) {
      if (p.text.trim()) page.drawText(p.text, { x, y: pageH - base, size: p.size, font: p.font, color: p.color });
      x += p.width;
    }
    y += l.height;
  }
}

const INSET_X = 7.2;
const INSET_Y = 3.6;

export async function pptxToPdf(deck: Pptx, fontBytes: FontBytes, convert?: ImageConverter, title?: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  if (title) pdf.setTitle(title);
  const fonts = await loadFonts(pdf, fontBytes);
  const images = new Map<string, Awaited<ReturnType<PDFDocument['embedPng']>> | null>();
  const imageFor = async (p: string) => {
    if (images.has(p)) return images.get(p)!;
    const bytes = deck.media[p];
    const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase();
    let img = null;
    try {
      if (bytes && (ext === 'png' || ext === 'jpg' || ext === 'jpeg')) img = ext === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      else if (bytes && convert) {
        const c = await convert(bytes, ext);
        if (c) img = c.png ? await pdf.embedPng(c.bytes) : await pdf.embedJpg(c.bytes);
      }
    } catch {
      img = null; // повреждённая или неподдерживаемая картинка (EMF/WMF) — пропускаем
    }
    images.set(p, img);
    return img;
  };

  const { width: W, height: H, defaults } = deck;
  for (const slide of deck.slides) {
    const page = pdf.addPage([W, H]);
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: hexToRgb(slide.bg, rgb(1, 1, 1)) });
    const dark = slide.bg ? isDark(slide.bg) : false;
    for (const el of slide.els) {
      if (el.kind === 'rect') {
        page.drawRectangle({
          x: el.x,
          y: H - el.y - el.h,
          width: el.w,
          height: el.h,
          ...(el.fill ? { color: hexToRgb(el.fill) } : {}),
          ...(el.stroke ? { borderColor: hexToRgb(el.stroke), borderWidth: 0.75 } : {}),
        });
      } else if (el.kind === 'image') {
        const img = await imageFor(el.path);
        if (img) page.drawImage(img, { x: el.x, y: H - el.y - el.h, width: el.w, height: el.h });
      } else {
        const sizeFor = (p: Para, r: Run) => r.size ?? (el.role === 'title' ? defaults.title : el.role === 'body' ? (defaults.body[p.level] ?? 18) : defaults.other);
        const box = { x: el.x + INSET_X, y: el.y + INSET_Y, w: el.w - 2 * INSET_X, h: el.h - 2 * INSET_Y };
        const color = dark ? '#ffffff' : '#1f1f23';
        // текст не влез — уменьшаем, как «автоподбор» PowerPoint (до половины размера)
        let scale = el.scale;
        let lines = layoutParas(fonts, el.paras, box.w, sizeFor, scale, color);
        while (lines.reduce((s, l) => s + l.height, 0) > box.h && scale > el.scale * 0.5) {
          scale *= 0.9;
          lines = layoutParas(fonts, el.paras, box.w, sizeFor, scale, color);
        }
        drawLines(page, lines, box, el.anchor, H);
      }
    }
  }
  return pdf.save();
}

function isDark(hex: string) {
  const c = hexToRgb(hex);
  return 0.2126 * c.red + 0.7152 * c.green + 0.0722 * c.blue < 0.45;
}
