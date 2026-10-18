import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { AI_KEYS_META, db, getMeta, getSettings, saveSettings, setMeta } from '../db/db';
import type { AiProviderId, FontSetting, ThemeSetting } from '../db/schema';
import { FONTS, THEMES } from '../lib/appearance';
import { formatBytes, storageLevel } from './storage';
import { deliverFile, getLastBackup, importBackup, makeBackupFile, markBackupDone, readBackup } from '../db/backup';
import { formatDate } from '../lib/time';
import { dialog } from './dialog';
import { Icon } from './Icon';

const PROVIDERS: { id: AiProviderId; label: string; hint: string; keyUrl: string }[] = [
  { id: 'gemini', label: 'Google Gemini (бесплатно)', hint: 'Ключ: aistudio.google.com → Get API key. Бесплатный уровень с лимитами; из России нужен VPN.', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'claude', label: 'Claude (Anthropic)', hint: 'Ключ: console.anthropic.com → API Keys. Платно по факту использования.', keyUrl: 'https://console.anthropic.com/settings/keys' },
];

type Keys = Partial<Record<AiProviderId, string>>;

/** Ключи ИИ: хранятся только на этом устройстве и не попадают в резервную копию. */
function AiSettings() {
  const settings = useLiveQuery(getSettings, []);
  const keys = useLiveQuery(() => getMeta<Keys>(AI_KEYS_META, {}), []);
  const [shown, setShown] = useState(false);
  if (!settings || !keys) return null;
  const p = PROVIDERS.find((x) => x.id === settings.aiProvider) ?? PROVIDERS[0];
  const setKey = (v: string) => setMeta(AI_KEYS_META, { ...keys, [p.id]: v.trim() || undefined });
  return (
    <section className="panel">
      <h2>
        <Icon name="sparkle" size={20} /> Искусственный интеллект
      </h2>
      <label className="field">
        <span>Провайдер</span>
        <select className="text-input narrow-select" value={settings.aiProvider} onChange={(e) => saveSettings({ aiProvider: e.target.value as AiProviderId })}>
          {PROVIDERS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field stacked">
        <span>Ключ API</span>
        <div className="key-row">
          <input
            key={p.id}
            className="text-input"
            type={shown ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            placeholder="Вставьте ключ"
            defaultValue={keys[p.id] ?? ''}
            onBlur={(e) => setKey(e.target.value)}
          />
          <button className="btn small" type="button" onClick={() => setShown(!shown)}>
            {shown ? 'Скрыть' : 'Показать'}
          </button>
        </div>
      </label>
      <p className="muted small">
        {p.hint} Ключ хранится только на этом устройстве и не попадает в резервную копию.{' '}
        <a href={p.keyUrl} target="_blank" rel="noreferrer">
          Где взять ключ
        </a>
      </p>
      <label className="field">
        <span>Модель</span>
        <input
          key={'m' + p.id}
          className="text-input narrow-select"
          defaultValue={settings.aiModel[p.id]}
          spellCheck={false}
          onBlur={(e) => e.target.value.trim() && saveSettings({ aiModel: { ...settings.aiModel, [p.id]: e.target.value.trim() } })}
        />
      </label>
      <p className="muted small">{keys[p.id] ? '✓ Ключ сохранён. Функции ИИ появятся на следующих этапах.' : 'Ключ не задан — функции ИИ будут недоступны.'}</p>
    </section>
  );
}

function AppearanceSettings() {
  const settings = useLiveQuery(getSettings, []);
  if (!settings) return null;
  return (
    <section className="panel">
      <h2>
        <Icon name="palette" size={20} /> Оформление
      </h2>
      <div className="field">
        <span>Тема</span>
        <div className="segmented">
          {THEMES.map((t) => (
            <button key={t.id} className={settings.theme === t.id ? 'active' : ''} onClick={() => saveSettings({ theme: t.id as ThemeSetting })}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="font-list">
        {FONTS.map((f) => (
          <button key={f.id} className={'font-choice' + (settings.font === f.id ? ' active' : '')} style={{ fontFamily: f.css }} onClick={() => saveSettings({ font: f.id as FontSetting })}>
            <span className="font-sample">Аа Бб 123</span>
            <span className="font-label">{f.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function SettingsView() {
  const lastBackup = useLiveQuery(getLastBackup, []);
  const stats = useLiveQuery(async () => ({ docs: await db.docs.count(), blocks: await db.blocks.count(), cards: await db.cards.count(), files: await db.files.count() }), []);
  const [pending, setPending] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
    navigator.storage?.estimate?.().then((e) => setUsage({ usage: e.usage ?? 0, quota: e.quota ?? 0 })).catch(() => setUsage(null));
  }, []);

  const doExport = async (file?: File) => {
    setBusy(true);
    try {
      const f = file ?? (await makeBackupFile());
      const r = await deliverFile(f);
      if (r === 'needs-gesture') setPending(f);
      else {
        setPending(null);
        if (r !== 'cancelled') await markBackupDone();
      }
    } catch (e) {
      dialog.alert('Не удалось сохранить копию', String(e));
    } finally {
      setBusy(false);
    }
  };

  const doImport = async (file: File) => {
    try {
      const backup = await readBackup(file);
      const n = (backup.data.docs ?? []).length;
      const choice = await dialog.choose(
        'Восстановить из копии?',
        `В файле документов: ${n} (от ${formatDate(Date.parse(backup.exportedAt))}). «Заменить» удалит текущие данные, «Объединить» добавит недостающее и обновит изменённое.`,
        [
          { label: 'Объединить', value: 'merge', primary: true },
          { label: 'Заменить всё', value: 'replace', danger: true },
          { label: 'Отмена', value: 'cancel' },
        ],
      );
      if (choice !== 'merge' && choice !== 'replace') return;
      if (choice === 'replace' && !(await dialog.confirm('Точно заменить все данные?', 'Заменить'))) return;
      await importBackup(backup, choice);
      dialog.alert('Готово', 'Данные восстановлены.');
    } catch (e) {
      dialog.alert('Не удалось импортировать', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="page-pad settings">
      <h1>Настройки</h1>

      <AppearanceSettings />
      <AiSettings />

      <section className="panel">
        <h2>Резервная копия</h2>
        <p className="muted">
          Все данные хранятся только на этом устройстве. Регулярно сохраняйте копию (.zip: заметки, карточки, картинки и PDF) в «Файлы» или iCloud Drive.
          <br />
          Последняя копия: <strong>{lastBackup ? formatDate(lastBackup) : 'ещё не было'}</strong>
        </p>
        <div className="row-gap">
          <button className="btn primary" disabled={busy} onClick={() => doExport()}>
            <Icon name="download" /> Сохранить копию
          </button>
          {pending && (
            <button className="btn primary" onClick={() => doExport(pending)}>
              <Icon name="check" /> Файл готов — сохранить
            </button>
          )}
          <button className="btn" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" /> Восстановить из файла
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,.json,application/zip,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) doImport(f);
            }}
          />
        </div>
      </section>

      <section className="panel">
        <h2>Повторение</h2>
        <p className="muted">
          Две кнопки: <strong>«Знаю»</strong> — интервал растёт: 15 мин → 1 ч → 1 день → 3 дня → 1 неделя → дальше вдвое.{' '}
          <strong>«Не знаю»</strong> — карточка вернётся через ~30 секунд среди других, пока не ответите «знаю»; тогда интервал откатится на 4 шага.
          Лимита новых карточек нет.
        </p>
        <p className="muted small">Новый учебный день начинается в 4:00.</p>
      </section>

      <section className="panel">
        <h2>Apple Pencil</h2>
        <p className="muted">
          <strong>Рукописные блоки и тетради:</strong> рисует только Pencil, пальцы прокручивают и масштабируют (двумя пальцами), поэтому ладонь можно класть на экран.
          Лассо выделяет штрихи — их можно перенести, скопировать, перекрасить или удалить.
          <br />
          <strong>Текст от руки (Scribble):</strong> коснитесь блока кончиком Pencil и пишите — iPadOS сам превратит почерк в текст. Включается в «Настройки iPad → Apple Pencil → От руки».
        </p>
      </section>

      <section className="panel">
        <h2>Хранилище</h2>
        <p className="muted">
          Документов: {stats?.docs ?? '…'}, блоков: {stats?.blocks ?? '…'}, карточек: {stats?.cards ?? '…'}, файлов: {stats?.files ?? '…'}.
          <br />
          Занято: {usage ? `${formatBytes(usage.usage)} из доступных ${formatBytes(usage.quota)}` : 'неизвестно'}
          {usage && storageLevel(usage.usage, usage.quota) !== 'ok' && <strong className="danger-text"> — место заканчивается!</strong>}
          <br />
          Постоянное хранилище: {persisted === null ? 'неизвестно' : persisted ? 'включено ✓' : 'не подтверждено (на iPad установите приложение на экран «Домой»)'}
        </p>
      </section>

      <section className="panel">
        <h2>О приложении</h2>
        <p className="muted">
          Мелькин &lt;3 · версия {__APP_VERSION__}. Работает офлайн, без серверов и подписок.
        </p>
      </section>
    </div>
  );
}
