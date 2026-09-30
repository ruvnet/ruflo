# RuFlo AI Team

RuFlo AI Team is a separate, multi-tenant MCP service and Claude plugin. It turns a reviewed goal into explicit team, run, task, memory, and evidence records without exposing raw operator tools or credentials.

The public v0.1 surface coordinates work; it does not silently send messages, deploy software, execute shell commands, make purchases, or approve consequential actions. Claude Code and Cowork agents use the service as a shared control plane while the user remains the authority for external effects.

## Architecture

- OAuth 2.1 resource server with RFC 9728 discovery and issuer/audience/scope verification.
- Tenant identity derived only from verified token claims; no tool accepts a tenant ID.
- Firestore is canonical storage; an in-memory store is used for tests and local development.
- The default vector backend is the bounded, tenant-scoped `lexical-degraded` fallback. Set `RUFLO_AI_TEAM_VECTOR=native` only after the exact `@ruvector/core` binary passes the startup self-test; an unavailable or incompatible binding falls back explicitly and never claims semantic search.
- The opt-in `RUFLO_AI_TEAM_VECTOR=edge` adapter writes a derived, per-team RuVector edge index using Workers AI embeddings. Firestore remains canonical; indexing and fallback status are returned explicitly. Production activation is gated by ADR-0005.
- Stored task, memory, and evidence content is provenance-labelled and nonce-fenced as untrusted data.
- Fourteen focused tools, two prompts, a template resource, and a ChatGPT MCP Apps board.

The read-only `team_board` tool opens one compact ruOS-style workspace in ChatGPT. Its Teams, Runs, Tasks, and Evidence rail navigates inside the same card; selecting a run or pressing Refresh calls the same scoped tool through the MCP Apps bridge without asking ChatGPT to render another board. Evidence shows a private run summary; `evidence_export` provides the full bundle in chat. Its public HTML resource contains no tenant data; the tool requires `team:read`. Other tools remain data-only. Historical chat cards are immutable, so open a fresh chat after refreshing tools to see the current UI. `run_complete` requires `team:run` and refuses to complete a run until it has at least one task and every task is complete.

Memory search reports `lexical-degraded` unless a compatible native binding or the edge backend is active. The pinned `@ruvector/core` 0.1.32 package with its 0.1.30 optional native binding fails the local startup probe with a dimension mismatch. Do not set `RUFLO_AI_TEAM_VECTOR=native` in production until a compatible binary is verified.

### RuVector edge activation gate

The edge adapter can be deployed as a zero-traffic revision first. Set `RUFLO_AI_TEAM_VECTOR=edge` for production traffic only after the following checks:

1. The confidential `ruflo-ai-team` client is registered on the edge authorization server with the public P-256 JWK, subject audience `https://team.ruv.io/mcp`, and `ruvector:read ruvector:write` ceiling. The separate exchange drill passed; it does not substitute for an AI Team memory E2E.
2. Bind Secret Manager `ruflo-ai-team-edge-private-jwk` to `RUFLO_AI_TEAM_EDGE_PRIVATE_JWK` at runtime; set `RUFLO_AI_TEAM_EDGE_CLIENT_ID=ruflo-ai-team`. The app fails startup if either is missing or malformed. Never print or commit the private JWK.
3. Set `RUFLO_AI_TEAM_OAUTH_ISSUER=https://ruvector-edge-auth.cognitum-consulting-mail.workers.dev`, `RUFLO_AI_TEAM_OAUTH_LEGACY_ISSUER=https://auth.cognitum.one`, and the edge JWKS URI `.../.well-known/jwks.json`. The audience remains exactly `https://team.ruv.io/mcp`. New clients use edge OAuth. Existing Cognitum-issued tokens are still verified and served from their existing tenant with an explicit `legacy_oauth` local-memory fallback. They cannot be exchanged. Data migration across the old and new Firestore tenant keys requires a separately consented flow; no automatic copy is performed.
4. Verify the user has claimed the intended edge tenant and can create a team collection. Disclose that approved memory text and search queries go to RuVector edge and consume its metered work units. Prove two-workspace isolation, token exchange, memory write/query, revocation, degraded fallback, and measured quota use in a browser E2E before enabling broadly.

Writes longer than 8 KiB remain only in Firestore and report `edgeIndex: deferred`. Existing rows are not silently migrated; successful edge queries are labelled `ruvector-edge-hybrid`. Sparse edge result pages are supplemented with local lexical results; full pages skip that scan, so older unindexed rows may need a consented backfill. Edge result IDs are hydrated through a bounded Firestore batch read. Workers Paid caps in RuVector PR #1098 have a live deploy receipt; this adapter does not depend on those higher caps. As of 2026-09-29, separate-account browser canaries passed cross-tenant denial and edge index/search after an explicitly authorized second-tenant claim. Production remains on the local backend pending stable `edge.ruv.io` hostname/audience coordination, measured AI Team usage, and revocation verification; see ADR-0005.

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
- [ADR-0005: RuVector edge derived memory](docs/adrs/0005-ruvector-edge-derived-memory.md)
