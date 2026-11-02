/**
 * The HTTP transport's `/ws` endpoint must authenticate the upgrade itself
 * (like WebSocketTransport does) and must never throw on a request it refuses:
 * an exception inside the ws 'connection' listener is uncaught and would end
 * the whole server process.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as net from 'node:net';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { WebSocket } from 'ws';
import { HttpTransport } from '../src/transport/http.js';
import type { ILogger } from '../src/types.js';

const TOKEN = 'correct-horse-battery-staple-42';
const logger: ILogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
let transport: HttpTransport | undefined;
let port: number;
const uncaught: unknown[] = [];
const onUncaught = (e: unknown) => { uncaught.push(e); };

beforeEach(() => {
  uncaught.length = 0;
  process.on('uncaughtException', onUncaught);
});
afterEach(async () => {
  process.off('uncaughtException', onUncaught);
  await transport?.stop();
  transport = undefined;
});

async function start(tokens: unknown[]): Promise<void> {
  transport = new HttpTransport(logger, {
    host: '127.0.0.1',
    port: 0,
    auth: { enabled: true, method: 'token', tokens: tokens as string[] },
  } as never);
  transport.onRequest(async (r) => ({ jsonrpc: '2.0', id: r.id, result: { ok: true } }));
  await transport.start();
  port = ((transport as unknown as { server: Server }).server.address() as AddressInfo).port;
}

/** 'rejected' = the upgrade got 401/403; 'answered' = a request was served. */
function call(opts: { bearer?: string; query?: string }): Promise<string> {
  return new Promise((resolve) => {
    const q = opts.query !== undefined ? `?token=${encodeURIComponent(opts.query)}` : '';
    const headers = opts.bearer !== undefined ? { Authorization: `Bearer ${opts.bearer}` } : {};
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${q}`, { headers });
    const done = (v: string) => { ws.terminate(); resolve(v); };
    ws.on('unexpected-response', (_q, res) =>
      done(res.statusCode === 401 || res.statusCode === 403 ? 'rejected' : `status ${res.statusCode}`));
    ws.on('error', (e) => done(`error ${e.message}`));
    ws.on('close', (code) => done(`closed ${code}`));
    ws.on('open', () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })));
    ws.on('message', () => done('answered'));
    setTimeout(() => done('timeout'), 1500);
  });
}

/** Raw upgrade so the Host header can be something a URL parser refuses. */
function rawUpgrade(host: string): Promise<string> {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1', () =>
      sock.write(
        `GET /ws HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
      ));
    let buf = '';
    sock.on('data', (d) => (buf += d.toString('latin1')));
    sock.on('error', () => undefined);
    sock.on('close', () => resolve(buf.split('\r\n')[0] ?? ''));
    setTimeout(() => sock.destroy(), 500);
  });
}

const healthy = async () => (await fetch(`http://127.0.0.1:${port}/health`)).status;

describe('HttpTransport /ws with token auth', () => {
  it('refuses an upgrade with no token at the handshake', async () => {
    await start([TOKEN]);
    expect(await call({})).toBe('rejected');
  });

  it('refuses a wrong token at the handshake, from header or query', async () => {
    await start([TOKEN]);
    expect(await call({ bearer: 'wrong-token-0000000000' })).toBe('rejected');
    expect(await call({ query: 'wrong-token-0000000000' })).toBe('rejected');
  });

  it('serves the right token from the Authorization header or ?token=', async () => {
    await start([TOKEN]);
    expect(await call({ bearer: TOKEN })).toBe('answered');
    expect(await call({ query: TOKEN })).toBe('answered');
  });

  it('a Host header that is not a valid URL authority never throws and the server keeps serving', async () => {
    await start([TOKEN]);
    for (const host of ['a b', 'a:b', '[', '']) {
      const status = await rawUpgrade(host);
      expect(status).not.toMatch(/ 101 /);
    }
    expect(uncaught).toEqual([]);
    expect(await healthy()).toBe(200);
    expect(await call({ bearer: TOKEN })).toBe('answered');
  });

  it('an unset token entry matches nothing and does not throw', async () => {
    await start([TOKEN, undefined, '']);
    expect(await call({ bearer: 'wrong-token-0000000000' })).toBe('rejected');
    expect(uncaught).toEqual([]);
    expect(await call({ bearer: TOKEN })).toBe('answered');
  });
});
