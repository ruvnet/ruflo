/**
 * Browser and token checks on the shared MCP transports
 *
 * A loopback bind does not keep web pages out: browsers do not apply CORS to
 * WebSocket upgrades, and DNS rebinding reaches 127.0.0.1 under the page's own
 * hostname. A server without a token refuses both; a server with a token
 * checks it on the upgrade, and none configured means none is valid.
 *
 * @module v3/shared/__tests__/mcp/transport-browser-guard.test
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as net from 'node:net';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { WebSocket } from 'ws';

import { HttpTransport } from '../../src/mcp/transport/http.js';
import { WebSocketTransport } from '../../src/mcp/transport/websocket.js';
import { bearerCredentials, handshakeAuthorized, tokenAllowed } from '../../src/mcp/transport/guard.js';
import { createMCPServer } from '../../src/mcp/server.js';
import type { ITransport } from '../../src/mcp/types.js';

const TOKEN = 'correct-horse-battery-staple-42';
const RPC = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'terminal_execute' } };
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const tokenAuth = { enabled: true, method: 'token' as const, tokens: [TOKEN] };

let transport: ITransport | undefined;
let handled = 0;
let port = 0;

async function boot(t: ITransport): Promise<void> {
  handled = 0;
  t.onRequest(async (r) => {
    handled++;
    return { jsonrpc: '2.0', id: r.id, result: { ok: true } };
  });
  await t.start();
  transport = t;
  port = ((t as unknown as { server: Server }).server.address() as AddressInfo).port;
}

const startHttp = (extra: Record<string, unknown> = {}) =>
  boot(new HttpTransport(logger as never, { host: '127.0.0.1', port: 0, ...extra }));
const startWs = (extra: Record<string, unknown> = {}) =>
  boot(new WebSocketTransport(logger as never, { host: '127.0.0.1', port: 0, ...extra }));

/**
 * Open a WebSocket, send one request. 'rejected' means the server answered the
 * upgrade with 401/403; any other failure (refused connection, crash) is 'error'.
 */
function wsCall(headers: Record<string, string> = {}, query = ''): Promise<'rejected' | 'answered' | 'closed' | 'error'> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`, { headers });
    let settled = false;
    const done = (v: 'rejected' | 'answered' | 'closed' | 'error') => {
      if (settled) return;
      settled = true;
      ws.terminate();
      resolve(v);
    };
    ws.on('unexpected-response', (_req, res) => done(res.statusCode === 401 || res.statusCode === 403 ? 'rejected' : 'error'));
    ws.on('error', () => done('error'));
    ws.on('open', () => ws.send(JSON.stringify(RPC)));
    ws.on('message', (data) => done(JSON.parse(data.toString()).result?.ok ? 'answered' : 'closed'));
    ws.on('close', () => done('closed'));
    setTimeout(() => done('closed'), 1500);
  });
}

/** POST one request with a chosen Host header; returns the status code. */
function rawPost(host: string, extraHeaders = '', body = JSON.stringify(RPC), contentType = 'application/json'): Promise<number> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () =>
      sock.write(
        `POST /rpc HTTP/1.1\r\nHost: ${host}\r\nContent-Type: ${contentType}\r\n${extraHeaders}` +
          `Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
      ),
    );
    let buf = '';
    sock.on('data', (d) => (buf += d.toString('latin1')));
    sock.on('error', reject);
    sock.on('close', () => resolve(Number(/^HTTP\/1\.1 (\d+)/.exec(buf)?.[1] ?? 0)));
    setTimeout(() => sock.destroy(), 1500);
  });
}

afterEach(async () => {
  await transport?.stop();
  transport = undefined;
});

describe('token helpers', () => {
  it('accepts only a configured token, and none when none is configured', () => {
    expect(tokenAllowed(TOKEN, [TOKEN])).toBe(true);
    expect(tokenAllowed('wrong', [TOKEN])).toBe(false);
    expect(tokenAllowed(TOKEN, [])).toBe(false);
    expect(tokenAllowed(TOKEN, undefined)).toBe(false);
    expect(tokenAllowed(undefined, [TOKEN])).toBe(false);
  });

  it('treats auth as on unless enabled is false, and accepts only tokens', () => {
    expect(bearerCredentials(undefined)).toBeUndefined();
    expect(bearerCredentials({ enabled: false, tokens: [TOKEN] })).toBeUndefined();
    expect(bearerCredentials({ tokens: [TOKEN] })).toEqual([TOKEN]);
    expect(bearerCredentials({ enabled: true, apiKeys: ['k-123'] } as never)).toEqual([]);
  });

  it('reads the token from the Authorization header or the token query parameter', () => {
    expect(handshakeAuthorized({ headers: { authorization: `Bearer ${TOKEN}` }, url: '/ws' }, [TOKEN])).toBe(true);
    expect(handshakeAuthorized({ headers: {}, url: `/ws?token=${TOKEN}` }, [TOKEN])).toBe(true);
    expect(handshakeAuthorized({ headers: {}, url: '/ws' }, [TOKEN])).toBe(false);
  });
});

