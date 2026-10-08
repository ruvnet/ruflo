# ADR 482: Dashboard connector: an opt-in, outbound-only, signed link from a local ruflo to the hosted dashboard

Status: Proposed

Date: 2026-10-08

Related: ADR-479 (MCP HTTP bearer auth), ADR-406 (mission control), ADR-480 (ADR management). Summarises ADR-0001 and ADR-0003 of the
private `cognitum-one/ruflo-dashboard` repository, which owns the server, the shared `protocol/` and the web UI.

## 1. Context

A hosted dashboard (Cognitum SSO) should show real missions, swarm, memory, ADRs and health from a user's own ruflo, and let them issue a
small set of confirm-gated commands. The machine running ruflo is behind NAT, holds the user's code, and must not gain an inbound port, a
tunnel, or a remote shell. Reverse tunnels, inbound webhooks, bearer-only sockets (no replay or forgery resistance) and an arbitrary
`terminal_execute` relay were considered and rejected in the dashboard repository.

## 2. Decision

`ruflo dashboard link | status | enable | disable | set | unlink | run` (`src/commands/dashboard.ts`, library in `src/dashboard/`).

**Default OFF.** Nothing connects unless the machine is linked AND enabled AND the local level is not `off`, and `run` is an explicit
foreground command. Level defaults to `read`; `autoApprove` defaults to false.

**Pairing (RFC 8628 shape).** `link` generates an Ed25519 key (private key `~/.ruflo/dashboard/device.key`, mode 0600, refused on read if
group/world-readable, symlinked or not owned by the user; directory 0700), calls `POST /api/device/code`, prints a user code and the
verification URL, and polls `POST /api/device/token` honouring `interval`, `slow_down` and expiry. A signed-in user approves it in the
browser, binding the device to their tenant. The server's Ed25519 public key is pinned in `config.json`. The base URL must be https
(http only for loopback); the `connectUrl` must be wss on the same host.

**Transport.** One outbound `wss://.../connect`. Every frame is an `Envelope` v1: Ed25519 signature over canonical JSON including device
id and tenant id, +-120 s clock window, a 128-bit nonce and a strictly increasing `seq`. The device `seq` is reserved in blocks on disk, and
the last accepted server `seq` is persisted, so a restart cannot reuse or be replayed to. Frames over 256 KiB are refused. Reconnect uses
jittered exponential backoff (1 s to 60 s).

**Publishing.** Every 10 s (and on `state.refresh`) the device sends a `digest` (the Digest object is the frame body), collected read-only through `ruflo mcp exec` (system_info,
system_health, mission_get, mission_events, task_summary, swarm_status, agent_list, memory_stats) plus ADR markdown headers from
`docs/adr`. Strings are control-stripped and secret-masked before signing and again server-side; the digest is schema-validated (strict).
A collector that fails becomes a health note. Cost is omitted because ruflo has no cost read tool.

**Commands.** Only the allowlist in the shared protocol exists (`state.refresh`, `memory.search`, `mission.create` as DRAFT only,
`mission.pause|resume|stop`, `swarm.init` max 6, `agent.spawn` from a type allowlist within the cap). The device verifies the signature
with the pinned server key, checks expiry (and a 15 minute maximum lifetime), re-validates arguments against the allowlist schema, applies
its own level (`off < read < write < manage < full`), and requires a local approval for anything above `read`: an interactive TTY `y/N`
(no TTY = deny; an `Approver` can be injected so the console can supply its own confirm). `autoApprove` never covers `manage` or `full`.
Each command maps to fixed `ruflo mcp exec` tool calls; ruflo is started with `spawn(argv, {shell:false})`, a 10 s timeout, a 1 MiB output
cap and an allowlisted environment. User text is only a JSON value inside one argument.

**Revocation.** A server `revoke` frame signed with the pinned key wipes the key and config and exits (code 3). `unlink` sends a signed
`revoke` best-effort, then wipes locally regardless. An append-only, 0600 `audit.jsonl` records every command, decision and publication
summary (secrets masked, no keys).

## 3. Consequences

- A compromised dashboard can at worst ask for allowlisted, level-checked, locally approved actions; it cannot reach a shell, the
  filesystem or a ruOS machine through this channel.
- The connector is an unreviewed copy of `cognitum-one/ruflo-dashboard/connector` plus the shared `protocol/` (`src/dashboard/protocol/`).
  They must be kept in lock-step: a protocol change needs both repositories. The only intentional difference is the ruflo launcher, which
  here is the running CLI itself (`process.execPath` + `process.argv[1]`) instead of a PATH or pinned `npx` lookup.
- Server frames use a persisted `seq`; a server whose counter can go backwards (for example an in-memory counter after a restart) would be
  refused as a replay. The dashboard should derive `seq` from a durable or time-based source.

## 4. Not done

No console UI, MCP tool, or auto-start; no Windows file-mode enforcement (the 0600 check is POSIX only); `cost` is not published until a
read surface exists.
