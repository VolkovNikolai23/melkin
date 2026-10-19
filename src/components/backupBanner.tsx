import { useEffect, useState } from 'react';
import { changedSinceBackup, deliverFile, getLastBackup, makeBackupFile, markBackupDone } from '../db/backup';
import { getMeta, setMeta } from '../db/db';
import { dialog } from './dialog';
import { Icon } from './Icon';
import { dayStart } from '../lib/time';

const DISMISS_KEY = 'backupDismissedDay';

/**
 * Раз в день при открытии: «Сохранить копию» (меню «Поделиться» → iCloud Drive).
 * Файл собирается заранее: Safari открывает «Поделиться» только сразу после нажатия,
 * а сборка архива занимает время.
 */
export function DailyBackupBanner() {
  const [show, setShow] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const today = dayStart(Date.now());
      const [last, dismissed] = await Promise.all([getLastBackup(), getMeta<number>(DISMISS_KEY, 0)]);
      if ((last && last >= today) || dismissed >= today || !(await changedSinceBackup())) return;
      if (!alive) return;
      setShow(true);
      try {
        const f = await makeBackupFile();
        if (alive) setFile(f);
      } catch {
        /* соберём при нажатии */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!show) return null;

  const save = async () => {
    setBusy(true);
    try {
      const f = file ?? (await makeBackupFile());
      const r = await deliverFile(f);
      if (r === 'needs-gesture') {
        setFile(f); // файл готов — второе нажатие сразу откроет «Поделиться»
        return;
      }
      if (r !== 'cancelled') {
        await markBackupDone();
        setShow(false);
      }
    } catch (e) {
      dialog.alert('Не удалось сохранить копию', String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pwa-banner backup-banner">
      <Icon name="download" />
      <span>Сохраните копию на сегодня: «Поделиться» → «Сохранить в Файлы» → iCloud Drive. Файл тот же — новая копия заменит старую.</span>
      <button className="btn small primary" disabled={busy} onClick={save}>
        {file ? 'Сохранить копию' : 'Готовлю…'}
      </button>
      <button
        className="icon-btn small"
        aria-label="Не сегодня"
        title="Не сегодня"
        onClick={async () => {
          await setMeta(DISMISS_KEY, Date.now());
          setShow(false);
        }}
      >
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}
