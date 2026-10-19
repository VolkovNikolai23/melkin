// Простые схемы для сводок: цепочка шагов, цикл, таблица сравнения. ИИ даёт только
// пункты и номер слайда-источника, рисуем сами — аккуратно и без выдуманных картинок.

export type Diagram =
  | { kind: 'flow' | 'cycle'; title: string; items: string[]; page?: number }
  | { kind: 'compare'; title: string; columns: string[]; rows: string[][]; page?: number };

const COLORS = ['#fde2e8', '#dff3e6', '#e1ecfb', '#fff1c7', '#efe3fb', '#fde6d4', '#dff4f4'];
const STROKE = '#9e3d5a';
const INK = '#2b2228';
const FONT = 'Nunito, -apple-system, system-ui, sans-serif';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Перенос текста по ширине (приблизительно: средняя ширина буквы 0,55 кегля). */
export function wrapText(text: string, maxWidth: number, fontSize: number, maxLines = 4): string[] {
  const perLine = Math.max(4, Math.floor(maxWidth / (fontSize * 0.55)));
  const lines: string[] = [];
  let cur = '';
  for (const w of text.trim().split(/\s+/)) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= perLine) cur += ' ' + w;
    else {
      lines.push(cur);
      cur = w;
    }
    while (cur.length > perLine) {
      lines.push(cur.slice(0, perLine - 1) + '-');
      cur = cur.slice(perLine - 1);
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.?$/, '…');
  }
  return lines;
}

function textBlock(lines: string[], cx: number, cy: number, size: number, weight = 600): string {
  const lh = size * 1.25;
  const top = cy - ((lines.length - 1) * lh) / 2;
  return lines
    .map((l, i) => `<text x="${cx}" y="${top + i * lh}" font-size="${size}" font-weight="${weight}" text-anchor="middle" dominant-baseline="middle" fill="${INK}">${esc(l)}</text>`)
    .join('');
}

function frame(w: number, h: number, title: string, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="${FONT}">` +
    `<rect width="${w}" height="${h}" rx="18" fill="#ffffff"/>` +
    (title ? textBlock(wrapText(title, w - 60, 26, 2), w / 2, 36, 26, 800) : '') +
    `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${STROKE}"/></marker></defs>` +
    body +
    `</svg>`
  );
}

