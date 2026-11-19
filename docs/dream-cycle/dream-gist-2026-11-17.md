# Intelligence SOTA Report — 2026-11-17

TL;DR: In 2026, an accepted ICLR paper ("ReasoningBank", arXiv 2509.25140) measured that distilling *both* successful and failed agent trajectories into memory beats distilling successes only. Ruflo's own `ReasoningBank.distill()` — the class actually wired into the live `completeTask()` → `LearningBridge.consolidate()` path — was doing exactly the inferior success-only thing, discarding every judged failure. Fixed tonight, plus a latent cross-type dedup bug the fix would otherwise have introduced.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| Failure-aware trajectory distillation (+MaTTS test-time scaling) beats success-only memory on web/SWE benchmarks | Google Research, ICLR 2026 poster, arXiv 2509.25140 | A |
| Fisher-Guided Gradient Masking selects *which* params to update via Fisher info, beats MIGU without old-task data | arXiv 2601.18261 (Jan 2026) | B (single preprint) |
| EWC's task-boundary assumption is a poor fit for continuous LLM/agent learning (no discrete task demarcation) | arXiv 2502.04390 | B |
| Online-EWC canonical decayed-Fisher form confirmed across independent implementations | capymoa.org, AiDotNet docs | B |
| Combining regularization+replay+routing (not any one alone) sustains long-horizon agent memory | arXiv 2609.06986 (2026) | C (single paper) |

## Ruflo Current Capability

`ReasoningBank.distill()` (`v3/@claude-flow/neural/src/reasoning-bank.ts:456`) judged every trajectory (`getFailedTrajectories()` existed and was tracked in stats) but **only distilled successes** into the retrievable `this.memories` pool — failures were judged, then thrown away. A dual-track success/failure distiller already exists in a sibling file, `reasoningbank-adapter.ts` (697 lines, its own `Success|Failure|Partial` verdict type), but is never imported by `@claude-flow/neural/src/index.ts` — built once, never wired up, the same "implemented but disconnected" pattern this repo's own audit has flagged elsewhere.

