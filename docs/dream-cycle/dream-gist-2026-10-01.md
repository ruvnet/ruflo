# Security SOTA Report — 2026-10-01

TL;DR: Ruflo's MCP HTTP transport (`v3/@claude-flow/cli/src/mcp-server.ts`, `startHttpServer()`) constructs its `@claude-flow/mcp` server without ever setting `requireToolAuthorization` or installing a `toolAuthorizer`. Since `ToolRegistry`'s authorization check is fully opt-in (`if (this.authorizer)`), every one of the CLI's 300+ registered MCP tools (`memory_*`, `hooks_*`, `agentdb_*`, `hive-mind_*`, ...) is callable with zero authorization whenever the server is reachable — and `--host` is a live, documented CLI flag that can bind it off loopback. This is structurally identical to CVE-2026-81735 (CVSS 10/10, disclosed against UI-TARS-desktop's `mcp-http-server` within the last 12 months): an optional auth hook the integrating CLI never wired, combined with a non-loopback-capable bind address. Tonight wires a fail-closed-by-default gate: the HTTP server now refuses to start on a non-loopback host unless the operator explicitly acknowledges the risk via `RUFLO_MCP_ALLOW_UNAUTHENTICATED_HTTP=1`. Default (loopback) behavior is completely unchanged.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| MCP spec (2026-07-28 rev.) leaves authorization OPTIONAL at the protocol/transport level ("SHOULD", not "MUST") | modelcontextprotocol.io/specification/2026-07-28/basic/authorization | A |
| MCP Security Best Practices doc: once a server *does* implement authorization, it MUST verify every inbound request; local/HTTP servers SHOULD require an auth token | modelcontextprotocol.io/.../security_best_practices | A |
| CVE-2026-81735 (CVSS 10/10): UI-TARS-desktop `mcp-http-server` defaulted to bind `::`, applied auth middleware only when a caller supplied it, exposing unauthenticated `run_command`/file-write MCP tools | Mend.io / OpenCVE / INCIBE-CERT, 2026 (cross-corroborated) | B |
| CVE-2025-49596: MCP Inspector's unauthenticated `/sse` endpoint allowed remote RCE via unauthenticated proxy-to-stdio launch | crowdsec.net + trackers, 2025 | B |
| OWASP LLM06 (Excessive Agency) + new OWASP Agentic Top 10 ASI02 "Tool Misuse and Exploitation" (2025-12-09) both prescribe per-call runtime authorization and least-privilege tool access as core mitigations | OWASP GenAI Security Project | A |

## Ruflo Current Capability

`@claude-flow/mcp`'s `ToolRegistry`/`MCPServer` already has a **fully-built, tested, opt-in fail-closed path**: `requireToolAuthorization: true` with no `toolAuthorizer` throws at construction (`server.ts:126-128`, exercised today only by the package's own `__tests__/mcp.test.ts`). Zero production callers anywhere in `v3/` ever set it. The CLI's stdio transport (the default) goes through a separate dispatcher with its own opt-in `PolicyEnforcer` (audit log + rate limit only, env-gated `RUFLO_MCP_ENFORCE_POLICY=1`, explicitly *not* an identity/authorization check, and explicitly *not* wired into the HTTP path per its own header comment) — so stdio has an audit trail but no permission check, and HTTP (the more exposure-prone path, given `--host`) had neither.

## Competitor Comparison

| Capability | LangGraph | AutoGen (MS) | CrewAI | OpenAI Agents SDK | Ruflo (before tonight) |
|---|---|---|---|---|---|
| Default tool-call authorization | Default-allow; HITL is a pattern you build (`interrupt_before`), not a default gate [B] | Default-allow; `approval_func` only vets if you supply one, logs a warning if you don't [B] | Default-allow; `human_input=True` is per-task opt-in, stdin-only (unattended-useless) [B] | Default-allow; `needsApproval` is an opt-in per-tool predicate (AI SDK 6, 2025) [B] | Default-allow (fail-open) — same industry norm, now closed for the HTTP transport |
| Has the authorizer *hook* built at all | No dedicated tool-auth hook found | `approval_func` callback exists | `human_input` flag exists (interactive-only) | `needsApproval` predicate exists | `ToolAuthorizer` type + fail-closed constructor path exist — ruflo is ahead on primitives, behind on wiring them by default |
| Documented CVE/incident for this exact shape | None found | None found | None found | None found | CVE-2026-81735 (closest external analog, different codebase) |

