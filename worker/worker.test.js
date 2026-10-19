import { describe, expect, it } from 'vitest';
import { b64urlToBytes, bytesToB64url, dueTime, vapidJwt } from './worker.js';

describe('сервер напоминаний', () => {
  it('JWT VAPID подписан ключом и проверяется открытым ключом', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const pub = bytesToB64url(await crypto.subtle.exportKey('raw', pair.publicKey));
    const priv = (await crypto.subtle.exportKey('jwk', pair.privateKey)).d;
    const jwt = await vapidJwt('https://web.push.apple.com/abc', { VAPID_PUBLIC: pub, VAPID_PRIVATE: priv, VAPID_SUBJECT: 'mailto:a@b.c' }, 1_000_000_000_000);
    const [h, b, s] = jwt.split('.');
    expect(JSON.parse(new TextDecoder().decode(b64urlToBytes(b)))).toMatchObject({ aud: 'https://web.push.apple.com', sub: 'mailto:a@b.c', exp: 1_000_000_000 + 43200 });
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, b64urlToBytes(s), new TextEncoder().encode(`${h}.${b}`));
    expect(ok).toBe(true);
  });

  it('напоминает один раз о каждом наступившем сроке', () => {
    expect(dueTime({ times: [100, 200, 900], sent: 0 }, 500)).toBe(200);
    expect(dueTime({ times: [100, 200, 900], sent: 200 }, 500)).toBeNull();
    expect(dueTime({ times: [100, 200, 900], sent: 200 }, 1000)).toBe(900);
  });
});
