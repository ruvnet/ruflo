# Security SOTA Report — 2026-11-26

TL;DR: `.harness/mcp-policy.json`'s `allowShell: false` / `allowNetwork: false` / `allowFileWrite: false` have been purely decorative since the policy file was written — nothing in `policy-enforcer.ts` ever read them, on the premise that shell/network/filesystem access "is NOT in this server's tool surface." Two independent research passes tonight traced the real tool handlers and found that premise false: `terminal_execute` runs `execSync` on caller-supplied input, `http_fetch` performs raw outbound HTTP(S), and `hooks_fast-apply`/`hooks_codemod` write files directly — all inside this MCP server's own ~300-tool surface, not Claude Code's separate Bash/Write/WebFetch layer. This is the fourth consecutive dream-cycle night this gap was disclosed (since 2026-10-26) and the first night it was actually fixed: `evaluateToolCall()` now denies calls to those four named tools when the corresponding flag is `false` and enforcement is opted in (`RUFLO_MCP_ENFORCE_POLICY=1`).

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| MCP "tool poisoning" (malicious instructions hidden in tool descriptions/schemas, not user input) is OWASP's own MCP03:2025 category and the most prevalent client-side MCP vulnerability class | OWASP MCP Top 10; arXiv:2603.21642 (7-client study); Trail of Bits (2025-04-21) | B |
| OWASP's MCP04:2025 "software supply-chain attacks" — ~3,500+ MCP servers on Smithery.ai, 92% unverified; a cloned/trojanized "Oura Ring" MCP server shipped a functionally-identical fork before activating a payload | OWASP MCP04:2025; UpGuard; Straiker/NHI Mgmt (Feb 2026) | B |
| Simon Willison's "lethal trifecta" (private-data access + untrusted-content exposure + external-comms channel) plus the MCP spec's own `security_best_practices` page, which documents tool annotations as advisory-only, not security boundaries | simonwillison.net (Jun 2025 + 2026 follow-ups); modelcontextprotocol.io spec | A |
| A March 2026 empirical study of 7 real MCP clients found very different real-world exposure to cross-tool/tool-poisoning injection under the same protocol (Claude Desktop strongest guardrails; Cursor highly susceptible) | arXiv:2603.21642 | B |
| Anthropic acknowledged a Cato Networks MCP "confused deputy" finding (Nov 2025) mapped to the spec's own named scenario; no public confirmation found of what shipped | Cato Networks (2025-11-13); MCP spec | C |

## Ruflo Current Capability

`.harness/mcp-policy.json` is a single, versioned, machine-readable governance artifact — `defaultDeny`, `allowShell`/`allowNetwork`/`allowFileWrite`, `requireApprovalForDangerous`, `auditLog`, regex `dangerousPatterns`, and wall-clock rate limiting (`maxToolCallsPerTurn`/`turnWindowMs`). Until tonight, only `auditLog` and the rate limit were actually enforced (`policy-enforcer.ts`, opt-in via `RUFLO_MCP_ENFORCE_POLICY=1`, stdio dispatch only); `allowShell`/`allowNetwork`/`allowFileWrite` were declared but never read by any enforcement branch anywhere in the codebase — confirmed by grep, the only hits were the interface declaration and a comment explaining they were "intentionally left unenforced" on the (false) premise that shell/network/filesystem access doesn't happen inside this MCP server. Tonight's fix wires those three fields against a small, explicitly-traced table (`MCP_TOOL_CAPABILITY`) of the four tools proven to need it. The already-disclosed, not-yet-fixed scope limit remains: the separate HTTP/WebSocket dispatch path (`startHttpServer()`, via `@claude-flow/mcp`) never calls this enforcement module at all, with or without the env flag.

## Competitor Comparison

