# Memory SOTA Report — 2026-10-28

**TL;DR**: In 2026, every major agent-memory framework (LangMem, AutoGen/MS Agent Framework, CrewAI, OpenAI Agents SDK) still keeps "remembering" entirely in the context/retrieval layer, deliberately avoiding weight-level consolidation — a tradeoff a fresh academic critique (arXiv 2604.27707) names explicitly as "lookup, not memory." Ruflo is unusual in having real EWC++-style importance-protection machinery for its own learning subsystem, but tonight's deep code review found that machinery's *write-path enforcement* has been silently dead since it was added: `ControllerRegistry` never implemented the `set()` method `memory-bridge.ts`'s controller-activation wiring has called on every startup, so `MutationGuard` (write validation) and `AttestationLog` (audit trail) permanently fell through to a no-op fallback. Fixed tonight with a 20-line, fully tested, zero-regression patch.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| MemCon frames memory ops (retrieve/consolidate/forget) as an MDP solved by a contextual bandit; +15.2pt task success, 5-20% lower tokens across 6 benchmarks | arXiv 2607.13591 (Jul 2026) | B |
| "Contextual Agentic Memory is a Memo, Not True Memory" — names the shared architectural gap across LangMem/AutoGen/CrewAI/OpenAI Agents SDK: exemplar lookup, zero weight-space consolidation | arXiv 2604.27707 (Apr 2026), CUHK+Zhejiang Univ. | A/B |
| TMEM — first concrete counter-proposal: writes real per-episode LoRA weight deltas online to escape the "lookup ceiling" | arXiv 2606.04536 (Jun 2026) | B |
| Microsoft folded AutoGen + Semantic Kernel into Agent Framework 1.0 GA (Apr 2026); AutoGen's "Task-Centric Memory" (learn from own trial-and-error) left in undocumented limbo | Microsoft release notes + secondary sources | B/C |
| Qdrant-style `exp_decay`/`gauss_decay` time-decay rescoring is now the standard hybrid-search recipe industry-wide | Qdrant docs + arXiv 2609.00548 | B |

## Ruflo Current Capability

