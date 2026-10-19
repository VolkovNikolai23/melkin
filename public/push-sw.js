// Push-уведомления (подключается в сервис-воркер Workbox через importScripts).
// Сервер шлёт пустой пуш — число карточек к повторению считаем здесь, из локальной базы.
/* global self, clients, indexedDB */

function countDue() {
  return new Promise((resolve) => {
    const open = indexedDB.open('melkin');
    open.onerror = () => resolve(0);
    open.onsuccess = () => {
      const idb = open.result;
      try {
        const tx = idb.transaction(['cards', 'docs'], 'readonly');
        const now = Date.now();
        const live = new Set();
        const docs = tx.objectStore('docs').openCursor();
        docs.onsuccess = () => {
          const c = docs.result;
          if (c) {
            if (!c.value.deletedAt) live.add(c.value.id);
            c.continue();
            return;
          }
          let n = 0;
          const cur = tx.objectStore('cards').index('due').openCursor(IDBKeyRange.upperBound(now));
          cur.onsuccess = () => {
            const k = cur.result;
            if (!k) return resolve(n);
            if (!k.value.disabled && live.has(k.value.docId)) n++;
            k.continue();
          };
          cur.onerror = () => resolve(n);
        };
        docs.onerror = () => resolve(0);
      } catch (e) {
        resolve(0);
      }
    };
  });
}

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

self.addEventListener('push', (event) => {
  event.waitUntil(
    countDue().then((n) =>
      self.registration.showNotification('Мелькин <3', {
        body: n > 0 ? `Пора повторить: ${n} ${plural(n, 'карточка', 'карточки', 'карточек')} · 15 минут — и готово` : 'Загляните повторить карточки',
        icon: 'icon-192.png',
        badge: 'icon-192.png',
        tag: 'melkin-review',
        data: { url: './#/review?scope=all' },
      }),
    ),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.navigate?.(url);
          return c.focus();
        }
      }
      return clients.openWindow(url);
    }),
  );
});
