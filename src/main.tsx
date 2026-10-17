import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import 'katex/dist/katex.min.css';
import './styles.css';
import { App } from './App';
import { db, requestPersistence } from './db/db';
import { resyncAllCards } from './features/cards/sync';

requestPersistence();
// После обновления схемы карточки пересобираются новым парсером (история сохраняется).
db.meta.get('resyncCards').then(async (m) => {
  if (!m?.value) return;
  await resyncAllCards();
  await db.meta.delete('resyncCards');
});
// Service worker: кэширует приложение для офлайн-работы и тихо обновляет его при наличии сети.
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
