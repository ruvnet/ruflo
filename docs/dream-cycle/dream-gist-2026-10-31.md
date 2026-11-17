# Security SOTA Report — 2026-10-31

**TL;DR**: OWASP's official Agentic AI Top 10 (published Dec 9 2025 by the OWASP GenAI Security Project, 100+ reviewers) names ASI03 "Identity & Privilege Abuse" — delegated permissions and agent-to-agent trust get exploited to reach access an agent shouldn't have — as a top-tier agentic risk, and a June 2026 Cloud Security Alliance piece on multi-agent zero-trust architectures flags exactly this pattern: meshes that inherit authorization scopes or make risky trust assumptions about peer messages. Tonight's deep code review found Ruflo's own `@claude-flow/plugin-agent-federation` carries a live instance of this class, carried forward directly from last night's own memory-surface recommendation #3: `PolicyEngine`'s `SecurityPolicy.minTrustLevelForWrite/Memory/Spawn` fields are declared, defaulted, and accept constructor overrides, but `evaluateMessage()` never read any of them — the only trust-level gate was a hardcoded capability table. By *default*, with zero caller override, that table permits federation `memory-query`/`memory-response` messages at `TrustLevel.ATTESTED`, one level below the policy's own stated `minTrustLevelForMemory: TRUSTED` requirement. Fixed tonight with a 40-line, fully tested, independently adversarially-reviewed patch.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| OWASP Top 10 for Agentic AI Applications — ASI03 "Identity & Privilege Abuse": agents operating with more identity/privilege than their task requires; delegated permissions, cached credentials, agent-to-agent trust exploited | OWASP GenAI Security Project, published 2025-12-09, 100+ reviewer peer review (via secondary summaries — primary doc not directly fetched tonight) | B |
| "Securing the Swarm": multi-agent meshes routinely inherit authorization scopes or make risky trust assumptions about peer messages; recommends OPA-style policy checks before every tool/operation call, cryptographic per-agent identity | Cloud Security Alliance, 2026-06-24 | B |
| A 2026 audit of 30 agent frameworks (AutoGen, CrewAI, LangGraph, etc.) reports 93% rely on unscoped API keys as sole authorization — maps to OWASP ASI01/ASI03/ASI10 | Vendor-run study, methodology not independently verified | C |
| `agentgate-pdp` (PyPI): child-agent authorization must be checked at *both* registration time and call time — a child can never exceed what its parent was authorized for, enforced live, not just declared | PyPI package description | C |
| arXiv 2602.10465 "authenticated workflows": thin per-framework authorization adapters for CrewAI/AutoGen/LangChain/OpenAI; self-reported 100% recall / 0 false positives across 174 cases | Single paper, author-reported results, not independently reproduced | C |

## Ruflo Current Capability

`@claude-flow/plugin-agent-federation`'s `PolicyEngine` (`src/application/policy-engine.ts`) is Ruflo's real zero-trust gate for cross-node federation messages: a numeric 5-level `TrustLevel` enum, a hardcoded `CAPABILITY_GATES` table mapping trust level to allowed operations (`trust-level.ts`), a claims check, message-size limits, and per-node rate limiting — more structured than most competitors' "unscoped API key" baseline. But `SecurityPolicy`, the one piece meant to be *configurable per deployment*, was decoration: `minTrustLevelForWrite`/`Memory`/`Spawn` were declared, defaulted, merged from constructor overrides into `this.securityPolicy`, and never read anywhere (confirmed by exhaustive grep — zero read sites before tonight). Same "declared-but-dead-config" anti-pattern last night's gist fixed in the memory package (`ControllerRegistry.set()`), explicitly flagged there as reproduced here and picked up directly tonight.

## Competitor Comparison

