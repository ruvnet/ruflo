/**
 * Checks for transports that carry no bearer token. A browser always sends an
 * `Origin` header and cannot be stopped by CORS on a WebSocket upgrade, and a
 * rebinding page reaches 127.0.0.1 under its own hostname, so an open loopback
 * server must look at both. Non-browser clients send no `Origin`. The token
 * helpers at the end are for servers that do carry one.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '0:0:0:0:0:0:0:1']);

export function isLoopbackName(host: string): boolean {
  return LOOPBACK.has(host.trim().toLowerCase().replace(/^\[|\]$/g, ''));
}

/** The hostname of a `Host` header value: no port, no IPv6 brackets, lower case. */
function hostnameOf(header: string): string {
  const value = header.trim().toLowerCase();
  const bracket = value.match(/^\[([^\]]*)\](?::\d*)?$/);
  if (bracket) return bracket[1];
  return value.replace(/:\d*$/, '');
}

/** Whether the `Host` header names this server (a loopback name or the bound host). */
export function hostHeaderAllowed(header: string | undefined, boundHost: string): boolean {
  if (!header) return false;
  const name = hostnameOf(header);
  return isLoopbackName(name) || name === boundHost.trim().toLowerCase().replace(/^\[|\]$/g, '');
}

/** Whether a request's `Origin` may talk to an unauthenticated server: none at all, or one listed by name (`*` does not count). */
export function originAllowed(origin: string | undefined, allowed: readonly string[] | undefined): boolean {
  if (origin === undefined || origin === '') return true;
  return (allowed ?? []).some((entry) => entry !== '*' && entry === origin);
}

/** Why an unauthenticated request must be refused, or `undefined` when it may proceed. */
export function refuseOpenRequest(req: Pick<IncomingMessage, 'headers'>, boundHost: string, allowedOrigins: readonly string[] | undefined): string | undefined {
  // Rebinding only reaches a loopback bind; behind a proxy on another address the Host is the proxy's.
  if (isLoopbackName(boundHost) && !hostHeaderAllowed(req.headers.host, boundHost)) return 'Host header does not name this server';
  const origin = req.headers.origin;
  if (!originAllowed(Array.isArray(origin) ? origin[0] : origin, allowedOrigins)) return 'cross-origin requests are refused without a token';
  return undefined;
}

/** Refuse to listen beyond loopback with no token unless the operator said so. */
export function assertSafeBind(host: string, authenticated: boolean, allowUnauthenticated: boolean | undefined): void {
  if (!isLoopbackName(host) && !authenticated && allowUnauthenticated !== true) {
    throw new Error(
      `Refusing to listen on non-loopback host "${host}" without authentication: every registered tool would be reachable from the network. ` +
        'Configure a token, bind to a loopback host, or set allowUnauthenticated to accept the risk.',
    );
  }
}

// Keyed per process: the digest only turns values of any length into equal-length
// buffers for timingSafeEqual; it is never stored.
const COMPARE_KEY = randomBytes(32);
const compareDigest = (value: string): Buffer => createHmac('sha256', COMPARE_KEY).update(value, 'utf8').digest();

/** Whether `token` is one of `tokens`, compared in constant time. No configured token means none is valid. */
export function tokenAllowed(token: string | undefined, tokens: readonly string[] | undefined): boolean {
  if (!token) return false;
  const digest = compareDigest(token);
  let valid = false;
  // No early exit, so timing does not depend on which token matched.
  for (const expected of tokens ?? []) {
    // A missing or empty configured value (e.g. an unset env var) matches nothing.
    if (typeof expected !== 'string' || expected.length === 0) continue;
    if (timingSafeEqual(digest, compareDigest(expected))) valid = true;
  }
  return valid;
}

/**
 * Whether a WebSocket upgrade carries a configured token, from `Authorization: Bearer`
 * or a `token` query parameter (a browser cannot set headers on a WebSocket).
 */
export function handshakeAuthorized(req: Pick<IncomingMessage, 'headers' | 'url'>, tokens: readonly string[] | undefined): boolean {
  const header = req.headers.authorization;
  const bearer = typeof header === 'string' ? /^Bearer\s+(.+)$/i.exec(header)?.[1] : undefined;
  const query = new URL(req.url ?? '/', 'http://localhost').searchParams.get('token') ?? undefined;
  return tokenAllowed(bearer ?? query, tokens);
}

/**
 * The bearer tokens a transport accepts, or `undefined` when auth is off (no
 * `auth`, or `enabled: false`). An `auth` object without `enabled` counts as
 * on, as it always has for HTTP requests. Only `tokens` are checked, as in
 * @claude-flow/mcp.
 */
export function bearerCredentials(
  auth: { enabled?: boolean; tokens?: string[] } | undefined,
): string[] | undefined {
  if (!auth || auth.enabled === false) return undefined;
  // Drop missing or empty values (e.g. an unset env var), so they count as
  // "nothing configured" rather than a credential.
  return [...(auth.tokens ?? [])].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
}

/** Refuse to start with auth on but no token a client could present. */
export function assertUsableAuth(credentials: readonly string[] | undefined): void {
  if (credentials !== undefined && credentials.length === 0) {
    throw new Error(
      'Authentication is enabled but no tokens are configured, so every request would be refused. ' +
        'Configure auth.tokens (bearer tokens are the only method this transport checks) or disable auth.',
    );
  }
}
