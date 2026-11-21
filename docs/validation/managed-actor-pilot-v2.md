# Fresh confirmation: lower cost against fixed baseline, overall gate failed

Date: 2026-10-25. Draft PR #4474. This is the fresh confirmation after the v1
oracle defect, not a retrospective repair of v1 scores.

The frozen v2 endpoint **did not pass overall**. A learned global prompt reduced
reported cost against the fixed baseline, but did not establish consistent cost
improvement against randomized selection. Do not promote it as proven general
agent improvement or keep rerunning fresh audits until one passes.

## Preregistered endpoint and exact execution

Before any paid v2 call, the runner froze explicit function parameters, finite JSON
return types, a core ECMAScript runtime, the full task manifest and a separate
cost endpoint: at least 10% lower total reported cost against both fixed and
random controls, paired cost sign tests at alpha .025 per control, no per-task
correctness regression, no p95 regression and complete audit/cost accounting.
Costs of failed tasks are included. This does not modify the existing quality-lift
proof gate, which these equal-quality observations cannot satisfy.

All 34 reference implementations passed the exact bubblewrap oracle before any
model inference. Training used four tasks per prompt style. It selected one
compact global prompt by correctness then reported cost, froze that selection and
executed 30 fresh audit tasks across fixed, seeded random and learned arms.
All 98 calls completed; total SDK-reported cost including training was **$0.4765472**.

| Arm | Declared oracle passes | Reported audit cost | p95 |
| --- | --- | --- | --- |
| Fixed explanatory prompt | 30/30 | $0.1694662 | 5,556 ms |
| Seeded random prompt selection | 30/30 | $0.1420766 | 5,432 ms |
| Training-selected compact prompt | 30/30 | $0.1275412 | 3,882 ms |

| Learned comparison | Cost reduction | Paired cost wins / losses | One-sided p | Endpoint |
| --- | --- | --- | --- | --- |
| Fixed baseline | 24.739% | 22 / 8 | 0.0080624 | Pass, conditional on task independence and oracle validity |
| Random control | 10.231% | 15 / 15 | 0.5722322 | Fail |

Training itself cost $0.0374632 across all eight calls. Including that overhead,
the learned first 30-task batch would cost $0.1650044 versus fixed $0.1694662:
only **2.63% net first-batch reduction**, not 24.739%. At the observed means,
training breaks even after about 26.8 similar tasks. That is descriptive arithmetic,
not a production forecast; experimental control arms, verification and VM costs
are additional.

The lower aggregate cost against random is not enough: wins and losses were split
evenly across tasks, failing the frozen paired test. Latency and observed per-task
correctness gates passed. Overall conjunction: **false**.

## Provenance and interpretation

[Full safe archive](managed-actor-pilot-v2.json) includes the plan, frozen training
selection, all 98 generated outputs and model usage, reference checks and exact
source hashes. [Independent analysis](managed-actor-pilot-v2-analysis.json)
recomputes the endpoint and matches the executed result exactly.

[Exact executed raw manifest](managed-actor-pilot-v2-manifest.json), SHA256
`3cb074a0113f6d6331ddbb585a96a39e2bb3a0f376d3af41ee7063fafec1f1e5`, is retained.
Two later local wording clarifications were **not** in the running campaign and
are not presented as if they preceded its freeze.

Executed source is archived unchanged:

* [actor_pilot_v2.py](../../scripts/managed-proof/actor_pilot_v2.py), SHA256 `6b8d50b2f9c0f8fe63d480d866d755775e8ef5ab2ff0d2898c3c0cec34bfbcb2`.
* [cost_endpoint_v2.py](../../scripts/managed-proof/cost_endpoint_v2.py), SHA256 `a424859c3618004407cf0f759e084fd4c32d92387839e1670725085fa5dfec2e`.

This is actual model execution and bounded global prompt selection, not native
managed learning, contextual routing, weight updates or AVO release qualification.
The task corpus is hand-curated programming microtasks; 30 labels do not prove
30 independent production task families. Provider model and cache accounting are
SDK-reported, not independently reconciled invoices. A universally better static
compact prompt remains an alternative explanation. The fixed baseline requested
an extra explanation field, while the common grader evaluated code only. Removing
that unnecessary narrative is a legitimate output-cost optimization; it does not
establish better reasoning or full feature equivalence for production workflows
that actually require explanations or audit narratives.

The existing native learning schema stores integer cents. Subcent provider calls
collapse under rounding, while this Python selector used float USD. A prospective
native integration needs an explicitly versioned precise cost contract and a fresh
campaign. Agreement with a later native replay must not be relabelled as causal
native selection before this audit.

## Oracle review and next version

Post-run source inspection found that nullable Dijkstra outputs explicitly convert
unreachable Infinity to null; no observed NaN/toJSON/JSON override false pass was
found in the recorded programs. Nevertheless, generic v2 oracle holes remain:
JSON serialization can coerce nonfinite values to null, invoke toJSON and let
modified VM JSON methods hide input mutations. These are fixed only in the next
v3 source and offline regressions. No v2 scores are repaired or rescored as new
confirmation evidence.

The v3 serializer captures pristine intrinsics before generated code, rejects
nonfinite/undefined/accessor/sparse/custom-prototype results, never invokes toJSON
and serializes checked plain JSON data inside the timed VM. No model code or
object crosses into the host comparator; only a validated serialized primitive
returns. Bubblewrap remains the OS security boundary. Node old-heap limits are
not a total RSS, tmpfs or process-count control.

Nineteen offline Python tests pass, including actual Node VM tests for prototype
keys, constructor bridges, dynamic code generation, mutation, nonfinite output,
toJSON and intrinsic tampering. All 98 recorded v2 outputs were subsequently replayed through the frozen strict
v3 oracle on ruOS: [98/98 passed](managed-actor-pilot-v2-strict-replay.json), with
zero new provider calls and cost. This is a diagnostic stricter verification,
not a new audit or repair of the failed cost endpoint. The original random-control
failure remains unchanged. Separate Kimi transfer and Agent Booster application
runs use the frozen v3 source and are reported independently.

## Prospective continuation

Keep the quality gate unchanged and retain this failed confirmation. Further
confirmation must freeze new tasks, explicit oracle references and the entire
search family before seeing outputs. Register alpha spending across additional
campaigns rather than reusing .025 per comparison until a positive appears.
A new model or Agent Booster transfer should test the frozen selected policy
against sensible fixed, randomized and static-best controls on fresh tasks,
accounting for inference plus tool cost and independently validated acceptance.
No automatic default change or promotion is authorized by these artifacts.