| Framework | MCP / tool-authority security posture | Source | Grade |
|---|---|---|---|
| LangGraph | No native per-tool MCP authorization layer; sensitive actions gated only via the generic `interrupt()` human-in-the-loop primitive. Scoped credential issuance is filled by a third party (Arcade.dev), not shipped. | Arcade.dev; Permit.io | C |
| AutoGen / AG2 | No built-in credential broker or MCP tool-scoping; isolation is pushed to Docker/Daytona sandboxed code execution instead — a deliberate architectural choice, not an oversight. | arXiv:2509.08646; docs.ag2.ai | B |
| CrewAI | No built-in MCP authorization engine or audit log. Official docs explicitly tell users to "only connect to MCP servers you fully trust" — a named, acknowledged gap, deferred to third-party add-ons. | docs.crewai.com/MCP Security (official) | A (for the official text itself) |
| OpenAI Agents SDK | Strongest native human-in-the-loop model: `require_approval` pauses execution with resumable `RunState`. A practitioner critique notes approval ≠ authorization — no persistent re-scoping, credentials typically app-embedded. | developers.openai.com (official); independent critique | A / C |

Ruflo's own policy sits **ahead** of LangGraph/CrewAI on having a single declarative, audited policy artifact at all, roughly **at parity** with OpenAI's SDK on "require approval before dangerous actions," and **behind** it on resumable per-tool approval state. Tonight's fix closes the specific split-enforcement gap researchers name as where "advisory, not security boundary" controls get exploited: a flag that looks like it governs a capability but doesn't.

## Hypothesis

> Given the claude-flow MCP server's opt-in policy enforcement (`RUFLO_MCP_ENFORCE_POLICY=1`, `evaluateToolCall()`), where `.harness/mcp-policy.json` declares `allowShell: false` / `allowNetwork: false` / `allowFileWrite: false` but these fields are never read by any enforcement code — confirmed decorative, independently, by two research roles with file:line evidence that `terminal_execute` (shell), `http_fetch` (network), and `hooks_fast-apply`/`hooks_codemod` (filesystem) are registered MCP tools performing these operations directly — when `evaluateToolCall()` is extended to check a tool-name→capability table against the matching `allow*` flag and deny when it is explicitly `false`, then calling those four tools under the existing committed policy with enforcement enabled should be denied (which it currently is not), while every other registered tool and every existing enforcement behavior (budget, audit log, fail-closed) stays byte-identical, subject to: zero regression to the existing 31-test suite, enforcement stays fully opt-in, and a tool whose flag is left `undefined` keeps today's permissive behavior.

## Benchmarks

Vitest 4.1.8 (`@claude-flow/cli`), run directly against `src/` in a freshly-installed checkout (no `node_modules` existed at session start; `npm install` + `pnpm install` run first). Stash-isolated baseline (reverting `policy-enforcer.ts`/`mcp-policy.json`/`manifest.json`, keeping the new test file): the suite fails to even load (`MCP_TOOL_CAPABILITY` is `undefined`), a hard discriminating failure. Candidate: 40/43 pass — the 3 failures are pre-existing and environmental (tests assert `/nonexistent-dir-xyz/...` is unwritable; this sandbox runs as root, which can create that path; reproduced byte-identical on baseline too, confirmed via a direct `whoami`/`mkdirSync` probe). `tsc --noEmit -p .`: 534 pre-existing errors both before and after (unbuilt monorepo siblings), 0 in either changed file.

## Evaluation

12 new tests (capability-table coverage for all 4 tools, undefined/true-flag permissiveness, budget-isolation on a capability denial, a control proving `memory_store` is unaffected). `harness mcp-scan .` and `harness threat-model .`: MEDIUM (3 findings, 0 high) / clean — byte-identical to the standing baseline (2 pre-existing risky-bash-allow findings, 1 pre-existing unpinned-deps finding; none touch this diff).

