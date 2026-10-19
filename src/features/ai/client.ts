// Клиент ИИ: один интерфейс для Gemini (по умолчанию) и Claude. Запросы идут прямо
// из браузера с ключом пользователя; ответы кэшируются в IndexedDB, чтобы одинаковый
// запрос не тратил лимит повторно. Ошибки переводятся в понятные сообщения.
import { AI_KEYS_META, db, getMeta, getSettings } from '../../db/db';
import type { AiProviderId } from '../../db/schema';

export type Part = { text: string } | { image: { data: string; mime: string } };

export interface AiRequest {
  /** Системная инструкция (из файла промпта) */
  system: string;
  parts: Part[];
  /** Ждём JSON */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** Кэшировать ответ (по умолчанию да) */
  cache?: boolean;
}

export type AiErrorKind = 'nokey' | 'offline' | 'network' | 'blocked' | 'quota' | 'auth' | 'server' | 'safety' | 'format';

const MESSAGES: Record<AiErrorKind, string> = {
  nokey: 'Не задан ключ ИИ. Откройте «Настройки» → «Искусственный интеллект» и вставьте ключ.',
  offline: 'Нет интернета. Функции ИИ заработают, когда появится сеть.',
  network: 'Нет доступа к сервису ИИ. Если вы в России — включите VPN и повторите.',
  blocked: 'Сервис ИИ недоступен из вашего региона. Включите VPN или переключитесь на другой провайдер в настройках.',
  quota: 'Исчерпан лимит запросов. Подождите минуту и повторите, или переключитесь на другой провайдер в настройках.',
  auth: 'Ключ ИИ не подходит. Проверьте его в «Настройках».',
  server: 'Сервис ИИ сейчас перегружен или недоступен. Повторите чуть позже.',
  safety: 'ИИ отказался отвечать на этот запрос. Попробуйте переформулировать.',
  format: 'ИИ ответил в неожиданном виде. Попробуйте ещё раз.',
};

export class AiError extends Error {
  kind: AiErrorKind;
  detail?: string;
  constructor(kind: AiErrorKind, detail?: string) {
    super(MESSAGES[kind]);
    this.kind = kind;
    this.detail = detail;
  }
}

/** Понятный текст ошибки для интерфейса. */
export function aiErrorText(e: unknown): string {
  return e instanceof AiError ? e.message : e instanceof Error ? e.message : String(e);
}

/** Ошибка HTTP → вид ошибки (по статусу и тексту ответа провайдера). */
export function classifyHttp(provider: AiProviderId, status: number, body: string): AiError {
  const b = body.toLowerCase();
  if (status === 429 || b.includes('resource_exhausted') || b.includes('quota') || b.includes('rate limit') || b.includes('credit balance')) return new AiError('quota', body);
  if (b.includes('location is not supported') || b.includes('unsupported_country') || b.includes('not available in your country')) return new AiError('blocked', body);
  if (status === 401 || b.includes('api key not valid') || b.includes('api_key_invalid') || b.includes('invalid x-api-key') || b.includes('authentication')) return new AiError('auth', body);
  if (status === 403) return new AiError(provider === 'gemini' && !b.includes('permission') ? 'blocked' : 'auth', body);
  if (status >= 500 || status === 529) return new AiError('server', body);
  return new AiError('server', `HTTP ${status}: ${body.slice(0, 300)}`);
}

// ---------- Тела запросов и разбор ответов (чистые функции, покрыты тестами) ----------

export function geminiBody(req: AiRequest) {
  return {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [
      {
        role: 'user',
        parts: req.parts.map((p) => ('text' in p ? { text: p.text } : { inline_data: { mime_type: p.image.mime, data: p.image.data } })),
      },
    ],
    generationConfig: {
      temperature: req.temperature ?? 0.4,
      maxOutputTokens: req.maxTokens ?? 8192,
      ...(req.json ? { responseMimeType: 'application/json' } : {}),
    },
  };
}

