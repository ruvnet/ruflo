# Intelligence SOTA Report — 2026-11-12

**TL;DR**: In 2026, continual-learning-for-agents has split into two camps — weight-space regularization (EWC-family, what Ruflo claims) versus non-parametric/replay approaches, with recent practitioner and research voices (Letta/MemGPT's "Continual Learning in Token Space" essay, SuRe arXiv:2511.22367, MSSR arXiv:2603.09892) arguing replay is the stronger, more consistently effective baseline. Tonight's review found Ruflo's own EWC++ implementation has a bug that makes this debate concrete: `SONAManager.triggerLearning()` re-fed every STILL-RESIDENT, already-learned trajectory into gradient accumulation on every cycle with no "already learned from" marker — fixed tonight (disclosed-but-not-fixed 2026-10-27, #4531/#4532). An independent adversarial critic then found, and this session independently re-confirmed, that the fix is real but narrower than first claimed: it stops replay of *stalled* trajectories, but `BalancedMode`'s underlying gradient accumulator is never reset at all, so EWC's `means` anchor still grows linearly and unboundedly under ordinary, correct, continuous operation (one genuinely-new trajectory per cycle) — a distinct, deeper bug carried forward, not fixed tonight. Also surfaced: a live fail-open authorization bug in `ruflo claims check`, a `memory compress` CLI/MCP schema mismatch, and a stale, inconsistent performance claim in CLAUDE.local.md.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| Replay-based continual learning consistently outperforms EWC-style regularization for continual LLM/agent fine-tuning | SuRe arXiv:2511.22367; MSSR arXiv:2603.09892 | B |
| Letta/MemGPT: weight-space consolidation (EWC) is the wrong layer to fight forgetting at for agents; non-parametric context/memory paging sidesteps it entirely | Letta "Continual Learning in Token Space" essay (Dec 2025) | B/C |
| Vespa's HNSW is a genuinely mutable graph (real-time CRUD, no rebuild) — a published answer to "continual index updates" Ruflo's docs don't address | Vespa ANN docs + design blog | A/B |
| RouteLLM reports ~95% of top-model quality at ~14% of top-model queries via learned routing (cost/quality benchmark) — but a May-2026 study argues routing-headroom claims across this category are broadly inflated | RouteLLM arXiv (A); headroom-inflation critique (C, single source) |
| Adaptive/entropy-conditioned top-K expert selection is an active 2026 MoE research direction; Ruflo's `moe-router.ts` computes routing entropy but never consults it for K | SoftMoE/ProbMoE/AdaMoE summaries | B/C |
| A 72-model controlled 2025 study finds pure linear/flash attention degrades recall; recommends 3:1–6:1 linear:full-attention ratios | arXiv:2507.06457 | A |
| No 2025/2026 benchmark exists for flash/linear attention at small-batch, agent-coordination scale — a genuine open gap, honestly reported as absence-of-evidence | — | N/A |

**Why this isn't "None across the board"**: no competitor bundles routing + continual-learning + attention-management the way Ruflo's CLAUDE.md claims to; the field instead answers each piece separately and usually better-documented (Vespa on index mutability, RouteLLM on routing cost curves) — Ruflo's gap is in benchmarking/engaging these existing answers, not a universally unsolved problem.

## Ruflo Current Capability

`v3/@claude-flow/neural/src/sona-manager.ts`'s 4-stage pipeline (RETRIEVE→JUDGE→DISTILL→CONSOLIDATE) is real and reachable from production (`QueenCoordinator.completeTask()`→`NeuralLearningSystem`→`SONAManager.completeTrajectory()`→`triggerLearning()`). `moe-router.ts`'s 8-expert gate is correctly hardened (load-balance loss, persistence) per 2026-09-15's review. HNSW (`@claude-flow/memory`) measures ~1.9x–4.7x vs. brute force (CLAUDE.md, corrected from a fabricated 150x-12,500x figure found earlier this year) — but **CLAUDE.local.md still carries the uncorrected 150x-12,500x figure**, a live internal-consistency gap (flagged by tonight's competitor-analyst, not independently scored as a candidate — a one-line doc fix for a future night).

## Competitor Comparison

| Competitor | Mechanism | vs. Ruflo | Grade |
|---|---|---|---|
| Vespa | Mutable HNSW graph, no-rebuild CRUD | Published, load-bearing design Ruflo's HNSW docs don't address at all | A/B |
| Qdrant | Tunable ef/efConstruct, segment-based inserts | User-exposed tuning docs; Ruflo doesn't expose efSearch as independently tunable (tonight's #1 deferred candidate) | B |
| Weaviate | Dynamic flat→HNSW conversion by size threshold | Matches Ruflo's own "HNSW loses below crossover" finding — an industry-acknowledged tradeoff | B |
| Milvus | Static per-collection index-type choice (HNSW/IVF/DiskANN/ScaNN) | Closest public analog to "pick index by workload shape," but static, not learned like Ruflo's MoE claim | B |
| RouteLLM / vLLM Semantic Router | Learned whole-model routing, published cost/quality curve | Ruflo's MoE gate has only an internal confidence-convergence metric, no external cost/quality benchmark, and conflates true MoE with cross-model routing | A/C |
| Letta/MemGPT | Non-parametric context paging, explicit rejection of weight-space consolidation | Direct, named challenge to Ruflo's EWC++ premise that CLAUDE.md doesn't engage | B/C |
| LangGraph/AutoGen/CrewAI | No built-in routing/continual-learning/attention primitives | Deliberate, stated design choice (stay unopinionated) — genuine N/A, not a gap | B |

## Hypothesis