**Independent adversarial critique** (fresh-context `reviewer` subagent, own stash/pop reproduction, own `tsc`/mcp-scan runs, own code reads): **CONFIRMED-WITH-CAVEATS**, all non-blocking. New facts it surfaced: `evaluateToolCall()` actually has 3 real call sites sharing one compiled module (`mcp-server.ts:997`, `bin/cli.js:306`, `bin/mcp-server.js:177`) — all three stdio dispatchers, confirming the module's own docstring claim rather than contradicting it. Caveats: (a) the 4-tool `MCP_TOOL_CAPABILITY` table is real but narrow — `github-tools.ts`/`browser-tools.ts` and ~25 more files with `fetch(`/`writeFileSync` are outside it, honestly disclosed, not silently safe; (c) a capability-denied call skips the budget counter but still forces a mandatory audit-log write — an un-rate-limited disk-write path when `auditLog:true`, worth its own follow-up ticket; (d) the separate HTTP/WebSocket dispatcher still never calls this module at all (pre-existing, not worsened). `defaultDeny`, `dangerousPatterns`, and `requireApprovalForDangerous` remain just as unenforced as `allowShell`/`allowNetwork`/`allowFileWrite` were before tonight — not claimed fixed.

## Darwin Results

**Skipped — binary guard, no tunable parameter**, same precedent as every recent structural/correctness fix in this ledger (11-14, 11-23, 11-24, 11-25). The fix is a fixed table of 4 tool→capability mappings resolved by direct code trace, not a continuous or categorical parameter space to search.

## SOTA Proof & Witness

```
Session commit:   48b04dce286a1df4af0411923821cf63399d7c8b
Candidate commit: 1d62958eeebfe92e8d561bf5fc790f8008c76df4
Gist SHA-256 (pre-witness): c5a85dc7c1d5e031bab480590b85d172b2a7b6450db1822128bf6461d04d20ec
Witness stamp:    29d887c85c647d62c34f747f0b56e5f82c858d03c7fd8082c18095d1b162ac58
```
Verifier: fetch this file from the branch, replace the Gist SHA-256 and Witness stamp fields above with the literal text `PENDING`, SHA-256 the result, concatenate with the Session commit value, SHA-256 again — must equal the Witness stamp.

## Recommended Next Steps

1. **Extend `MCP_TOOL_CAPABILITY` to the broader traced surface.** Tonight's research found more direct shell/network/filesystem call sites inside MCP handlers than the 4 fixed tonight: `github-tools.ts`'s `execSync`/`execFileSync`, `browser-tools.ts`'s `execFileSync`, `auto-install.ts`'s `spawnSync`, `memory-tools.ts`'s git `execFileSync`, `metaharness-tools.ts`/`testgen-tools.ts`'s `spawn`, plus 9 files with raw `fetch(` and 22 with raw filesystem writes. Each needs its own capability classification and risk judgment — not safe to batch into one patch.
2. **Wire enforcement into the HTTP/WebSocket MCP dispatcher.** `startHttpServer()` (via `@claude-flow/mcp`) never calls `evaluateToolCall()` at all, with or without `RUFLO_MCP_ENFORCE_POLICY=1` — a disclosed, pre-existing gap, now more consequential since the stdio path actually enforces something real.
3. **PBFT leader-impersonation gap in `byzantine.ts:325-329`** (found tonight by the swarm SCAN, not implemented): `handlePrePrepare()` validates `viewNumber` but never checks `message.senderId` matches the primary computed for that view — any node can broadcast a `pre-prepare` and every receiver accepts it as legitimate. Distinct from the already-known Raft `prevLogIndex` gap; a strong next DEEP=security or DEEP=swarm candidate.

**Scan findings (disclosed, not implemented tonight):** intelligence — `SONAManager`'s EWC-consolidation snapshot method (`getConsolidationSnapshot()`) is implemented by only 2 of 5 SONA modes (`balanced`, `research`); `real-time`, `batch`, and `edge` configure a non-zero `ewcLambda` but never actually run `consolidateEWC()` — catastrophic-forgetting prevention is inert for the lowest-latency modes. swarm — see Recommendation #3 above.
