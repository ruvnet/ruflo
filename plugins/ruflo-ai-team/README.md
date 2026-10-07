# RuFlo AI Team

RuFlo AI Team is a separate, multi-tenant MCP service and Claude plugin. It turns a reviewed goal into explicit team, run, task, memory, and evidence records without exposing raw operator tools or credentials.

The public v0.1 surface coordinates work; it does not silently send messages, deploy software, execute shell commands, make purchases, or approve consequential actions. Claude Code and Cowork agents use the service as a shared control plane while the user remains the authority for external effects.

## Architecture

- OAuth 2.1 resource server with RFC 9728 discovery and issuer/audience/scope verification.
- Tenant identity derived only from verified token claims; no tool accepts a tenant ID.
- Firestore is canonical storage; an in-memory store is used for tests and local development.
- The default vector backend is the bounded, tenant-scoped `lexical-degraded` fallback. Set `RUFLO_AI_TEAM_VECTOR=native` only after the exact `@ruvector/core` binary passes the startup self-test; an unavailable or incompatible binding falls back explicitly and never claims semantic search.
- Stored task, memory, and evidence content is provenance-labelled and nonce-fenced as untrusted data.
- Fourteen focused tools, two prompts, a template resource, and a ChatGPT MCP Apps board.

The read-only `team_board` tool opens one compact ruOS-style workspace in ChatGPT. Its Teams, Runs, Tasks, and Evidence rail navigates inside the same card; selecting a run or pressing Refresh calls the same scoped tool through the MCP Apps bridge without asking ChatGPT to render another board. Evidence shows a private run summary; `evidence_export` provides the full bundle in chat. Its public HTML resource contains no tenant data; the tool requires `team:read`. Other tools remain data-only. Historical chat cards are immutable, so open a fresh chat after refreshing tools to see the current UI. `run_complete` requires `team:run` and refuses to complete a run until it has at least one task and every task is complete.

## Public and protected surface

Discovery is deliberately public, so MCP clients and directory reviewers can list the service before a user signs in. Anything tenant-scoped requires OAuth.

| Anonymous (no token) | Requires OAuth (`401` challenge with RFC 9728 metadata otherwise) |
|---|---|
| `initialize`, `ping`, `tools/list`, `prompts/list`, `resources/list` | every `tools/call` |
| `resources/read` of the static board UI (`ui://ruflo-ai-team/board-v4.html`) | every other `resources/read`, including `ruv://team/templates` |
| `/health`, `/.well-known/oauth-protected-resource[/mcp]`, `/privacy`, `/terms`, `/support` | |

The anonymous methods return only static definitions: tool schemas, prompt text, and the two static resource descriptors. They never return team, run, task, memory or evidence data. A bearer token that fails verification is treated as anonymous for these discovery methods only; it never downgrades a protected call.

Cross-origin (browser) reads are limited to an explicit allowlist. By default it covers `https://chatgpt.com`, `https://chat.openai.com` and `https://claude.ai`; set `ALLOWED_ORIGINS` (comma-separated origins) to replace it. The request origin is echoed back only when it is on the list, with `Vary: Origin`. No `access-control-allow-origin` header is sent for any other origin. ChatGPT and Claude call the endpoint server-to-server and the board UI makes no network requests, so the allowlist governs browser-based MCP clients only. Requests without an `Origin` header are unaffected.

Memory search reports `lexical-degraded` unless a compatible native RuVector binding passes the startup probe. The pinned `@ruvector/core` 0.1.32 package with its 0.1.30 optional native binding fails that probe in local validation with a dimension mismatch. Do not set `RUFLO_AI_TEAM_VECTOR=native` in production until a compatible binary is verified.

## Local verification

```bash
npm install
npm test
npm run smoke
```

Run locally with `RUFLO_AI_TEAM_STORE=memory npm start`. Production requires the exact OAuth resource audience `https://team.ruv.io/mcp`, Firestore IAM, and the environment variables documented in `deploy/cloud-run.yaml`. ChatGPT connections registered before the `team:*` scope ceiling was added must be created again so dynamic client registration includes those scopes.

## Compatibility

The plugin targets Ruflo / `@claude-flow/cli` v3.48 and pins its remote MCP contract at service version 0.1.x. Claude discovers skills, commands, and agents from the canonical plugin directories; the manifest intentionally contains no component arrays.

## Namespace coordination

The plugin owns the `ruflo-ai-team-*` namespace. Tenant data is never separated by a user-supplied namespace: authorization derives the tenant and every repository operation requires it. This follows the `ruflo-agentdb` ADR-0001 namespace convention while treating namespaces as organization aids, not security boundaries.

## Verification

`bash plugins/ruflo-ai-team/scripts/smoke.sh` runs structural checks and the Node test suite. The tests assert the exact tool inventory, complete annotations, OAuth challenges, scope errors, cross-tenant denial, bounded vector indexes, fenced retrieval, and evidence export.

## Architecture decisions

- [ADR-0001: Multi-tenant service boundary](docs/adrs/0001-multitenant-service-boundary.md)
- [ADR-0002: Approval and external-action boundary](docs/adrs/0002-approval-and-external-action-boundary.md)
- [ADR-0003: Tenant-scoped RuVector memory](docs/adrs/0003-tenant-scoped-ruvector-memory.md)
- [ADR-0004: Metered unit budget](docs/adrs/0004-metered-unit-budget.md)

## As a mod

AI Team also ships as a function-hook mod (ADR-445 pattern; hooks in `hooks/`, loaded with the plugin). No network, no process, no model call.

- **Guard (default on)**: refuses a team write (`memory_remember`, `task_create`, `task_update`, `run_create` on the ruflo-ai-team server) that holds a key, token or password. It only tightens: it never allows anything the session would deny, and the refusal never repeats the secret. Turn it off with the `guard` option.
- **`/ai-team-mod`**: answered locally. `/ai-team-mod status`, `/ai-team-mod scan <text>`.
- **Status file**: `.claude-flow/ai-team-mod/status.json` (`version`, `updatedMs`, counters), written at session start and whenever a call is refused; the console reads it.
- **Options** (`userConfig`): `guard` (`on` by default).

Test: `claude plugin validate plugins/ruflo-ai-team`, `claude plugin test plugins/ruflo-ai-team`, and `bash plugins/ruflo-ai-team/scripts/smoke.sh`.