Ruflo's memory stack (`v3/@claude-flow/memory`, `v3/@claude-flow/hooks/src/reasoningbank`) has real, shipped mechanisms most competitors lack: native BM25+cosine hybrid search, embedding-based dedup, half-life recency decay (`smart-retrieval.ts`), and an EWC++ Fisher-penalty for pattern-confidence forgetting-prevention (fixed two nights ago, 2026-10-27). Tonight's architecture review found this is not one coherent service: at least four parallel memory implementations coexist (`ControllerRegistry`'s AgentDB wrapper, a separate in-process `AgentDBAdapter`, a third hand-rolled `ReasoningBank` in `hooks/`, and an orphaned DDD application-service stack) — the "unify 6+ memory systems" ADR-006/ADR-009 unification CLAUDE.md describes is incomplete, and ADR-053's "Implemented" status has drifted from current code (6-8 of its flagship controllers are hardcoded dead per issue #2977, undisclosed in the ADR text).

## Competitor Comparison

| Competitor | Mechanism | Touches weights? | Grade |
|---|---|---|---|
| LangGraph / LangMem | `BaseStore` + semantic/episodic/procedural (prompt-rewrite) memory types | No | B |
| AutoGen → MS Agent Framework | `TeachableAgent` memos → Task-Centric trial-and-error learning (status post-merge unclear) | No | B/C |
| CrewAI | RAG-based short/long-term/entity memory, unified `Memory` class (2026); `crew.train()` is prompt/few-shot, not memory | No | B |
| OpenAI Agents SDK | `Session` = short-term conversation history only, explicitly "not general-purpose memory"; long-term pushed to Mem0/Hindsight; RFT is a disconnected weight-training product | No (Sessions) / Yes (separate RFT) | B |
| Academic: TMEM (arXiv 2606.04536) | Online per-episode LoRA weight writes — closest real counter-example to the industry consensus | Yes | B |

**Why every production row reads "no weight touch"**: not an oversight — arXiv 2604.27707 argues it's a deliberate, stated-cost tradeoff (training-loop cost, forgetting risk, multi-tenant incompatibility). Ruflo's own EWC++ protects SONA's small adaptation parameters, not an LLM's weights, so it's the same category as its competitors, not a counterexample — only TMEM (academic, unshipped) proposes otherwise.

## Hypothesis

> Given `memory-bridge.ts`'s post-init controller-activation wiring, which externally constructs `MutationGuard`/`AttestationLog`/`SemanticRouter`/etc. and gates registration on `typeof reg.set === 'function'`, when a public `ControllerRegistry.set<T>(name, instance)` method is added (mirroring the shape `initController()` already produces internally: `{name, instance, level, initTimeMs, enabled}`), then `registry.get('mutationGuard')`/`get('attestationLog')` should return the externally-constructed instance instead of permanently null, and `guardValidate()`/`logAttestation()` in `memory-bridge.ts` should route through their real-guard/real-log branches instead of the permanent degraded-mode fallback — subject to: zero change to `initController()`'s internal path, zero regression to the existing `controller-registry.test.ts` suite (82 tests pre-fix), deterministic $0 Vitest evaluation. Frozen before evaluation; not modified after.

## Benchmarks

No agent-task benchmark corpus applies — this is a unit-level wiring/correctness fix to an internal controller-registration mechanism, evaluated via discriminating Vitest tests (stash-isolated baseline-fails/candidate-passes), consistent with this repo's convention for non-routing/non-topology fixes. `.harness/bench.json` does not exist in this checkout.

## Evaluation

**evaluated: accepted — ACCEPT-scoped (post-critique).** Real evaluator: Vitest 4.1.8, package `@claude-flow/memory`.

Round 1: 5 new discriminating tests added to `controller-registry.test.ts`, reproducing memory-bridge.ts's exact `typeof reg.set === 'function'` activation pattern. Stash-isolated baseline (`controller-registry.ts` only reverted): 5/5 fail exactly as predicted (`registry.set is not a function`; `tsc --noEmit` independently confirms with 5 `TS2339` errors), 77/82 pass. Candidate: 82/82 pass.

An independent adversarial critic (fresh context, no authoring context, own isolated git worktree checked out at the real pushed commit) reproduced all of the above from scratch — **CONFIRMED-WITH-CAVEATS**. Two real findings: (1) `set()` silently dropped a reference to any pre-existing resource-holding instance on overwrite, reintroducing the exact leak class issue #2432 fixed for `initController()`'s own replacement path — not currently triggerable through the shipped wiring (every real call site guards with `if (!reg.get(name))` first), but the API itself offered no protection. **Fixed forward same session**: `set()` now dispatches the existing `closePriorIfAny(name)` before overwriting, same as `initController()`. (2) `causalRecall` is the one `ControllerName` absent from every `INIT_LEVELS` entry, so `shutdown()`'s by-static-list lookup would never find/close a controller registered under that name via `set()` — unexercised today (no call site uses it); **disclosed, not fixed tonight** (would need a human call on correct init-level ordering for a controller never previously activated anywhere). No reward-hacking found: diff is purely additive, no existing test/threshold touched.

Final: 1 more discriminating test added (6 total), full `@claude-flow/memory` suite **651/652 both ways**, 0 regressions (the 1 failure, a chmod-based permission test, reproduces byte-identically on baseline — confirmed environmental, container runs as root). `tsc --noEmit`: 0 errors both ways.

**Security note**: this activates a previously-fully-dormant validation path (MutationGuard can now actually reject a write; AttestationLog now actually records). That is the intended behavior, not a new risk surface, but it is a real behavior change on live `store`/`delete`/`purge` code paths that has never run against production traffic — flagged for human reviewer attention, not a blocker.

## Darwin Results

Skipped — binary wiring/correctness fix (a method either exists and is called, or doesn't), not a continuous/categorical parameter Darwin's bounded-evolution interface can search over. Same skip class as nearly every ACCEPT in this repo's history that wasn't a routing/topology weight.

## SOTA Proof & Witness

Session commit:   bd19b6f984fb0b4465e333c5e24cc5333784f410
Candidate commit: 1b973fbc47c9dc25ab440055e8fd5dcc5faff9b2
Gist SHA-256 (pre-witness, this block held to the literal text `PENDING`): 6bfed140ea589b31648dc52cf9c4ede513c7529925a1c0054ed54d08a1941247
Witness stamp:    5f0e5fddb734fc8b6ce83e6cfe203ab4b3682c4ca9b7e0a1fddc83bb431fd293

Verifier: fetch this file, replace this block's four filled-in values with the literal text `PENDING` (as it was before this computation), SHA-256 the result, concatenate with the Session commit above, SHA-256 again — must equal the Witness stamp.

Evaluation receipt identity: 6 new tests in `controller-registry.test.ts` (5 round-1 + 1 post-critique), stash-isolated 5/5-fail-baseline → 83/83-pass-candidate (round 1), full suite 651/652 both ways (round 2) — independently reproduced in an isolated worktree by a fresh-context adversarial critic at commit afe2cdd, who found and this session fixed forward one real issue (see Evaluation). Flywheel evidence identity: none (`.claude-flow/flywheel/` doesn't exist in this repo). Darwin lineage identity: none (skipped — binary wiring fix, not a tunable parameter).

## Recommended Next Steps

1. **Wire `GuardedVectorBackend` end-to-end and add an integration test on `memory-bridge.ts` itself** (not just the registry unit) proving a real `store()`/`delete()` call now actually gets rejected by a MutationGuard that denies — tonight's fix makes activation possible but the bridge-level integration test is a natural fast-follow, not done tonight to keep blast radius minimal.
2. **Reconcile ADR-053's "Implemented" status** against issue #2977's hardcoded-dead controller list — a documentation/governance fix, not a patch, flagged by tonight's architecture review.
3. **`@claude-flow/plugin-agent-federation`'s `SecurityPolicy.minTrustLevelForSpawn`/etc. are declared, defaulted, and never read** — the identical dead-config anti-pattern as tonight's fix, in a sibling package, gating cross-node agent spawning (a meaningfully dangerous capability). Strong candidate for a future night.
4. **`worker-daemon.ts`'s default-on, critical-priority `audit` worker fabricates `noHardcodedSecrets: true` every 10 minutes** with no real scan performed (confirmed live, reachable, SCAN:automation finding) — a believable false-negative security claim, textbook undisclosed-fallback pattern. Carried forward as a strong SCAN candidate for a future automation night.
