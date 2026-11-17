# ADR-524: MCP 2026-07-28 support in the stdio servers (dual-era)

- **Status:** Accepted (Phase 1 shipped; Phase 2 open)
- **Date:** 2026-11-05
- **Spec:** [MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog),
  [versioning and compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)
- **Related:** ADR-490 (declared capabilities must be served)

## Context

The 2026-07-28 MCP revision removes the `initialize` handshake and protocol sessions. Each request now carries its
protocol version and client capabilities in `_meta`. Results gain a required `resultType`. List results gain
`ttlMs`/`cacheScope` cache hints. `server/discover` is mandatory. An unknown resource is now `-32602`, not `-32002`.

Ruflo has three stdio MCP servers, not one:

| Entry | Reached by |
|---|---|
| `bin/cli.js` (stdin-piped fast path) | `npx ruflo mcp start`, i.e. what Claude Code and Codex run |
| `bin/mcp-server.js` | the `claude-flow-mcp` bin |
| `MCPServerManager` in `src/mcp-server.ts` | `mcp start` from an interactive (TTY) launch, programmatic use |

All three answered `initialize` with a hardcoded `protocolVersion: '2024-11-05'` regardless of what the client asked
for. Two of them also reported `serverInfo.version: '3.0.0'`. None of them answered `server/discover` or read `_meta`.
A 2026-07-28 client probing over stdio got `Method not found` and, per the spec's compatibility matrix, treated ruflo
as a legacy-only server.

The separate `@claude-flow/mcp` package (used for HTTP) is on `2025-11-25` and is not changed here.

## Decision

Ruflo's stdio servers become **dual-era**: they serve modern (2026-07-28) and legacy (2024-11-05, 2025-06-18,
2025-11-25) clients from one process. 2025-03-26 is deliberately not offered: it is the only revision that allowed
JSON-RPC batching, and these handlers read one message per line. They choose per request, which the spec allows.

All revision logic lives in one dependency-free module, `src/mcp-protocol.ts`. The three handlers call it
instead of keeping their own copy:

1. `protocolPreflight(message, capabilities)` runs before each handler's own `switch`. It does the following:
   - Answers `initialize` itself. A supported legacy version is echoed back; anything else gets `2025-11-25`. The real
     package version goes in `serverInfo`.
   - Answers `server/discover`, with or without `_meta`, so a dual-era client's stdio probe succeeds. It returns
     `supportedVersions`, `capabilities`, `serverInfo` in `_meta` and cache hints.
   - Rejects a request that declares an unknown `_meta` version with `-32022` and `data.supported` / `data.requested`.
   - Rejects a 2026-07-28 request that lacks `clientCapabilities` with `-32602`.
   - Never answers a notification.
   - Otherwise it returns a `ProtocolContext`: modern or not, the declared version, and a validated `traceparent` /
     `tracestate`.
2. `finalizeResponse(response, method, context)` adds `resultType: 'complete'` and
   `_meta['io.modelcontextprotocol/serverInfo']` to every modern result. List methods also get `ttlMs` and
   `cacheScope: 'private'`. **Legacy responses are returned unchanged**, byte for byte.
3. `tools/list` is sorted by tool name in both eras. That makes the catalogue byte-identical across calls, which the
   spec recommends and which keeps client prompt caches stable across ruflo's roughly 450 tools.
4. `resources/read` returns `-32602` to a modern request and `-32002` to a legacy one.
5. A W3C-valid `traceparent` (and `tracestate` up to 512 bytes) from `_meta` is forwarded into the tool-call context.
   Handlers and the observability plugin can then join the caller's trace. Malformed values are dropped, never
   echoed: they must be lowercase hex with non-zero ids and no `ff` version, which also rules out header injection.

### Not in Phase 1

- **Tasks extension** (`io.modelcontextprotocol/tasks`, polling with `tasks/get` and `tasks/update`). This needs a
  decision on which ruflo tools may run as durable tasks, and on how a handle's lifetime and authorization work across
  stdio restarts. The capability is **not advertised**, so per the spec, clients fall back to plain calls.
- **`subscriptions/listen`.** `listChanged` stays advertised for legacy clients. Modern clients need a listen stream
  to receive change notifications, and the stdio servers never emit one today.
- **Multi round-trip requests (MRTR, `input_required`).** No ruflo tool needs client input mid-call, so no tool ever
  returns `input_required`.
- **`@claude-flow/mcp` (HTTP)** and the ruvocal `ruflo/src/mcp-bridge`. Both have their own negotiation. They move
  separately, and the HTTP side also needs the `Mcp-Method` / `Mcp-Name` headers and RFC 9207 `iss` validation.
- **Sampling, Roots and Logging** are deprecated in this revision, so no new work goes into
  `@claude-flow/mcp/src/sampling.ts`.

## Consequences

- A legacy client that asks for `2025-06-18` or `2025-11-25` now gets that version back instead of `2024-11-05`.
  Ruflo uses no feature that differs between those revisions on the server side (no batching, elicitation or
  structured output), so the answer is now accurate rather than a downgrade.
- `tools/list` order changes once, from registration order to name order. Nothing in the repository depends on the
  old order.
- `bin/cli.js` and `bin/mcp-server.js` now import `dist/src/mcp-protocol.js`. That file ships in the same tarball as
  the bins. Test fixtures that copy `bin/cli.js` into a stub tree must copy it too
  (`mcp-fast-path-error-envelope.test.ts`).

## Verification

`__tests__/mcp-protocol-2026-07-28.test.ts` covers three layers:

- The module as a unit: negotiation, discover, `-32022`, `-32602`, notifications, legacy pass-through, modern
  decoration and traceparent validation.
- `MCPServerManager` through its handler: version echo, sorted modern `tools/list`, trace forwarding, both error codes.
- **Both bin entries over real stdio**: a discover probe, two modern `tools/list` calls compared byte for byte, an
  unknown version rejected, and a legacy `initialize` in the same process.
