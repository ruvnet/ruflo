# Performance SOTA Report — 2026-11-25

TL;DR: `AttentionCoordinator.multiHeadAttentionCoordination()` (`v3/@claude-flow/swarm/src/attention-coordinator.ts`) ran a 2026-era "multi-head attention" loop whose per-head differentiator (`head: number`) was never actually read, so all 8 heads computed byte-identical O(n²) cosine-similarity scores and averaged 8 identical copies — pure wasted work. Fixed by memoizing each `(i,j)` pair's score once per call. Deferred twice: 10-30 scored it 4.60/5 and deliberately held it back to keep that night's patch to one conceptual change; tonight picks it up. A naive string-keyed cache was tried first and *measured slower* than the original bug at scale — a real, disclosed negative result folded into the final fix.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| Qdrant ships a `full_scan_threshold` (default 10,000) that brute-forces below that vector count instead of building HNSW | Qdrant official docs | A |
| "Representational Collapse in Multi-Agent LLM Committees" — mean pairwise cosine similarity 0.888 across 3-agent runs; diversity-weighted consensus beats self-consistency by ~3pp at −26% tokens | arXiv:2604.03809 (preprint) | B/C — single source, author discloses 1–3pt run variance |
| Multi-head dimension-splitting faults are a documented class of attention implementation bug (24% of surveyed faults) | arXiv:2508.04925 (survey) | B |
| "Multi-Head Attention Is a Multi-Player Game" — gradient descent itself can yield redundant/dead heads under training | arXiv:2602.00861 (Jan 2026) | B/C — tangential, a training-dynamics finding, not an implementation-defect match |

No paper names "unused head-differentiation parameter causing 8x redundant computation" directly — the closest matches are a general dimension-splitting-fault taxonomy (B) and representational-collapse framing for *why* multi-agent output diversity matters (B/C). This is a correctness/implementation bug, not a researched-and-rejected design tradeoff.

## Ruflo Current Capability

`AttentionCoordinator` implements 6 coordination mechanisms over multiple agents' outputs (flash/multi-head/linear/hyperbolic/moe/graph-rope). `multiHeadAttentionCoordination()` is reachable via the public `coordinateAgents(outputs, 'multi-head')` API and exercised by its own package's tests, but — a correction worth disclosing plainly — `@claude-flow/swarm` is **not currently a dependency of `@claude-flow/cli`** or any of the four bundled release components (`security`, `codex`, `mcp`, `plugin-agent-federation`); its only in-repo consumer is `@claude-flow/testing`. So tonight's fix is real, live within the package's own public API and test suite (and reachable by anyone installing `@claude-flow/swarm` directly from npm), but it does not currently change behavior exercised by the shipped `ruflo`/`claude-flow` CLI train. Disclosing this now rather than carrying forward the more generous "every coordination mechanism calls it" framing some earlier nights used for this same file.

## Competitor Comparison

| Framework | Multi-output-weighting/attention mechanism? | Perf characteristics | Grade |
|---|---|---|---|
| LangGraph | No native one — reducers are generic merge functions; weighted aggregation is user-written | None documented (cost is whatever the custom reducer does) | C |
| AutoGen / AG2 | No — `GroupChatManager` selects ONE next speaker via an LLM call, doesn't blend multiple outputs | AG2 docs claim fewer LLM calls than alternatives (vendor-stated) | B/C |
| CrewAI | No — hierarchical manager delegates/validates, no scored blend of worker outputs | Independent write-ups report delegation-loop reliability issues (not a redundant-compute one) | C |
| OpenAI Agents SDK | No — handoffs transfer control to one target; combining sub-agent outputs is a known manual workaround (see GH issue #2056 on `openai-agents-python`) | Not perf-characterized; a documented gap | C |

Why every row is "No": this is a real architectural split, not an oversight. LangGraph/AutoGen/CrewAI/OpenAI's SDK are all supervisor/handoff-pattern frameworks — each step picks ONE next actor rather than computing a weighted blend across simultaneous agent outputs. True weighted multi-agent-output attention shows up only in emerging academic work (e.g. ICLR 2026 "Graph-of-Agents", arXiv:2607.23678's adaptive attention orchestration) — a research-frontier pattern, not something competitors solved and declined to ship. That raises the bar for Ruflo's own implementation to be *correct*, since nothing else validates it by comparison.

## Hypothesis

> Given a call to `AttentionCoordinator.coordinateAgents(outputs, 'multi-head')` with `n` agent outputs, when `computeAttentionScore(i, j)` is memoized once per call (flat `Float64Array`/`Uint8Array` cache indexed by `i*n+j`, not a string-keyed `Map`) and reused across all 8 heads instead of recomputed per head, then `computeAttentionScore` call count should drop from `numHeads·n²` to `n²` and wall-clock latency should improve materially at n≥300, subject to: `attentionWeights`/`consensusOutput`/`confidence` output is unchanged (within floating-point tolerance) for every input, the cache is never reused across separate `coordinateAgents()` calls, and all other mechanisms (flash/linear/hyperbolic/moe/graph-rope) are untouched.

## Benchmarks

