# Intelligence SOTA Report — 2026-10-07

TL;DR: In 2026, continual-weight-learning for production agent frameworks remains an open, field-wide gap — Ruflo is at parity with LangGraph/AutoGen/CrewAI/OpenAI's Agents SDK (none update weights in production either), per a sourced competitor scan. Inside Ruflo's own SONA/EWC++ stack, tonight's deep-dive independently found something sharper than a parity gap: EWC++ catastrophic-forgetting regularization is a **silent, permanent no-op in every mode that references it** (`balanced`, `research`, `batch`) — not just because `ewcState.fisher`/`means` were never populated (fixed on `main` 2026-09-22, #3395), and not just because the follow-up wiring fix that populates them is still unmerged (`dream/2026-10-02-intelligence`, PR #3622, open 5 days) — but because, even once that pending PR lands exactly as written, each mode looks up a **different, incompatibly-keyed and incompatibly-dimensioned** private accumulator that the populated `fisher`/`means` map can never match. Tonight ships the diagnostic that makes this observable (hit/miss counters + 4 discriminating tests) rather than another silent patch on top of an inert subsystem, and recommends #3622 not be merged as currently described.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| ReasoningBank: distilling from both successful AND failed trajectories (contrastive signal) beats success-only/raw-trajectory storage on WebArena/Mind2Web/SWE-Bench-Verified | Ouyang et al., arXiv:2509.25140, ICLR 2026 | A |
| AgentFly/MemGen: production agent frameworks deliberately avoid in-place weight updates, citing catastrophic forgetting + fine-tuning cost as the reason — not an oversight | arXiv:2509.24704 (AgentFly) + MemGen paper, cross-checked | B |
| CrewAI ships the one real "training" loop among mainstream frameworks (`crewai train`), but it operates in **prompt space** (textual suggestions), not weight space — sidesteps forgetting entirely rather than solving it | CrewAI official docs | A |
| Online-LoRA (WACV 2025, arXiv:2411.05663) / CL-LoRA (CVPR 2025, arXiv:2505.24816): real, peer-reviewed continual LoRA weight updates exist — but only for vision-transformer class-incremental learning, not agent frameworks | arXiv, verified real and correctly cited in prior repo history | A |
| Baseten (Oct 2025): proposes merging rank-1 LoRA gradients into production base weights — the exact step Ruflo's modes currently discard via `gradient.fill(0)` — but explicitly theoretical, zero benchmarks, and the authors state they're unsure LoRA is even the right primitive for continual learning, explicitly excluding agentic/RL settings as unsolved | Baseten Labs blog | C |
| RaBitQ 1-bit quantization (32× compression, O(1/√D) error bound) — matches Ruflo's own measured 32x/0.60ms-query number | Gao & Long, SIGMOD 2024 "Most Influential Paper", arXiv:2405.12497 | A |

## Ruflo Current Capability

SONA's continual-learning stack (`v3/@claude-flow/neural/src/`) has, in order, now had **four** consecutive nights of attention (09-22 Fisher-EMA-direction fix, merged; 09-27 `fisherDecayRate` env exposure, unmerged; 10-02 `consolidateEWC()`→`triggerLearning()` wiring + Fisher/means population, unmerged; tonight). Direct code reading (not log-trusting) shows:

