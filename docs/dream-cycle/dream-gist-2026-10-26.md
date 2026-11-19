# Security SOTA Report — 2026-10-26

TL;DR: `http_fetch`'s SSRF guard (`isPrivateOrLoopback()` in `v3/@claude-flow/cli/src/mcp-tools/http-fetch-tools.ts`) never stripped the `[...]` brackets Node's URL parser keeps in `.hostname` for IPv6 literals. That silently broke two things at once: the existing `fc00::/7`/`fe80::/10` checks never matched anything (dead code since they tested `startsWith('fc'/'fe80:')` against a string starting with `[`), and IPv4-mapped IPv6 literals (`::ffff:127.0.0.1`, `::ffff:169.254.169.254`) sailed through untested — a live, reproduced SSRF bypass reaching loopback and cloud-metadata targets. Fixed by stripping brackets once and decoding IPv4-mapped forms back into the existing IPv4 rules. 13 new tests, independently critiqued (CONFIRMED-WITH-CAVEATS, two pre-existing out-of-scope gaps disclosed in-source). **Verdict: ACCEPT.** 4 deferred candidates (one architecturally significant — `.harness/mcp-policy.json` falsely claims zero shell/network tool surface) and 1 new intelligence-surface finding (EWC++ Fisher map never populated) carried forward.

## What's New in 2026

| Finding | Source | Grade |
|---|---|---|
| 5 independent 2025-2026 CVEs in MCP filesystem/git servers, all symlink/path-containment failures (unresolved-path check vs. symlink-following op) — the official `@modelcontextprotocol/server-filesystem` reference implementation among them | CVE-2025-53110/53109/67366/67364/11489, NVD/GitLab advisories | A |
| IPv4-mapped-IPv6 (`::ffff:a.b.c.d`) is a well-documented SSRF-filter-bypass technique class; reproduced live against Ruflo's own code this session | SSRF cheat sheets, recurring CVE pattern; direct PoC | A (technique, reproduced), B (external sourcing) |
| 2026 agent-framework RCE/SSRF disclosures: CrewAI's Code Interpreter sandbox-fallback chain (CVE-2026-2275/2285/2286/2287, CERT/CC VU#221883) and a later blocklist-bypass (CVE-2026-37008); Microsoft AutoGen Studio's "AutoJack" localhost-trust chain (MSRC-disclosed, no public CVE) | NVD, CERT/CC, BleepingComputer, CSOonline, TheHackerNews | A/B |
| LangGraph SDK path-building CVE (CVE-2026-48776, GHSA-w39p-vh2g-g8g5) and its SDK-level default-deny *authorization* pattern (resource access, not tool-execution sandboxing) | GHSA/NVD, LangGraph SDK docs | A/C |
| No major competitor (LangGraph, AutoGen/MS Agent Framework, CrewAI, OpenAI Agents SDK) publishes a declared, versioned, default-deny MCP/tool-authority manifest comparable to Ruflo's `.harness/mcp-policy.json` — genuine but narrow differentiator (closest analogs are cloud-IAM-layer or per-tool ad hoc sandbox manifests, not framework-level) | Targeted search across all 4 + CIS MCP Companion Guide + Google Cloud MCP IAM docs | B |
| EWC++ continual-learning correctness depends heavily on how Fisher information is estimated — directly relevant once Ruflo's SONA-path Fisher estimation (currently absent, see Scan Findings) is implemented | Van de Ven, ICLR 2025 (arXiv:2502.11756); arXiv:2603.18596 (2026, single preprint) | A / B |

## Ruflo Current Capability

`http_fetch` is ADR-164 §5.1.8's guarded HTTP probe primitive, documented as "DEFAULT-REFUSES private addresses + loopback." `validateUrl()` → `isPrivateOrLoopback()` pattern-matches the lowercased hostname against IPv4 RFC1918/loopback/link-local/CGNAT ranges and a couple of IPv6 special forms. The IPv6 branch was silently broken (bracket-prefix mismatch) and had no IPv4-mapped-IPv6 handling — both closed tonight by one root-cause fix (strip-then-match, with IPv4-mapped forms recursing into the already-correct IPv4 rules rather than duplicating them).

## Competitor Comparison

