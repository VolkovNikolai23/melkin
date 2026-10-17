import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import 'katex/dist/katex.min.css';
import './styles.css';
import { App } from './App';
import { requestPersistence } from './db/db';

requestPersistence();
// Service worker: кэширует приложение для офлайн-работы и тихо обновляет его при наличии сети.
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
