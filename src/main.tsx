import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import 'katex/dist/katex.min.css';
import './styles.css';
import { App } from './App';
import { pwaStore } from './components/pwa';
import { db, requestPersistence } from './db/db';
import { resyncAllCards } from './features/cards/sync';
import { dedupeDaily, getOrCreateDaily } from './features/notes/daily';
import { purgeExpired } from './features/notes/docs';
import { initSession } from './lib/session';

// Куда открыть: при возврате — последняя заметка, после полного закрытия — «Сегодня»
initSession();
requestPersistence();
// Корзина: всё, что лежит дольше 30 дней, удаляется насовсем
purgeExpired().catch(() => undefined);
// Ежедневная заметка на сегодня создаётся автоматически
dedupeDaily()
  .then(() => getOrCreateDaily())
  .catch(() => undefined);
// После обновления схемы карточки пересобираются новым парсером (история сохраняется).
db.meta.get('resyncCards').then(async (m) => {
  if (!m?.value) return;
  await resyncAllCards();
  await db.meta.delete('resyncCards');
});
// Service worker кэширует приложение для офлайн-работы. Новую версию ставим только по нажатию
// «Обновить» — автоматическая перезагрузка могла бы оборвать набор текста.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh: () => pwaStore.set({ needRefresh: true, update: () => updateSW(true) }),
  onOfflineReady: () => pwaStore.set({ offlineReady: true }),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
// Рукопись распознаётся в фоне, когда есть сеть и ключ ИИ (текст — для поиска и сводок)
setTimeout(() => {
  import('./features/ai/recognize').then((m) => m.startAutoRecognize()).catch(() => undefined);
}, 8000);
