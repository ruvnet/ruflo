# Security SOTA Report — 2026-10-06

TL;DR: Tonight's `security` deep-dive narrows a detection gap. The advisory `.claude/settings.json` risk scanner shipped 2026-08-16 (`settings-risk-scanner.ts`) was wired into `ruflo init`/`--upgrade` only (grep-confirmed, the sole call sites). `hooksSessionRestore`'s handler now also runs the same, unmodified scan, for an explicit `ruflo hooks session-restore` call or an MCP client calling `hooks_session-restore` — advisory only. An independent adversarial critic caught the original claim ("closes the gap for any later session") overstating its reach: the automatic `SessionStart` hook fired for every real session runs a separate generated/signed helper template (`hook-handler.cjs`/`session.cjs`) this scan doesn't touch; extending there is a larger, separate-night change, disclosed as Next Step #1, not dropped. External research (Grade C) names a March–May 2026 campaign ("TeamPCP") weaponizing this exact persistence shape; the code gap itself is Grade A. Four further findings from tonight's research are recommended below.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| OWASP published the Top 10 for Agentic Applications 2026 (ASI01–ASI10), 2025-12-09 — ASI02 Tool Misuse, ASI03 Identity Abuse name least-privilege/default-deny tool scoping as the top mitigation; ASI07 Insecure Inter-Agent Communication and ASI10 Rogue Agents are separate, explicitly *unresolved* categories | genai.owasp.org (official), cross-checked vs. 5+ independent secondary write-ups | B |
| MCP ships with **no authentication in the base protocol by design**; 40+ CVEs against MCP SDKs Jan–Apr 2026, ~200k exposed servers estimated; CVE-2026-33032 (Nginx-UI MCP, CVSS 9.8); CVE-2026-59822 (LiteLLM MCP, first MCP flaw in CISA KEV) | mcp.directory, CSA labs research notes, cross-checked | B |
| MCP's own 2025-06-18 authorization spec revision mandates RFC 9728 + RFC 8707 audience-bound tokens and forbids token pass-through — but authorization is explicitly **OPTIONAL**, and **stdio transport "SHOULD NOT" follow the spec at all** | modelcontextprotocol.io (primary source, direct fetch) | A |
| CrewAI: CERT/CC VU#221883 discloses 4 CVEs (2 RCE, 1 arbitrary file read, 1 SSRF) rooted in an **insecure fail-open fallback** (Code Interpreter falls back to an RCE-exploitable sandbox when Docker is unavailable, instead of refusing). Microsoft AutoGen Studio: "AutoJack" (2026-06-18) — missing-auth-middleware-on-an-HTTP-tool-surface → unauthenticated host RCE from a single web page (dev-branch only, never shipped on PyPI) | CERT/CC (official, direct fetch); CSA research note + BleepingComputer + TheHackerNews (independent corroboration) | A |
| "Can AI Agents Agree?" (arXiv 2603.01213, ICML 2026) and a companion Self-Anchored-Consensus paper: classical BFT/Raft guarantees do **not** transfer cleanly to LLM multi-agent voting — failures are dominated by **loss of liveness** (stalled/timeout), not value corruption, and worsen with group size | arXiv, ICML-accepted | A |
| Single-source (Grade C): a campaign tracked as "TeamPCP" (Mar–May 2026) compromised 170+ npm/PyPI packages and injected modified `.claude/settings.json` files to exploit Claude Code's `SessionStart` hook as a persistence/re-execution mechanism | CSA labs research-note cluster only — no second independently-operated outlet found in the time available | C |

## Ruflo Current Capability

`.harness/mcp-policy.json` declares a default-deny MCP governance posture, but an independent architecture review (file:line verified at `main` @ `ca421287d`) found its headline fields (`defaultDeny`, `requireApprovalForDangerous`, `dangerousPatterns`) have **zero production consumers** — only `auditLog` and the sliding-window rate limit are wired (`policy-enforcer.ts`), stdio-only, opt-in via an undocumented env var, with HTTP/WebSocket (`startHttpServer()`) never calling the enforcer. The deep-dive confirmed this HTTP gap is broader than the still-open draft PR #3599 describes: the CLI never constructs an `auth` config at all, so `http.ts`'s fail-open branch is reachable unconditionally, even on loopback. Hive-mind consensus already has a real, shipped Sybil-resistance fix (hiveToken capability binding, #3290/#3291/#3338/#3339) — one of the few comparable systems in this scan to even have a voting primitive worth attacking.

