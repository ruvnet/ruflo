/**
 * `auth.tokens` is often built from the environment (`[process.env.X]`). An
 * unset entry must not match anything, and must not throw inside verifyClient,
 * where any client sending a Bearer value would reach it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { WebSocket } from 'ws';
import { WebSocketTransport } from '../src/transport/websocket.js';
import type { ILogger } from '../src/types.js';

const TOKEN = 'correct-horse-battery-staple-42';
const logger: ILogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
let transport: WebSocketTransport | undefined;
afterEach(async () => { await transport?.stop(); transport = undefined; });

async function start(tokens: unknown[]): Promise<number> {
  transport = new WebSocketTransport(logger, {
    host: '127.0.0.1',
    port: 0,
    auth: { enabled: true, method: 'token', tokens: tokens as string[] },
  });
  transport.onRequest(async (r) => ({ jsonrpc: '2.0', id: r.id, result: { ok: true } }));
  await transport.start();
  return ((transport as unknown as { server: Server }).server.address() as AddressInfo).port;
}

/** 'rejected' = the upgrade got 401/403; 'answered' = a request was served. */
function call(port: number, bearer: string): Promise<string> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Authorization: `Bearer ${bearer}` } });
    const done = (v: string) => { ws.terminate(); resolve(v); };
    ws.on('unexpected-response', (_q, res) => done(res.statusCode === 401 || res.statusCode === 403 ? 'rejected' : `status ${res.statusCode}`));
    ws.on('error', (e) => done(`error ${e.message}`));
    ws.on('open', () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })));
    ws.on('message', () => done('answered'));
    setTimeout(() => done('timeout'), 1500);
  });
}

describe('WebSocketTransport with an unset token entry', () => {
  it('refuses a wrong token without throwing, and still serves the real one', async () => {
    const port = await start([TOKEN, undefined]);
    expect(await call(port, 'wrong-token-0000000000')).toBe('rejected');
    expect(await call(port, TOKEN)).toBe('answered');
  });

  it('with only unset or empty entries, refuses every token', async () => {
    const port = await start([undefined, '']);
    expect(await call(port, 'anything-at-all-0000')).toBe('rejected');
  });
});
