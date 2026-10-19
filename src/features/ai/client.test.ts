import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { AI_KEYS_META, db, saveSettings, setMeta } from '../../db/db';
import { AiError, ask, askJson, claudeBody, classifyHttp, extractJson, geminiBody, parseClaude, parseGemini, transport } from './client';
import { fill, prompt } from './prompts';

const req = { system: 'sys', parts: [{ text: 'привет' }, { image: { data: 'AAA', mime: 'image/png' } }] };

describe('тела запросов и ответы', () => {
  it('Gemini: системная инструкция, картинка inline, JSON-режим', () => {
    const b = geminiBody({ ...req, json: true });
    expect(b.systemInstruction.parts[0].text).toBe('sys');
    expect(b.contents[0].parts[1]).toEqual({ inline_data: { mime_type: 'image/png', data: 'AAA' } });
    expect(b.generationConfig.responseMimeType).toBe('application/json');
  });

  it('Claude: модель, картинка base64, просьба вернуть только JSON', () => {
    const b = claudeBody('claude-opus-5-5', { ...req, json: true });
    expect(b.model).toBe('claude-opus-5-5');
    expect(b.messages[0].content[1]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } });
    expect(b.system).toContain('только JSON');
  });

  it('разбор ответов и блокировок', () => {
    expect(parseGemini({ candidates: [{ content: { parts: [{ text: 'мысль', thought: true }, { text: 'ответ' }] } }] })).toBe('ответ');
    expect(() => parseGemini({ promptFeedback: { blockReason: 'SAFETY' } })).toThrow(AiError);
    expect(parseClaude({ content: [{ type: 'text', text: 'да' }] })).toBe('да');
    expect(() => parseClaude({ content: [] })).toThrow(/неожиданном/);
  });

  it('понятные ошибки: лимит, регион (VPN), ключ, сервер', () => {
    expect(classifyHttp('gemini', 429, '{"error":{"status":"RESOURCE_EXHAUSTED"}}').kind).toBe('quota');
    expect(classifyHttp('gemini', 400, 'User location is not supported for the API use.').kind).toBe('blocked');
    expect(classifyHttp('gemini', 400, 'API key not valid. Please pass a valid API key.').kind).toBe('auth');
    expect(classifyHttp('claude', 401, 'invalid x-api-key').kind).toBe('auth');
    expect(classifyHttp('claude', 529, 'overloaded').kind).toBe('server');
    expect(classifyHttp('claude', 400, 'Your credit balance is too low').message).toMatch(/лимит/);
  });

  it('JSON из ответа с обёрткой и мусором', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Вот: {"a":[1,2]} готово')).toEqual({ a: [1, 2] });
    expect(() => extractJson('нет json')).toThrow(AiError);
  });
});

describe('промпты', () => {
  it('подставляет переменные и общие правила, не трогая клозы', () => {
    expect(fill('{{a}} и {{46}}', { a: 'x' })).toBe('x и {{46}}');
    const p = prompt('cards', { subject: 'Биология' });
    expect(p).toContain('Предмет: Биология');
    expect(p).toContain('{{46}}');
    expect(prompt('summary', { mode: 'коротко' })).toContain('=={green}');
  });
});

describe('отправка', () => {
  beforeEach(async () => {
    await db.aiCache.clear();
    await setMeta(AI_KEYS_META, { gemini: 'k-test' });
    await saveSettings({ aiProvider: 'gemini' });
  });

  it('без ключа — понятная ошибка, без запроса', async () => {
    await setMeta(AI_KEYS_META, {});
    await expect(ask(req)).rejects.toMatchObject({ kind: 'nokey' });
  });

  it('ключ в заголовке, ответ кэшируется', async () => {
    let calls = 0;
    let headers: Record<string, string> = {};
    let url = '';
    transport.fetch = async (u, init) => {
      calls++;
      url = u;
      headers = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ответ' }] } }] }), { status: 200 });
    };
    expect(await ask(req)).toBe('ответ');
    expect(await ask(req)).toBe('ответ');
    expect(calls).toBe(1);
    expect(headers['x-goog-api-key']).toBe('k-test');
    expect(url).not.toContain('k-test');
  });

  it('сеть недоступна (блокировка) — совет включить VPN', async () => {
    transport.fetch = async () => {
      throw new TypeError('Load failed');
    };
    await expect(ask({ ...req, cache: false })).rejects.toMatchObject({ kind: 'network', message: expect.stringMatching(/VPN/) });
  });

  it('JSON: испорченный ответ — повтор без кэша', async () => {
    const answers = ['не json', '{"ok":true}'];
    transport.fetch = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: answers.shift() }] } }] }), { status: 200 });
    expect(await askJson<{ ok: boolean }>(req, (v) => v.ok)).toEqual({ ok: true });
  });
});