- `consolidateEWC()` at `main`@`be9c767` only decays existing Fisher values (`fisher[i] *= decay`) and is **never called** from `triggerLearning()` — confirmed via `git merge-base --is-ancestor`: commit `9be192651` (PR #3622's fix) is **not an ancestor of `main`**, despite the repo's own prior-night notes describing this subsystem as sequentially "fixed." Zero `.set()` writers on `ewcState.fisher`/`.means` exist anywhere in `src/` today.
- Independently re-deriving #3622's own diff: it populates `fisher`/`means` under `${domain}:${module}` keys, dimensioned to the LoRA rank (`weights.A.get(module).length`). But:
  - `balanced.ts`'s `computeEWCPenalty()` looks up `this.gradientAccumulator.get(key)` — a map keyed **only** `'positive'`/`'negative'`, dimensioned to the state-embedding size. Never matches. Worse: the computed `ewcPenalty` feeds into a local `totalGradientNorm` that is **never read again** after that line — dead regardless of key alignment.
  - `research.ts`'s `computeEWCLoss()` looks up `this.adamM.get(key)` — keyed `'step_0'`, `'step_1'`, ... (per-trajectory-step), dimensioned to the state-embedding size. Never matches `domain:module` keys.
  - `batch.ts`'s inline check looks up `this.accumulatedGradients.get(key)` where `key = trajectory.domain` (no module suffix) — never matches `domain:module` either, and even if it did, the array lengths differ (state-embedding dim vs. LoRA rank), so a coincidental key match would silently inject `NaN` into the gradient (no `Math.min`-style bound guard here, unlike the other two modes).
  - Net: **EWC regularization contributes exactly 0 penalty in all three modes, on `main` today and after #3622 lands unmodified.** #3622's own test suite (143/143 claimed) only asserts that `fisher`/`means` *populate* — it does not assert the penalty becomes non-zero in any mode's real `learn()` path, so this gap passed review undetected.

Tonight's fix: add `ewcPenaltyLookupHits`/`ewcPenaltyLookupMisses` counters at each mode's lookup site, surfaced via each mode's existing `getStats()` pattern, plus 4 discriminating tests (3 reproduce the always-0-hits condition under #3622's exact key scheme; 1 control proves a hand-aligned key *does* register a hit, so the counters themselves are live, not dead code).

## Competitor Comparison

| System | Continual-learning / self-improvement mechanism | Grade |
|---|---|---|
| **Ruflo** | EWC++/SONA/LoRA infrastructure exists but is fully inert end-to-end (confirmed tonight, deeper than disclosed) | A (direct repo read) |
| **LangGraph** | No weight-level learning; retrieval-based memory only | B |
| **AutoGen (Microsoft)** | None; AgentFly/MemGen built atop it explicitly avoid weight updates, citing forgetting+cost | B |
| **CrewAI** | Real shipped `crewai train` loop, but prompt-space only (textual suggestions), not weight-space | A |
| **OpenAI Agents SDK** | None; third-party memory (e.g. Mem0) bolted on | B |
| **Qdrant/Weaviate/Milvus/LanceDB** | None — pure retrieval substrate, not learners (CrewAI builds memory atop LanceDB, not in it) | A |

Why most read "None": AgentFly/MemGen explicitly name catastrophic forgetting + fine-tuning cost as a deliberate reason to avoid weight updates — a sourced, known failure mode being avoided, not an oversight. Ruflo's position: **at parity** with the mainstream production field (nobody ships real weight updates), **ahead of** vector-DB infrastructure (not a learner at all), and only narrowly **behind** the unvalidated experimental edge (Baseten's rank-1 LoRA-merge proposal, grade C, explicitly unsure LoRA is even right for agentic settings).

## Hypothesis

