# Intelligence SOTA Report — 2026-10-27

TL;DR: `SONAManager`'s EWC++ continual-learning mechanism is completely inert in production. `ewcState.fisher`/`.means` initialize empty and **nothing in the core package ever writes to them** (zero `.fisher.set(` calls, confirmed by repo-wide grep); `consolidateEWC()` only decays existing entries and has **zero callers anywhere in the repo**. Every `computeEWCPenalty`/`computeEWCLoss` call across all 5 modes therefore returns exactly `0`, forever. Production-reachable: `SONAManager` backs `NeuralLearningSystem`, loaded by `@claude-flow/memory`'s `learning-bridge.ts`, auto-triggered at 80% trajectory-capacity utilization. The package's own description advertises "EWC++ for continual learning" as shipped. Carried forward as recommendation #3 from last night's (2026-10-26) SCAN finding. **Verdict: ACCEPT-scoped** — this fix makes the EWC *state* real and measurable; it does not itself prove forgetting is reduced end-to-end (see Evaluation for a second limitation found by adversarial critique).

## What's New in 2026

| Finding | Source | Grade |
|---|---|---|
| "Elastic Weight Consolidation Done Right" — critiques EWC's Fisher-based importance (gradient vanishing, inaccurate importance), proposes a fix | Liu & Chang, CVPR 2026 poster (arXiv:2603.18596) | B |
| The empirical-Fisher approximation (squared-gradient accumulation — exactly the style Ruflo's own in-repo plugin reference pattern uses) is *not*, in general, a valid Fisher/curvature estimate | Kunstner, Balles, Hennig, NeurIPS 2019 (arXiv:1905.12558) | A |
| Unconditional memory consolidation can *actively harm* agent utility: GPT-5.4 regresses 54% on ARC-AGI tasks it had previously solved, after forced consolidation; raw-episode agents ~2x the accuracy of forced-consolidation agents | Zhang et al., NeurIPS 2026 (arXiv:2605.12978) | A |
| "Why Routers Freeze": under soft/full softmax MoE routing, experts collapse and router gradients vanish at infinite width; top-K routing (which Ruflo's `moe-router.ts` already uses, K=2) is a symmetry-breaking defense | NeurIPS 2026 poster | A |
| ReasoningBank + Memory-aware Test-Time Scaling (MaTTS): parallel-rollout contrastive signal improves distilled memory quality over single-trajectory judging — Ruflo's own `reasoning-bank.ts` naming appears inspired by this line of work but hasn't ported MaTTS itself | Ouyang et al. (Google), ICLR 2026 accepted (arXiv:2509.25140) | A |
| Bandit-style LLM cost routers without discounting/sliding-windows overshoot cost targets up to 6.9x under post-deployment model drift | ParetoBandit, Apr 2026 (arXiv:2604.00136) | C (single preprint) |

Searched specifically and found **no material change** vs. pre-2026 baseline on: K-FAC-based continual learning for agents; any LangGraph/AutoGen/CrewAI issue/doc mentioning EWC or weight-level forgetting.

## Ruflo Current Capability

`SONAManager` implements online LoRA adaptation across 5 modes. Each mode's `learn()` reads `ewcState.fisher`/`.means` to compute an EWC regularization penalty (`(λ/2)·Σ Fisher_i·(θ_i − θ*_i)²`) intended to resist catastrophic forgetting. The mechanism is fully scaffolded (types, config, decay, serialization) but never wired to anything that writes real values. A reference squared-gradient Fisher estimator already exists, unused by the core package, in `v3/plugins/cognitive-kernel/src/bridges/sona-bridge.ts::computeFisher()` — but that reference's own `consolidate()` is itself a stubbed placeholder, so even it only solves "compute Fisher," not "apply the penalty."

## Competitor Comparison

Genuinely **None** across LangGraph, AutoGen/Microsoft Agent Framework, CrewAI, and OpenAI's agent tooling — confirmed via research, not a blank left by omission. All four are orchestration layers over a frozen foundation-model API with no in-process weight-update loop, so EWC-style forgetting prevention doesn't apply to their architecture at all. The closest production analogue is OpenAI's separate Reinforcement Fine-Tuning product (a distinct hosted service, not bundled into an agent SDK). The closest academic analogue, "EWC-LoRA" (ICLR 2026), validates Ruflo's attempted design even though the implementation was broken.

| Competitor | Mechanism | Touches model weights? | Grade |
|---|---|---|---|
| LangGraph / LangMem | External checkpointer + semantic/episodic/procedural memory store, retrieved into context | No | B |
| AutoGen → Microsoft Agent Framework | "Teachable" vector-store memos; successor adds checkpointed Workflows | No | B |
| CrewAI | RAG-based short/long-term memory; `crew.train()` appends feedback text into the prompt (confirmed via official docs: no gradient-based learning) | No | A (mechanism claim) |
| OpenAI Agents SDK | `Session` objects for conversation history; long-term memory via third-party layers; separate hosted RFT product does update weights | No (SDK itself) / Yes (separate RFT product) | B |
| EWC-LoRA (ICLR 2026) | Fisher-weighted EWC regularization directly on LoRA updates — closest academic analogue to Ruflo's intended design | Yes | A |

## Hypothesis

> Given SONA's default `'balanced'` learning mode processing completed trajectories through `SONAManager.triggerLearning()`, when a real diagonal-Fisher-information estimate (squared-gradient-of-reward, matching the existing in-repo reference pattern in `plugins/cognitive-kernel/src/bridges/sona-bridge.ts::computeFisher()`) is computed from `BalancedMode`'s existing gradient accumulator and folded into `SONAManager`'s `ewcState.fisher`/`.means` via `consolidateEWC()` after each learning cycle, then `ewcState.fisher` should become non-empty and the previously-always-zero `computeEWCPenalty()` should return a strictly positive value when a second, significantly-different task's gradients are evaluated against the first task's consolidated means — subject to: zero change to `BalancedMode`'s existing gradient/momentum update math, zero regression to the existing 23/23-passing `__tests__/sona.test.ts` suite, deterministic $0 zero-LLM Vitest evaluation. Frozen before evaluation; not modified after.

**Scope disclosure** (Kunstner et al., NeurIPS 2019, A-grade): the empirical-Fisher (squared-gradient) approximation this fix ports is not, in general, a theoretically valid Fisher/curvature estimate. Tonight's fix makes the EWC *bookkeeping* real; it does **not** prove forgetting is reduced end-to-end, and the penalty isn't wired into the gradient update (same gap as the reference plugin's stub). KNOWN LIMITATION, not fixed tonight — see Evaluation for a second, deeper limitation found by adversarial critique.

**Deferred** (4 other scored candidates, plus 2 scan findings): MoE router entropy-collapse alerting (4.25, cheap/safe bonus for a future night); router bandit reward-decay for non-stationarity (3.65); gate ReasoningBank distillation on measured utility delta (3.50, grounded in a hard 2026 NeurIPS finding, needs a dedicated night); MaTTS-style parallel-rollout judging (2.85, correctly lowest — not credibly testable in one night).

## Benchmarks

No agent-task benchmark corpus applies — this is a unit-level correctness/wiring fix to an internal learning-state mechanism, evaluated via discriminating Vitest tests (stash-isolated baseline-fails/candidate-passes), consistent with nearly every ACCEPT in this repo's ledger for non-routing/non-topology fixes.

## Evaluation

**evaluated: accepted — ACCEPT-scoped (post-critique).** Real evaluator: Vitest 4.1.8.

Round 1: 4 new tests in `sona-ewc-consolidation.test.ts`, public API only. Stash-isolated baseline: 3/4 fail exactly as predicted (`ewcState.fisher` stays permanently empty); the 4th is a non-discriminating control. Candidate: 4/4 pass. Full suite: 143/143 both ways, 0 regressions. `tsc --noEmit`: 0 errors both ways.

An independent adversarial critic (no authoring context) reproduced all of the above from scratch in an isolated `git worktree` — **CONFIRMED-WITH-CAVEATS**. It found one real, previously-undisclosed issue: round-1's `getConsolidationSnapshot()` squared the raw *lifetime-cumulative* `gradientAccumulator` directly, which diverges without bound (proved empirically: 25 cycles, 0.00012 → 0.68). Round 2 (same session): the snapshot now reports the *change* since the last consolidation (a delta), the theoretically appropriate EWC quantity. Tracing further surfaced a second, deeper, **separate, pre-existing** cause of residual growth: `triggerLearning()` re-processes *every* completed trajectory the manager still holds on every call (nothing marks one "already learned from"; only `pruneTrajectories()`'s 50%-capacity threshold ever removes one), so gradient movement per cycle grows with the historical backlog — confirmed via a 150-cycle traced script (delta grows roughly linearly, well past where momentum alone would have settled). **Disclosed, not fixed tonight**; named as the priority follow-up, ahead of ever wiring the penalty into a real gradient update. Two other critic nits — an overclaimed "Fisher == means²" invariant (really a single-cycle construction identity) and an incomplete stale-artifact cleanup (12 more tracked `.d.ts`/`.map` files) — were both fixed the same session; re-verified 143/143, 0 tsc errors, clean build.

## Darwin Results

Skipped — this is a binary wiring/correctness fix, not a continuous/categorical parameter Darwin's bounded-evolution interface (confirmed reachable tonight via `npx ruvector@0.3.3 harness darwin <config> --execute`) can search over. The EWC `decay` rate (`config.decay = 0.9`) is the one plausible future-night Darwin target on this exact subsystem, but tuning it is a distinct research question from tonight's frozen hypothesis and wasn't pursued. Same skip class as nearly every accepted fix in this repo's history that wasn't a routing/topology weight.

## SOTA Proof & Witness

Session commit:   e30d81b845815dbfaed2c4085790b23ed7654f91
Candidate commit: 9c76cf2626b38f43a169aac0427bfc57c78880d9
Gist SHA-256 (pre-witness, witness block stripped to PENDING): a255b49f201f54d97d1bc9b7e08f8365e31bebb8a9ec16454a278de649f77f26
Witness stamp:    7b5244831e1c66b2c227361029162c9e71f5e195139b0d46cbdb2f85f71bc18e

Verifier: fetch this file, strip this block's filled-in values back to `PENDING`, SHA-256 the file, concatenate with the Session commit above, SHA-256 again — must equal the Witness stamp.

Evaluation receipt identity: 4 new tests in `sona-ewc-consolidation.test.ts`, stash-isolated 3/4-fail-baseline → 4/4-pass-candidate, independently reproduced in an isolated worktree by a fresh-context adversarial critic, who also found and this session fixed forward a real unbounded-growth issue (see Evaluation section). Flywheel evidence identity: none (`.claude-flow/flywheel/` doesn't exist in this repo, confirmed, same as every prior night) — retained as this gist, the tests, the stash comparisons, and the adversarial critique transcript. Darwin lineage identity: none (skipped, see above).

## Recommended Next Steps

1. **Fix `triggerLearning()`'s trajectory-reprocessing** (new finding, this session) — track "already learned from" so each cycle only processes new trajectories; the root cause of tonight's disclosed residual Fisher growth. Should land *before* #2.
2. **Wire the EWC penalty into the actual gradient/LoRA update**, not just compute it — the natural fast-follow on this exact subsystem, but only safe once #1 lands.
3. **MoE router entropy-collapse alerting** (score 4.25) — cheap, additive, fully testable, no file overlap with tonight's fix.
4. **Gate ReasoningBank distillation on measured utility delta** (score 3.50) — grounded in a hard 2026 NeurIPS result; needs a dedicated night.