Synthesis: **every framework researched is default-allow at the tool-execution layer** — this is a genuine industry-wide gap, not something ruflo is uniquely behind on. The MCP spec is the one place "secure by default" is explicitly normative, and it targets transport-level OAuth, leaving in-process tool-dispatch authorization (exactly `ToolAuthorizer`) unstandardized everywhere. Ruflo is unusual only in having *already built* the fail-closed hook and never wiring it — most peers never built the hook at all. That makes tonight's fix unusually cheap: no new primitive, just correct default wiring at one call site.

## Hypothesis

> Given an operator starts Ruflo's MCP server over HTTP transport with a non-loopback `--host`, when `startHttpServer()` is made to refuse to start (throw a clear, actionable error) instead of silently constructing an authorization-free `MCPServer`, then an unauthenticated remote client should no longer be able to reach any of the ~300+ registered MCP tools over the network by default, subject to: (1) default/loopback-host behavior is completely unchanged, (2) an explicit, documented env-var opt-out preserves today's behavior for operators who intentionally expose it behind their own auth layer, (3) the stdio transport (default, pipe-local, already governed by its own opt-in audit/rate-limit layer) is unaffected by this change.

Frozen before evaluation began; not modified afterward.

## Benchmarks

Candidate: `v3/@claude-flow/cli/src/mcp-server.ts`, +36/-0 lines (one file, one conceptual change — adds a `LOOPBACK_HOSTS` set, an exported `isUnauthenticatedHttpAllowed()` helper, and a pre-construction guard in `startHttpServer()`). New test file `__tests__/mcp-http-nonloopback-auth-gate.test.ts` (6 tests: 3 unit tests on the helper, 3 end-to-end tests spawning the built CLI).