Vitest 4.1.8, `@claude-flow/swarm`, run directly against `src/` (package has no build-dependency on the monorepo's unbuilt `dist/` output).

- **Call count** (deterministic, zero timing noise): baseline `numHeads·n²` exactly (e.g. n=20 → 3200 calls; n=100 → 80000); candidate `n²` exactly (n=20 → 400; n=100 → 10000) — an exact 8x reduction, independently stash-verified both directions.
- **Wall-clock** (median of 15 trials after JIT warmup, same sandbox, back-to-back stash/pop): n=300 baseline 131.9ms → candidate 23.3ms (~5.7x); n=400 baseline 236.5ms → candidate 38.4ms (~6.2x, min 228.4ms→36.1ms ~6.3x). At n≤100 the effect is swamped by sandbox scheduling/GC noise and is not a reliable signal — disclosed rather than cherry-picked.
- **Negative result, disclosed**: a first implementation used a string-keyed `Map<string, number>` for the cache. At n≥400 this was measured *slower* than the original 8x-redundant baseline (per-pair template-string allocation + hashing cost more than `computeAttentionScore`'s own O(64)-float cosine loop, since `getOrCreateEmbedding()` is already memoized from 2026-10-30). Switched to index-addressed typed arrays, which eliminated the regression. Kept in-source as a code comment so this isn't rediscovered.

## Evaluation

7 new tests (2 discriminating via call-count/pair-uniqueness spies, 5 controls including a hand-computed ground-truth comparison and cross-mechanism sanity checks). Stash-isolated baseline: the 2 discriminating tests fail exactly as predicted (200 calls vs expected 25 at n=5; 648 pairs vs expected 81 at n=9 — i.e., exactly 8x over-count), the 5 controls pass vacuously either way. Candidate: 7/7 new, full `@claude-flow/swarm` suite 389/389 (382 pre-existing + 7 new), 0 regressions. `tsc --noEmit -p .`: 0 errors, both before and after. `harness mcp-scan .`: MEDIUM (3 findings, 0 high) — byte-identical to every recent night's baseline (candidate touches no `.claude/settings.json` or dependency manifest). Independently reproduced by a fresh-context adversarial critic (own stash/pop cycle, own throwaway probe): n=400 baseline median 256.4ms → candidate median 40.0ms (~6.4x), cross-validating this session's own 6.2x at the same n. Verdict: **CONFIRMED**, no blocking issues; one disclosed non-blocking caveat (the string-keyed-Map-is-slower claim above is plausible but was not independently re-run by the critic for lack of budget).

## Darwin Results

**Skipped — binary guard, no tunable parameter**, same precedent as 2026-11-14/11-23/11-24. The fix has a single discrete design choice (typed-array cache vs. string-keyed `Map`), already resolved by direct measurement above, not a continuous parameter space.

## SOTA Proof & Witness

```
Session commit:   f8a62a5f0ea4fa83b9fa7f5dc10acfe9ce0e8876
Candidate commit: 07ce6dbf1b6cc38265ef0586ed692835577690f0
Gist SHA-256 (pre-witness): c2ec634dc50819187b0ee1895157d6e67321934799ac6e8d9ffae8ee2c82ea20
Witness stamp:    ee0d1892be90e8d3ba60647ae232ca463705eaae8ac48ac75c9f5f1f3e259a22
```
Verifier: fetch this file from the branch, replace only the Gist SHA-256 and Witness stamp fields above with the literal text `PENDING` (Session/Candidate commit stay as-is — they were already fixed at hash time), SHA-256 the result, concatenate that hash with the Session commit value, SHA-256 again — must equal the Witness stamp.

Evaluation receipt identity: `v3/@claude-flow/swarm/__tests__/attention-coordinator-multihead-memoization.test.ts` at the candidate commit. Flywheel evidence identity: issue #5112 + this gist + the independent adversarial critique described in the Evaluation section above. No Darwin lineage (skipped, binary guard).

## Recommended Next Steps

1. **AgentDB backend has no size-based brute-force bypass below the measured HNSW crossover** (N≈5k–20k per `v3/CLAUDE.md`'s own perf table) — `v3/@claude-flow/memory/src/agentdb-backend.ts`'s `searchWithAgentDB`. Confirmed still open tonight (grep of current `lines ~862-885`). Scored 4.50/5 — strongest next-night performance pick, deferred because the threshold is a judgment call (trades exactness vs. speed below crossover) rather than a byte-identical fix.
2. **Score-symmetry exploitation**: `computeAttentionScore(i,j) == computeAttentionScore(j,i)` exactly (cosine + symmetric confidence average), so tonight's fix still computes the full n×n matrix instead of the upper triangle — combining with tonight's fix would yield a further ~2x (combined ~16x total). Deferred to keep tonight's patch to one conceptual change; a clean, low-risk follow-up.
3. **`.harness/mcp-policy.json`'s false zero-shell/zero-network claim** remains open (4th consecutive disclosure since 10-26, still not re-raised as a fresh finding, flagged again only because this is now a multi-week-standing design question needing a human decision, not an oversight).

**Security/hive-mind scan (disclosed, not implemented tonight):** security — SSRF-via-DNS-rebind fix (11-11) confirmed still holding; new low-severity hardening note: `getOrCreateEmbedding()`'s synthetic-hash loop is O(content.length) with no cap, a minor single-call CPU-stall surface for a pathologically large `AgentOutput.content` (not currently attacker-reachable in any call site). hive-mind — `RaftConsensus.appendEntries()`'s legacy path still has zero log-contiguity/prevLogIndex check (confirmed via direct code read, unchanged since 11-10's disclosure) — strong candidate for a future hive-mind-DEEP night.
