// Копирует ресурсы pdf.js (шрифты, CMaps, wasm-декодеры, ICC) в public/pdfjs,
// чтобы PDF открывались офлайн: Workbox кладёт их в precache вместе с приложением.
import { cpSync, existsSync, mkdirSync } from 'node:fs';

const src = 'node_modules/pdfjs-dist';
if (!existsSync(src)) process.exit(0);
mkdirSync('public/pdfjs', { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  if (existsSync(`${src}/${dir}`)) cpSync(`${src}/${dir}`, `public/pdfjs/${dir}`, { recursive: true });
}
console.log('pdf.js: ресурсы скопированы в public/pdfjs');