describe.each([
  ['http transport /ws', startHttp],
  ['websocket transport', startWs],
])('%s without a token', (_name, start) => {
  it('refuses a foreign Origin before any request runs', async () => {
    await start();
    expect(await wsCall({ Origin: 'https://evil.example' })).toBe('rejected');
    expect(handled).toBe(0);
  });

  it('refuses a rebinding Host before any request runs', async () => {
    await start();
    for (const host of ['evil.example', '127.0.0.1.evil.example', 'localhost.evil.example']) {
      expect(await wsCall({ Host: `${host}:${port}` })).toBe('rejected');
    }
    expect(handled).toBe(0);
  });

  it("does not let '*' admit a browser Origin", async () => {
    await start({ corsOrigins: ['*'], allowedOrigins: ['*'] });
    expect(await wsCall({ Origin: 'https://evil.example' })).toBe('rejected');
    expect(handled).toBe(0);
  });

  it('still serves a non-browser client on loopback', async () => {
    await start();
    expect(await wsCall()).toBe('answered');
    expect(handled).toBe(1);
  });

  it('serves a browser Origin listed by name', async () => {
    const origins = ['https://app.example'];
    // Each transport reads only its own option: corsOrigins (http), allowedOrigins (websocket).
    await start(start === startHttp ? { corsOrigins: origins } : { allowedOrigins: origins });
    expect(await wsCall({ Origin: 'https://app.example' })).toBe('answered');
  });

  it('refuses a non-loopback bind unless allowUnauthenticated is set', async () => {
    await expect(start({ host: '0.0.0.0' })).rejects.toThrow(/without authentication/);
  });
});

describe.each([
  ['http transport /ws', startHttp],
  ['websocket transport', startWs],
])('%s with a token', (_name, start) => {
  it('refuses an upgrade without the token', async () => {
    await start({ auth: tokenAuth });
    expect(await wsCall()).toBe('rejected');
    expect(handled).toBe(0);
  });

  it('refuses an upgrade with a wrong token', async () => {
    await start({ auth: tokenAuth });
    expect(await wsCall({ Authorization: 'Bearer wrong-token-0000000000' })).toBe('rejected');
    expect(handled).toBe(0);
  });

  it('serves an upgrade with the token', async () => {
    await start({ auth: tokenAuth });
    expect(await wsCall({ Authorization: `Bearer ${TOKEN}` })).toBe('answered');
    expect(handled).toBe(1);
  });
});

describe('http transport POST', () => {
  it('refuses a rebinding Host without a token', async () => {
    await startHttp();
    expect(await rawPost(`evil.example:${port}`)).toBe(403);
    expect(handled).toBe(0);
  });

  it('serves a loopback Host without a token', async () => {
    await startHttp();
    expect(await rawPost(`127.0.0.1:${port}`)).toBe(200);
    expect(handled).toBe(1);
  });

  it('refuses to start when auth is enabled with no tokens configured (any bearer used to pass)', async () => {
    await expect(startHttp({ auth: { enabled: true, method: 'token', tokens: [] } })).rejects.toThrow(/no tokens are configured/);
    expect(handled).toBe(0);
  });

  it('serves the configured token', async () => {
    await startHttp({ auth: tokenAuth });
    expect(await rawPost(`127.0.0.1:${port}`, `Authorization: Bearer ${TOKEN}\r\n`)).toBe(200);
    expect(handled).toBe(1);
  });
});

describe('http transport: browser POST without a token', () => {
  it('refuses a cross-origin text/plain POST (no CORS preflight) before it runs', async () => {
    await startHttp();
    const status = await rawPost(`127.0.0.1:${port}`, 'Origin: https://evil.example\r\n', JSON.stringify(RPC), 'text/plain');
    expect(status).toBe(403);
    expect(handled).toBe(0);
  });

  it("refuses a foreign Origin POST even with corsOrigins ['*']", async () => {
    await startHttp({ corsOrigins: ['*'] });
    expect(await rawPost(`127.0.0.1:${port}`, 'Origin: https://evil.example\r\n')).toBe(403);
    expect(handled).toBe(0);
  });

  it('refuses Origin null', async () => {
    await startHttp();
    expect(await rawPost(`127.0.0.1:${port}`, 'Origin: null\r\n')).toBe(403);
    expect(handled).toBe(0);
  });
});