| Competitor | Mechanism | Config → enforcement actually wired? | Grade |
|---|---|---|---|
| LangGraph / AutoGen / CrewAI (per 2026 framework audit) | Mostly unscoped API keys as sole authorization; no per-operation trust tiers | N/A — no comparable tiered policy exists to drift from | C |
| OWASP ASI03 reference mitigation | Short-lived SPIFFE-style tokens, just-in-time provisioning, independently revocable per-agent identity | Prescriptive guidance only, not a specific product | B (as guidance) |
| `agentgate-pdp` (PyPI) | Explicit design principle: check authorization at registration AND call time, not just declaration time | Yes, by design intent (not independently verified in production) | C |
| Cloud Security Alliance "Securing the Swarm" | Recommends OPA-style policy evaluation gating every agent operation | Prescriptive guidance, not Ruflo-comparable code | B (as guidance) |
| **Ruflo (pre-fix)** | `SecurityPolicy` fields declared + defaulted + overridable | **No — zero read sites** | — |
| **Ruflo (post-fix, tonight)** | Policy thresholds now read and enforced as an additional AND-gate layered on the hardcoded floor | **Yes** | — |

**Why this isn't "None across the board"**: this is a Ruflo-specific wiring bug, not an industry-gap claim — the useful comparison is normative (what OWASP/CSA say the property *should* be), not another product with the identical defect. No competitor writeup names a comparable "declared-but-unenforced policy" bug; ASI03/CSA explain why the gap matters even though no one names Ruflo.

## Hypothesis

> Given `PolicyEngine.evaluateMessage()`'s trust-level gate, which before tonight consulted only the hardcoded `CAPABILITY_GATES` table and never `securityPolicy.minTrustLevelForWrite/Memory/Spawn`, when a per-message-type policy-category check is added comparing `trustLevel` against the configured threshold (layered on top of, not replacing, `CAPABILITY_GATES`), then a `memory-query`/`memory-response` message from a peer at `TrustLevel.ATTESTED` should be rejected by default (matching `minTrustLevelForMemory: TRUSTED`), and a constructor-supplied override should actually change behavior — subject to: zero change to `CAPABILITY_GATES` itself (a loosened override must never bypass that floor), zero regression to the existing 667-test suite, deterministic $0 Vitest evaluation. Frozen before evaluation.

## Benchmarks

No agent-task benchmark corpus applies — a unit-level authorization-wiring fix, evaluated via discriminating Vitest tests (stash-isolated baseline-fails/candidate-passes), the established convention in this repo for non-routing/non-topology correctness fixes (e.g. 2026-10-28, 2026-10-19). `.harness/bench.json` does not exist in this checkout (`.harness/` holds only `README.md`/`manifest.json`/`mcp-policy.json`).

## Evaluation

**evaluated: accepted — ACCEPT-scoped.** Real evaluator: Vitest 4.1.9, package `@claude-flow/plugin-agent-federation`.

10 new discriminating tests added (`__tests__/unit/policy-engine.test.ts`): default-policy memory-query/response rejected at ATTESTED, allowed at TRUSTED; write/spawn paths unchanged at existing defaults; `status-broadcast` (no policy category) unaffected; a tightened override rejects; a loosened override allows *only where the hardcoded floor permits it* (spawn below PRIVILEGED stays denied even with a loosened policy — defense in depth).

