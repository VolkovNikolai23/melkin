// Скачивает открытый китайско-английский словарь CC-CEDICT (CC BY-SA 4.0, mdbg.net)
// в public/dict. В precache он не входит: приложение загружает его один раз по кнопке
// «Загрузить китайский словарь» и хранит в IndexedDB — дальше работает офлайн.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const out = 'public/dict/cedict.txt.gz';
const url = 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz';
if (existsSync(out)) process.exit(0);
mkdirSync('public/dict', { recursive: true });
try {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  writeFileSync(
    'public/dict/CEDICT-LICENSE.txt',
    'CC-CEDICT — Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0).\nИсточник: https://www.mdbg.net/chinese/dictionary?page=cc-cedict\n',
  );
  console.log('CC-CEDICT: словарь загружен в public/dict');
} catch (e) {
  // без сети сборка не падает — просто не будет кнопки загрузки словаря из приложения
  console.warn('CC-CEDICT: не удалось скачать словарь —', e.message);
}
