/**
 * http_fetch's address checks and connection-pinned transport (ADR-164 §5.1.8).
 *
 * Checking the URL's hostname string is not enough: a public-looking name can resolve to
 * loopback, RFC-1918 or cloud metadata (169.254.169.254), and `fetch()` resolves the name
 * again on its own, so even a pre-resolution check can be rebound (TTL-0 DNS) between the
 * check and the connect. Here the socket's DNS lookup *is* the check: `pinnedLookup`
 * resolves the name, refuses it when any address is private, and hands the socket only the
 * addresses it checked, so the connection cannot land anywhere else. IP-literal hosts never
 * reach a lookup; `validateUrl` checks those by text, with the same `isPrivateOrLoopback`.
 *
 * @module @claude-flow/cli/mcp-tools/http-fetch-pinned
 */

import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import * as http from 'node:http';
import * as https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { Readable } from 'node:stream';

/** Raised when a hostname resolves to an address the allowlist refuses. */
export class PrivateAddressError extends Error {
  readonly code = 'PRIVATE_ADDRESS';
  constructor(host: string, address: string) {
    super(`host ${host} resolves to ${address}, which is loopback/private/link-local; set CLAUDE_FLOW_HTTP_FETCH_ALLOW_PRIVATE=1 to override`);
    this.name = 'PrivateAddressError';
  }
}

export const allowPrivateAddresses = (): boolean => process.env.CLAUDE_FLOW_HTTP_FETCH_ALLOW_PRIVATE === '1';

/** The 16-bit groups of an IPv6 address (brackets stripped), or null when it is not one. */
function ipv6Groups(addr: string): number[] | null {
  if (isIP(addr) !== 6) return null;
  let text = addr.split('%')[0]!;
  // A trailing dotted IPv4 (`::ffff:1.2.3.4`) is two groups.
  const v4 = text.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.includes('::') ? text.split('::') as [string, string] : [text, undefined];
  const parse = (s: string) => (s ? s.split(':').map((g) => parseInt(g, 16)) : []);
  const h = parse(head);
  const t = tail === undefined ? [] : parse(tail);
  const groups = tail === undefined ? h : [...h, ...new Array(8 - h.length - t.length).fill(0), ...t];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function privateIPv4(a: number, b: number): boolean {
  return a === 0                              // 0.0.0.0/8 ("this" network)
    || a === 127                              // loopback
    || a === 10                               // RFC 1918
    || (a === 172 && b >= 16 && b <= 31)      // RFC 1918
    || (a === 192 && b === 168)               // RFC 1918
    || (a === 169 && b === 254)               // link-local, cloud metadata
    || (a === 100 && b >= 64 && b <= 127)     // CGNAT
    || (a === 198 && (b === 18 || b === 19))  // benchmarking
    || a >= 224;                              // multicast, reserved, broadcast
}

/**
 * Whether a host (an IP literal, bracketed or not, or `localhost`) is one http_fetch refuses
 * by default. A name that is not an IP literal is `false` here: what it resolves to is
 * checked at connect time by `pinnedLookup`.
 */
export function isPrivateOrLoopback(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === 'localhost' || lower === 'localhost.localdomain' || lower.endsWith('.localhost')) return true;
  const bare = lower.startsWith('[') && lower.endsWith(']') ? lower.slice(1, -1) : lower;

  const v4 = bare.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) return privateIPv4(Number(v4[1]), Number(v4[2]));

  const g = ipv6Groups(bare);
  if (!g) return false;
  const embedded = (hi: number) => privateIPv4(hi >> 8, hi & 0xff);
  if (g.slice(0, 7).every((x) => x === 0) && g[7]! <= 1) return true;                        // :: and ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return embedded(g[6]!);          // ::ffff:a.b.c.d (IPv4-mapped)
  if (g.slice(0, 6).every((x) => x === 0)) return true;                                      // ::a.b.c.d (deprecated IPv4-compatible)
  if (g[0] === 0x64 && g[1] === 0xff9b) return true;                                         // 64:ff9b::/96 and /48 NAT64: may wrap any IPv4
  if (g[0] === 0x2002) return embedded(g[1]!);                                                // 6to4 carries an IPv4
  if ((g[0]! & 0xfe00) === 0xfc00) return true;                                              // fc00::/7 unique local
  if ((g[0]! & 0xffc0) === 0xfe80 || (g[0]! & 0xffc0) === 0xfec0) return true;               // fe80::/10 link-local, fec0::/10 site-local
  if ((g[0]! & 0xff00) === 0xff00) return true;                                              // ff00::/8 multicast
  return false;
}

/**
 * The socket's DNS lookup: resolve every address, refuse the host when any of them is
 * private (unless opted in), and return only those checked addresses to the socket.
 */
export const pinnedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return (callback as (e: NodeJS.ErrnoException | null, a: LookupAddress[]) => void)(err, []);
    const list = addresses as LookupAddress[];
    if (!allowPrivateAddresses()) {
      const bad = list.find((a) => isPrivateOrLoopback(a.address));
      if (bad || list.length === 0) {
        return (callback as (e: Error | null, a: LookupAddress[]) => void)(new PrivateAddressError(hostname, bad?.address ?? 'no address'), []);
      }
    }
    if ((options as { all?: boolean }).all) return (callback as (e: null, a: LookupAddress[]) => void)(null, list);
    (callback as (e: null, a: string, f: number) => void)(null, list[0]!.address, list[0]!.family);
  });
};

export interface PinnedInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
}

/** Statuses whose Response must not carry a body. */
const NULL_BODY = new Set([101, 103, 204, 205, 304]);

/**
 * One HTTP(S) request whose connection goes only to an address `pinnedLookup` checked, with
 * no redirect following and a fresh connection every time (no pooled socket from elsewhere).
 * Returns a standard `Response` so the caller reads it as it would a `fetch()` result.
 */
export function pinnedRequest(url: string, init: PinnedInit): Promise<Response> {
  const target = new URL(url);
  const client = target.protocol === 'https:' ? https : http;
  const headers: Record<string, string> = { accept: '*/*', ...init.headers };
  if (init.body !== undefined && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-length')) {
    headers['content-length'] = String(Buffer.byteLength(init.body));
  }
  return new Promise<Response>((resolve, reject) => {
    const req = client.request(target, { method: init.method, headers, lookup: pinnedLookup, agent: false, signal: init.signal }, (res) => {
      const out = new Headers();
      for (const [key, value] of Object.entries(res.headers)) {
        for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) out.append(key, v);
      }
      const status = res.statusCode ?? 0;
      if (status < 200 || status > 599) {
        res.destroy();
        reject(new Error(`unsupported HTTP status ${status}`));
        return;
      }
      const body = NULL_BODY.has(status) || init.method === 'HEAD' ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>);
      if (body === null) res.resume();
      resolve(new Response(body, { status, statusText: res.statusMessage ?? '', headers: out }));
    });
    req.on('error', reject);
    req.end(init.body);
  });
}
