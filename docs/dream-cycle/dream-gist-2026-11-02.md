# Intelligence SOTA Report — 2026-11-02

**TL;DR**: 2026 continual-learning research converges on a specific warning for self-learning agents: diagonal-Fisher EWC (exactly what Ruflo's SONA implements) is a known-imperfect approximation, and "capability erosion" from self-adaptation is now a named failure mode in the agent literature, not just a classic ML concern. Tonight directly continues 2026-10-27's (#4531/#4532) and 2026-11-01's (#4633 SCAN) own disclosed gap: `BalancedMode` was the only one of SONA's 5 learning modes wired into `SONAManager`'s EWC++ consolidation path. Investigating the other 4 modes found they are **not structurally equivalent** — `ResearchMode` already maintains real per-key gradient-shaped state (an Adam optimizer's `adamM`/`adamV`, already read back by its own dormant `computeEWCLoss()`), so it can be wired honestly using the exact reviewed Balanced-mode pattern. `EdgeMode` and `RealTimeMode` cannot be, without fabricating state from nothing. `BatchMode`'s gradient map is real but is zeroed on its own independent flush cadence, making a direct port semantically ambiguous rather than a clean port. Tonight wires `ResearchMode` only and discloses the other three with evidence, rather than stubbing all four uniformly.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| Diagonal-Fisher EWC misses cross-parameter correlations; at low SNR per-sample gradients align and the empirical Fisher is closer to rank-1 — a rank-1 EWC+replay variant nearly eliminates forgetting on class-incremental benchmarks | arXiv:2509.23593 (ICLR 2026 poster), revised 2026-01 | A |
| "EWC Done Right": standard EWC's Fisher-matrix reliance can cause vanishing gradients and inaccurate importance estimates in some regimes; proposes EWC-DR | arXiv:2603.18596 (CVPR 2026 submission) | B |
| "Capability erosion" named explicitly as a multi-channel agent failure mode (workflow/skill/model/memory adaptation each degrade prior ability); preservation strategies reduce it across all four channels | arXiv:2605.09315 | B |
| Synthetic-data fine-tuning for agent skill retrieval causes real forgetting: OOD recall fell 0.850→0.650 in the most aggressive setup studied (34,396-skill corpus) | arXiv:2609.10750 | B |
| "How Fast Do Agents Rot?": geometric decay fits 28/36 model-task cells for long-horizon agent reliability; projects 0.42 (GAIA-length) → 0.24 (100-step production horizons) | arXiv:2609.01660 | C (single study) |

## Ruflo Current Capability

`SONAManager` (`v3/@claude-flow/neural/src/sona-manager.ts`) runs 5 pluggable learning modes (`real-time`/`balanced`/`research`/`edge`/`batch`) behind one `ModeImplementation` interface. `triggerLearning()` calls `modeImpl.learn()` then a mode-agnostic `updateEWCConsolidation()` hook that folds an optional `getConsolidationSnapshot()` into `ewcState.fisher`/`.means` via online-EWC decay+accumulate. 2026-10-27 implemented that optional hook for `BalancedMode` only (scoped deliberately); 2026-11-01's SCAN re-disclosed the other 4 modes as still contributing nothing. Direct inspection tonight of all 4 (`edge.ts`, `real-time.ts`, `research.ts`, `batch.ts`) found they are not one uniform gap: `ResearchMode` already runs a full Adam optimizer (`adamM`/`adamV`, persistent across calls, already consumed by its own long-dormant `computeEWCLoss()`) — structurally identical to Balanced's `gradientAccumulator`. `EdgeMode` stores only quantized `Int8Array` weights and compressed patterns (no per-key `Float32Array` gradient map exists to snapshot). `RealTimeMode`'s `learn()` contains the literal comment "we skip full backprop" and tracks no gradient state at all. `BatchMode` has a real `accumulatedGradients: Map<string, Float32Array>`, but `applyAccumulatedGradients()` deliberately `.fill(0)`s it every 4 learning cycles — a delta-since-last-EWC-snapshot measured at an arbitrary point relative to that independent flush would not mean "this cycle's movement" the way it does for Balanced/Research.

## Competitor Comparison

| Competitor | Mechanism | Weight-level continual-learning / forgetting mitigation? | Grade |
|---|---|---|---|
| LangGraph | Graph-state persistence across turns; human-in-the-loop checkpoints | No — state/memory management, not weight consolidation | C |
| AutoGen → Microsoft Agent Framework (1.0, 2026-04) | Custom memory stores per agent | No — externalized memory, not weight-level EWC/regularization | C |
| CrewAI | Built-in memory management, "flows" mode (2026) | No — same external-memory shape | C |
| OpenAI Agents SDK | Tight integration to Assistants/function-calling; no documented weight-adaptation layer | No — stateless-weights-by-design; forgetting is out of scope | C |
| **Ruflo (SONA)** | Per-mode LoRA adaptation + EWC++ Fisher/means consolidation (now 2/5 modes wired) | Partial — the only reviewed source with an actual weight-regularization mechanism, still incomplete | — |

The uniform "None" here is explained, not just reported: all four frameworks manage conversation/task **state**, not model **weights** — none of them fine-tune or adapt parameters in production the way SONA's LoRA+EWC pipeline does, so "catastrophic forgetting" in the classical sense is architecturally out of scope for them. This is a genuine differentiator, not an oversight on their part — and it means Ruflo owns both the capability and the risk the 2026 capability-erosion literature describes.

## Hypothesis

> Given SONA's `'research'` learning mode processing completed trajectories through `SONAManager.triggerLearning()` using its existing Adam-optimizer first-moment state (`adamM`), when a real diagonal-Fisher snapshot (squared delta of `adamM` since the last consolidation) is computed from that existing optimizer state and folded into `ewcState.fisher`/`.means` via the already-existing, mode-agnostic `updateEWCConsolidation()` path (zero `sona-manager.ts` changes required), then `ewcState.fisher`/`.means` should become non-empty and `ResearchMode`'s own existing, previously-inert `computeEWCLoss()` should return a strictly positive value after a second learning cycle — subject to: zero change to `ResearchMode`'s existing Adam-update math, zero regression to the `@claude-flow/neural` suite, deterministic $0 Vitest evaluation, and explicit non-claims that EdgeMode/RealTimeMode (no real gradient-shaped state to snapshot honestly) and BatchMode (gradient map reset on an independent flush cadence) remain unwired. Frozen before evaluation; not modified after.

## Benchmarks / Evaluation

Real evaluator: Vitest 4.1.8, `@claude-flow/neural`. 5 new tests (3 discriminating, 2 controls) in `__tests__/sona-ewc-consolidation-research.test.ts`, mirroring the reviewed Balanced-mode test file's structure. Stash-isolated baseline (`research.ts` reverted): 3/5 fail exactly as predicted (`ewcState.fisher/means` stay empty for research mode). Candidate: 5/5 pass — independently reproduced from scratch by a fresh-context adversarial critic, who also independently ran the full suite and `tsc`. Full `@claude-flow/neural` suite: **153/153** both ways except the 3 discriminating failures (8 files, 0 regressions). `tsc --noEmit`: 0 errors both ways.

## Adversarial Critique

**CONFIRMED-WITH-CAVEATS** (independent fresh-context critic). Verified: zero `sona-manager.ts` changes needed (hook is genuinely mode-agnostic); `adamM`'s never-cleared-except-init/cleanup lifecycle is structurally sound for the delta-since-snapshot approach (not the raw-cumulative-squaring bug Balanced's own fix corrected); non-finite guards hold under length mismatch; Fisher/means key sets agree with what `computeEWCLoss()` reads back. Re-ran the full suite, `tsc`, and their own independent stash-isolation — all matched. Confirmed by direct read that Edge/RealTime/Batch's "not wired" claims are accurate, not just asserted. On reward-hacking: using `adamM` (an EMA, not a raw gradient) as the Fisher-estimation input was judged **not** metric substitution — it's the same empirical-Fisher-via-smoothed-gradient approximation already reviewed and merged for Balanced mode, applied consistently. **One nit, fixed forward same session**: the "decays before folding in fresh evidence" test only asserted `> 0` instead of the stronger `> valueAfter1 * 0.9` Balanced's own test uses; tightened after the critic empirically confirmed a ~7.5x ratio comfortably clears that bound.

## Darwin Results

Skipped — binary wiring/correctness fix (a mode either implements `getConsolidationSnapshot()` or it doesn't), no continuous/categorical parameter for Darwin's bounded-evolution interface to search over. Same skip class as nearly every EWC-wiring ACCEPT in this repo's dream-cycle history (2026-10-27, and most binary-fix nights generally).

## Flywheel Evidence

No `.claude-flow/flywheel/` state exists in this checkout (confirmed by direct inspection, same as every prior night). Evidence retained as: the 5 new tests, both stash-isolated comparisons (session + independent critic), the issue, this gist, and the witness below.

## Reward Hack Check

Clean. Diff is additive-only (new method + 2 lines in `initialize()`/`cleanup()` + a new test file); no existing test, threshold, or gold data touched; $0, fully deterministic; independently re-verified by the adversarial critic, who specifically scrutinized the Adam-moment-as-Fisher-input choice (see above) and found it consistent with the already-reviewed Balanced-mode precedent, not a loosening.

## Scan Findings

**capabilities**: `.harness/mcp-policy.json` still falsely claims `allowShell:false`/`allowNetwork:false` at the MCP layer while `terminal_execute` and `http_fetch` MCP tools both exist in `@claude-flow/cli/src/mcp-tools/`, directly contradicting it. This is now the **3rd consecutive** disclosure (2026-10-26, 2026-10-27, tonight) without action — each night correctly treated it as "a design question, not a unilateral patch" rather than acting unilaterally, but per STEP 1.1 this now needs a deliberate human decision on a future night rather than a 4th deferral.

**memory**: `CacheManager.clear()` (`v3/@claude-flow/memory/src/cache-manager.ts:218-224`) still reads `this.cache.size` **after** calling `this.cache.clear()`, so the emitted `cache:cleared` event's `previousSize` is always `0`. Confirmed still live (2nd consecutive disclosure since 2026-10-27). Small, mechanical, one-line fix — a strong future-night pick.

## SOTA Proof & Witness

```
Session commit:   5f3dacc54b7279e39b172d6027d7989791448e2e
Candidate commit: PENDING
Witness stamp:    PENDING
```
Verifier: fetch this gist, strip the Witness block's filled-in values back to `PENDING`, SHA-256 the file, concatenate with the Session commit above, SHA-256 again — must equal the Witness stamp.

## Recommended Next Steps

1. **Fix `CacheManager.clear()`'s `previousSize:0` bug** (memory SCAN) — one-line, mechanical, high-confidence next-night pick, now twice disclosed.
2. **Force a deliberate decision on `.harness/mcp-policy.json`'s false shell/network claim** (capabilities SCAN) — 3rd consecutive disclosure without action; either tighten the policy's `$comment` framing to acknowledge native-tool-layer reach, or treat it as a real policy gap, but stop re-deferring it silently.
3. **Give `BatchMode`'s EWC wiring its own dedicated design pass**, not a port of tonight's pattern — specifically, decide what "this cycle's movement" should mean when `accumulatedGradients` is reset on an independent 4-step flush cadence, before attempting it.
