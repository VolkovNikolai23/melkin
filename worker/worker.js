// Мелькин <3 — сервер напоминаний (Cloudflare Workers, бесплатный тариф).
// Хранит подписку на push и время ближайших повторений (без содержимого карточек)
// и по расписанию (cron) присылает уведомление. Пуш без данных: текст «пора повторить N
// карточек» составляет само приложение на iPad из своей локальной базы.
//
// Нужно в настройках Worker'а:
//   KV-хранилище с именем переменной SUBS;
//   секреты VAPID_PUBLIC, VAPID_PRIVATE (их генерирует приложение), VAPID_SUBJECT (mailto:ваша почта);
//   Cron Trigger «*/15 * * * *».
// Пошаговая инструкция — docs/PUSH.md.

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...CORS } });

export function b64urlToBytes(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

export function bytesToB64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Ключ подписи VAPID из пары base64url: открытый (65 байт, 0x04|x|y) и закрытый (d, 32 байта). */
async function signingKey(pub, priv) {
  const p = b64urlToBytes(pub);
  const jwk = { kty: 'EC', crv: 'P-256', x: bytesToB64url(p.slice(1, 33)), y: bytesToB64url(p.slice(33, 65)), d: priv, ext: true };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/** JWT для VAPID (ES256): адресат — origin push-сервиса (Apple, Google, Mozilla). */
export async function vapidJwt(endpoint, env, now = Date.now()) {
  const header = bytesToB64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:melkin@example.com' };
  const body = bytesToB64url(new TextEncoder().encode(JSON.stringify(claims)));
  const key = await signingKey(env.VAPID_PUBLIC, env.VAPID_PRIVATE);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${bytesToB64url(sig)}`;
}

export async function sendPush(sub, env) {
  const jwt = await vapidJwt(sub.endpoint, env);
  return fetch(sub.endpoint, {
    method: 'POST',
    headers: { TTL: '86400', Urgency: 'normal', Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`, 'Content-Length': '0' },
  });
}

/** Пора ли слать: есть время повторения, которое уже наступило и о котором ещё не напоминали. */
export function dueTime(rec, now) {
  const past = (rec.times || []).filter((t) => t <= now && t > (rec.sent || 0));
  return past.length ? Math.max(...past) : null;
}

async function handle(req, env) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ ok: true, service: 'melkin-push' });
  const path = new URL(req.url).pathname;
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  const id = String(body.id || '');
  if (!/^[a-z0-9-]{16,64}$/i.test(id)) return json({ error: 'bad id' }, 400);
  const times = Array.isArray(body.times) ? body.times.filter((t) => Number.isFinite(t)).slice(0, 60) : [];
  if (path === '/subscribe') {
    if (!body.subscription?.endpoint) return json({ error: 'no subscription' }, 400);
    await env.SUBS.put(id, JSON.stringify({ sub: body.subscription, times, sent: 0 }));
    return json({ ok: true });
  }
  const rec = JSON.parse((await env.SUBS.get(id)) || 'null');
  if (!rec) return json({ error: 'not subscribed' }, 404);
  if (path === '/schedule') {
    await env.SUBS.put(id, JSON.stringify({ ...rec, times }));
    return json({ ok: true });
  }
  if (path === '/unsubscribe') {
    await env.SUBS.delete(id);
    return json({ ok: true });
  }
  if (path === '/test') {
    const r = await sendPush(rec.sub, env);
    return json({ ok: r.ok, status: r.status }, r.ok ? 200 : 502);
  }
  return json({ error: 'unknown' }, 404);
}

async function tick(env) {
  const now = Date.now();
  let cursor;
  do {
    const list = await env.SUBS.list({ cursor });
    for (const k of list.keys) {
      const rec = JSON.parse((await env.SUBS.get(k.name)) || 'null');
      if (!rec || !dueTime(rec, now)) continue;
      const r = await sendPush(rec.sub, env);
      // подписка больше не действует (приложение удалено или уведомления выключены)
      if (r.status === 404 || r.status === 410) await env.SUBS.delete(k.name);
      else await env.SUBS.put(k.name, JSON.stringify({ ...rec, sent: now }));
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
}

export default {
  fetch: (req, env) => handle(req, env),
  scheduled: (_event, env, ctx) => ctx.waitUntil(tick(env)),
};