Given SONA's three EWC-consuming learning modes (`balanced`, `research`, `batch`), when `ewcState.fisher`/`means` are populated under LoRA-weight-space keys (`${domain}:${module}`) exactly as the pending, unmerged `dream/2026-10-02-intelligence` commit (#3622) would populate them, then each mode's own EWC penalty/loss computation (`computeEWCPenalty` in balanced.ts, `computeEWCLoss` in research.ts, the inline check in batch.ts's `applyAccumulatedGradients`) should be measurably shown to register **zero lookup hits and a non-zero miss count**, because each mode's own internal gradient/moment accumulator uses a different key namespace and different dimensionality than the LoRA-weight-space fisher/means map — subject to: (1) no change to existing `learn()`/`applyAdaptations()` behavior or latency budget; (2) new instrumentation purely additive/observational; (3) all existing tests remain green; (4) deterministic, $0, zero LLM calls. A control case (hand-aligned key) must register a hit, proving the instrumentation itself isn't dead code. Frozen before evaluation; not modified after.

## Benchmarks

No `.harness/bench.json` corpus applies — this is a correctness/observability finding evaluated via discriminating unit tests (stash-isolated baseline-vs-candidate), the same evaluation shape used by nearly every accepted non-benchmark-shaped dream-cycle candidate to date.

## Evaluation

**evaluated: accepted.** Stash-isolated: reverting the 3 instrumented source files (keeping the new test file) makes all 4 new tests fail (`expected undefined to be +0` / `TypeError: ... received "undefined"` — the counters don't exist pre-candidate). Restoring the source: 4/4 pass. Full `@claude-flow/neural` suite: **143/143** (139 pre-existing + 4 new), 0 regressions. `tsc --noEmit`: clean. All three "always-zero" assertions hold exactly as the hypothesis predicted; the control assertion (hand-aligned key) registers `hits > 0`, confirming the counters are live.

## Darwin Results

Skipped — this is a diagnostic/observability addition with no continuous tunable parameter and no fitness gradient for Darwin's real interface (`npx ruvector harness darwin <config> --execute`, confirmed available) to search over. Same skip class as nearly every correctness/observability-fix dream-cycle night.

## SOTA Proof & Witness

See the linked issue/PR for the full reward-hack checklist, adversarial critique, security review, and witness stamp.

## Recommended Next Steps

1. **Do not merge PR #3622 (`dream/2026-10-02-intelligence`) as currently written without addressing tonight's finding** — or merge only with an explicit disclosed caveat that it does not yet make EWC regularization non-zero in any mode. Its own "143/143 passing" claim is true but doesn't test the behavior its commit message describes.
2. **Real fix requires a cross-file redesign, not a parameter tweak**: either (a) `consolidateEWC()` needs visibility into each mode's own internal accumulator key scheme (breaks the current encapsulation — `gradientAccumulator`/`adamM`/`accumulatedGradients` are private to each mode), or (b) each mode's penalty/loss function needs to consume LoRA weight drift directly instead of its own ephemeral per-batch scratch state (a different, arguably more correct, EWC formulation — same "needs real design judgment" class of problem Darwin's fitness-function search already declined to fabricate a proxy for on 2026-10-02). Good candidate for a dedicated future `intelligence` night with a wider patch-size budget than tonight's.
3. **`batch.ts`'s unguarded `fisher[i]`/`means[i]` indexing** (no `Math.min(...)` bound, unlike balanced.ts/research.ts) is a latent `NaN`-injection landmine for whoever aligns the key spaces later — flagged inline, not fixed tonight (no observable effect today; the gradient is discarded via `fill(0)` immediately after regardless).
4. **`balanced.ts`'s `totalGradientNorm` is a fully dead local variable** — written 4 times, read 0 times, independent of the key-mismatch bug. Even a correctly-keyed, correctly-dimensioned EWC penalty would still have zero effect on `learn()`'s behavior in this mode until this is also fixed.
5. Capabilities scan (secondary): plugin registry's declared `permissions`/`exports` metadata (`v3/@claude-flow/cli/src/plugins/store/types.ts`) is never enforced at runtime — `manager.ts` has zero dynamic `import()`/`require()` calls (grep-confirmed), so a plugin's declared capabilities are install-time bookkeeping, not a runtime boundary. Distinct from the already-known-unwired `PluginIntegrityVerifier` (ADR-145). Good candidate for a `capabilities` night.
6. Memory scan (secondary, medium confidence, not yet empirically reproduced): `HNSWIndex.removePoint()` strips edges but never repairs graph connectivity; `MemoryConsolidator.dedup()`'s multi-round near-dup merge loop searches the same progressively-degraded graph before any rebuild, risking missed duplicates on large merge clusters. Needs a recall-before/after benchmark to confirm before any fix.

## Witness

| Field | Value |
|---|---|
| Session commit (STEP 0) | `be9c76718069e7f9592ee80e5a12aba60a2455f0` |
| Candidate commit | `a213b1e8a1205a61496d45affca75561be0dc7e6` |
| Gist SHA-256 (pre-witness content, this table's values stripped to `PENDING`) | `73e12f90928490b9e6890f4b36a8f289b32e41232977bf0e7da70016cdae498a` |
| Witness stamp | `eccba84db3eb0ea3bf770d7a65d1f3e75f7c57b1591b90b3393b60b996324c91` |

Verifier: fetch this gist, strip this table's filled values back to `PENDING`, SHA-256 the file, concatenate with the session commit above, SHA-256 again — must equal the witness stamp.
