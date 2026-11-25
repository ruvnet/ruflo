# Actual Claude actor pilot: v1 evidence and oracle failure

Date: 2026-10-25. Associated draft PR #4474. This is separate from the synthetic
cost and local-code routing experiment. Full safe plan, selection, generated code,
SDK model usage and outcomes are in [the v1 archive](managed-actor-pilot-v1.json).
[Read-only analysis](managed-actor-pilot-v1-analysis.json) verifies the plan hash,
training selection rule, seeded random choices, task identity and complete rows.

## Observed execution

The existing authenticated Claude Code host on ruOS executed 98 actual model calls:
eight training calls and 90 audit calls. Tools and MCP servers were disabled,
session persistence was disabled, each call had a reported-cost budget, and the
host admitted one call at a time under a $0.99 aggregate reported-cost envelope.
The runner selected one global prompt style using training correctness then cost.
Selection froze before audit calls. This was a plain Python selector, not the
native `managed_agent_learning` operation.

Generated functions ran in bubblewrap with separate network/PID namespaces, no
home mount, cleared environment and read-only runtime mounts. Node's 64 MB old-heap
setting is not a total RSS, tmpfs or OS memory limit. A VM alone is not a security
sandbox; the OS process boundary and mount/network isolation carry that boundary.

| Arm | Declared oracle passes | SDK-reported audit cost | Observed p95 |
| --- | --- | --- | --- |
| Fixed explanatory prompt | 27/30 | $0.1850866 | 11,530 ms |
| Seeded random prompt selection | 27/30 | $0.1549400 | 8,374 ms |
| Training-selected compact prompt | 27/30 | $0.1156064 | 6,436 ms |

Total reported cost including training: **$0.4848662**. The learned prompt used
37.54% less reported audit cost than the fixed baseline and 25.39% less than the
random control. These are descriptive SDK-reported list-cost observations,
including the provider's reported cache basis, not an invoice audit or a
preregistered proof of general improvement.

## Why this is not accepted proof

Independent review found a real flaw in the executed acceptance test. The v1
runner embedded expected cases as JavaScript object literals. An expected
`{"__proto__":1,"a":2}` then treats `__proto__` as prototype syntax, losing the
own property the test was supposed to require. A correct generated solution using
`Object.create(null)` was rejected. This is an actual false failure, not merely
a hypothetical threat model.

Two other failures expose specification gaps: the Fibonacci task did not define
a finite JSON-number return instead of BigInt; the topological-sort task did not
state the exact `solve(nodes, edges)` signature. The VM runtime also omitted
TextEncoder/URLSearchParams without saying so in the model prompt. Therefore the
27/30 scores do not establish validated quality equivalence. The archived failed
tasks are the same across arms, but shared grader errors do not prove correctness.

A better global fixed compact prompt could explain the observed cost reduction.
No separate static-best arm was executed. Native managed learning uses integer
cents, while this selector used float USD; subcent training costs would collapse
to the same rounded cent and cannot be represented as a native cost benefit.
No Ed25519 registration/oracle chain, independent-family validation or rGi/AVO
release gate was executed for this pilot.

Do not repair these scores after seeing audit outputs and call them new proof.
The full original runner is archived byte-for-byte as
[scripts/managed-proof/actor_pilot_v1.py](../../scripts/managed-proof/actor_pilot_v1.py),
SHA256 `a2ce770a5db3d3f6bfc12e3278b478dae9c9cf9428a74644de581f455bd8f4d3`.
Its defects are retained for reproducibility.

## New version and fresh confirmation

The separate v2 runner fixes expected-case parsing through JSON.parse, constructs
arguments inside the VM realm, disables dynamic code generation and avoids
unbounded capture of generated-code diagnostics. It rejects nonfinite/boolean
metering, records timeout/unknown-spend terminal artifacts, keeps missing outcomes
in denominators and stops further admission when spend is unknown.

V2 requires a fresh host manifest with explicit argument names, finite JSON return
types and reference implementations. Published v1 tasks and duplicate/overlapping
inputs are rejected. Every reference must pass the exact frozen oracle before any
paid inference. These checks do not prove semantic independence or adequate test
coverage; independent corpus review remains necessary.

A separate primary cost endpoint is frozen before new inference: at least 10%
reported-cost reduction against fixed and random controls, paired cost sign tests
at alpha .025 each, no per-task correctness regression, no p95 regression, all
30 audit tasks present and failed task costs included. This global-prompt efficiency
endpoint does not weaken or replace the existing quality-lift proof gate. Its
independent-pair assumption remains conditional on corpus curation, and it cannot
claim model intelligence or context-adaptive routing.

The v2 source and regression tests are included, but a fresh v2 model campaign's
result must be archived separately. Passing offline tests must never be presented
as a completed fresh model run.
