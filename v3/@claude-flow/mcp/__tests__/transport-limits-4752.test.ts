import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { WebSocket } from 'ws';
import { HttpTransport } from '../src/transport/http.js';
import type { ILogger } from '../src/types.js';

const TOKEN = 'a-long-enough-token-4752';
const logger: ILogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
let stop: (() => Promise<void>) | undefined;
afterEach(async () => { await stop?.(); stop = undefined; });

async function open(extra: Record<string, unknown> = {}): Promise<number> {
  const t = new HttpTransport(logger, { host: '127.0.0.1', port: 0, ...extra } as never);
  t.onRequest(async (r) => ({ jsonrpc: '2.0', id: r.id, result: { ok: true } }));
  await t.start();
  stop = () => t.stop();
  return ((t as unknown as { server: Server }).server.address() as AddressInfo).port;
}

/** 'open' when the upgrade is accepted, else the HTTP status it was refused with. */
const upgrade = (url: string, headers: Record<string, string> = {}): Promise<'open' | number> =>
  new Promise((resolve) => {
    const ws = new WebSocket(url, { headers });
    ws.on('open', () => { ws.close(); resolve('open'); });
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    ws.on('error', () => resolve(0));
  });

describe('/ws on the HTTP transport (#4752)', () => {
  const auth = { auth: { enabled: true, method: 'token', tokens: [TOKEN] } };

  it('refuses the upgrade itself when the token is missing or wrong', async () => {
    const port = await open(auth);
    expect(await upgrade(`ws://127.0.0.1:${port}/ws`)).toBe(401);
    expect(await upgrade(`ws://127.0.0.1:${port}/ws`, { authorization: 'Bearer wrong-wrong-wrong' })).toBe(401);
    expect(await upgrade(`ws://127.0.0.1:${port}/ws`, { authorization: `Bearer ${TOKEN}` })).toBe('open');
  });

  it('does not take the token from the query string, like the HTTP routes', async () => {
    const port = await open(auth);
    expect(await upgrade(`ws://127.0.0.1:${port}/ws?token=${TOKEN}`)).toBe(401);
  });

  it('skips an unset token entry instead of throwing during the upgrade', async () => {
    const port = await open({ auth: { enabled: true, method: 'token', tokens: [undefined, TOKEN] } });
    expect(await upgrade(`ws://127.0.0.1:${port}/ws`, { authorization: `Bearer ${TOKEN}` })).toBe('open');
  });

  it('closes a connection that sends a frame over maxMessageSize', async () => {
    const port = await open({ maxMessageSize: 1024 });
    const code = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      ws.on('open', () => ws.send('x'.repeat(4096)));
      ws.on('close', (c) => resolve(c));
      ws.on('error', () => undefined);
    });
    expect(code).toBe(1009);
  });
});

describe('legacy SSE streams on GET /mcp (#4752)', () => {
  it('refuses new streams past maxSseClients and accepts again once one closes', async () => {
    const port = await open({ maxSseClients: 2 });
    const url = `http://127.0.0.1:${port}/mcp`;
    const first = new AbortController();
    const second = new AbortController();
    expect((await fetch(url, { signal: first.signal })).status).toBe(200);
    expect((await fetch(url, { signal: second.signal })).status).toBe(200);
    const refused = await fetch(url);
    expect(refused.status).toBe(503);
    expect(refused.headers.get('retry-after')).toBe('5');

    first.abort();
    await new Promise((r) => setTimeout(r, 100));
    const third = new AbortController();
    expect((await fetch(url, { signal: third.signal })).status).toBe(200);
    second.abort();
    third.abort();
  });
});
