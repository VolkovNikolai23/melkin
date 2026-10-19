import { useEffect, useState } from 'react';
import { navigate } from '../lib/router';
import { plural } from '../lib/time';
import { Icon } from './Icon';

/** После скольких минут в фоне снова напоминать при возвращении */
const AWAY_MS = 60 * 60_000;

/**
 * Запасной вариант напоминаний (без сервера push): при открытии приложения
 * и при возвращении после перерыва — «Пора повторить N карточек».
 */
export function OpenReminder({ due, hidden }: { due: number; hidden: boolean }) {
  const [show, setShow] = useState(true);
  useEffect(() => {
    let left = 0;
    const on = () => {
      if (document.visibilityState === 'hidden') left = Date.now();
      else if (left && Date.now() - left >= AWAY_MS) setShow(true);
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  if (!show || hidden || due <= 0) return null;
  return (
    <div className="pwa-banner reminder-banner" role="status">
      <Icon name="flame" />
      <span>
        Пора повторить: {due} {plural(due, 'карточка', 'карточки', 'карточек')}. 15 минут — и готово!
      </span>
      <button
        className="btn small primary"
        onClick={() => {
          setShow(false);
          navigate('review?scope=all');
        }}
      >
        Повторить
      </button>
      <button className="icon-btn small" aria-label="Позже" title="Позже" onClick={() => setShow(false)}>
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}
