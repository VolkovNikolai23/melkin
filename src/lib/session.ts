// Куда открыть приложение при запуске (SPEC 6): при возврате из другого приложения —
// туда, где была; после полного закрытия — «Сегодня».

/** Сколько можно отсутствовать, чтобы запуск считался «возвратом», а не новым открытием. */
export const RESUME_WINDOW_MS = 15 * 60 * 1000;

export interface StartInput {
  /** Есть ли метка в sessionStorage (живёт, пока PWA не закрыли полностью) */
  hasSession: boolean;
  lastActive: number | null;
  lastRoute: string | null;
  now: number;
}

/** Возвращает маршрут, который надо открыть, или null — оставить текущий адрес. */
export function startRoute({ hasSession, lastActive, lastRoute, now }: StartInput): string | null {
  if (hasSession) return null; // обычная перезагрузка страницы — остаёмся на месте
  // iPadOS иногда выгружает свёрнутое приложение и запускает заново: если отсутствовали недолго,
  // это всё ещё «возврат» — открываем последнюю заметку
  if (lastActive && now - lastActive < RESUME_WINDOW_MS && lastRoute) return lastRoute;
  return ''; // полный перезапуск — «Сегодня»
}

const KEY_ROUTE = 'melkin-last-route';
const KEY_ACTIVE = 'melkin-last-active';
const KEY_SESSION = 'melkin-session';

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Вызывается один раз при старте: решает, куда открыть, и начинает следить за активностью. */
export function initSession() {
  const target = startRoute({
    hasSession: safe(() => sessionStorage.getItem(KEY_SESSION) === '1', false),
    lastActive: safe(() => Number(localStorage.getItem(KEY_ACTIVE)) || null, null),
    lastRoute: safe(() => localStorage.getItem(KEY_ROUTE), null),
    now: Date.now(),
  });
  safe(() => sessionStorage.setItem(KEY_SESSION, '1'), undefined);
  if (target !== null && '#/' + target !== (location.hash || '#/')) location.hash = '#/' + target;

  const remember = () =>
    safe(() => {
      localStorage.setItem(KEY_ROUTE, location.hash.replace(/^#\/?/, ''));
      localStorage.setItem(KEY_ACTIVE, String(Date.now()));
    }, undefined);
  window.addEventListener('hashchange', remember);
  document.addEventListener('visibilitychange', remember);
  window.addEventListener('pagehide', remember);
  setInterval(remember, 30_000);
  remember();
}