Stash-isolated baseline (`policy-engine.ts` reverted only): **3/10 new tests fail exactly as predicted** (memory-query/response wrongly allowed at ATTESTED; a tightened override has zero effect). Candidate: **10/10 pass**. Full package suite: **677/677 pass both ways except those 3 discriminating failures on baseline** (29 files, 0 regressions). `tsc --noEmit`: 5 pre-existing, unrelated module-resolution errors (`@claude-flow/shared/src/plugin-interface.js` unresolved, an artifact of installing this package's deps in isolation rather than the full pnpm workspace) reproduce byte-identically both ways; `policy-engine.ts` itself has 0 errors either way.

An independent adversarial critic (fresh context, re-read the code from scratch, re-ran stash-isolation and the full suite itself) returned **CONFIRMED** on the core bug and **PASS** on shippability, and disclosed one scope caveat not fixed tonight: `DEFAULT_SECURITY_POLICY.allowedMessageTypes` lists only 9 of 16 `FederationMessageType` values — it omits `claim-event`/`agent-handoff`, so those are rejected at the first gate regardless of trust level at the one production call site (`plugin.ts:289`, no override). The `'write'`/`'spawn'` categories this fix adds for those two types are therefore **unreachable in production** until a future `allowedMessageTypes` change — disclosed, not fixed. The fixed gap that **is** live today (`memory-query`/`memory-response`, `task-assignment`, `context-share`, `agent-spawn`) covers message types already in the default allow-list. No reward-hacking: diff touches zero existing tests/thresholds/gold data; the effect is reproducibly tied to the code change via stash isolation.

**Security note**: this closes a real "fail-open relative to stated intent" gap for federation memory messages — default behavior now matches what the default policy already claimed, and any deployer who set a `SecurityPolicy` override believing it was enforced will find it now actually is (a visible behavior change on live federation message-handling code, untested against production traffic under the stricter gate — flagged for human reviewer attention, not a blocker).

## Darwin Results

Skipped — binary authorization-wiring/correctness fix (a threshold is either consulted or it isn't), not a continuous/categorical parameter Darwin's bounded-evolution interface can search over. Same skip class as nearly every ACCEPT in this repo's dream-cycle history that wasn't a routing/topology weight (e.g. 2026-10-28, 2026-10-19, 2026-10-13).

## SOTA Proof & Witness

Session commit: 0d94037eb149967cba66daad2898563892c53a02
Candidate commit: a85efdf53a56fcda18bae53237ac6486bae38223
Gist SHA-256 (pre-witness, this block held to the literal text `PENDING`): 649c17caa33b8994c33291bf172ab5e3fcdc7492808f3a7f02b164737ca4c8db
Witness stamp: af2860e12f00ccd3bd57caa9dec207341ac340e23f07e88b3d86d4ff9cc49449

Verifier: fetch this file, replace this block's three dynamic values (Candidate commit, Gist SHA-256, Witness stamp) with the literal text `PENDING` (as they were before this computation; Session commit is fixed from STEP 0 and is not blanked), SHA-256 the result, concatenate with the Session commit above, SHA-256 again — must equal the Witness stamp.

Evaluation receipt identity: 10 new tests in `policy-engine.test.ts`, stash-isolated 3/10-fail-baseline → 10/10-pass-candidate; full suite 677/677 both ways except the 3 discriminating failures on baseline (29 files, 0 regressions) — independently reproduced from scratch by a fresh-context adversarial critic, who confirmed the core bug and disclosed one real scope caveat (see Evaluation). Flywheel evidence identity: none (`.claude-flow/flywheel/` doesn't exist in this repo). Darwin lineage identity: none (skipped — binary wiring fix, not a tunable parameter).

## Recommended Next Steps

1. **Add `claim-event`/`agent-handoff`/`challenge*`/`handshake-*`/`session-terminate` to `DEFAULT_SECURITY_POLICY.allowedMessageTypes`** (or confirm deliberate exclusion). Until then, ADR-101's claim-federation message types, and tonight's new write/spawn coverage for them, stay unreachable at the production call site. Not done tonight — changing the allow-list is a materially different, higher-risk change than wiring an existing-but-dead field.
2. **Extend the same mechanism to admin operations** (`trust-change`/`topology-change`) — these fall through to the `'send'` operation (ATTESTED floor) with no policy-configurable floor, same gap class as tonight's fix but for trust escalation itself. `SecurityPolicy` has no `minTrustLevelForAdmin` field yet.
3. **Reconcile `@claude-flow/security`'s and `@claude-flow/cli`'s own, differently-named `PolicyEngine`-style classes against this one** — three same-concept classes across three packages is worth a future architecture-review night, flagged here rather than investigated tonight.