| Competitor | Approach | Grade |
|---|---|---|
| LangGraph | SDK auth module ships a default-deny code pattern for resource access; no first-party sandboxing/least-privilege doc for tool execution; CVE-2026-48776 (path-building, fixed 0.3.15) | A (CVE) / C (framing) |
| Microsoft AutoGen/Agent Framework | No documented default-deny tool-authority policy; "AutoJack" localhost-trust MCP chain disclosed pre-release, generalizable pattern per Microsoft's own statement | B |
| CrewAI | 4 chained CVEs in Code Interpreter's Docker-sandbox fallback + SSRF/file-read tools; later blocklist-vs-allowlist bypass (CVE-2026-37008); no default-deny policy found | A |
| OpenAI Agents SDK | April-2026 sandbox harness scopes filesystem via Unix-permission manifests — opt-in capability, not a declared default-deny posture | C (mechanism detail community-sourced) |
| MCP reference/community filesystem servers | 5 independent 2025 CVEs, all symlink/path-containment, official reference impl included | A |

## Hypothesis

> Given `http_fetch`'s `isPrivateOrLoopback()` SSRF guard, when IPv6 literals are normalized (brackets stripped) before pattern-matching and IPv4-mapped-IPv6 forms are decoded and re-checked against the existing IPv4 rules, then both the previously-dead ULA/link-local IPv6 checks and the undetected IPv4-mapped-IPv6 bypass should be correctly rejected, with every currently-passing public-hostname/public-IP case unaffected — subject to: zero change to the IPv4 dotted-decimal path, zero regression to existing http-fetch tests, deterministic $0 zero-LLM Vitest evaluation. Frozen before evaluation; not modified after.

**Deferred, not implemented tonight**: (a) `.harness/mcp-policy.json` declares `allowShell:false`/`allowNetwork:false` but `terminal_execute` (execSync) and `http_fetch` itself are live counterexamples — a real documentation-accuracy gap, scored 4.55, but a design question (restrict the tool? gate behind native-Bash approval? fix the doc?), not a clean patch — left for human review; (b) `http_fetch`'s unvalidated-redirect SSRF escalation (`redirect:'follow'` never re-validates `Location`), scored 4.35, same contract, distinct mechanism — fast-follow candidate; (c) terminal env-denylist gap for proxy/TLS-trust vars, scored 3.95; (d) MCP policy enforcement not wired into the HTTP/websocket transport, scored 3.65 (self-disclosed in-source already).

## Benchmarks

No agent-task benchmark corpus applies to a guard-function correctness fix — consistent with nearly every accepted security fix since 2026-08-18, which use stash-isolated discriminating unit tests instead.

## Evaluation

**evaluated: accepted.** Real evaluator: Vitest 4.1.8.

13 new tests in `__tests__/http-fetch-tools.test.ts` (8 discriminating, 5 non-discriminating controls — a public IPv4-mapped address, a public IPv6 literal, and the still-rejects-`::1` regression check). Stash-isolated baseline (`git stash` on just `http-fetch-tools.ts`): **8/8 discriminating tests fail exactly as predicted** (`isPrivateOrLoopback` returns `false`/`undefined`-equivalent for every bypass form); all controls and the 24 pre-existing tests pass both ways. Candidate: **37/37 pass**. Independently reproduced from a fresh context by an adversarial-critic subagent — identical result.

A full `@claude-flow/cli` suite run timed out at 300s with no partial output (environmental, not a hang in changed code). A scoped-but-wider run (5 other mcp/http/policy files, 109 tests) showed 12 failures, confirmed byte-identical on the true pre-fix commit via `git checkout <parent-commit> -- <files>` — all `Error: Failed to resolve entry for package "@claude-flow/mcp"` (unbuilt sibling package), unrelated to this diff. `tsc --noEmit`: zero errors reference either changed file, either before or after (raw aggregate count is noisy here — 80 vs. 510 across repeated runs on the same tree, same unbuilt-sibling cause — disclosed, not relied on).

**Independent adversarial critique: CONFIRMED-WITH-CAVEATS.** Independently reproduced the stash-isolated comparison from scratch, verified the diff is additive-only, confirmed the caller already lowercases input (no uppercase-hex bypass), confirmed the one-level recursion is bounded (not ReDoS-able), and manually re-derived the decode arithmetic against real Node normalization. Checked the IPv4-*compatible* (non-mapped) form `::a.b.c.d` and confirmed it correctly does **not** match the fix's narrow `::ffff:` regex — that deprecated form has no OS-level dual-stack reinterpretation, so leaving it alone is correct. Found two pre-existing, out-of-scope caveats, disclosed in-source: IPv6 `::` (unspecified, the analog of `0.0.0.0`) and multicast/NAT64 ranges remain unblocked.