export function claudeBody(model: string, req: AiRequest) {
  return {
    model,
    max_tokens: req.maxTokens ?? 8192,
    temperature: req.temperature ?? 0.4,
    system: req.json ? req.system + '\n\nОтвечай только JSON, без пояснений и без ```.' : req.system,
    messages: [
      {
        role: 'user',
        content: req.parts.map((p) => ('text' in p ? { type: 'text', text: p.text } : { type: 'image', source: { type: 'base64', media_type: p.image.mime, data: p.image.data } })),
      },
    ],
  };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

export function parseGemini(r: GeminiResponse): string {
  if (r.promptFeedback?.blockReason) throw new AiError('safety', r.promptFeedback.blockReason);
  const c = r.candidates?.[0];
  const text = (c?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('');
  if (!text && (c?.finishReason === 'SAFETY' || c?.finishReason === 'PROHIBITED_CONTENT')) throw new AiError('safety', c.finishReason);
  if (!text) throw new AiError('format', JSON.stringify(r).slice(0, 300));
  return text;
}

interface ClaudeResponse {
  content?: { type: string; text?: string }[];
  stop_reason?: string;
}

export function parseClaude(r: ClaudeResponse): string {
  const text = (r.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('');
  if (!text && r.stop_reason === 'refusal') throw new AiError('safety');
  if (!text) throw new AiError('format', JSON.stringify(r).slice(0, 300));
  return text;
}

/** JSON из ответа модели: снимает ```json-обёртки и лишний текст вокруг. */
export function extractJson<T>(text: string): T {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t) as T;
  } catch {
    const start = t.search(/[[{]/);
    const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1)) as T;
      } catch {
        /* ниже — ошибка формата */
      }
    }
    throw new AiError('format', text.slice(0, 300));
  }
}

// ---------- Отправка ----------

/** Подменяется в тестах */
export const transport = { fetch: (input: string, init: RequestInit) => fetch(input, init) };

async function hashKey(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function aiConfig(): Promise<{ provider: AiProviderId; model: string; key: string | undefined }> {
  const s = await getSettings();
  const keys = await getMeta<Partial<Record<AiProviderId, string>>>(AI_KEYS_META, {});
  return { provider: s.aiProvider, model: s.aiModel[s.aiProvider], key: keys[s.aiProvider] };
}

/** Есть ли ключ — чтобы заранее показать подсказку, а не ошибку. */
export async function aiReady(): Promise<boolean> {
  return !!(await aiConfig()).key;
}

const CACHE_DAYS = 60;

export async function ask(req: AiRequest): Promise<string> {
  const { provider, model, key } = await aiConfig();
  if (!key) throw new AiError('nokey');
  const useCache = req.cache !== false;
  const cacheKey = useCache ? await hashKey(JSON.stringify([provider, model, req.system, req.parts, req.json, req.temperature])) : '';
  if (useCache) {
    const hit = await db.aiCache.get(cacheKey);
    if (hit && Date.now() - hit.createdAt < CACHE_DAYS * 864e5) return hit.value;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new AiError('offline');

  let res: Response;
  try {
    if (provider === 'gemini') {
      res = await transport.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        // ключ — в заголовке, а не в адресе (не попадает в журналы и историю)
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(geminiBody(req)),
      });
    } else {
      res = await transport.fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(claudeBody(model, req)),
      });
    }
  } catch (e) {
    // fetch падает без ответа: нет сети или сервис заблокирован (нужен VPN)
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new AiError('offline');
    throw new AiError('network', e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) throw classifyHttp(provider, res.status, await res.text().catch(() => ''));
  const data = await res.json();
  const text = provider === 'gemini' ? parseGemini(data) : parseClaude(data);
  if (useCache) await db.aiCache.put({ key: cacheKey, value: text, createdAt: Date.now() });
  return text;
}

/** Запрос с ответом JSON; при неверном формате — одна повторная попытка без кэша. */
export async function askJson<T>(req: AiRequest, check?: (v: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await ask({ ...req, json: true, cache: attempt === 0 ? req.cache : false });
    try {
      const v = extractJson<T>(text);
      if (!check || check(v)) return v;
    } catch {
      /* повторим */
    }
    if (attempt === 0 && req.cache !== false) {
      // испорченный ответ не должен остаться в кэше
      const { provider, model } = await aiConfig();
      await db.aiCache.delete(await hashKey(JSON.stringify([provider, model, req.system, req.parts, true, req.temperature])));
    }
  }
  throw new AiError('format');
}

// ---------- Картинки ----------

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function blobPart(blob: Blob): Promise<Part> {
  return { image: { data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())), mime: blob.type || 'image/png' } };
}

export async function canvasPart(c: HTMLCanvasElement, type: 'image/png' | 'image/jpeg' = 'image/jpeg'): Promise<Part> {
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), type, 0.85));
  return blobPart(blob);
}