> Given `SONAManager.triggerLearning()`, which re-filters the entire `this.trajectories` map on every call with no marker for prior processing, when trajectories are gated on a new `learnedFrom` flag set after a successful `modeImpl.learn()` call, then a `triggerLearning()` cycle with no newly-completed trajectories should produce zero additional gradient-accumulator/EWC-means movement and should not increment `learnIterations`, relative to today's baseline which reprocesses the full surviving backlog and produces nonzero movement from pure replay — while a cycle with a genuinely new completed trajectory still learns from it normally, subject to: zero change to `pruneTrajectories()`'s capacity-bounding behavior, zero change to below-threshold trajectory exclusion, deterministic $0 Vitest evaluation. Frozen before evaluation; not modified after. **Confirmed exactly as stated, no more and no less** — see Evaluation below for what this hypothesis does and does not cover.

## Benchmarks / Evaluation

Real evaluator: Vitest 4.1.8, `@claude-flow/neural` (package required `pnpm install` — no prior build). Stash-isolated baseline (`sona-manager.ts`/`types.ts` reverted): **3/4 new tests fail exactly as predicted** (`learnIterations` 1→2 on a no-op second cycle; `learnedFrom` always `undefined`, field doesn't exist); 1 non-discriminating control passes both ways. Candidate: **4/4 pass**; full package suite **152/152** (148 pre-existing + 4 new), 0 regressions; `tsc --noEmit` 0 errors both ways.

**Post-critique correction** (this is the important part — an earlier version of this evaluation overclaimed): a first growth probe (one trajectory completed once, then `triggerLearning()` called 150x with nothing new) showed baseline growing 6.59x (cycle30→150) and candidate flat — but that scenario is the ONE case the hypothesis actually covers (zero new completions), so "flat" there doesn't mean the underlying growth problem is solved. An independent adversarial critic re-ran the *actual* 2026-10-27 "stationary periodic input" scenario (one brand-new, content-identical trajectory completed every cycle — the realistic "agent keeps succeeding at a similar task" case) against the candidate and found the SAME 6.59x/2.03x growth curve the original baseline showed. This session independently reproduced that exact result twice more (own re-check + confirming the critic's numbers byte-for-byte): `ewcState.means[0]` = 0.000065/0.013917/0.091778/0.189414/0.384688 at cycles 1/30/150/300/600 — linear, not plateauing, under the fixed candidate. Root cause (traced in `modes/balanced.ts`): `accumulateGradient()`'s `gradientAccumulator` is a lifetime-cumulative sum reset only by `initialize()`/`cleanup()`; `getConsolidationSnapshot()` sets `ewcState.means` to that raw accumulator. Tonight's fix removes the O(backlog-size) *multiplier* on this growth (real, verified) but leaves the underlying O(cycle-count) unbounded accumulator itself untouched. **Verdict: ACCEPT-scoped (post-critique)** — ships the narrower, correctly-tested fix; the deeper accumulator-reset bug is disclosed, not fixed, and carried forward as tonight's top recommended next step.

## Darwin Results

Skipped — binary "already learned from" gate, not a continuous/categorical tunable parameter. Same skip class as most prior ACCEPTs of this shape.

## SOTA Proof & Witness

See PR for full witness block (session commit, candidate commit, gist SHA-256, witness stamp) — computed after this file is finalized.

## Recommended Next Steps

1. **`BalancedMode`'s never-reset gradient accumulator** (new, found by tonight's own adversarial critique — highest priority): `means`/`gradientAccumulator` grow linearly without bound under ordinary continuous operation, not just under the now-fixed backlog-replay bug. Needs a deliberate design decision (periodic reset/decay of the accumulator itself, not just gating which trajectories feed it) before `computeEWCPenalty()` is ever wired into a real gradient update.
2. **HNSW efSearch/efConstruction decoupling** (score 4.55/5, deep-researcher): decouple query-time `ef` from `efConstruction` in `hnsw-index.ts:334`; reuses `scripts/benchmark-intelligence.mjs` directly.
3. **`claims.ts` `checkCommand` fail-open on config error** (score 4.05/5, scan-capabilities): silently grants any non-`admin:`-prefixed claim on config read/parse failure; zero test coverage; a real, narrowly-scoped security candidate for a future security/capabilities night.
4. **`memory compress --quantize` CLI/MCP schema mismatch** (score 3.65/5, scan-memory): always prints "Quantization: No"/"Duration: NaNs" regardless of flags; pure glue-code bug, no data-integrity risk.
5. Sync CLAUDE.local.md's stale "150x-12,500x" HNSW figure with CLAUDE.md's corrected ~1.9x-4.7x number (doc-only, not scored as a candidate).

## Witness

```
Session commit: dc25dd9b522bf1f3761f0d061a0bd0deb1900ba1
Evaluation receipt identity: v3/@claude-flow/neural __tests__/sona-trigger-learning-idempotency.test.ts (4 tests) + sona-ewc-consolidation.test.ts (5 tests, docstring corrected)
Flywheel evidence identity: none (.claude-flow/flywheel/ does not exist in this checkout)
Darwin lineage identity: none (skipped — binary gate, not a tunable parameter)
Report SHA-256 (pre-witness): fa2e43352ad5de3487b3ca2b8cbcfdd6411340da1da395aacace03ea07098c9e
Witness stamp: 4cfe201778b06a9918196637183d4270c38da7123b2ee29119498c525d83db15
```
Verifier: fetch this file, replace "Report SHA-256 (pre-witness)" and "Witness stamp" values with the literal text PENDING, SHA-256 the result, concatenate with the Session commit, SHA-256 again — must equal the Witness stamp above.
