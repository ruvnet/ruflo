/**
 * Checks for transports that carry no bearer token. A browser always sends an
 * `Origin` header and cannot be stopped by CORS on a WebSocket upgrade, and a
 * rebinding page reaches 127.0.0.1 under its own hostname, so an open loopback
 * server must look at both. Non-browser clients send no `Origin`.
 */
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

/**
 * The token in an `Authorization: Bearer <token>` header, or `undefined`.
 *
 * Deliberately not `/^Bearer\s+(.+)$/i`: there `\s+` and `.+` both match
 * whitespace, so a header of many spaces or tabs makes the engine try every
 * split point — polynomial backtracking on input an unauthenticated caller
 * controls (CodeQL js/polynomial-redos). A prefix compare, one unquantified
 * character class and trimStart are all linear.
 */
export function bearerToken(header: string | undefined): string | undefined {
  if (typeof header !== 'string' || header.length > 8192) return undefined;
  if (header.slice(0, 6).toLowerCase() !== 'bearer' || !/^\s/.test(header.slice(6))) return undefined;
  const token = header.slice(6).trimStart();
  return token || undefined;
}
