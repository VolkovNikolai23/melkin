import { useEffect, useState } from 'react';
import { navigate } from '../lib/router';
import { Icon } from './Icon';

/** Предупреждаем заранее: при заполнении 80% квоты или если свободно меньше 300 МБ. */
export const STORAGE_WARN_RATIO = 0.8;
export const STORAGE_WARN_FREE = 300 * 1024 * 1024;

export function formatBytes(n: number) {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} КБ`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1).replace('.', ',')} МБ`;
  return `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} ГБ`;
}

export function storageLevel(usage: number, quota: number): 'ok' | 'warn' | 'critical' {
  if (!quota) return 'ok';
  const free = quota - usage;
  if (usage / quota >= 0.95 || free < 50 * 1024 * 1024) return 'critical';
  if (usage / quota >= STORAGE_WARN_RATIO || free < STORAGE_WARN_FREE) return 'warn';
  return 'ok';
}

export function useStorageEstimate() {
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () =>
      navigator.storage
        ?.estimate?.()
        .then((e) => alive && setEst({ usage: e.usage ?? 0, quota: e.quota ?? 0 }))
        .catch(() => undefined);
    read();
    const t = setInterval(read, 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return est;
}

export function StorageWarning() {
  const est = useStorageEstimate();
  if (!est) return null;
  const level = storageLevel(est.usage, est.quota);
  if (level === 'ok') return null;
  return (
    <div className={'banner' + (level === 'critical' ? ' danger' : ' warn')}>
      <Icon name="warning" />
      <span>
        {level === 'critical' ? 'Место почти закончилось' : 'Место заканчивается'}: занято {formatBytes(est.usage)} из {formatBytes(est.quota)}. Сохраните резервную копию и
        удалите ненужные PDF и фото (не забудьте очистить корзину).
      </span>
      <button className="btn small" onClick={() => navigate('settings')}>
        Подробнее
      </button>
    </div>
  );
}
