# ADR-391 — Change the Default Router Only on a Measured Win

**Status**: Proposed
**Date**: 2026-09-23
**Related**: ADR-150 (MetaHarness AND-gate), ADR-389, ADR-390, PR #3406 (opt-in `@ruvector/typesafe` router)
**Surfaces**: `hooks_route`, `v3/@claude-flow/cli/src/ruvector/router-parallel-recorder.ts`, a new bench under `v3/@claude-flow/cli/benchmarks/`

## Context

There are now four ways RuFlo could pick an agent, and no evidence on which is best:

| Candidate | What it is | Status |
|---|---|---|
| **A** current | semantic router over hash embeddings + keyword fallback | default |
| **B** MiniLM | A, with the real sentence embedder (ADR-390) | proposed |
| **C** typesafe-hash | `@ruvector/typesafe`, default hash embedder | opt-in since 3.43.0 |
| **D** typesafe-onnx | `@ruvector/typesafe` with bge-small / MiniLM | untested |

The evidence so far is a handful of hand-picked prompts. Typesafe's own lift
threshold (1.2×) was set from a **10-task** sample. That isn't enough to justify
changing what every user gets.

The data source this needs isn't populated yet. `router-parallel-recorder.ts`
writes `.swarm/router-parallel.jsonl`, but:
- only when `CLAUDE_FLOW_ROUTER_PARALLEL_LOG=1`
- task text is excluded unless `CLAUDE_FLOW_ROUTER_PARALLEL_LOG_TASK=1`

On the maintainer's machine the file does not exist. There is no history to mine
today.

## Decision

1. **Build the corpus first.**
   - Collect **150–200 real task prompts**. Sources: the parallel log (collected
     with both env flags on, and scrubbed of anything sensitive), plus
     prompts from this repo's issues and PR titles.
   - Label each with the correct agent, blind to any router's output.
   - Include negatives: prompts that fit no agent, where abstaining is correct.
   - Freeze the corpus with a hash and split it into **dev** (tuning thresholds) and
     **test** (the decision). The test split is touched once per candidate.
2. **Run all four candidates on the same frozen test split.** For each, measure:
   - top-1 accuracy
   - macro-F1
   - wrong-with-high-confidence rate
   - abstain precision (C and D)
   - p50/p95 latency, cold and warm
   - dependency and install cost
3. **Promotion rule** (the ADR-150 AND-gate, restated for routing). A candidate
   replaces the default only if, against A:
   - accuracy is **more than 2 points** better
   - it adds no required dependency (optional peers and fallbacks are allowed)
   - p95 latency regresses by **no more than 5%** warm, with cold start reported
     separately
4. **Tie-break role for typesafe.** If C or D doesn't win outright but its abstain
   signal predicts A's errors, it may become a second opinion: consulted only when
   A's top two scores are within a margin. That needs its own measured win on the
   same split.
5. Results, the corpus hash and the per-candidate receipts are committed under
   `benchmarks/results/`, whatever the outcome. A loss is recorded, not deleted.

## Consequences

- The default router changes only on evidence. B (no new dependency) is the
  expected winner, but that's a prediction this ADR exists to test.
- Typesafe stays opt-in unless it earns more. PR #3406's design already allows
  either outcome.
- Labelling 150–200 prompts is real work. It's also reusable: the same corpus
  evaluates any future router change.

## Verification

- The bench script re-runs deterministically from the frozen corpus (fixed seeds,
  pinned model hashes).
- A CI job re-runs the bench on changes to `hooks_route` and fails if the default's
  accuracy on the test split drops below the committed receipt.
