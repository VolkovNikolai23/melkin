/** Плашка «Подождите…» поверх интерфейса на время долгой операции. Возвращает функцию «убрать». */
export function showBusy(text: string): () => void {
  const el = document.createElement('div');
  el.className = 'busy-toast';
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.appendChild(el);
  return () => el.remove();
}