function flow(title: string, items: string[]): string {
  const W = 900;
  const perRow = items.length <= 4 ? items.length : Math.ceil(items.length / 2);
  const rows = Math.ceil(items.length / perRow);
  const gap = 46;
  const bw = (W - 60 - gap * (perRow - 1)) / perRow;
  const bh = 110;
  const top = 80;
  let body = '';
  items.forEach((it, i) => {
    const r = Math.floor(i / perRow);
    // вторая строка идёт справа налево — «змейкой», стрелки не пересекаются
    const c = r % 2 === 0 ? i % perRow : perRow - 1 - (i % perRow);
    const x = 30 + c * (bw + gap);
    const y = top + r * (bh + 60);
    body += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="16" fill="${COLORS[i % COLORS.length]}" stroke="${STROKE}" stroke-width="2"/>`;
    body += textBlock(wrapText(`${i + 1}. ${it}`, bw - 20, 20), x + bw / 2, y + bh / 2, 20);
    if (i < items.length - 1) {
      const nr = Math.floor((i + 1) / perRow);
      if (nr === r) {
        const dir = r % 2 === 0 ? 1 : -1;
        const x1 = dir > 0 ? x + bw + 4 : x - 4;
        body += `<line x1="${x1}" y1="${y + bh / 2}" x2="${x1 + dir * (gap - 8)}" y2="${y + bh / 2}" stroke="${STROKE}" stroke-width="3" marker-end="url(#arr)"/>`;
      } else body += `<line x1="${x + bw / 2}" y1="${y + bh + 4}" x2="${x + bw / 2}" y2="${y + bh + 52}" stroke="${STROKE}" stroke-width="3" marker-end="url(#arr)"/>`;
    }
  });
  return frame(W, top + rows * (bh + 60) - 30, title, body);
}

function cycle(title: string, items: string[]): string {
  const W = 760;
  const H = 700;
  const cx = W / 2;
  const cy = 390;
  const R = 230;
  const bw = 200;
  const bh = 92;
  const n = items.length;
  let body = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#f2b8c6" stroke-width="2" stroke-dasharray="6 8"/>`;
  const pos = items.map((_, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [cx + R * Math.cos(a), cy + R * Math.sin(a), a] as const;
  });
  // стрелки по дуге между соседями
  pos.forEach(([, , a], i) => {
    const a2 = -Math.PI / 2 + ((i + 1) / n) * Math.PI * 2;
    const pad = Math.min(0.45, Math.PI / n - 0.08);
    const s = a + pad;
    const e = a2 - pad;
    if (e <= s) return;
    const x1 = cx + R * Math.cos(s);
    const y1 = cy + R * Math.sin(s);
    const x2 = cx + R * Math.cos(e);
    const y2 = cy + R * Math.sin(e);
    body += `<path d="M${x1} ${y1} A${R} ${R} 0 0 1 ${x2} ${y2}" fill="none" stroke="${STROKE}" stroke-width="3" marker-end="url(#arr)"/>`;
  });
  pos.forEach(([x, y], i) => {
    body += `<rect x="${x - bw / 2}" y="${y - bh / 2}" width="${bw}" height="${bh}" rx="16" fill="${COLORS[i % COLORS.length]}" stroke="${STROKE}" stroke-width="2"/>`;
    body += textBlock(wrapText(items[i], bw - 18, 19, 3), x, y, 19);
  });
  return frame(W, H, title, body);
}

function compare(title: string, columns: string[], rows: string[][]): string {
  const W = 900;
  const cols = Math.max(1, columns.length);
  const cw = (W - 40) / cols;
  const top = 76;
  const headH = 60;
  const lineH = 24;
  let body = '';
  columns.forEach((c, j) => {
    body += `<rect x="${20 + j * cw}" y="${top}" width="${cw}" height="${headH}" fill="${COLORS[j % COLORS.length]}" stroke="${STROKE}" stroke-width="1.5"/>`;
    body += textBlock(wrapText(c, cw - 16, 21, 2), 20 + j * cw + cw / 2, top + headH / 2, 21, 800);
  });
  let y = top + headH;
  for (const row of rows) {
    const wrapped = columns.map((_, j) => wrapText(row[j] ?? '', cw - 20, 18, 5));
    const h = Math.max(...wrapped.map((l) => l.length)) * lineH + 24;
    wrapped.forEach((lines, j) => {
      body += `<rect x="${20 + j * cw}" y="${y}" width="${cw}" height="${h}" fill="#ffffff" stroke="#e5d3da" stroke-width="1.5"/>`;
      body += textBlock(lines, 20 + j * cw + cw / 2, y + h / 2, 18, 500);
    });
    y += h;
  }
  return frame(W, y + 20, title, body);
}

/** SVG схемы; null — если данных для схемы нет. */
export function diagramSvg(d: Diagram): string | null {
  if (d.kind === 'compare') {
    const cols = (d.columns ?? []).filter(Boolean).slice(0, 3);
    const rows = (d.rows ?? []).filter((r) => Array.isArray(r) && r.some(Boolean)).slice(0, 10);
    return cols.length >= 2 && rows.length ? compare(d.title ?? '', cols, rows) : null;
  }
  const items = (d.items ?? []).map((s) => String(s).trim()).filter(Boolean).slice(0, 8);
  if (items.length < 2) return null;
  return d.kind === 'cycle' && items.length >= 3 ? cycle(d.title ?? '', items) : flow(d.title ?? '', items);
}
