import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { db, getSettings, saveSettings } from '../db/db';
import { deliverFile, getLastBackup, importBackup, makeBackupFile, markBackupDone, readBackup } from '../db/backup';
import { formatDate } from '../lib/time';
import { dialog } from './dialog';
import { Icon } from './Icon';

function formatBytes(n: number) {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} КБ`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1).replace('.', ',')} МБ`;
  return `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} ГБ`;
}

export function SettingsView() {
  const settings = useLiveQuery(getSettings, []);
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
      <h1>Настройки и копии</h1>

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
        <label className="field">
          <span>Новых карточек в день</span>
          <input
            type="number"
            min={0}
            max={999}
            inputMode="numeric"
            className="text-input narrow"
            value={settings?.newPerDay ?? 20}
            onChange={(e) => saveSettings({ newPerDay: Math.max(0, Math.min(999, Number(e.target.value) || 0)) })}
          />
        </label>
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
