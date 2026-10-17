import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import 'katex/dist/katex.min.css';
import './styles.css';
import { App } from './App';
import { pwaStore } from './components/pwa';
import { db, requestPersistence } from './db/db';
import { resyncAllCards } from './features/cards/sync';
import { getOrCreateDaily } from './features/notes/daily';

requestPersistence();
// Ежедневная заметка на сегодня создаётся автоматически
getOrCreateDaily().catch(() => undefined);
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