## Competitor Comparison

| System | Tool-authz default posture | Anti-Sybil for multi-agent consensus | Grade |
|---|---|---|---|
| **Ruflo** | `.harness/mcp-policy.json` declares default-deny; HTTP transport is unconditionally fail-open in practice (confirmed) | Hive-mind join/leave/vote capability-token-bound (shipped) | A (direct repo read) |
| **MCP spec itself** | Authorization OPTIONAL; stdio "SHOULD NOT" implement it | N/A (client↔server model, not agent↔agent) | A (primary spec text) |
| **LangChain/LangGraph** | Default-allow; least-privilege is advisory docs, not enforced | No native voting/consensus primitive | B |
| **AutoGen (Microsoft)** | Default-allow; sandboxing is operator-side, not framework-enforced (see AutoJack) | No native voting/consensus primitive | A |
| **CrewAI** | Default-allow-on-failure (CERT/CC VU#221883: insecure fallback, 4 CVEs) | No native voting/consensus primitive | A |
| **OpenAI Agents SDK** | Default-allow unless a tool explicitly sets `needsApproval` | No native voting/consensus primitive (handoff-based orchestration) | B |

Column 3 reads "N/A" for most competitors because their "multi-agent" patterns are orchestration, not quorum agreement among authenticated peers — no vote exists to forge. OWASP's ASI07/ASI10 confirm this is an unresolved, industry-wide gap once a system *does* add real consensus, which is Ruflo's case. Ruflo's default-deny posture and Sybil-resistant consensus are genuine, narrow leads; its MCP-HTTP auth is parity-at-best (same root cause as AutoJack).

## Hypothesis

Given a `.claude/settings.json` containing a hook or allow-rule matching an existing `STANDALONE_RISK_PATTERNS`/`DANGEROUS_COMMAND_WORDS`/`RISKY_PREAPPROVE_WORDS` entry in `settings-risk-scanner.ts`, when the already-shipped, already-tested `scanSettingsForRisk()`/`formatRiskFindingsAsWarnings()` functions are also invoked from `hooksSessionRestore`'s handler (today: only `ruflo init`/`--upgrade` call them), then an explicit `ruflo hooks session-restore` call or an MCP client calling `hooks_session-restore` should surface an advisory warning via the handler's existing `warnings` field, where today there is silence, subject to: (1) no change to detection logic/patterns; (2) advisory-only — no enforcement, no change to which hooks actually execute; (3) `init`'s existing three call sites unaffected; (4) all existing tests remain green; (5) deterministic, $0 evaluation, zero LLM calls. Frozen before evaluation; not modified after.

Scope corrected post-critique (see TL;DR) — this hypothesis text already reflects the narrowed claim, not the original overclaim.

## Benchmarks

No `.harness/bench.json` corpus exists for this surface. Binary detection-wiring fix, same evaluation shape as nearly every prior accepted security-night candidate (#3043, #3102, #3138/#3139, #3151/#3152, #3290/#3291, #3384/#3385) — evaluated via discriminating unit tests, not a benchmark corpus.

## Evaluation

**evaluated: accepted (scoped, post-critique).** 6 new discriminating tests (`session-restore-settings-risk-scan.test.ts`: risky hook/allow-rule → warning; clean/missing/malformed settings.json → no risk warnings; composes correctly with the existing in-progress-task warning). Stash-isolated baseline: 3/6 fail exactly as predicted; the 3 non-discriminating controls pass both ways. Full `@claude-flow/cli` suite, byte-identical FAIL-line diff (full, untruncated logs): candidate 16 failed files/20 failed tests/4236 passed; baseline 17/23/4233 — the *only* difference between the two full failure lists is this candidate's own 3 discriminating tests. `tsc --noEmit`: byte-identical 9 pre-existing errors both ways. Independent critic reproduced the same numbers, found the scope-overclaim (fixed same session), confirmed no reward-hacking, no new attack surface, no scanner changes.

## Darwin Results

Skipped — binary wiring fix, not a continuous parameter with a fitness gradient for Darwin's real interface to search over. Same skip class as nearly every accepted security-night candidate since 2026-08-18.

## SOTA Proof & Witness

See the Witness section of the linked issue/PR for the full reward-hack checklist, adversarial critique, security review, and witness stamp — not duplicated here to keep this report under the word budget.

## Recommended Next Steps

1. **This fix**: human review and merge. Disclosed remaining gap: doesn't reach the automatic `SessionStart` path (`hook-handler.cjs` → `session.cjs`), only explicit `session-restore` calls. Wiring the generated/signed helper templates is a separate, larger night's work (real prior incidents: #3411/#3412; live concurrent-session helper corruption was observed twice during tonight's own evaluation).
2. **MCP HTTP/WebSocket transport ships unconditionally unauthenticated** (deep-dive Candidate 1, architecture-review Finding 1): `createMCPServer()` is never given an `auth` config, so the fail-open branch is reachable even on loopback — broader than the already-open, 5-day-stale draft PR #3599 describes. Post as a comment/amendment on #3599 rather than a competing PR; a human decision is already pending there.
3. **Hive-mind consensus quorum denominator recomputed live, not frozen at proposal time** (architecture-review Finding 2, deep-dive Candidate 3): `totalNodes = state.workers.length` is read fresh on every vote/status/list call in `hive-mind-tools.ts` rather than captured once at `propose` time — membership churn mid-vote can flip which side reaches quorum first. Small (~20-60 line), single-file fix; good next `security` or `swarm` night candidate.
4. **`hiveToken` capability secret persisted world-readable** (architecture-review Finding 3, deep-dive Candidate 2): `saveHiveState()`'s `writeFileSync`/`ensureHiveDir()`'s `mkdirSync` use default umask, not `0o600`/`0o700` — inconsistent with this same codebase's own `policy-enforcer.ts` audit-log hardening pattern. Trivial (<10 line) fix, independently flagged by two separate agents tonight plus the 2026-10-05 gist.
5. **`AgentPool.acquire()`'s scale-up path produces agents invisible to `MessageBus`** (swarm scan, live-reproduced): `assignTaskToDomain()` dispatches to an auto-provisioned agent never `registerAgent()`'d/`subscribe()`'d; the message queues and is never delivered or TTL-expired, leaving the task stuck in `'assigned'`. Distinct from, and not covered by, the still-open #3538/#3539 fix.
6. **SONA's LoRA write-back path remains fully disconnected from gradient computation** (intelligence scan finding): confirmed still open post-#3622, and `batch.js`'s mode now computes a real EWC-penalized gradient and discards it via `gradient.fill(0)` rather than ever applying it to `LoRAWeights.A`/`.B`. Before any future night spends a cycle wiring this up, worth deciding intent first: implement the missing write-back (per Online-LoRA/CL-LoRA, WACV/CVPR 2025), or treat it as vestigial scaffolding given Letta/Mem0/Zep have each converged on memory-editing over weight-updating for continual adaptation, and Ruflo's own HNSW+ReasoningBank memory layer already does that job.

## Witness

| Field | Value |
|---|---|
| Session commit (STEP 0) | `ca421287d56269406b450c2ed9595ebae6cffe9e` |
| Candidate commit | see linked PR's head commit |
| Gist SHA-256 (pre-witness content, this table's values stripped to `PENDING`) | `48e3ad1cf940ddf51459fc927f5a2c233e446f4401034ba50eeb28591840d99a` |
| Witness stamp | `06aaea840dbf31974a1efa728089f0192e5252ade56e67b8e0e53608c3090e7e` |

Verifier: fetch this gist, strip this table's filled values back to `PENDING`, SHA-256 the file, concatenate with the session commit above, SHA-256 again — must equal the witness stamp.
