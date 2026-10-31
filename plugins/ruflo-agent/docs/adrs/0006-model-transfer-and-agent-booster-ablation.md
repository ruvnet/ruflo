# ADR 0006: bounded model transfer and Agent Booster ablation

Status: Experimental host tooling. No promotion authority.
Date: 2026-10-25.

## Decision

Test prompt policy transfer separately from code edit application. A frozen
source policy can be evaluated on OpenRouter with three target arms: untuned,
transferred, and a target prompt selected only from target training results.
The source policy is data, not model weights. No cross model performance gain
is presumed.

The initial exact target is `moonshotai/kimi-k3.1-pro`. The official
[OpenRouter catalog](https://openrouter.ai/api/v1/models) listed it on the
research date, with canonical slug `moonshotai/kimi-k3.1-pro-20261023`, input
price $2 per million tokens and output price $10 per million. The runner fetches
and freezes the current exact catalog row; it never silently substitutes K3,
K2.5 or another model. Prices in a catalog are planning inputs, not a billing
receipt. Only returned provider metering is recorded as observed cost.

Agent Booster is a separate deterministic merge tool. The existing
[cost tracker wrapper](../../../ruflo-cost-tracker/skills/cost-booster-edit/SKILL.md)
invokes `new AgentBooster().apply({code, edit, language})` from pinned npm
`agent-booster@0.2.2`. Its confidence does not establish semantic correctness.
The current enhanced router's `canUseAgentBooster` name is a deprecated alias
for its TypeScript compiler codemod classifier; its real codemod execution does
not import the Agent Booster package. The transfer experiment must not label
that alias as an executed Booster engine.

## Executable boundaries

Host tools live in `scripts/managed-proof/booster-transfer/`:

* `transfer_pilot.py` freezes catalog model, source policy provenance, corpus,
  target training selection, request parameters, oracle and runner hashes.
* `openrouter_client.py` permits only the official catalog and completion
  endpoints. It rejects redirects, implicit models, unbounded output, missing
  metering and unknown model identity. Reasoning effort is explicitly none;
  provider fallbacks are disabled. One request executes at a time, with a
  60 second transport timeout and 768 output token maximum.
* `edit_ablation.py` sends one full code edit generation to two application
  arms: direct output and the exact same generation passed to Agent Booster.
  This isolates application effects. The provider generation is billed once,
  never twice. Each output is checked by the independent sandbox oracle.
* `booster_apply.mjs` resolves the installed package from a host selected local
  directory, verifies version 0.2.2 and executes its actual API. Missing Booster
  is unavailable, never a silent codemod or model fallback. The child runs in a separate bubblewrap namespace with a read only tools mount
  and bridge file, no home or network, and no provider credentials.

Credentials are read only from the executor's `OPENROUTER_API_KEY` environment.
A ruOS secret name or stored vault slot is not proof that an executor can use it.
No secret retrieval endpoint, raw environment dump, key printing, global LLM
route switch, signing key or credential artifact is added. The root executor
owns authorized placement and actual provider calls.

Fresh confirmation requires a new sealed corpus and consumed campaign history.
Explicit `--diagnostic-reuse` permits a descriptive replay of published tasks,
but records it as reused and ineligible for a fresh proof claim. References
must pass the exact oracle before the first inference request. Source policy,
target selection and test outputs do not authorize a default change.

## Threat model and limitations

The assets are provider credentials, spend budget, source policy provenance,
heldout labels and correctness verdicts. Inputs cross the host manifest, HTTP
provider, npm merge package and generated code boundaries.

The provider transport does not reflect errors, headers or raw response bodies
into diagnostics. It meters known costs, stops after unknown spend and checks
remaining budget before each call. The byte based input allowance plus catalog
prices is a conservative admission estimate, not an account billing hard cap.
A provider or network failure may have incurred cost without a receipt. No
automatic retry is allowed in that state.

Generated programs run only through the independent bubblewrap oracle. The
host imports that oracle from ADR 0005 and binds its hash. Node's old heap
setting is not a total RSS or host memory sandbox. Host manifests and local
package installations remain trusted code requiring ordinary review.

The target native prompt selector in this pilot is a Python training selector,
not the Ruflo MCP learning cycle or native RuVector controller. Native learning
costs use integer cents and cannot represent this experiment's subcent
measurements directly. Transfer evidence must preserve those distinctions.
A transferred prompt matching a strong fixed prompt does not establish
context adaptive routing or weight learning.

Repeatedly testing until a positive result appears is not a proof protocol.
Further confirmation campaigns require a prospective hypothesis family and
alpha spending rule, fresh tasks and the unchanged quality and latency gates.
Neither package confidence, provider completion, lower mean cost nor a successful
transport probe alone is transfer correctness.

## Acceptance

Offline tests reject foreign origins, redirects, model substitution, missing or
nonfinite cost, absent credentials, consumed task reuse, schema expansion and
Booster fallback. Tests preserve missing outcome denominators and ensure Booster
children do not inherit provider credentials.

Live qualification must record the exact target model, catalog snapshot,
reference checks, every attempted result including failure costs, frozen source
policy and target selection. A valid experiment compares quality, total provider
cost and latency with complete paired outcomes. Any missing or unknown spend
keeps the run diagnostic and prevents promotion. The initial runners always
report `transferProven: false`; their results are evidence for subsequent review,
not an automatic statistical or release authority.

## Actual results and next guarded host version

[The actual Kimi and Agent Booster report](../../../../docs/validation/managed-kimi-and-booster.md)
records 98 completed Kimi calls with all audit arms 30/30, but a reused diagnostic
corpus and identical source/target compact policies. Marginal code-only output
cost decreased versus an explanatory baseline; weights, reasoning and native
Ruflo learning were not improved or qualified by that observation.

Actual Booster accepted nine merges and eight were correct; a confidence .548
fuzzy merge duplicated solve and left the old binding active. Raw Booster remains
8/10 versus direct 10/10. The next closed application guard uses independent
acceptance and permits verified direct fallback only for a host-declared complete
source request. Partial patches never receive that fallback. Actual posthoc strict
oracle replay accepted eight Booster outputs plus two verified direct fallbacks,
not ten correct raw Booster merges. No threshold was retuned.

A desktop restart also interrupted the first Kimi attempt. The next host version
now uses durable intent/receipt fencing and optional explicit fixed ruOS placement
(ADR0007). Its actual canary is separate from the archived model experiments;
source snapshots and all failure evidence remain retained. There is no automatic
promotion from lower cost, successful transport or merge confidence.
