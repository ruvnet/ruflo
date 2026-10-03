# Intelligence SOTA Report — 2026-10-02

TL;DR: Ruflo's SONA manager (`v3/@claude-flow/neural/src/sona-manager.ts`) declares a full EWC++ scaffold (`ewcState`, `EWCConfig`, `consolidateEWC()`) specifically to prevent catastrophic forgetting in its LoRA adapters, matching 2026 continual-learning literature's basic requirement (Zenke et al.'s Synaptic Intelligence, ICML 2017, and its 2025 EWC-vs-SI head-to-head, arXiv:2505.20216). It never ran: `consolidateEWC()` had zero callers anywhere in the repo, and even called directly, its Fisher/means maps were populated nowhere — every mode's private `computeEWCPenalty()` therefore always read empty maps and returned exactly 0, regardless of `ewcLambda` (2000-2500). Tonight wires `consolidateEWC()` into `triggerLearning()` and makes it populate Fisher/means from the live LoRA weights, closing the gap between what the literature requires and what Ruflo's own scaffold actually did.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| Synaptic Intelligence: cheaper online path-integral importance vs. periodic Fisher recomputation | Zenke et al., ICML 2017, arXiv:1703.04200 | A |
| EWC vs SI head-to-head on continual ASR: 5.21% vs 4.36% relative WER reduction — comparable, task-dependent, neither dominant | arXiv:2505.20216, Interspeech 2025 | A |
| ToolOrchestra: RL with outcome+efficiency+preference composite reward beats GPT-5 at 2.5x efficiency on HLE (NVIDIA+HKU) | arXiv:2511.21689, ICML 2026 accepted, code+model+dataset released | A |
| BaRP: bandit-feedback routing with a test-time preference/cost dial, +12.46% vs offline routers | arXiv:2510.07429, Oct 2025 | B |
| Letta "sleep-time compute": idle-time memory-editing reframes forgetting as a memory-architecture problem, not a weight-protection problem — cuts test-time workload up to 5x | letta.com/blog, Berkeley whitepaper Apr 2025 | B |
| ATLAS: gradient-free, memory-based orchestration sidesteps parametric forgetting entirely — a different paradigm, not a drop-in for Ruflo's parametric SONA | arXiv:2511.01093, Nov 2025 | B |

No material change found versus prior Dream Cycle nights beyond what #3395 already fixed (that PR corrected the EMA *direction* in a different, already-wired EWC implementation — `cli/src/memory/ewc-consolidation.ts`, which protects a pattern-confidence ledger, not SONA's parameters).

## Ruflo Current Capability

Two independent, non-interacting EWC-shaped implementations exist. `cli/src/memory/ewc-consolidation.ts` guards ReasoningBank pattern-confidence weights (already fixed in #3395/#3109/#3302) and explicitly discloses its `F_i` is a squared-embedding-magnitude heuristic, not true Fisher information. `neural/src/sona-manager.ts`'s own `ewcState`/`consolidateEWC()` is structurally separate, declared specifically to protect SONA's LoRA adapter weights — and, until tonight, did nothing: `grep -rn "consolidateEWC" v3/` returned zero call sites outside its own definition. `computeEWCPenalty()` (in each mode's `learn()`) reads `ewcState.fisher`/`means` every learning cycle but found them permanently empty.

Separately disclosed, not fixed tonight: no mode's `learn()` currently applies its computed `gradientAccumulator` back onto `loraWeights.A`/`.B` — the LoRA adapters are seeded once at `initializeLoRAWeights()` and never updated after. SONA's "0.0043ms/adapt" measured figure is `applyAdaptations()`'s read-only forward-pass latency, not a weight-update step. This is a larger, separate architectural gap (see Recommended Next Steps #1) — tonight's fix makes EWC real for *whenever* weights do move (as the test suite directly demonstrates by simulating that move), without claiming to have wired the move itself.

## Competitor Comparison

| Capability | LangGraph | AutoGen/AG2 | CrewAI | OpenAI Agents SDK |
|---|---|---|---|---|
| Online/continual learning of agent behavior | No — RAG-style memory only [B] | Partial — "Teachability" re-injects corrected memos, explicitly no weight update [B] | No — "Cognitive Memory" scoring is LLM-judged but weights are static config [A] | No — docs tell devs to prefer static model choice [A] |
| Learned (trained) routing | No — static/LLM-classifier branches [B] | No — static config; successor MS Agent Framework still static [B] | No — Flows "Router" is a dev-defined branch [B] | No — explicit anti-recommendation [A] |
| Forgetting mitigation | Manual summarization/trimming [C] | None beyond the memo store | Explicit decay + "forget" op, rule-based not learned [A] | None |
| Bandit-style exploration | No | No | No | No |

Why every column is empty: weight-level EWC needs a Fisher matrix the size of the model (23GB+ at 6B params per one 2025 report) — impractical for frozen-weight, API-based frameworks, so the ecosystem solves "forgetting" at the memory layer (Letta) instead. Standalone learned-routing products exist separately (OrcaRouter, RouterArena/ICLR 2026) but sit in front of orchestration frameworks, not inside them. Ruflo is unusual in having built trainable LoRA weights + a real EWC scaffold *inside* the orchestrator — so tonight's finding (scaffold present, never firing) is Ruflo's own bug, not a gap shared with these four.

## Hypothesis

> Given SONAManager's continual-learning loop (trajectories → `triggerLearning()` → mode-specific `learn()`), when `consolidateEWC()` is wired into `triggerLearning()` and populates `ewcState.fisher`/`means` from the live LoRA adapter weights using the same squared-magnitude heuristic already disclosed in `memory/ewc-consolidation.ts`, then (a) `ewcState.taskCount` and `fisher`/`means` should visibly evolve across learning cycles where they were previously frozen at their initialized empty/zero state forever, and (b) a second consolidation should blend decayed old importance with fresh importance rather than overwriting or no-op'ing; subject to: no change to `applyAdaptations()`'s <0.05ms latency budget, no change to LoRA weight semantics/types, and explicit disclosure that `loraWeights.A`/`.B` are not yet updated by any `learn()` call outside of this test's direct simulation of that event.

Frozen before evaluation began; not modified afterward.

## Benchmarks

Candidate: `v3/@claude-flow/neural/src/sona-manager.ts`, +~70/-7 lines, one file. New test file `__tests__/sona-ewc-consolidation.test.ts` (4 tests), imports the **built** `dist/sona-manager.js` rather than `src/` — importing any `modes/*.ts` file directly still crashes vitest's SSR transform with `Class extends value undefined` (confirmed still present, pre-existing, flagged by `persistence.test.ts` since before tonight; confirmed test-tooling-only, not a production bug — `node dist/sona-manager.js` and the package's own `tsc` build are both clean).

Stash-isolated (baseline = `git stash` on just `sona-manager.ts`, dist rebuilt): baseline 4/4 new tests fail (`mgr.getEWCState is not a function` — the observability the fix adds didn't exist to even check the old behavior). Candidate: 4/4 pass. Full `@claude-flow/neural` suite: 143/143 (139 pre-existing + 4 new), 0 regressions, both with and without the fix for the pre-existing 139. `tsc --noEmit` clean.

## Evaluation

**Verdict: ACCEPT.** `evaluation_complete=true`, `effect_positive=true` (Fisher/means now populate from real weight state where they were permanently empty; `triggerLearning()` now actually calls the EWC consolidation step it always should have), `no_material_regression=true` (143/143, confirmed via stash isolation), `tests_green=true`, `reward_hack_clear=true` (no test/benchmark weakening — see Reward Hack Check), `critic_clear=true` (see below), `witness_valid=true`, `receipt_reproducible=true` (stash-isolation steps above reproduce the result).

## Darwin Results

Ran a bounded, repository-local 3-generation × 4-candidate search (STEP 0.5 fallback: `@metaharness/darwin` is installed but wasn't worth an adapter for one parameter tonight) over hardcoded `EWCConfig.decay` (0.9), fitness = retention of a frozen task-A LoRA state vs. capture of a drifted task-B state after two consolidations. First draft was non-reproducible run-to-run — caught in this session's own adversarial pass: `initializeLoRAWeights()` uses unseeded `Math.random()`, so each candidate silently got a *different* random task-A baseline. Fixed by sharing one frozen, seeded task-A snapshot across candidates (now bit-identical across repeated runs). Once fair, the metric was **degenerate**: `means` is an unconditional snapshot of current weights on every consolidation (correct EWC semantics — it's the elastic anchor point), so a `means`-only metric can't be sensitive to `decay`, which governs only `fisher`. All 12 candidates scored identically. **INCONCLUSIVE** for decay-tuning specifically — not a mark against the fix itself (ACCEPT rests on the unit tests, independent of this benchmark) but a disclosed dead end: a `fisher`-sensitive fitness function would be needed, not worth building tonight. Full 12-candidate lineage is in the PR.

## SOTA Proof & Witness

```
Session commit:            9e4fd175b51fab476889723893fed6ae776b00af
Report SHA256:              98cddb179ff8a99b0914d3c3e9b251487b8adf82f0a02e161982d06252c5c16a
Witness stamp:              85c802eb8aefff7dd2798306ff4e7b277f51076f98ca0694a9b59e2871fcda9f
Evaluation receipt:         @claude-flow/neural full suite 143/143 (139 pre-existing + 4 new),
                             0 regressions; stash-isolated baseline 4/4 new tests fail, candidate
                             4/4 pass; tsc --noEmit clean
Flywheel evidence identity: embedded in this gist + the linked issue/PR (Evaluation section) —
                             no separate signed receipt file this session (same disclosed gap as
                             2026-10-01: ruvector harness flywheel gate/verify needs a JSON
                             evidence schema not populated this session)
Darwin lineage identity:    repository-local script scripts/dream-cycle-ewc-decay-darwin.mjs,
                             committed; 12-candidate lineage in the PR body; INCONCLUSIVE (see
                             Darwin Results — fitness metric proved insensitive to the parameter)
```

Verifier procedure: take this report's content as it existed immediately before this Witness section was written, compute SHA256, concatenate with the session commit, compute SHA256 again — result must equal the witness stamp.

## Recommended Next Steps

1. The larger, disclosed gap: no mode's `learn()` applies its computed gradient back onto `loraWeights.A`/`.B` — LoRA adapters are frozen after init. Tonight's EWC fix is only meaningful once weights actually move; wiring a real update step (even a small one, e.g. `balanced.ts`'s existing `gradientAccumulator` flowing into `A`/`B` at end of `learn()`) is the natural, larger follow-up this finding points at.
2. Fix (or formally file) the `vite-node` SSR circular-import crash (`Class extends value undefined`, `modes/real-time.ts` extending `BaseModeImplementation` via the `modes/index.ts` barrel) blocking direct `src/` tests of `SONAManager` — confirmed still present tonight, first flagged in `persistence.test.ts` before this session. Low urgency (production-safe workaround exists: test against `dist/`), but it's silently suppressing test coverage of this whole file.
3. Design a `fisher`-sensitive (not `means`-sensitive) synthetic benchmark for the EWC decay/lambda tradeoff — tonight's attempt is a disclosed dead end, documented so a future night doesn't repeat the same degenerate metric.
