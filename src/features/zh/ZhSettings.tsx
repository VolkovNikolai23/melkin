import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { dialog } from '../../components/dialog';
import { formatDate } from '../../lib/time';
import { dictStatus, importDsl, loadCedict, removeDict } from './dict';

/** Китайский словарь: загрузка CC-CEDICT, импорт своего DSL, удаление. */
export function ZhSettings() {
  const status = useLiveQuery(dictStatus, []);
  const [busy, setBusy] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (label: string, fn: (p: (n: number) => void) => Promise<number>) => {
    setBusy(label);
    try {
      const n = await fn((k) => setBusy(`${label} ${k.toLocaleString('ru-RU')} слов…`));
      await dialog.alert('Словарь готов', `${n.toLocaleString('ru-RU')} слов. Выделите китайский текст в заметке или PDF — появится кнопка «汉 Перевод».`);
    } catch (e) {
      await dialog.alert('Не получилось', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const cedict = status?.find((s) => s.src === 'cedict');
  const dsl = status?.find((s) => s.src === 'dsl');

  return (
    <section className="panel zh-settings">
      <h2>
        <Icon name="hanzi" size={20} /> Китайский словарь
      </h2>
      <p className="muted small">
        Слова (2–3 иероглифа) переводятся офлайн по словарю, предложения — ИИ. Выделите китайский текст в заметке, сводке или PDF и нажмите «汉 Перевод».
      </p>
      <div className="zh-dict-row">
        <div>
          <strong>CC-CEDICT</strong> — открытый китайско-английский словарь, 125 тыс. слов (лицензия CC BY-SA 4.0). Определения на английском; перевести их на русский может ИИ.
          {cedict && (
            <div className="muted small">
              ✓ Загружен {formatDate(cedict.at)} · {cedict.count.toLocaleString('ru-RU')} слов
            </div>
          )}
        </div>
        <div className="row-gap">
          <button className="btn small primary" disabled={!!busy} onClick={() => run('Загружаю', loadCedict)}>
            {cedict ? 'Обновить' : 'Загрузить (~4 МБ)'}
          </button>
          {cedict && (
            <button className="btn small ghost" disabled={!!busy} onClick={() => removeDict('cedict')}>
              Удалить
            </button>
          )}
        </div>
      </div>
      <div className="zh-dict-row">
        <div>
          <strong>Свой словарь (DSL)</strong> — например, китайско-русский БКРС для GoldenDict, если вы скачали его сами (.dsl или .dsl.dz). Файл читается на устройстве; в приложение и в резервную копию он не встраивается.
          {dsl && (
            <div className="muted small">
              ✓ {dsl.name} · {dsl.count.toLocaleString('ru-RU')} слов · {formatDate(dsl.at)}
            </div>
          )}
        </div>
        <div className="row-gap">
          <button className="btn small" disabled={!!busy} onClick={() => fileRef.current?.click()}>
            Импорт DSL…
          </button>
          {dsl && (
            <button className="btn small ghost" disabled={!!busy} onClick={() => removeDict('dsl')}>
              Удалить
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".dsl,.dz,.gz,text/plain"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) run('Читаю словарь:', (p) => importDsl(f, p));
          }}
        />
      </div>
      {busy && (
        <p className="ai-thinking muted">
          <span className="spinner" aria-hidden /> {busy}
        </p>
      )}
    </section>
  );
}