Separately (not tonight's candidate, but surfaced by research): `BalancedMode.computeEWCPenalty()`'s output is computed but never reaches a real weight update in `learn()` — confirmed again tonight, still discarded, still disqualified for low production value (same conclusion as 2026-11-16's research).

## Competitor Comparison

| Framework | Continual/online learning | Forgetting mitigation | Self-optimizing routing/memory | Grade |
|---|---|---|---|---|
| LangGraph | None — app-defined store/checkpoint eviction, not weight learning | None | None | C |
| AutoGen | "Teachable" agents (vector-DB facts); newer task-centric-memory marked experimental | N/A (non-parametric) | None | B |
| CrewAI | 2026 unified `Memory` API (LanceDB-backed) | None native | None | B/C |
| OpenAI Agents SDK | `Sessions` = history persistence only, no cross-session semantic memory | N/A | None native | B |
| Letta (MemGPT) | Self-editing memory via tool calls; explicit "token space, not weight space" design philosophy | Avoided by design (no weight updates) | Agent-directed, not learned | B |
| Mem0 | ADD/UPDATE/DELETE/NOOP consolidation pipeline | Policy-driven selective forgetting, not automatic | None | B |
| Zep (Graphiti) | Bi-temporal knowledge graph, validity-interval fact invalidation | Strongest native decay mechanism in this set | None | A (own benchmark: DMR 94.8% vs MemGPT 93.4%) |

Every "None" in the self-optimizing-routing column is the same industry-wide, deliberate scope boundary: these are orchestration frameworks that keep the base model frozen and push "learning" into context/store engineering instead of weight space — a March 2026 position paper (arXiv 2603.01761) argues nobody ships the in-weight+in-context combination in production, citing per-customer fine-tune cost, recertification burden, and imperfect-importance-estimate forgetting risk (the same Fisher-proxy problem this repo's own audit flags in its EWC++). Ruflo is the only system here attempting real in-process EWC-style weight consolidation at all — ahead on that narrow axis, behind Zep/Mem0 on memory-product maturity and public, reproducible benchmarks.

## Hypothesis

> Given Ruflo's live trajectory-learning path (`LearningBridge.consolidate()` → `NeuralLearningSystem.completeTask()` → `ReasoningBank.distill()`), when `distill()` is changed to also distill unsuccessful trajectories into a distinct `memoryType: 'pitfall'` memory instead of unconditionally discarding them, then `ReasoningBank.retrieve()` should surface pitfall memories for queries similar to a past failure — which it structurally cannot today — subject to: zero regression to existing success-path distillation/retrieval tests, `PatternLearner.extractPattern()`'s positive-exemplar consumer must never promote a pitfall memory into a success `Pattern`, deterministic $0 Vitest evaluation. Frozen before evaluation; not modified after.

## Benchmarks

No numeric benchmark corpus — this is a correctness/completeness fix, not a performance claim. Evaluation is deterministic Vitest discrimination (below), consistent with "a benchmark without reproducibility is not a successful Dream Cycle" — reproducibility here comes from stash-isolated baseline-vs-candidate test runs, independently reproduced by the critic.

## Evaluation

Vitest 4.1.8, `@claude-flow/neural` package (ran directly against `src/`, no build required). 5 new/changed tests in `__tests__/patterns.test.ts` (1 behavior-change update of a test whose prior assertion *was* the bug; 4 new). Stash-isolated baseline (`git stash push --keep-index` on the 3 source files, test file kept): baseline fails exactly the 4 predicted tests (null where a pitfall was expected, missing `memoryType`), 38/42 unaffected tests still pass. Candidate: **43/43 pass** (one more test added after the forward-fix below). Full package suite: **152/152 pass, 0 regressions**. Related suite (`@claude-flow/memory`'s `learning-bridge.test.ts`, the real caller chain, mocked neural import): **78/78 pass**. `tsc --noEmit -p .`: **clean, 0 errors**.

## Darwin Results

Skipped — this is a binary/structural guard fix (distill failures or don't; no continuous/categorical parameter introduced), not a tunable Darwin could search over. Same category as 2026-11-16's EWC/capability-brain findings.

## SOTA Proof & Witness

Independent adversarial critique (fresh-context `reviewer` subagent): traced real production reachability (`LearningBridge.consolidate()` is wired into the CLI via `enableLearningBridge`, default `true` in at least one runtime preset); confirmed the `extractPattern()` anti-promotion guard is **load-bearing, not redundant** (threshold divergence between `ReasoningBank`'s `distillationThreshold`=0.6 and `PatternLearner`'s own `qualityThreshold`=0.5 meant a pre-fix trajectory scoring ~0.55 could already have reached `extractPattern` with no `memoryType` field to stop it); independently reproduced the stash-isolation; ran the full suite and `tsc` itself. Verdict: **CONFIRMED-WITH-CAVEATS**. One caveat was a real bug, not cosmetic: `deduplicateMemories()` would now delete a pitfall memory that happened to share a near-identical embedding (≥0.95 cosine similarity) with a higher-quality success memory, treating opposite outcomes as duplicates — a direct consequence of merging both types into one pool. **Fixed forward same session**: dedup now skips any pair whose `memoryType` differs; added a discriminating regression test (`createTestTrajectory`'s embedding depends only on domain/steps, not quality, so a same-shape success/pitfall pair reaches cosine similarity 1.0 — proven to fail without the guard, pass with it). Second caveat, disclosed but **not** fixed tonight (out of scope, pre-existing): `detectContradictions()`'s `consolidated` flag is set but never read by `retrieve()`/`retrieveByContent()` — a dead toggle that predates this change and is unrelated to it.

```
Session commit: 8cb2fbc7a1e9e08f20fc5fc6a45e1046ad0369b9
Candidate commit: 08e2e32 (dream/2026-11-17-intelligence)
Gist SHA-256: 2e3839768122c32df740f83d5921b6b3625028f1ebfd5517feeb9f5fbb42a530
Witness stamp: 2261d4ec0aad5dedb3ee82c2766a4be15553bad262f44181d8cb909a161018e8
```
Verifier: fetch this file from the `dream/2026-11-17-intelligence` branch, replace the three dynamic values above with the literal text `PENDING`, SHA-256 the result, concatenate with the Session commit, SHA-256 again — must equal the Witness stamp.

## Recommended Next Steps

1. **Ship tonight's candidate** (ACCEPT, post-critique): `ReasoningBank.distill()` now distills pitfall memories; `extractPattern()` call site gated on `memoryType === 'success'`; `deduplicateMemories()` no longer cross-deletes success/pitfall pairs. Human review required before merge.
2. **Wire `consolidated` into `retrieve()`/`retrieveByContent()`** so contradiction-flagged entries are actually excluded (currently a dead toggle, pre-existing, orthogonal to tonight's fix) — small, safe, a good next-night pick on the memory SCAN surface.
3. **Reconnect `reasoningbank-adapter.ts`'s dual-track distiller** (already has `Success|Failure|Partial` + confidence-prior config, more sophisticated than tonight's minimal fix) to `@claude-flow/neural/src/index.ts`, or deliberately retire it — it is prior art the team already built and never wired up; leaving two parallel, inconsistent distillation designs in the package is a legibility risk even though neither currently breaks the other.
