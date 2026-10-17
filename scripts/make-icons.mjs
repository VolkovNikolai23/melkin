// Генерирует PNG-иконки PWA без внешних зависимостей (сердечко на фиолетовом фоне).
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function makeIcon(size, heartScale, rounded) {
  const ss = 4; // суперсэмплинг для сглаживания
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const bg = [124, 108, 242];
  const r = size * 0.22;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let heart = 0;
      let inside = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss;
          const py = y + (sy + 0.5) / ss;
          // скругление углов
          let ok = true;
          if (rounded) {
            const cx = Math.min(Math.max(px, r), size - r);
            const cy = Math.min(Math.max(py, r), size - r);
            ok = (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
          }
          if (ok) inside++;
          const hx = ((px / size - 0.5) * 2.6) / heartScale;
          const hy = (-(py / size - 0.52) * 2.6) / heartScale;
          const v = (hx * hx + hy * hy - 1) ** 3 - hx * hx * hy ** 3;
          if (ok && v <= 0) heart++;
        }
      const n = ss * ss;
      const a = inside / n;
      const h = heart / Math.max(inside, 1);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = Math.round(bg[0] * (1 - h) + 255 * h);
      raw[o + 1] = Math.round(bg[1] * (1 - h) + 255 * h);
      raw[o + 2] = Math.round(bg[2] * (1 - h) + 255 * h);
      raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync('public/apple-touch-icon.png', makeIcon(180, 0.75, false));
writeFileSync('public/icon-192.png', makeIcon(192, 0.75, true));
writeFileSync('public/icon-512.png', makeIcon(512, 0.75, true));
writeFileSync('public/icon-maskable-512.png', makeIcon(512, 0.55, false));
console.log('Иконки созданы в public/');
