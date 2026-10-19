import { useState, useSyncExternalStore } from 'react';
import { Icon } from '../../components/Icon';
import { db } from '../../db/db';
import type { Doc, Stroke } from '../../db/schema';
import { InkCanvas } from '../ink/InkCanvas';
import { InkToolbar } from '../ink/InkToolbar';
import { appendBlock } from '../notes/blocks';
import { getOrCreateDaily } from '../notes/daily';
import { getPdfIndex } from '../pdf/textIndex';
import { showAiAnswer } from './AiAnswer';
import { ask, canvasPart, type Part } from './client';
import { renderInk } from './inkImage';
import { lectureMaterial, materialText, subjectOf } from './lecture';
import { prompt } from './prompts';

const ASK_W = 800;
const ASK_H = 300;

let openFor: { docId: string | null } | null = null;
const listeners = new Set<() => void>();
/** Открыть окно вопроса; docId — документ, который взять как контекст. */
export function openAsk(docId: string | null = null) {
  openFor = { docId };
  listeners.forEach((l) => l());
}
function close() {
  openFor = null;
  listeners.forEach((l) => l());
}

/** Текст документа как контекст вопроса (не длиннее limit). */
export async function docContext(doc: Doc, limit = 20000): Promise<string> {
  let text = '';
  if (doc.type === 'lecture') text = materialText(await lectureMaterial(doc), undefined, limit);
  else if (doc.type === 'pdf' && doc.fileId) text = ((await getPdfIndex(doc.fileId)) ?? []).map((t, i) => `[стр. ${i + 1}] ${t}`).join('\n');
  else if (doc.type === 'notebook') {
    const pages = await db.pages.where('docId').equals(doc.id).sortBy('order');
    text = pages.map((p) => [p.recognizedText ?? '', ...(p.items ?? []).map((i) => i.text ?? '')].join('\n')).join('\n---\n');
  } else {
    const blocks = await db.blocks.where('docId').equals(doc.id).toArray();
    text = blocks.map((b) => b.text || b.recognizedText || '').filter(Boolean).join('\n');
  }
  text = text.trim();
  return text.length > limit ? text.slice(0, limit) + '\n[…обрезано…]' : text;
}

/** Вопрос к ИИ текстом или от руки (Pencil); ответ можно сохранить в заметку дня. */
export function AskDialogHost() {
  const state = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => openFor,
  );
  if (!state) return null;
  return <AskDialog key={String(state.docId)} docId={state.docId} />;
}

function AskDialog({ docId }: { docId: string | null }) {
  const [mode, setMode] = useState<'text' | 'pen'>('text');
  const [text, setText] = useState('');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [useDoc, setUseDoc] = useState(!!docId);

  const submit = async () => {
    const doc = docId ? await db.docs.get(docId) : undefined;
    const question = text.trim();
    const pen = mode === 'pen' && strokes.length > 0;
    if (!pen && !question) return;
    let preview: Blob | undefined;
    const parts: Part[] = [];
    if (pen) {
      const c = await renderInk({ width: ASK_W, height: ASK_H, strokes }, undefined, 1200);
      preview = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/jpeg', 0.85));
      parts.push({ text: 'Вопрос написан от руки:' }, await canvasPart(c));
    } else parts.push({ text: `Вопрос: ${question}` });
    const context = doc && useDoc ? await docContext(doc) : '';
    const subject = doc ? await subjectOf(doc) : '';
    close();
    await showAiAnswer(
      'Ответ ИИ',
      () => ask({ system: prompt('ask', { context: context ? `«${doc!.title}»:\n${context}` : 'нет', subject }), parts, cache: false }),
      {
        preview,
        action: {
          label: 'В заметку дня',
          run: async (answer) => {
            const daily = await getOrCreateDaily();
            const q = await appendBlock(daily.id, 'text', `Вопрос к ИИ: ${pen ? '(от руки)' : question}`);
            for (const line of answer.split('\n').filter((l) => l.trim())) {
              const b = await appendBlock(daily.id, 'text', line.trim().replace(/<>|>>|<<|::|;;/g, '→'));
              await db.blocks.update(b.id, { parentId: q.id });
            }
          },
        },
      },
    );
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal ask-modal" role="dialog" aria-modal aria-label="Спросить ИИ" onClick={(e) => e.stopPropagation()}>
        <h3>
          <Icon name="sparkle" size={20} /> Спросить ИИ
        </h3>
        <div className="segmented small">
          <button className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')}>
            Текстом
          </button>
          <button className={mode === 'pen' ? 'active' : ''} onClick={() => setMode('pen')}>
            <Icon name="pen" size={16} /> От руки
          </button>
        </div>
        {mode === 'text' ? (
          <textarea
            className="text-input ask-text"
            rows={4}
            autoFocus
            placeholder="Например: чем митоз отличается от мейоза? (можно писать Pencil — Scribble)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && submit()}
          />
        ) : (
          <div className="ask-ink">
            <InkToolbar />
            <InkCanvas id="ask" width={ASK_W} height={ASK_H} strokes={strokes} background="lines" onChange={setStrokes} className="answer-ink" />
          </div>
        )}
        {docId && (
          <label className="check-row">
            <input type="checkbox" checked={useDoc} onChange={(e) => setUseDoc(e.target.checked)} /> С учётом открытого документа
          </label>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={close}>
            Отмена
          </button>
          <button className="btn primary" disabled={mode === 'text' ? !text.trim() : !strokes.length} onClick={submit}>
            Спросить
          </button>
        </div>
      </div>
    </div>
  );
}