describe('auth configuration', () => {
  it('an auth object without enabled still requires the token on /ws and POST', async () => {
    await startWs({ auth: { method: 'token', tokens: [TOKEN] } });
    expect(await wsCall()).toBe('rejected');
    await transport!.stop();
    await startHttp({ auth: { method: 'token', tokens: [TOKEN] } });
    expect(await wsCall()).toBe('rejected');
    expect(await rawPost(`127.0.0.1:${port}`)).toBe(401);
    expect(handled).toBe(0);
  });

  it('refuses to start with only API keys (bearer tokens are the only method checked)', async () => {
    await expect(startHttp({ auth: { enabled: true, method: 'api-key', apiKeys: ['api-key-0123456789'] } })).rejects.toThrow(/no tokens are configured/);
  });

  it.each([
    ['http', startHttp],
    ['websocket', startWs],
  ])('%s refuses to start with auth on but no tokens or API keys', async (_n, start) => {
    await expect(start({ auth: { enabled: true, method: 'jwt', jwtSecret: 's' } })).rejects.toThrow(/no tokens are configured/);
  });

  it.each([
    ['[undefined]', [undefined]],
    ["['']", ['']],
  ])('refuses to start when the only configured token is %s (e.g. an unset env var)', async (_n, tokens) => {
    await expect(startHttp({ auth: { enabled: true, method: 'token', tokens } })).rejects.toThrow(/no tokens are configured/);
    await expect(startWs({ auth: { enabled: true, method: 'token', tokens } })).rejects.toThrow(/no tokens are configured/);
  });

  it('an unset entry beside a real token neither crashes nor blocks the real token', async () => {
    await startWs({ auth: { enabled: true, method: 'token', tokens: [TOKEN, undefined] } });
    expect(await wsCall({ Authorization: 'Bearer wrong-token-0000000000' })).toBe('rejected');
    expect(await wsCall({ Authorization: `Bearer ${TOKEN}` })).toBe('answered');
  });

  it('checks the token before reading the body', async () => {
    await startHttp({ auth: tokenAuth });
    expect(await rawPost(`127.0.0.1:${port}`, '', '{not json')).toBe(401);
  });

  it('serves /health without a token but reveals only liveness', async () => {
    await startHttp({ auth: tokenAuth });
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
    expect((await fetch(`http://127.0.0.1:${port}/info`)).status).toBe(401);
  });

  it('rate-limits failed requests, which bounds token guessing', async () => {
    await startHttp({ auth: tokenAuth });
    const statuses: number[] = [];
    for (let i = 0; i < 121; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/info`, { headers: { Authorization: `Bearer guess-${i}` } });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 120).every((s) => s === 401)).toBe(true);
    expect(statuses[120]).toBe(429);
  });

  it('does not count successful requests toward the limit', async () => {
    await startHttp({ auth: tokenAuth });
    for (let i = 0; i < 130; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/info`, { headers: { Authorization: `Bearer ${TOKEN}` } });
      expect(res.status).toBe(200);
    }
  });

  it('a wrong token on POST is refused', async () => {
    await startHttp({ auth: tokenAuth });
    expect(await rawPost(`127.0.0.1:${port}`, 'Authorization: Bearer wrong-token-0000000000\r\n')).toBe(401);
    expect(handled).toBe(0);
  });

  it('serves a token passed as a query parameter on the http transport /ws', async () => {
    await startHttp({ auth: tokenAuth });
    expect(await wsCall({}, `?token=${TOKEN}`)).toBe('answered');
  });

  it('allowUnauthenticated lets a token-less server bind beyond loopback', async () => {
    await startWs({ host: '0.0.0.0', allowUnauthenticated: true });
    expect(await wsCall()).toBe('answered');
  });
});

describe('MCPServer wires the guard into its transport', () => {
  it('passes corsOrigins as the WebSocket origin list', async () => {
    const server = createMCPServer(
      { transport: 'websocket', host: '127.0.0.1', port: 0, corsOrigins: ['https://app.example'] },
      logger as never,
    );
    await server.start();
    try {
      const inner = (server as unknown as { transport: { server: Server } }).transport;
      port = (inner.server.address() as AddressInfo).port;
      expect(await wsCall({ Origin: 'https://evil.example' })).toBe('rejected');
      expect(await wsCall({ Origin: 'https://app.example' })).not.toBe('rejected');
    } finally {
      await server.stop();
    }
  });

  it('refuses a token-less non-loopback bind and honours allowUnauthenticated', async () => {
    const refused = createMCPServer({ transport: 'websocket', host: '0.0.0.0', port: 0 }, logger as never);
    await expect(refused.start()).rejects.toThrow();
    const allowed = createMCPServer(
      { transport: 'websocket', host: '0.0.0.0', port: 0, allowUnauthenticated: true },
      logger as never,
    );
    await allowed.start();
    await allowed.stop();
  });
});
