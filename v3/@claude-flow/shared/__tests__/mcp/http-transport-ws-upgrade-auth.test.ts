import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { WebSocket } from 'ws';
import { HttpTransport } from '../../src/mcp/transport/http.js';
import type { ILogger } from '../../src/mcp/types.js';

const logger: ILogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const RPC = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
let stop: (() => Promise<void>) | undefined;
afterEach(async () => { await stop?.(); stop = undefined; });

async function open(tokens: unknown[]): Promise<{ port: number; handled: () => number }> {
  let handled = 0;
  const t = new HttpTransport(logger, { host: '127.0.0.1', port: 0, auth: { enabled: true, tokens } } as never);
  t.onRequest(async (r) => { handled++; return { jsonrpc: '2.0', id: r.id, result: { ok: true } }; });
  await t.start();
  stop = () => t.stop();
  return { port: ((t as unknown as { server: Server }).server.address() as AddressInfo).port, handled: () => handled };
}

/** Resolves true when the upgrade is accepted, false when it is refused. */
const upgrades = (url: string, headers: Record<string, string> = {}): Promise<boolean> =>
  new Promise((resolve) => {
    const ws = new WebSocket(url, { headers });
    ws.on('open', () => { ws.close(); resolve(true); });
    ws.on('unexpected-response', () => resolve(false));
    ws.on('error', () => resolve(false));
  });

const rpc = (port: number, headers: Record<string, string> = {}) =>
  fetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(RPC) });

describe('shared HttpTransport with token auth', () => {
  it('refuses a /ws upgrade with no token or a wrong token', async () => {
    const s = await open(['right-token']);
    expect(await upgrades(`ws://127.0.0.1:${s.port}/ws`)).toBe(false);
    expect(await upgrades(`ws://127.0.0.1:${s.port}/ws`, { authorization: 'Bearer wrong' })).toBe(false);
    expect(await upgrades(`ws://127.0.0.1:${s.port}/ws?token=wrong`)).toBe(false);
  });

  it('accepts a /ws upgrade with the right token via header or query', async () => {
    const s = await open(['right-token']);
    expect(await upgrades(`ws://127.0.0.1:${s.port}/ws`, { authorization: 'Bearer right-token' })).toBe(true);
    expect(await upgrades(`ws://127.0.0.1:${s.port}/ws?token=right-token`)).toBe(true);
  });

  it('fails closed when no usable token is configured', async () => {
    const s = await open([undefined, '']);
    expect((await rpc(s.port, { authorization: 'Bearer anything' })).status).toBe(401);
    expect(await upgrades(`ws://127.0.0.1:${s.port}/ws`, { authorization: 'Bearer anything' })).toBe(false);
    expect(s.handled()).toBe(0);
  });

  it('still serves HTTP with the right token and refuses a wrong one', async () => {
    const s = await open([undefined, 'right-token']);
    expect((await rpc(s.port, { authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await rpc(s.port, { authorization: 'Bearer right-token' })).status).toBe(200);
    expect(s.handled()).toBe(1);
  });
});
