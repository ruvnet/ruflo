/**
 * MCP protocol-version handling for the stdio servers (ADR-524).
 *
 * Ruflo ships three stdio entry points (`bin/cli.js` auto-detect, `bin/mcp-server.js`,
 * and `MCPServerManager` in mcp-server.ts). All three answered `initialize` with a
 * hardcoded `2024-11-05` and knew nothing of the 2026-07-28 revision, which drops the
 * handshake and carries the version on every request. This module is the one place
 * that decides which revision a message speaks, so the three handlers cannot drift.
 *
 * Dual-era behaviour (spec: basic/versioning):
 *  - `initialize` selects legacy semantics; the requested legacy version is echoed.
 *  - a request carrying `_meta["io.modelcontextprotocol/protocolVersion"]` is served
 *    statelessly: `resultType` and `serverInfo` on every result, cache hints on lists,
 *    `-32602` for an unknown resource, `-32022` for an unsupported version.
 *  - `server/discover` is always answered, so a dual-era client's stdio probe succeeds.
 */

import { readFileSync } from 'node:fs';

export const MODERN_PROTOCOL_VERSIONS = ['2026-07-28'] as const;
// 2025-03-26 is deliberately absent: it is the one revision that allowed JSON-RPC batching, which these
// line-at-a-time handlers do not accept. A client asking for it is offered 2025-11-25 instead.
export const LEGACY_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2024-11-05'] as const;
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  ...MODERN_PROTOCOL_VERSIONS,
  ...LEGACY_PROTOCOL_VERSIONS,
];
/** Offered to a legacy client whose requested version we do not know. */
export const LATEST_LEGACY_PROTOCOL_VERSION = LEGACY_PROTOCOL_VERSIONS[0];

export const META_PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion';
export const META_CLIENT_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';
export const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

export const ERROR_INVALID_PARAMS = -32602;
export const ERROR_UNSUPPORTED_PROTOCOL_VERSION = -32022;
/** 2025-11-25 and earlier; replaced by -32602 in 2026-07-28. */
export const ERROR_LEGACY_RESOURCE_NOT_FOUND = -32002;

/** Tool catalogue is fixed for the life of a stdio process; five minutes is a conservative hint. */
export const TOOLS_LIST_TTL_MS = 300_000;
export const DISCOVER_TTL_MS = 3_600_000;

const LIST_METHODS = new Set(['tools/list', 'prompts/list', 'resources/list', 'resources/templates/list']);

// W3C Trace Context: version-traceid-parentid-flags, lowercase hex, ids not all zero, version != ff.
const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export interface ServerIdentity {
  name: string;
  version: string;
}

export interface ProtocolContext {
  /** True when the request used 2026-07-28 per-request metadata. */
  modern: boolean;
  /** Version the request declared, or undefined for legacy requests. */
  version?: string;
  /** Validated W3C traceparent, if the client propagated one. */
  traceparent?: string;
  tracestate?: string;
}

export interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

export type Preflight =
  | { response: JsonRpcResponse; context?: undefined }
  | { response?: undefined; context: ProtocolContext };

let cachedVersion: string | undefined;

/** The CLI package version, read once from package.json (dist/src/ → ../../). */
export function rufloPackageVersion(): string {
  if (cachedVersion) return cachedVersion;
  for (const rel of ['../../package.json', '../package.json']) {
    try {
      const pkg = JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as { name?: string; version?: string };
      if (pkg.name === '@claude-flow/cli' && typeof pkg.version === 'string') {
        cachedVersion = pkg.version;
        return cachedVersion;
      }
    } catch {
      // try the next candidate
    }
  }
  cachedVersion = '0.0.0';
  return cachedVersion;
}

export function defaultServerIdentity(): ServerIdentity {
  return { name: 'ruflo', version: rufloPackageVersion() };
}

/** Pick the legacy version to answer `initialize` with (spec: echo if supported, else our latest). */
export function negotiateLegacyVersion(requested: unknown): string {
  return typeof requested === 'string' && (LEGACY_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : LATEST_LEGACY_PROTOCOL_VERSION;
}

export function isValidTraceparent(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = TRACEPARENT.exec(value);
  if (!m) return false;
  const [, version, traceId, parentId] = m;
  return version !== 'ff' && !/^0+$/.test(traceId) && !/^0+$/.test(parentId);
}

function metaOf(params: unknown): Record<string, unknown> | undefined {
  if (!params || typeof params !== 'object') return undefined;
  const meta = (params as Record<string, unknown>)._meta;
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>) : undefined;
}

