import { useSyncExternalStore } from 'react';

// Разделение экрана: какой документ открыт во второй (правой) панели.
let secondary: string | null = (() => {
  try {
    return sessionStorage.getItem('melkin-split');
  } catch {
    return null;
  }
})();
const listeners = new Set<() => void>();

export function openSplit(docId: string | null) {
  secondary = docId;
  try {
    if (docId) sessionStorage.setItem('melkin-split', docId);
    else sessionStorage.removeItem('melkin-split');
  } catch {
    /* приватный режим */
  }
  listeners.forEach((l) => l());
}

export function useSplit(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => secondary,
  );
}
