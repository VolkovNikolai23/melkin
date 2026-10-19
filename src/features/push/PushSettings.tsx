import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { dialog } from '../../components/dialog';
import { disablePush, enablePush, generateVapidKeys, getPushConfig, pushSupport, testPush } from './push';

/** Настройки напоминаний: свой сервер (Cloudflare Worker), ключи, включение и проверка. */
export function PushSettings() {
  const cfg = useLiveQuery(getPushConfig, []);
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [hour, setHour] = useState<number | null>(null);
  const [keys, setKeys] = useState<{ publicKey: string; privateKey: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (cfg === undefined) return null;
  const u = url || cfg?.url || '';
  const k = key || cfg?.publicKey || '';
  const h = hour ?? cfg?.hour ?? 19;
  const support = pushSupport();

  const run = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) await dialog.alert(ok);
    } catch (e) {
      await dialog.alert('Не получилось', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = (s: string) => navigator.clipboard?.writeText(s);

  return (
    <section className="panel push-settings">
      <h2>
        <Icon name="flame" size={20} /> Напоминания
      </h2>
      <p className="muted small">
        Уведомление «пора повторить», когда подходит срок карточек. Нужен свой бесплатный сервер на Cloudflare — пошаговая инструкция в файле <code>docs/PUSH.md</code> (10 минут, программировать не нужно). На сервер уходит только время повторений, без текста карточек.
        Без сервера приложение напоминает само, когда вы его открываете.
      </p>
      {!support.ok && <p className="banner small">{support.reason}</p>}
      <label className="field stacked">
        <span>Адрес сервера (Worker)</span>
        <input className="text-input" placeholder="https://melkin-push.ваше-имя.workers.dev" value={u} onChange={(e) => setUrl(e.target.value)} spellCheck={false} autoComplete="off" />
      </label>
      <label className="field stacked">
        <span>Открытый ключ (VAPID_PUBLIC)</span>
        <input className="text-input" placeholder="Вставьте или сгенерируйте ниже" value={k} onChange={(e) => setKey(e.target.value)} spellCheck={false} autoComplete="off" />
      </label>
      <label className="field">
        <span>Напоминать в</span>
        <select className="text-input narrow-select" value={h} onChange={(e) => setHour(Number(e.target.value))}>
          {Array.from({ length: 17 }, (_, i) => i + 7).map((x) => (
            <option key={x} value={x}>
              {x}:00
            </option>
          ))}
        </select>
      </label>
      <div className="row-gap">
        {cfg?.on ? (
          <>
            <span className="muted">✓ Уведомления включены</span>
            <button className="btn" disabled={busy} onClick={() => run(testPush, 'Тестовое уведомление отправлено — оно придёт через несколько секунд.')}>
              Проверить
            </button>
            <button className="btn" disabled={busy || hour === null} onClick={() => run(() => enablePush(u, k, h), 'Время напоминаний обновлено.')}>
              Сохранить время
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => run(disablePush)}>
              Выключить
            </button>
          </>
        ) : (
          <button className="btn primary" disabled={busy || !u || !k || !support.ok} onClick={() => run(() => enablePush(u, k, h), 'Уведомления включены. Нажмите «Проверить», чтобы получить тестовое.')}>
            <Icon name="check" /> Включить уведомления
          </button>
        )}
      </div>
      <details className="push-keys">
        <summary>Ключи для сервера (шаг 4 инструкции)</summary>
        <p className="muted small">Сгенерируйте пару один раз. Открытый ключ вставьте сюда и в секрет VAPID_PUBLIC, закрытый — только в секрет VAPID_PRIVATE на Cloudflare. Закрытый ключ приложение не сохраняет.</p>
        <button
          className="btn small"
          onClick={async () => {
            const kk = await generateVapidKeys();
            setKeys(kk);
            setKey(kk.publicKey);
          }}
        >
          Сгенерировать ключи
        </button>
        {keys && (
          <div className="push-keypair">
            <div>
              <strong>VAPID_PUBLIC</strong>
              <code>{keys.publicKey}</code>
              <button className="btn small ghost" onClick={() => copy(keys.publicKey)}>
                Скопировать
              </button>
            </div>
            <div>
              <strong>VAPID_PRIVATE</strong>
              <code>{keys.privateKey}</code>
              <button className="btn small ghost" onClick={() => copy(keys.privateKey)}>
                Скопировать
              </button>
            </div>
          </div>
        )}
      </details>
    </section>
  );
}
