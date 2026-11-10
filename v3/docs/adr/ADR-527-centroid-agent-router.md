# ADR-527: Opt-in nearest-centroid agent router; ruv-fann routing deferred

- **Status:** Accepted (opt-in pilot; not the default)
- **Date:** 2026-11-10
- **Related:** [ADR-391](ADR-391-router-benchmark-gate.md) (router benchmark gate), ADR-390 (router embedder), ADR-148/149 (model-tier neural router, a separate path)
- **Surfaces:** `hooks_route` (`routeTaskLocal`), `src/ruvector/centroid-router.ts`, `assets/agent-router/centroids.minilm.json`, `benchmarks/router/{build-centroids,run-bench}.mjs`

## Context

The question was whether ruv-fann (`ruv-fann@0.1.2`, a dense MLP runtime over
WebAssembly with SGD/AdamW training) should become part of ruflo's agent routing.
It was measured on the frozen ADR-391 corpus: 197 labelled prompts, 11 labels
(10 agents plus `none` for "no agent fits"), split into 84 `dev` and 113 `test`.
MiniLM (`Xenova/all-MiniLM-L6-v2`, 384-d) embeddings, the ones ADR-390 added.
Every model choice was made on `dev` (5-fold cross-validation); `test` was
scored once per method.

| Router (held-out test, n = 113) | Accuracy | Notes |
|---|---|---|
| A — current default (hash semantic + keyword) | 25.7% (29) | ADR-391 run |
| B — current router on MiniLM | 36.3% | ADR-391 run |
| ruv-fann MLP trained on dev | 57.8% ± 1.5 | 10 seeds; dev-CV picked 384→32→11, 100 epochs |
| Nearest centroid on dev (offline) | 62.8% (71) | one mean vector per label |
| ruv-fann layer initialised at the centroids | 62.8% | dev-CV picked **0 training epochs** |

Training never improved on the centroid it started from: on dev cross-validation
every amount of ruv-fann training lowered accuracy. The gain over the default
comes from learning from labelled examples, not from the network.

Measured ruv-fann properties worth recording for a later decision:
- Inference about 5–11 µs per row; SIMD helps batches only (about 1.45×).
- Each `train` call is capped at `rows × (32 × params + 8 × (in + out) + 1) × epochs`
  ≤ 1e8, about 5 epochs at 84 rows × 6k parameters. Longer training must be split
  into calls that resume from the returned model, and AdamW state resets per call.

## Decision

1. **Ship a nearest-centroid agent router, opt-in.** `CLAUDE_FLOW_ROUTER_CENTROID=1`
   turns it on in `hooks_route`. Off, routing is byte-for-byte unchanged.
   - One unit-length centroid per label: the mean MiniLM embedding of the
     label's **dev** prompts. Built by `benchmarks/router/build-centroids.mjs`;
     `--check` fails when the committed file no longer matches the corpus.
   - **Versioned with the embedder.** The artifact records `embedder`, `model`
     and `dim`. A query embedded any other way is never scored against it:
     MiniLM degrading to the hash embedder, a different MiniLM runtime
     (`agentic-flow/…` or `ruvector/…` rather than `Xenova/…`), or another
     dimension all come back `unavailable` and the current router decides.
   - **Fallback on near-ties.** When the top two centroid scores differ by less
     than the margin, the current router's pick stands (`status: 'fallback'`).
     Default margin 0.005, override with `CLAUDE_FLOW_ROUTER_CENTROID_MARGIN`.
     Dev-CV accuracy fell as the margin grew (0 → 50.0%, 0.005 → 47.6%,
     0.02 → 45.2%) because the router it falls back to is weak; 0.005 is the
     smallest grid value that still sends near-ties back.
   - **`none` abstains.** A decided `none` returns `matched: false`,
     `matchedPattern: 'centroid-abstain'`.
   - Every response under the flag carries `centroid: { status, label, score,
     runnerUp, margin, baselineAgent, … }`. `baselineAgent` is what the current
     router would have picked, so a pilot can compare both on the same task.
2. **Defer ruv-fann for routing** until there are enough verified task outcomes
   to test whether a trained model beats the centroid under dev-only selection.
3. **Neural tools, a skill and a console panel** for training classifiers on user
   data are scoped separately, when there is a concrete use case.
4. **The 113 test prompts are now a regression set.** They have been looked at;
   the next routing decision uses fresh tasks.

## Measured (full pipeline, `run-bench.mjs --only A,B,E`)

Corpus sha256 `b0c1923b…bf04`. Receipt `benchmarks/router/results/router-bench-2026-11-10.json`.

| | Test acc | Macro-F1 | Wrong @ ≥0.7 conf | Traps | p50 / p95 warm | Cold |
|---|---|---|---|---|---|---|
| A | 25.7% | 0.178 | 8.0% | 29.0% | 0.73 / 1.20 ms | 40 ms |
| B | 36.3% | 0.334 | 5.3% | 25.8% | 5.5 / 11.8 ms | 457 ms |
| **E — centroid** | **63.7%** (72) | **0.627** | **0%** | **45.2%** | 6.6 / 17.1 ms | 3.2 s |

E decided 98.2% of test prompts and fell back on 1.8%. Its dev score (96.4%)
is in-sample and is not evidence.

ADR-391 gate for E: accuracy +38.1 points (passes), no required dependency
(passes), p95 latency +1323% (fails; MiniLM embedding dominates, and the first
call loads the model). That latency failure is why this stays opt-in.

## Acceptance test for making it the default

Label agreement is pilot evidence only. The default changes only on verified
task outcomes:

- Run the centroid router and the current router on **fresh** tasks at the
  **same task budget**.
- Require **lower cost per verified solve at a matched solve rate**.
- Report the centroid's fallback and `unavailable` rates alongside.
- Latency still has to be addressed or explicitly accepted (ADR-391 rule 3).

## Consequences

- Users who opt in pay the MiniLM model load once and about 6–17 ms per route.
- The artifact is 40 KB and ships in `@claude-flow/cli` (`assets/agent-router/`).
  The rest of `assets/` is not in the package's `files` list, so the model-tier
  router's bundled seed artifacts (`assets/model-router/`, 4.8 MB) do not reach
  npm users today; that is a separate issue.
- Relabelling or growing the corpus means rebuilding the centroids; `--check`
  and the artifact test catch a stale file.
