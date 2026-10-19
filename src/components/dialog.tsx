import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

// Простые модальные окна на промисах (системные confirm/prompt в PWA на iPad ведут себя ненадёжно).

interface Choice {
  label: string;
  value: string;
  danger?: boolean;
  primary?: boolean;
}

interface Req {
  title: string;
  message?: string;
  input?: { value: string; placeholder?: string };
  select?: { options: { value: string; label: string }[]; value: string };
  choices: Choice[];
  resolve: (r: { choice: string | null; value: string }) => void;
}

let current: Req | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function open(req: Omit<Req, 'resolve'>) {
  return new Promise<{ choice: string | null; value: string }>((resolve) => {
    current = { ...req, resolve };
    emit();
  });
}

export const dialog = {
  async confirm(title: string, okLabel = 'OK', message?: string): Promise<boolean> {
    const r = await open({
      title,
      message,
      choices: [
        { label: 'Отмена', value: 'cancel' },
        { label: okLabel, value: 'ok', danger: /удал/i.test(okLabel), primary: !/удал/i.test(okLabel) },
      ],
    });
    return r.choice === 'ok';
  },
  async prompt(title: string, value = '', placeholder?: string): Promise<string | null> {
    const r = await open({
      title,
      input: { value, placeholder },
      choices: [
        { label: 'Отмена', value: 'cancel' },
        { label: 'Готово', value: 'ok', primary: true },
      ],
    });
    return r.choice === 'ok' ? r.value : null;
  },
  async choose(title: string, message: string, choices: Choice[]): Promise<string | null> {
    return (await open({ title, message, choices })).choice;
  },
  async select(title: string, options: { value: string; label: string }[], value: string, message?: string): Promise<string | null> {
    const r = await open({
      title,
      message,
      select: { options, value },
      choices: [
        { label: 'Отмена', value: 'cancel' },
        { label: 'Готово', value: 'ok', primary: true },
      ],
    });
    return r.choice === 'ok' ? r.value : null;
  },
  alert(title: string, message?: string) {
    return open({ title, message, choices: [{ label: 'OK', value: 'ok', primary: true }] }).then(() => undefined);
  },
};

export function DialogHost() {
  const req = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!req) return;
    setValue(req.input?.value ?? req.select?.value ?? '');
    if (req.input) setTimeout(() => inputRef.current?.select(), 30);
  }, [req]);

  if (!req) return null;
  const close = (choice: string | null) => {
    current = null;
    emit();
    req.resolve({ choice: choice === 'cancel' ? null : choice, value });
  };

  return (
    <div className="modal-backdrop" onClick={() => close(null)}>
      <div className="modal" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <h3>{req.title}</h3>
        {req.message && <p className="modal-msg">{req.message}</p>}
        {req.input && (
          <input
            ref={inputRef}
            className="text-input"
            value={value}
            placeholder={req.input.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') close('ok');
              if (e.key === 'Escape') close(null);
            }}
          />
        )}
        {req.select && (
          <select className="text-input" value={value} onChange={(e) => setValue(e.target.value)}>
            {req.select.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        <div className={'modal-actions' + (req.choices.length > 2 ? ' stacked' : '')}>
          {req.choices.map((c) => (
            <button key={c.value} className={'btn' + (c.primary ? ' primary' : '') + (c.danger ? ' danger' : '')} onClick={() => close(c.value)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
