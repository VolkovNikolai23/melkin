// Состояние PWA: готовность к офлайну, доступное обновление, подсказка по установке на iPad.
import { useState, useSyncExternalStore } from 'react';
import { Icon } from './Icon';

interface PwaState {
  needRefresh: boolean;
  offlineReady: boolean;
  update: (() => Promise<void>) | null;
}

let state: PwaState = { needRefresh: false, offlineReady: false, update: null };
const listeners = new Set<() => void>();

export const pwaStore = {
  set(p: Partial<PwaState>) {
    state = { ...state, ...p };
    listeners.forEach((l) => l());
  },
};

function usePwa() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

function readFlag(key: string) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function writeFlag(key: string) {
  try {
    localStorage.setItem(key, '1');
  } catch {
    /* приватный режим */
  }
}

/**
 * Плашки внизу экрана: «доступна новая версия» (обновляем только по нажатию —
 * чтобы не перезагрузить страницу посреди набора) и подсказка, как установить приложение на iPad.
 */
export function PwaBanners() {
  const pwa = usePwa();
  const [offlineSeen, setOfflineSeen] = useState(() => readFlag('melkin-offline-seen'));
  const [installHidden, setInstallHidden] = useState(() => readFlag('melkin-install-hint'));

  if (pwa.needRefresh) {
    return (
      <div className="pwa-banner">
        <Icon name="download" />
        <span>Доступна новая версия приложения.</span>
        <button className="btn small primary" onClick={() => pwa.update?.()}>
          Обновить
        </button>
      </div>
    );
  }
  if (pwa.offlineReady && !offlineSeen) {
    return (
      <div className="pwa-banner">
        <Icon name="check" />
        <span>Приложение сохранено и теперь работает без интернета.</span>
        <button
          className="icon-btn small"
          aria-label="Закрыть"
          onClick={() => {
            writeFlag('melkin-offline-seen');
            setOfflineSeen(true);
          }}
        >
          <Icon name="close" size={18} />
        </button>
      </div>
    );
  }
  if (isIos() && !isStandalone() && !installHidden) {
    return (
      <div className="pwa-banner">
        <Icon name="heart" />
        <span>
          Установите на экран «Домой»: кнопка «Поделиться» <span aria-hidden>⎋</span> → «На экран „Домой“». Так данные надёжно хранятся, а приложение работает офлайн.
        </span>
        <button
          className="icon-btn small"
          aria-label="Скрыть подсказку"
          onClick={() => {
            writeFlag('melkin-install-hint');
            setInstallHidden(true);
          }}
        >
          <Icon name="close" size={18} />
        </button>
      </div>
    );
  }
  return null;
}