## Darwin Results

Skipped — binary SSRF-guard correctness fix (bracket-stripping + a decode-and-recurse branch), no continuous/categorical parameter for Darwin's bounded-evolution interface to search over. Same skip class as nearly every accepted fix since 2026-08-18 that wasn't a routing/topology weight.

## SOTA Proof & Witness

Session commit:   631c1557b5f325163c4f9f029a397bb30a61c730
Candidate commit: (this branch's head)
Gist SHA-256 (pre-witness, witness block stripped to PENDING): 0426fc1e1510bada31087763642db85704ec686df8619297e60e8eca19899ae6
Witness stamp:    9294b5d7b79e44df3eff1a779796dfb813e764f79c1dd7dc7d51e30095b80ddc

Verifier: fetch this file, strip this block's filled-in values back to `PENDING`, SHA-256 the file, concatenate with the Session commit above, SHA-256 again — must equal the Witness stamp.

Evaluation receipt identity: 13 new tests in `__tests__/http-fetch-tools.test.ts`, stash-isolated 8/8-fail-baseline → 37/37-pass-candidate, independently reproduced by a fresh-context adversarial critic. Flywheel evidence identity: none (`.claude-flow/flywheel/` doesn't exist in this repo, confirmed, same as every prior night) — retained as this gist, the tests, the stash comparison, and the adversarial critique transcript. Darwin lineage identity: none (skipped, see above).

## Scan Findings: intelligence

EWC++ in `@claude-flow/neural`'s `SONAManager` never consolidates: `ewcState.fisher`/`.means` are initialized empty and never populated anywhere in `neural/src` (confirmed by repo-wide grep — no `.fisher.set(`/`.means.set(` call exists), and the one method that touches `fisher` post-init, `consolidateEWC()`, has zero callers. Every `computeEWCPenalty`/`computeEWCLoss` call therefore iterates a 0-entry map and returns 0 — the "prevents forgetting" EWC term is a silent no-op on every learning cycle, in the production SONA path (`SONAManager` is reachable from `cli/src/ruvector/index.ts` and `cli/src/memory/neural-package-bridge.ts`). Distinct from the already-correct CLI-level `cli/src/memory/ewc-consolidation.ts` heuristic — don't conflate the two. Not implemented tonight (DEEP surface was security); carried forward as a well-scoped candidate for an `intelligence` night.

## Scan Findings: swarm

The 2026-10-25 night's `TopologyManager.calculateInitialConnections()` raw-vs-resolved-role finding (scored 3.70) is **already fixed** — an external contributor's PR #4483 (merged 2026-10-25, citing our own #4481) resolved it the same night it was reported. Verified against current source: `addNode()` now resolves the role before both the connection calculation and the stored `.role` field. No new swarm finding surfaced tonight beyond re-confirming this closure.

## Recommended Next Steps

1. **Fix `http_fetch`'s unvalidated-redirect SSRF escalation** (score 4.35) — `fetch()`'s default `redirect:'follow'` never re-validates the `Location` target through `validateUrl()`, so a public allowed URL that 302s to a private/loopback/metadata address bypasses the entire allowlist. Same file/contract as tonight's fix; natural fast-follow.
2. **Resolve the `.harness/mcp-policy.json` accuracy gap** (score 4.55) — `terminal_execute` and `http_fetch` both exercise shell/network authority the policy's own `$comment` claims this MCP server doesn't expose, and `policy-enforcer.ts` deliberately doesn't enforce `allowShell`/`allowNetwork` against them. Needs a human design decision (restrict the tools, gate them behind native-Bash-equivalent approval, or correct the policy doc), not a unilateral nightly patch.
3. **Implement Fisher-information estimation for `SONAManager`'s EWC++ path** — wire `consolidateEWC()` (currently dead code) into `triggerLearning()`'s post-`learn()` path with a real Fisher/importance estimate, or drop the dead scaffolding and the "prevents forgetting" claim for this specific path.
