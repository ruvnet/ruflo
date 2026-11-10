/**
 * http_fetch SSRF via DNS: the allowlist checked only the URL's hostname text, and fetch()
 * then resolved the name on its own, so a name pointing at (or rebinding to) loopback,
 * RFC-1918 or 169.254.169.254 reached it. Now the connection's own DNS lookup refuses any
 * private address and the socket connects only to the addresses that lookup checked.
 */
import type * as dns from 'node:dns';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// A scripted DNS answer for the pinnedLookup unit tests; null falls through to the real resolver.
const answer = vi.hoisted(() => ({ next: null as null | Array<{ address: string; family: number }> }));
vi.mock('node:dns', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:dns')>();
  const lookup = ((host: string, options: unknown, cb: (...a: unknown[]) => void) =>
    answer.next ? cb(null, answer.next) : (real.lookup as (...a: unknown[]) => void)(host, options, cb)) as typeof real.lookup;
  return { ...real, default: { ...real, lookup }, lookup };
});

import { httpFetchExecute } from '../src/mcp-tools/http-fetch-tools.js';
import { isPrivateOrLoopback, pinnedLookup, PrivateAddressError } from '../src/mcp-tools/http-fetch-pinned.js';

let server: http.Server;
let port: number;
let hits = 0;

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    hits++;
    res.end('INTERNAL-ONLY-SECRET-DATA');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CLAUDE_FLOW_HTTP_FETCH_ALLOW_PRIVATE;
});

describe('a hostname that resolves to loopback is refused on the connection', () => {
  // `localhost.` (trailing dot) is not an IP literal and not the text "localhost", so the old
  // hostname check passed it; the system resolver maps it to loopback, no network needed.
  it('refuses it and the internal server never sees a request', async () => {
    const before = hits;
    const result = await httpFetchExecute({ url: `http://localhost.:${port}/secret` });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PRIVATE_ADDRESS');
    expect(result.error).toMatch(/resolves to (127\.0\.0\.1|::1)/);
    expect(result.body).toBe('');
    expect(hits).toBe(before);
  });

  it('a redirect hop to such a name is refused the same way', async () => {
    const before = hits;
    const redirecting = http.createServer((_req, res) => {
      res.writeHead(302, { location: `http://localhost.:${port}/secret` });
      res.end();
    });
    await new Promise<void>((resolve) => redirecting.listen(0, '127.0.0.1', resolve));
    const rport = (redirecting.address() as AddressInfo).port;
    try {
      // The first hop is an IP literal on loopback, so it needs the opt-in; turn it off for the second hop
      // by resolving the second through a lookup that sees the flag unset.
      process.env.CLAUDE_FLOW_HTTP_FETCH_ALLOW_PRIVATE = '1';
      const result = await httpFetchExecute(
        { url: `http://127.0.0.1:${rport}/start` },
        {
          request: async (url, init) => {
            if (new URL(url).hostname === 'localhost.') delete process.env.CLAUDE_FLOW_HTTP_FETCH_ALLOW_PRIVATE;
            const { pinnedRequest } = await import('../src/mcp-tools/http-fetch-pinned.js');
            return pinnedRequest(url, init);
          },
        },
      );
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('PRIVATE_ADDRESS');
      expect(hits).toBe(before);
    } finally {
      redirecting.closeAllConnections?.();
      await new Promise<void>((resolve) => redirecting.close(() => resolve()));
    }
  });

  it('with CLAUDE_FLOW_HTTP_FETCH_ALLOW_PRIVATE=1 the same name connects (the opt-in still works)', async () => {
    process.env.CLAUDE_FLOW_HTTP_FETCH_ALLOW_PRIVATE = '1';
    const result = await httpFetchExecute({ url: `http://localhost.:${port}/secret` });
    expect(result.success).toBe(true);
    expect(result.body).toBe('INTERNAL-ONLY-SECRET-DATA');
  });
});

describe('pinnedLookup checks every resolved address and hands the socket only those', () => {
  const fake = (addresses: dns.LookupAddress[]) => { answer.next = addresses; };
  afterEach(() => { answer.next = null; });
  const run = (all: boolean) =>
    new Promise<{ err: Error | null; result: unknown }>((resolve) => {
      pinnedLookup('rebind.example', { all } as never, ((err: Error | null, a: unknown, f?: number) => resolve({ err, result: all ? a : [a, f] })) as never);
    });

  it('refuses a name whose answer mixes a public and a metadata address', async () => {
    fake([{ address: '93.184.216.34', family: 4 }, { address: '169.254.169.254', family: 4 }]);
    const { err } = await run(true);
    expect(err).toBeInstanceOf(PrivateAddressError);
    expect(err!.message).toContain('169.254.169.254');
  });

  it('refuses IPv6 answers that reach private space (mapped, NAT64, ULA)', async () => {
    for (const address of ['::ffff:10.0.0.1', '64:ff9b::a9fe:a9fe', 'fd00::1', '::1']) {
      fake([{ address, family: 6 }]);
      expect((await run(true)).err, address).toBeInstanceOf(PrivateAddressError);
    }
  });

  it('passes public answers through unchanged, as a list or as the first address', async () => {
    fake([{ address: '93.184.216.34', family: 4 }, { address: '2606:2800:220:1::1', family: 6 }]);
    expect(await run(true)).toEqual({ err: null, result: [{ address: '93.184.216.34', family: 4 }, { address: '2606:2800:220:1::1', family: 6 }] });
    expect(await run(false)).toEqual({ err: null, result: ['93.184.216.34', 4] });
  });

  it('refuses an empty answer', async () => {
    fake([]);
    expect((await run(true)).err).toBeInstanceOf(PrivateAddressError);
  });
});

describe('isPrivateOrLoopback covers the address forms a resolver can return', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '198.18.0.1',
    '224.0.0.1', '255.255.255.255', '::', '::1', '[::1]', '::ffff:127.0.0.1', '[::ffff:7f00:1]', '::7f00:1',
    '64:ff9b::7f00:1', '2002:a9fe:a9fe::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'fec0::1', 'ff02::1',
    'localhost', 'api.localhost',
  ])('%s is refused', (host) => expect(isPrivateOrLoopback(host)).toBe(true));

  it.each(['8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700::1111', '[2001:db8::1]', '2002:0808:0808::1', 'example.com'])(
    '%s is not', (host) => expect(isPrivateOrLoopback(host)).toBe(false),
  );
});