function error(id: JsonRpcMessage['id'], code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: data === undefined ? { code, message } : { code, message, data } };
}

/**
 * Decide how to serve one inbound message before the handler's own switch runs.
 * Returns a complete response for `initialize`, `server/discover` and protocol
 * errors; otherwise returns the context the handler passes to `finalizeResponse`.
 */
export function protocolPreflight(
  message: JsonRpcMessage,
  capabilities: Record<string, unknown>,
  identity: ServerIdentity = defaultServerIdentity(),
): Preflight {
  const meta = metaOf(message.params);
  const traceparent = isValidTraceparent(meta?.traceparent) ? (meta!.traceparent as string) : undefined;
  const tracestate = traceparent && typeof meta?.tracestate === 'string' && meta.tracestate.length <= 512
    ? meta.tracestate
    : undefined;
  const declared = meta?.[META_PROTOCOL_VERSION];
  const isNotification = message.id === undefined || message.id === null;

  if (message.method === 'initialize') {
    const requested = (message.params as Record<string, unknown> | undefined)?.protocolVersion;
    return {
      response: {
        jsonrpc: '2.0',
        id: message.id,
        result: { protocolVersion: negotiateLegacyVersion(requested), serverInfo: identity, capabilities },
      },
    };
  }

  if (declared !== undefined && !isNotification) {
    if (typeof declared !== 'string' || !SUPPORTED_PROTOCOL_VERSIONS.includes(declared)) {
      return {
        response: error(message.id, ERROR_UNSUPPORTED_PROTOCOL_VERSION, 'Unsupported protocol version', {
          supported: [...SUPPORTED_PROTOCOL_VERSIONS],
          requested: declared,
        }),
      };
    }
    const modern = (MODERN_PROTOCOL_VERSIONS as readonly string[]).includes(declared);
    if (modern) {
      const caps = meta?.[META_CLIENT_CAPABILITIES];
      if (message.method !== 'server/discover' && (!caps || typeof caps !== 'object' || Array.isArray(caps))) {
        return { response: error(message.id, ERROR_INVALID_PARAMS, `Missing required _meta field: ${META_CLIENT_CAPABILITIES}`) };
      }
    }
    if (message.method === 'server/discover') return { response: discoverResponse(message.id, capabilities, identity) };
    return { context: { modern, version: declared, traceparent, tracestate } };
  }

  if (message.method === 'server/discover') return { response: discoverResponse(message.id, capabilities, identity) };
  return { context: { modern: false, traceparent, tracestate } };
}

function discoverResponse(
  id: JsonRpcMessage['id'],
  capabilities: Record<string, unknown>,
  identity: ServerIdentity,
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      resultType: 'complete',
      supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
      capabilities,
      _meta: { [META_SERVER_INFO]: identity },
      ttlMs: DISCOVER_TTL_MS,
      cacheScope: 'private',
    },
  };
}

/** The resource-not-found code the request's revision expects. */
export function resourceNotFoundCode(context: ProtocolContext): number {
  return context.modern ? ERROR_INVALID_PARAMS : ERROR_LEGACY_RESOURCE_NOT_FOUND;
}

/** Stable, name-ordered copy so `tools/list` is byte-identical across calls (prompt-cache friendly). */
export function sortToolsDeterministically<T extends { name: string }>(tools: readonly T[]): T[] {
  return [...tools].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Tool-call context fields to forward, so handlers and logs can join the caller's trace. */
export function traceContextFields(context: ProtocolContext): Record<string, string> {
  const out: Record<string, string> = {};
  if (context.traceparent) out.traceparent = context.traceparent;
  if (context.tracestate) out.tracestate = context.tracestate;
  return out;
}

/** Add the 2026-07-28 result fields to a handler's response. Legacy responses pass through untouched. */
export function finalizeResponse(
  response: JsonRpcResponse | null,
  method: string | undefined,
  context: ProtocolContext,
  identity: ServerIdentity = defaultServerIdentity(),
): JsonRpcResponse | null {
  if (!response || !context.modern || !response.result) return response;
  const result: Record<string, unknown> = { resultType: 'complete', ...response.result };
  const priorMeta = result._meta && typeof result._meta === 'object' ? (result._meta as Record<string, unknown>) : {};
  result._meta = { ...priorMeta, [META_SERVER_INFO]: identity };
  if (method && LIST_METHODS.has(method)) {
    result.ttlMs = TOOLS_LIST_TTL_MS;
    result.cacheScope = 'private';
  }
  return { ...response, result };
}
