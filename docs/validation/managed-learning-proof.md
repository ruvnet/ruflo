# Independent managed learning proof experiment

Date: 2026-10-25. Depends on PR #4471. See
[ADR 0005](../../plugins/ruflo-agent/docs/adrs/0005-independent-learning-proof.md)
and the [source-bound JSON receipt](managed-learning-proof.json).

## Result

The experiment **does not prove adaptive agent improvement**. It demonstrates the
verification failure mode and rejects an attractive but unsupported success claim.

| Check | Observed result |
| --- | --- |
| Strict TypeScript | Passed |
| Protocol assertions | 44 passed, including positive synthetic statistical fixtures |
| Executable local workload assertions | 20 passed |
| Actual worker subprocesses | 260 |
| Training | 20 signed outcomes, ten disjoint inputs for each of two strategies |
| Fresh audit rounds | Two, 30 cases each, five correlated source-function families |
| Learned route | Actual Ruflo cycle selected strict validation |
| Fixed shallow baseline | 10/30 correct in each round |
| Learned route | 30/30 correct in each round |
| Static strict comparator | 30/30 correct in each round |
| Adaptive gain over static strict | Zero |
| Weak verifier false positives | 55 output errors would pass a shape-only acceptance check |
| Valid signed weak training | Selected the weak baseline under synthetic cost ranking |
| Statistical proof classification | Inconclusive, insufficient independent families |
| Replay | 20 duplicates, zero new training outcomes |
| Live provider calls in this experiment | Zero |
| Defaults changed or promotion authorized | False |

The baseline was deliberately weak fault injection. Selecting a stronger existing
validator is a routing mechanism, not evidence of emergent intelligence. The static
strict control performs equally well, so attributing that lift to adaptive learning
would be incorrect. The seeded random control uses the same two available strategies
and equal per-task envelopes; its exact counts are in the receipt.

The independent oracle compared outputs with host-owned expected outcomes. Correct
signatures on weak acceptance verdicts did not make those verdicts correct. Distinct
oracle and training keys prevent accidentally substituting authorities, but cannot
establish independent personnel, trustworthy labels or hidden-data isolation.

## Reproduction

With TypeScript 5.9.3 and Node type declarations available in node_modules:

```sh
node node_modules/typescript/lib/tsc.js --target es2022 --module nodenext \
  --moduleResolution nodenext --strict --skipLibCheck --types node \
  --outDir /tmp/managed-proof scripts/test-managed-proof.mts \
  scripts/e2e-managed-proof.mts scripts/managed-proof-worker.mts
node /tmp/managed-proof/scripts/test-managed-proof.mjs
node /tmp/managed-proof/scripts/e2e-managed-proof.mjs
```

The workflow `managed-learning-proof.yml` repeats this on Node 20 and 22 and
uploads the full result. The pinned rGi evaluator was byte-compared with upstream;
SHA256 is `151fc23d209129a0fb5bd746fc3338831feb3017e208dae5d969ec3b2d42cf6e`.
The scoped pinned Ruflo 3.25.6 code scan reported zero heuristic findings. It is
not a dependency vulnerability audit or a proof that the host oracle is sound.

## What remains to prove

Run a separately preregistered campaign with at least 30 genuinely independent
production-like task families, a sensible existing fixed baseline, random routing
and a competitive static best control. Freeze training/selection and the full
search family before revealing fresh audit tasks. Use actual metered actor work,
independent hidden tests and source-bound artifacts. Require at least 10% lift,
family-corrected significance, no task/domain safety or quality regressions and
no cost increase and no p95 latency regression. More cases from the same function must not inflate independence.

This host-only API does not start Autogenous, rGi or AVO runtimes. It directly
reuses the pure rGi evaluator and adopts the other systems' bounded variation and
claim separation patterns. It cannot globally prevent a privileged host from
resetting campaign state or lying about evidence origin; operational custody and
independent evaluation remain necessary.

A separate [actual Claude actor pilot](managed-actor-pilot-v1.md) subsequently ran
98 model calls. Its observed cost reduction is qualified by a confirmed grader
bug and is not accepted as proof. It does not change the local experiment result
or the existing quality-lift gate.
