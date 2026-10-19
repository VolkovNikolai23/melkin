import { useSyncExternalStore } from 'react';
import { Icon } from '../../components/Icon';
import { renderText } from '../notes/render';
import { aiErrorText } from './client';

interface State {
  title: string;
  loading: boolean;
  text?: string;
  error?: string;
  /** Картинка того, что отправили (обведённый фрагмент) */
  preview?: string;
  /** Дополнительное действие: «Вставить на лист», «В заметку дня»… */
  action?: { label: string; run: (text: string) => void | Promise<void> };
}

let state: State | null = null;
const listeners = new Set<() => void>();
const set = (s: State | null) => {
  if (state?.preview && state.preview !== s?.preview) URL.revokeObjectURL(state.preview);
  state = s;
  listeners.forEach((l) => l());
};

/** Показать окно ответа ИИ: сначала «думаю…», потом текст или понятная ошибка. */
export async function showAiAnswer(title: string, work: () => Promise<string>, opts: { preview?: Blob; action?: State['action'] } = {}) {
  const preview = opts.preview ? URL.createObjectURL(opts.preview) : undefined;
  const token = {};
  current = token;
  set({ title, loading: true, preview, action: opts.action });
  try {
    const text = await work();
    if (current === token) set({ title, loading: false, text, preview, action: opts.action });
  } catch (e) {
    if (current === token) set({ title, loading: false, error: aiErrorText(e), preview });
  }
}
let current: object | null = null;

export function AiAnswerHost() {
  const s = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );
  if (!s) return null;
  const close = () => {
    current = null;
    set(null);
  };
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal ai-answer" role="dialog" aria-modal aria-label={s.title} onClick={(e) => e.stopPropagation()}>
        <h3>
          <Icon name="sparkle" size={20} /> {s.title}
        </h3>
        {s.preview && <img className="ai-preview" src={s.preview} alt="Обведённый фрагмент" />}
        {s.loading && (
          <p className="muted ai-thinking">
            <span className="spinner" aria-hidden /> ИИ думает…
          </p>
        )}
        {s.error && <p className="error">{s.error}</p>}
        {s.text && (
          <div className="ai-text">
            {s.text
              .split('\n')
              .filter((l) => l.trim())
              .map((l, i) => (
                // renderText экранирует HTML и рисует выделения, формулы, химию
                <p key={i} dangerouslySetInnerHTML={{ __html: renderText(l.trim()) }} />
              ))}
          </div>
        )}
        <div className="modal-actions">
          {s.text && (
            <button className="btn" onClick={() => navigator.clipboard?.writeText(s.text!)}>
              Скопировать
            </button>
          )}
          {s.text && s.action && (
            <button
              className="btn"
              onClick={async () => {
                await s.action!.run(s.text!);
                close();
              }}
            >
              {s.action.label}
            </button>
          )}
          <button className="btn primary" onClick={close}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
