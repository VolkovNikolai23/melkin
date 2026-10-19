// Напоминания о повторении через web push. На сервер (свой Cloudflare Worker) уходят
// только подписка и время ближайших повторений — без текста карточек.
import { db, getMeta, setMeta } from '../../db/db';
import type { CardRow } from '../../db/schema';
import { uid } from '../../lib/id';
import { isNew } from '../review/scheduler';

const SLOT = 15 * 60_000; // сервер проверяет расписание раз в 15 минут
const H = 3_600_000;
const D = 24 * H;

export interface PushConfig {
  url: string;
  publicKey: string;
  id: string;
  on: boolean;
  /** Час ежедневного напоминания (по местному времени) */
  hour: number;
  /** Последнее отправленное расписание — чтобы не слать одно и то же */
  lastTimes?: number[];
}

export const PUSH_META = 'push';
export const getPushConfig = () => getMeta<PushConfig | null>(PUSH_META, null);

const ceilSlot = (t: number) => Math.ceil(t / SLOT) * SLOT;

/** Время локального часа hour в день now + i. */
function atHour(now: number, i: number, hour: number): number {
  const d = new Date(now);
  d.setDate(d.getDate() + i);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

/**
 * Расписание напоминаний:
 * - короткие шаги (15 мин, 1 ч, после ошибки) — в течение суток, точно по сроку;
 * - остальное — раз в день в выбранный час, если к этому часу появятся карточки к повторению
 *   (или есть новые, ещё не изученные).
 */
export function computeSchedule(cards: CardRow[], now: number, hour = 19): number[] {
  const active = cards.filter((c) => !c.disabled);
  const hasNew = active.some(isNew);
  const dues = active.filter((c) => !isNew(c)).map((c) => c.due);
  const times = new Set<number>();
  for (const t of dues) if (t > now && t <= now + D) times.add(ceilSlot(t));
  for (let i = 0; i < 14; i++) {
    const t = atHour(now, i, hour);
    if (t <= now) continue;
    const from = t - D;
    const fresh = dues.some((d) => d > from && d <= t) || (i <= 1 && (hasNew || dues.some((d) => d <= now)));
    if (fresh) times.add(t);
  }
  return [...times].sort((a, b) => a - b).slice(0, 60);
}

async function post(cfg: Pick<PushConfig, 'url'>, path: string, body: unknown) {
  let res: Response;
  try {
    res = await fetch(cfg.url.replace(/\/+$/, '') + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('Сервер напоминаний недоступен. Проверьте адрес и интернет.');
  }
  if (!res.ok) throw new Error(`Сервер напоминаний ответил ошибкой ${res.status}. Проверьте настройку Worker’а (docs/PUSH.md).`);
  return res.json().catch(() => ({}));
}

async function currentSchedule(hour: number) {
  const docs = new Set((await db.docs.filter((d) => !d.deletedAt).toArray()).map((d) => d.id));
  const cards = (await db.cards.toArray()).filter((c) => docs.has(c.docId));
  return computeSchedule(cards, Date.now(), hour);
}

/** Можно ли включить push здесь: iPad — только приложение с экрана «Домой» (iPadOS 16.4+). */
export function pushSupport(): { ok: boolean; reason?: string } {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    const standalone = matchMedia('(display-mode: standalone)').matches;
    return { ok: false, reason: standalone ? 'Это устройство не поддерживает push-уведомления.' : 'На iPad уведомления работают только в приложении, добавленном на экран «Домой» (Safari → «Поделиться» → «На экран Домой»), iPadOS 16.4 и новее.' };
  }
  return { ok: true };
}

export async function enablePush(url: string, publicKey: string, hour: number): Promise<void> {
  const support = pushSupport();
  if (!support.ok) throw new Error(support.reason);
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Уведомления не разрешены. Разрешите их: Настройки iPad → Уведомления → Мелькин.');
  const reg = await navigator.serviceWorker.ready;
  const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((publicKey.length + 3) % 4)), (c) => c.charCodeAt(0));
  const old = await reg.pushManager.getSubscription();
  if (old) await old.unsubscribe();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const prev = await getPushConfig();
  const cfg: PushConfig = { url: url.trim(), publicKey: publicKey.trim(), id: prev?.id ?? uid(), on: true, hour };
  const times = await currentSchedule(hour);
  await post(cfg, '/subscribe', { id: cfg.id, subscription: sub.toJSON(), times });
  await setMeta(PUSH_META, { ...cfg, lastTimes: times });
}

export async function disablePush(): Promise<void> {
  const cfg = await getPushConfig();
  if (!cfg) return;
  try {
    await post(cfg, '/unsubscribe', { id: cfg.id });
  } catch {
    /* сервер недоступен — подписка всё равно выключится на устройстве */
  }
  const reg = await navigator.serviceWorker?.ready;
  await (await reg?.pushManager.getSubscription())?.unsubscribe();
  await setMeta(PUSH_META, { ...cfg, on: false });
}

export async function testPush(): Promise<void> {
  const cfg = await getPushConfig();
  if (!cfg?.on) throw new Error('Уведомления не включены.');
  await post(cfg, '/test', { id: cfg.id });
}

let timer = 0;
/** Отправить расписание на сервер (с задержкой, только если оно изменилось). */
export function syncSchedule(delay = 60_000) {
  if (typeof window === 'undefined') return;
  window.clearTimeout(timer);
  timer = window.setTimeout(async () => {
    const cfg = await getPushConfig();
    if (!cfg?.on || !navigator.onLine) return;
    const times = await currentSchedule(cfg.hour);
    if (JSON.stringify(times) === JSON.stringify(cfg.lastTimes)) return;
    try {
      await post(cfg, '/schedule', { id: cfg.id, times });
      await setMeta(PUSH_META, { ...cfg, lastTimes: times });
    } catch {
      /* попробуем при следующем изменении */
    }
  }, delay);
}

/** Пара ключей VAPID для своего сервера: открытый — в приложение и Worker, закрытый — только в Worker. */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const b64url = (b: ArrayBuffer | Uint8Array) => {
    let s = '';
    for (const x of new Uint8Array(b)) s += String.fromCharCode(x);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = b64url(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privateKey = (await crypto.subtle.exportKey('jwk', pair.privateKey)).d!;
  return { publicKey, privateKey };
}
