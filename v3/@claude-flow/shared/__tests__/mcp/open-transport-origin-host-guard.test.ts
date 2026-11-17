import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { request, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { HttpTransport } from '../../src/mcp/transport/http.js';
import { WebSocketTransport } from '../../src/mcp/transport/websocket.js';
import { assertSafeBind, hostHeaderAllowed, originAllowed } from '../../src/mcp/transport/guard.js';
import type { ILogger } from '../../src/mcp/types.js';

const logger: ILogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const RPC = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'terminal_execute' } };
let stop: (() => Promise<void>) | undefined;
afterEach(async () => { await stop?.(); stop = undefined; });

async function openHttp(extra: Record<string, unknown> = {}): Promise<{ port: number; handled: () => number }> {
  let handled = 0;
  const t = new HttpTransport(logger, { host: '127.0.0.1', port: 0, corsEnabled: true, corsOrigins: ['*'], ...extra } as never);
  t.onRequest(async (r) => { handled++; return { jsonrpc: '2.0', id: r.id, result: { ok: true } }; });
  await t.start();
  stop = () => t.stop();
  return { port: ((t as unknown as { server: Server }).server.address() as AddressInfo).port, handled: () => handled };
}

const rpc = (port: number, headers: Record<string, string> = {}) =>
  fetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(RPC) });

/** Resolves true when the upgrade is accepted, false when it is refused. */
const upgrades = (url: string, headers: Record<string, string>): Promise<boolean> =>
  new Promise((resolve) => {
    const ws = new WebSocket(url, { headers });
    ws.on('open', () => { ws.close(); resolve(true); });
    ws.on('unexpected-response', () => resolve(false));
    ws.on('error', () => resolve(false));
  });

describe('a loopback MCP server with no token', () => {
  it('still serves a client that sends no Origin, as every CLI and MCP client does', async () => {
    const s = await openHttp();
    expect((await rpc(s.port)).status).toBe(200);
    expect(s.handled()).toBe(1);
  });

  it('refuses a web page, even when CORS is set to "*"', async () => {
    const s = await openHttp();
    const res = await rpc(s.port, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(s.handled()).toBe(0);
  });

  it('refuses a rebound hostname', async () => {
    const s = await openHttp();
    // fetch() will not let a caller set Host, so use a raw request.
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ port: s.port, host: '127.0.0.1', method: 'POST', path: '/rpc', headers: { host: 'evil.example', 'content-type': 'application/json' } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on('error', reject);
      req.end(JSON.stringify(RPC));
    });
    expect(status).toBe(403);
    expect(s.handled()).toBe(0);
  });

  it('lets an origin the operator listed by name through', async () => {
    const s = await openHttp({ corsOrigins: ['https://app.example'] });
    expect((await rpc(s.port, { origin: 'https://app.example' })).status).toBe(200);
  });

  it('refuses a cross-origin WebSocket upgrade on the HTTP transport, and accepts a plain one', async () => {
    const s = await openHttp();
    expect(await upgrades(`ws://127.0.0.1:${s.port}/ws`, { origin: 'https://evil.example' })).toBe(false);
    expect(await upgrades(`ws://127.0.0.1:${s.port}/ws`, { host: 'evil.example' })).toBe(false);
    expect(await upgrades(`ws://127.0.0.1:${s.port}/ws`, {})).toBe(true);
  });

  it('refuses a cross-origin upgrade on the standalone WebSocket transport', async () => {
    const t = new WebSocketTransport(logger, { host: '127.0.0.1', port: 0 });
    await t.start();
    stop = () => t.stop();
    const port = ((t as unknown as { server: Server }).server.address() as AddressInfo).port;
    expect(await upgrades(`ws://127.0.0.1:${port}/ws`, { origin: 'https://evil.example' })).toBe(false);
    expect(await upgrades(`ws://127.0.0.1:${port}/ws`, {})).toBe(true);
  });
});

describe('listening beyond loopback', () => {
  it('is refused by both transports without a token unless the operator opts in', async () => {
    await expect(new HttpTransport(logger, { host: '0.0.0.0', port: 0 } as never).start()).rejects.toThrow(/non-loopback/);
    await expect(new WebSocketTransport(logger, { host: '0.0.0.0', port: 0 }).start()).rejects.toThrow(/non-loopback/);
    expect(() => assertSafeBind('0.0.0.0', true, undefined)).not.toThrow();
    expect(() => assertSafeBind('0.0.0.0', false, true)).not.toThrow();
    expect(() => assertSafeBind('::1', false, undefined)).not.toThrow();
  });

  it('judges Host and Origin by exact name', () => {
    expect(hostHeaderAllowed('localhost:3000', '127.0.0.1')).toBe(true);
    expect(hostHeaderAllowed('[::1]:3000', '127.0.0.1')).toBe(true);
    expect(hostHeaderAllowed('localhost.evil.example', '127.0.0.1')).toBe(false);
    expect(hostHeaderAllowed(undefined, '127.0.0.1')).toBe(false);
    expect(originAllowed(undefined, undefined)).toBe(true);
    expect(originAllowed('https://a.example', ['*'])).toBe(false);
    expect(originAllowed('https://a.example', ['https://a.example'])).toBe(true);
  });
});