Stash-isolated (baseline = `git stash` + rebuild `dist/` on just `mcp-server.ts`, new tests kept):
- Baseline: 4/6 new tests fail — critically, the server **actually starts and serves `/health`** on `--host 0.0.0.0` with no authorization and no opt-out (the live vulnerability, reproduced directly, not inferred) — plus `isUnauthenticatedHttpAllowed` doesn't exist yet (import error) for the 3 unit tests.
- Candidate: 6/6 pass — non-loopback host refused before the port ever opens; non-loopback host starts when `RUFLO_MCP_ALLOW_UNAUTHENTICATED_HTTP=1`; loopback host (127.0.0.1) unaffected.
- Broader sweep: 72/72 pass across 7 related `__tests__/mcp-*` files. `@claude-flow/mcp` package's own suite: 81/81 unchanged (zero changes made to that package — the fix is entirely at the CLI's one call site).
- Full `@claude-flow/cli` suite: 4505 tests, 4367 passed, 9 failed, 129 skipped, across 329 files (4 files failed). All 4 failing files confirmed pre-existing via stash-isolation, unrelated to this candidate: `mcp-http-protocol-tools-2990.test.ts` (3 tests — this sandbox has no IPv6 support, `EAFNOSUPPORT` on `::1`, breaks an unrelated pre-existing dual-stack test identically on baseline); `mcp-policy-enforcer.test.ts` (3 tests — an "unwritable path" assumption that doesn't hold under this sandbox's filesystem permissions); `commands.test.ts` (3 tests — stale expectations tied to pre-existing issue #1425, "config reset/export not yet implemented"); `init-dual-native-2636-2637.test.ts` (fails to resolve the unbuilt sibling `@claude-flow/codex` package, the same "unbuilt sibling package" class of pre-existing environmental failure the ledger has logged repeatedly since 08-26). `tsc` clean on both `@claude-flow/cli` and `@claude-flow/mcp`.
- Independent adversarial critique: **CONFIRMED**. Verified the gate is the sole `createMCPServer()` call site and covers both HTTP and WebSocket transports; verified `0.0.0.0`/non-canonical loopback spellings fail closed (conservative direction); verified the `RUFLO_MCP_ALLOW_UNAUTHENTICATED_HTTP` self-bypass requires process-environment control, which already implies a stronger foothold than the vulnerability being closed; confirmed stdio's separate, lower-urgency scope (opt-in audit+rate-limit, no identity check, pipe-local) is a disclosed boundary, not a gap in tonight's fix. One process question raised (whether the stash-isolated e2e baseline was run against a rebuilt `dist/`, not a stale compiled binary) — confirmed yes, `npm run build` was run immediately after `git stash` and before the baseline test run.
- `npx ruflo metaharness mcp-scan --fail-on high`: 3 pre-existing findings (2 medium risky-bash-allow-rules, 1 low unpinned-deps), none related to this change, no high-severity findings — reward-hack / policy-regression check clean.

## Evaluation

**Verdict: ACCEPT.** `evaluation_complete=true`, `effect_positive=true` (fail-open → fail-closed-by-default on the demonstrated vulnerable path), `no_material_regression=true` (all 9 full-suite failures confirmed pre-existing via stash-isolation), `tests_green=true` for the candidate's own discriminating tests, `reward_hack_clear=true` (metaharness mcp-scan clean, diff scope matches claim), `critic_clear=true` (independent adversarial critique CONFIRMED, no blocking issues), `witness_valid=true` (below), `receipt_reproducible=true` (stash-isolation procedure documented above, independently spot-checked by the critic for current-state behavior). Per STEP 14, this is evidence for human review, not autonomous promotion — PR opened as draft.

## Darwin Results

Not run. This is a binary security gate (refuse-to-start vs. start), not a continuous metric with tunable parameters worth a 3-generation search — the one knob (which hosts count as loopback) is a fixed, well-known set (`127.0.0.1`/`::1`/`localhost`), not something to evolve. Recorded as considered-and-declined, matching the same judgment call made on 2026-09-30's performance candidate.

## SOTA Proof & Witness

```
Session commit:            0bd8e3142e5de68ca6075dad11b4ae2cfdaa0bec
Report SHA256:              45577a1b72d89ff41afdfc4e92f5b3e17cf4eb6be1bacd6622a629441ef03a29
Witness stamp:              f62fa76eb21e643cee0c21e1596917856534e658b95e3b9e68a398c58d1a0ced
Evaluation receipt:         @claude-flow/cli full suite 4367/4505 passed, 9 failed (all 4 failing
                             files confirmed pre-existing via stash-isolation); new discriminating
                             suite 6/6 (candidate) vs 4/6 fail (baseline, rebuilt dist); @claude-flow/mcp
                             81/81 unchanged; tsc clean both packages
Flywheel evidence identity: embedded in this gist + the linked issue/PR (Evaluation section) —
                             no separate signed receipt file this session (ruvector harness
                             flywheel gate/verify requires a JSON evidence schema not populated
                             this session; recorded as structured OBSERVATION/MEASUREMENT/
                             INFERENCE/DECISION text instead of fabricating a receipt shape)
Darwin lineage identity:    not run (see Darwin Results — binary gate, no tunable parameter)
```

Verifier procedure: take the report content as it existed immediately before this Witness
section was written in (the file `/tmp/dream-gist-2026-10-01.md`), compute SHA256, concatenate
with the session commit, compute SHA256 again — result must equal the witness stamp above.

## Recommended Next Steps

1. Consider whether the stdio transport's `PolicyEnforcer` (audit+rate-limit only) should grow an actual identity/permission check analogous to `ToolAuthorizer` — today stdio has logging but no "who is allowed to call what," same gap class, lower urgency since stdio is pipe-local by construction.
2. `createMCPServer()`'s `requireToolAuthorization`/`toolAuthorizer` parameters are production-ready but have zero real authorizer implementations anywhere in `v3/` (only the package's own tests exercise them) — a future night could build one real `ToolAuthorizer` (e.g., a shared-secret bearer-token check) for operators who need actual remote MCP access rather than just a refuse-to-start guard.
3. Audit other `createMCPServer`/`MCPServerManager` call sites (programmatic API, tests, any future SDK entry point) to confirm none of them construct a non-loopback HTTP server bypassing tonight's CLI-level gate — tonight's fix is scoped to the one production call site in `mcp-server.ts`.
