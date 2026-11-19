---
id: ADR-0004
title: First class managed console runs and verified advisory learning
status: Proposed
date: 2026-10-25
---

## Outcome

Extend [ADR 0003](0003-managed-dynamic-workflows.md) across all five requested
integration priorities: unified run model, one collector per session, budgets
and blockers, policy checked actions, and verified outcome feedback. Reuse
the console's workflow navigation, bounded readers, action confirmation and
Learning page; do not add a second dashboard or a provider client in hooks.

The resulting loop observes execution, records an outcome, authenticates a host
verifier's evidence, recalls training patterns, recommends a strategy and checks
it on a frozen holdout. No step silently promotes or deploys a default policy.

## Architecture and ownership

| Component | Input | Output and authority |
| --- | --- | --- |
| ManagedRunCollector | Explicit primary event/session reads | Incremental run, phase, worker and blocker facts; no correctness claim |
| Project collector lease | Project/session and host credential scope | One active collection; concurrent same-scope callers share it |
| Managed snapshot projection | Sanitized collected metadata | Six sessions, 60 worker rows/page, full aggregate counts, 128 KB maximum |
| Console | Local cached snapshots and learning summary | First class managed workflow rows, budgets, blockers and evidence; no provider traffic |
| managed_agent_control | Session/action, optional inspection offset | Fresh host policy and provider checks before dispatch; input cannot grant approval |
| Learning ledger | Closed metadata and optional Ed25519 receipt | Quarantine or authenticated measured outcome; 500 rows, 2 MB maximum |
| RuVector/AgentDB bridge | Authenticated training evidence | Native append-only index; independently revalidated recall hits |
| Advisory evaluator | Complete paired signed heldout results | Existing MetaHarness accept conjunction plus efficiency/safety gates; never a default write |

Production sources: `managed-run-collector.ts`, `managed-run-store.ts`,
`managed-learning.ts`, `managed-learning-store.ts` in the CLI services directory.
The two new MCP operations are `managed_agent_control` and
`managed_agent_learning`; the existing tool names remain available.

## 1. Unified console run model

`WfRun.kind` adds `managed`. Native, swarm and managed execution share workflow
navigation, but native controls are never offered for managed rows. Provider
phases and worker phase IDs are used when present; absent facts remain unknown.

The UI distinguishes provider completion, worker inspection and acceptance.
The collector always writes workersInspected=false, acceptancePassed=false and
verification=unverified. A completed provider run cannot produce a verified
badge. Signed learning receipts attest measured outcomes separately; they do
not make an unchecked snapshot an authorization token.

Each session carries its own observation timestamp. Refreshing one session
cannot make another session fresh. Observations older than 30 seconds or from
an implausible future timestamp are marked stale. Unknown cost is n/a, not zero.
Provider list cost is not mixed into unrelated local model budget totals.
Pending event IDs are shown for inspection; there is no blanket approval action.

## 2. Shared collector and bounded observation

Prompt polling and primary event inspection use one process-local singleflight
collector, with inclusive processed_at watermark, event-ID deduplication and
semantic replay equality. A 1 second cache prevents immediate duplicate reads.
Only explicit requests cause reads; snapshots, pagination and panel refreshes
never invoke a provider. There are no background collection timers.

A project/session OS lease prevents another process from collecting concurrently.
The lease is exclusive, never automatically stolen, and released on completion.
A crashed process may leave a lease requiring operator inspection. Singleflight
sharing never crosses host credential scopes. Session/action authorization is
not inferred from either the lease or cached data.

The collector caps six sessions, 10,000 events and 16 MB. It retains worker
aggregates while publishing 60 workers at a time. The console bounds file reads
and reuses parsed objects when text is unchanged. A collector cache is not a
restart journal; after restart it reloads provider history within the same caps.

## 3. Budget and approval visibility

Budget and reported list cost are integer US cents. Remaining budget and any
overshoot are displayed as observations. Provider budgets stop new requests,
so in flight work can exceed the cap. The console does not extrapolate unknown
cost or treat a budget pause as completion.

Permission requests, custom tool calls and requires_action event IDs populate
the blocker view. Confirmation/result events remove resolved IDs. Correctness
and host permissions are never inferred from a provider's completion label.

## 4. Controls recheck policy at execution

Console buttons use the existing confirmed, fixed CLI action:

```text
mcp exec -t managed_agent_control -p {sessionId,action,threadOffset?}
```

The handler accepts only inspect, interrupt and terminate. It requires
RUFLO_MANAGED_CONTROL=1 and an exact comma-separated session allowlist in
RUFLO_MANAGED_CONTROL_SESSIONS. It reads current provider state, then reads host
policy again immediately before dispatch. Unknown state, a changed policy,
unknown input fields, or a caller supplied approval flag fails closed.

Interrupt requests a pause and never confirms cancellation. Successful deletion
updates the observed session termination, without claiming acceptance or worker
inspection. Unexpected asynchronous deletion responses are not treated as
confirmed termination. Other direct managed tools retain their existing host
permission boundary; this control policy is not organization-wide authorization.

## 5. Verified learning and optimization

Learning writes require host RUFLO_MANAGED_LEARNING=1. The host configures the
trusted Ed25519 public key in RUFLO_MANAGED_VERIFIER_PUBLIC_KEY; an MCP caller
cannot supply a public key, declare itself verified, or request shell execution
through the learning API. The verifier's private key stays outside this service.

Version 1 observation metadata contains task/attempt/source/artifact/policy/
corpus/evaluator hashes, coarse task type, strategy ID/model/worker count/template,
split/trial, admitted budget, measured cost/duration, acceptance and safety
results, replay/adversarial verdicts, drift and rollback measurements. No raw
prompt, transcript, arbitrary command or credential field is accepted.

The trusted verifier must independently check the source and artifact and sign
the complete canonical observation after measuring the outcome. Cryptography
authenticates that verifier's statement; it does not replace the verifier's
tests or prove its operational independence. Unknown cost/duration cannot be
used for recommendations. Cumulative session list cost must not be mislabeled
as one task's measured cost.

Unsigned observations stay quarantined and cannot reserve a trusted attempt ID.
Quarantine has a separate 100-row ceiling, leaving capacity for authenticated
results. A matching valid attestation can attach to an unsigned observation;
two conflicting valid outcomes for one attempt are refused. Every reload and
memory recall rechecks signatures. Recommendations/evaluations are rederived
from currently valid receipts; old JSON advice cannot survive verifier rotation
or tampered evidence as supported advice.

Recommendations use only authenticated training observations in the exact task,
policy and evaluator cohort, require three distinct training tasks per strategy,
include failures in cost/quality denominators and enforce a latency constraint.
They return model, worker count, template, sample count, observed success rate,
successes per dollar, p95 latency and evidence IDs. Sample size is evidence,
not a calibrated probability. All-failed or unsupported cohorts abstain.

The optional memory index uses namespace managed-workflow-evidence, native
append-only writes and strict insertion. Uncertain persistence is an error;
missing embeddings are reported explicitly. Heldout and unsigned records are
never indexed. Semantic recall checks namespace, receipt signature, content
digest and local cohort membership. Similarity is not verification, and recall
does not select a favorable subset for efficiency scoring. The full eligible
training cohort determines the advisory recommendation.

Actual native integration showed that search results contain display previews,
not complete receipts. Recall hydrates the exact scoped row via getEntry before
checking its size, identity and signature. ruOS write/restart/recall validates
three embedded fixture receipts with the declared memory 3.0.9 dependency;
older desktop memory alpha.26 aborts during native initialization and is not
qualified. See the [ruOS validation](../../../../docs/validation/managed-ruos-e2e.md).

The actual console host path is qualified on Claude Code 2.1.287: installed
mods/swarm/console load and candidate managed views pass real console tool
assertions. The tested 2.1.283 host exposed no console tools even with the
function-hook flag; plugin installation alone is not proof of registration.

### Frozen evaluation gate

The heldout manifest declares 2 to 100 unique task hashes and 3 to 10 trials;
its canonical hash must match all paired receipts. Both strategies must have
exactly one result per task/trial, matching source identity and admitted budget.
Training/holdout task overlap is rejected. A project ledger binds a corpus to
one confirmation comparison, preventing candidate switching on that holdout.

Numeric domains are validated before the existing MetaHarness accept() function.
The gate requires at least 10% more verified successes per actual dollar, no
per-task acceptance regression, no safety failure, no p95 latency regression,
and the existing adversarial, replay, drift, receipt and rollback conjunction.
Fitness passed to MetaHarness is normalized cost efficiency, not raw pass rate.
Eligibility is advisory. No router champion, configuration, signing authority,
capability envelope or deployment state is modified. Statistical significance
and real model superiority require separately designed live experiments.

## Acceptance and measured limits

Required regressions include 1,000 workers with duplicate/reordered reconnects,
budget/permission pauses and failures; one collector and OS lease; no inactive
provider traffic; safe worker paging; stale policy denial; forged receipts;
quarantine poisoning; key rotation; heldout leakage; incomplete/mismatched trials;
failed persistence; and native tool/console compatibility.

The local bounded rendering target is under 16 ms. Validation measures warm
rendering with the actual view functions and fixture kit, not native GPU/UI
latency. CPU benchmarks and synthetic learning gate results cannot establish
live provider performance, dollar savings or model-quality improvements.

## Failure and rollback boundaries

Local files are advisory projections, not an action authority. Same-user
adversarial filesystem races are outside the directory-check guarantee. Atomic
file replacement and directory fsync are used; platforms without those semantics
must fail rather than claim durable writes. Ledger and summary are separate
atomic writes, so a crash can leave an older display summary.

Disable learning/control environment flags to stop those effects. Stop using
dynamicWorkflows for new sessions and explicitly terminate owned remote sessions
before removing the adapter. No existing default model, native workflow schema,
router state or memory row is migrated or overwritten by this integration.

Validation receipt: [managed learning and console](../../../../docs/validation/managed-learning-console.md).

## Amendment: executable verification and bounded feedback cycles

The next delivery closes four gaps exposed by native integration: managed
buttons were not callable through the model palette; signed observations had
no executable independent host verifier; native memory could abort the MCP
process; and individual learning operations required manual sequencing.

### Specification and invariants

1. Exact session-bound palette entries reuse the confirmed action runner and
   its existing permission classes. Text and selection changes cannot retarget
   an admitted action. The remote handler still rechecks provider and host policy.
2. A host-owned verifier manifest names explicit tests and source/artifact files.
   The verifier executes bounded argv checks without a shell, verifies measured
   cost bindings, rehashes files and signs the complete outcome. Failed tests
   remain failed observations, not discarded evidence. Neither MCP input nor a
   provider transcript supplies commands, signing keys or acceptance verdicts.
3. Native memory initialization and operations run in a fixed worker process.
   A timeout, native abort, malformed response or missing backend cannot become
   successful indexing and cannot take down the parent through a native abort.
   Process isolation is not an OS memory sandbox and does not prevent host OOM.
4. One cycle admits at most 24 measured signed outcomes in an exact cohort,
   persists one atomic batch, optionally indexes at most six training outcomes,
   recalls authenticated evidence, recommends and optionally evaluates paired
   holdouts. Every asynchronous phase rechecks the current host authorization.
5. A cycle never runs model tasks, starts a background timer, promotes policy,
   changes routing defaults or broadens an execution envelope. A scheduler or
   workflow invokes it explicitly after independent verification.

### Control flow and restart behavior

```text
verify host manifest and measurements
→ admit every signed outcome before mutation
→ persist atomic batch
→ optional bounded native index and authenticated recall
→ recommend from all eligible training evidence
→ optional complete paired holdout evaluation
→ return advisory result and phase evidence
```

The existing managed_agent_learning operation gains action=cycle with one
closed cycle object. The host flag and configured verifier key are checked
again across phase boundaries; a caller approval or promotion flag is rejected.
Indexing cycles with more than six training outcomes are rejected before any
write; the 24 outcome admission bound still applies to non-indexing cycles.
The worker permits one active operation with no queue, a 15 second operation
timeout and five second idle expiry. Host authorization is rechecked after native
initialization and immediately before an append grant. Revocation after a granted
write can report an admitted-write ambiguity; it cannot promise to undo that write.
The child strips provider credentials and configures the actual AgentDB
Transformers.js module to disable remote model loading before native startup.
These controls do not constitute an OS memory or network sandbox.

Per-attempt immutability makes replay safe. A failure after batch persistence
leaves durable evidence that can be retried, not a false claim that later phases
completed. Native insertion replay must verify the existing exact scoped row
instead of overwriting it or trusting a local index-complete marker.

The host verifier is trusted executable code, not a sandbox for arbitrary test
programs. Its private key is loaded outside child test environments. Host-owned
commands still require ordinary repository review and OS controls. Synthetic
fixture prices exercise the gate but cannot demonstrate economic improvement.

### Alternatives and operational tradeoffs

| Choice | Decision and rationale |
| --- | --- |
| Native imports in MCP process | Rejected: a native abort bypasses JavaScript error handling |
| Unbounded process per receipt | Rejected: repeated model/backend initialization and concurrency pressure |
| Bounded native worker lifecycle | Selected: isolates aborts and permits bounded warm reuse; native RSS still needs host limits |
| One fsync transaction per outcome | Retained for legacy record; cycles use one batch transaction to reduce durable-write overhead |
| Automatic promotion after the cost gate | Rejected: measured eligibility does not grant deployment authority |
| Model-submitted test command | Rejected: acceptance commands belong to the trusted host manifest |

### Acceptance and release gates

Run executable verifier success, failure, timeout, source mutation and cost
binding cases. Replay an authenticated cycle and confirm zero duplicate rows.
Revoke authorization between phases and confirm no later effects. Crash and
hang the native worker and confirm the parent remains available. Exercise
console_run with exact session IDs, confirmation and permission downgrades.
Measure atomic batching against the same sequential durable record baseline.

The live provider canary is separately opt-in, requires an executor API key and
one or two existing predefined agent IDs, uses the official origin and a fixed
small task with a $1 provider budget. In-flight requests may overshoot. Unknown
creation outcomes require inspection rather than blind retry or cascading
cleanup. Missing credentials produce a blocked result with zero provider calls.
Passing fixture E2E is not a live budget-pause or production-quality claim.

Linux ruOS, local CPU fixtures and CI have separate receipts. Windows/macOS
durability, production verifier operation and a live provider canary remain
explicit release gates until actual results exist. Disable learning/control
flags to stop effects; no automatic policy or memory migration is introduced.

Validation update, 2026-10-25: [feedback cycle report](../../../../docs/validation/managed-loop-e2e.md)
and [ruOS receipt](../../../../docs/validation/managed-loop-ruos.json) record 199
backend tests, 150 console tests, 86 verifier-loop assertions, source and emitted
JavaScript native persistence/restart recall, and the real MCP learning cycle.
The fixed-fixture batch benchmark reduced 18 transactions to one, with 7.29 times
lower median admission time. This measures ledger overhead, not provider quality
or cost savings. No routing default was promoted. Live provider, production
verifier and cross-platform release gates remain open.

## Amendment: independent review and known limits, 2026-10-25

An independent security and correctness review of this change found the defects below. They were fixed with a test that fails
without the fix: a stale previous-turn completion on later polls of `managed_agent_prompt`; `managed_agent_interrupt` having no
host policy gate (it now uses the `managed_agent_control` path; `managed_agent_terminate` obeys the same allowlist, and deletes only
the session's own environment, once `RUFLO_MANAGED_CONTROL=1`); non-canonical base64 spellings of one verifier signature being
stored as separate ledger records; a failed local snapshot write failing a successful provider read or deletion; a failed prompt not
reporting its `messageId`; and the console showing rescheduling, budget-stopped and action-blocked sessions as finished.

The following are **known limits that this change does not remove**. They are why learning and the control plane stay opt-in
(`RUFLO_MANAGED_LEARNING=1`, `RUFLO_MANAGED_CONTROL=1`) and why the evidence is advisory:

1. **The verifier runs its checks in the same trust domain as its signing key.** Checks run as the same user as the signer. A 0600
   key file is readable by any same-user process, so a check that executes agent-produced code can read the key and sign a false
   observation. The host-owned cost receipt and specs must live under the verified root, and the owner and group/world-write checks
   cannot tell the host's file from one the agent wrote as the same user. The command denylist does not stop `python3 -c`, `node -e`
   or `find -exec`. **Only run the verifier where its manifests and checks are authored by the host, never by the agent under test,
   and ideally sign from a separate user or container.** A cost receipt is not authenticated: `successesPerDollar` is only as honest
   as that file.
2. **Evidence is only partly bound to what ran.** `treeHash` covers the listed files; `evaluatorHash` hashes the command line, not
   the contents of the scripts or dependencies the check read. Receipts carry no ledger or project binding, key id or expiry, and
   a synthetic-fixture receipt signed by the production key looks the same as a live one in the ledger.
3. **A crashed process can leave a lock that nothing reclaims.** `*.collector.lock`, `snapshot.lock` and the learning `writer.lock`
   carry no pid or time. Remove the file by hand after confirming no ruflo process is running; concurrent writers fail instead of
   waiting.
4. **Some sessions cannot be controlled or can wedge.** A session in an `error` state is not accepted by the control allowlist. A
   conflicting replay of a processed event, or more than 10,000 events, makes refresh throw on every read until the process restarts.
5. **Observation cost.** Each poll deep-copies up to 16 MB of events two or three times, including on a cache hit.
6. **The learning summary is written after the ledger commit.** If it fails or exceeds 64 KB the caller sees an error although the
   record is committed.
7. **Unconfirmed against the live provider:** whether a `created_at[gte]` filter with a `processed_at` watermark can skip a message
   queued while the session was busy, and whether `max_list_cost.amount` is in cents. Both need the live-provider canary that is
   still an open release gate.

8. **Dynamic-mode egress is model-chosen.** When `dynamicWorkflows` is on, `allowedHosts`, `initScript`, `mcpServers` URLs and `packages`
   are chosen by the model and constrained only by `networking: limited`; there is no plugin-level host allowlist.
9. **Unconfirmed guard envelope.** The dynamic-workflow guard reads the arguments from `input`, `arguments`, `tool_input`, `params`, `args`
   or `parameters`, or from a flat event. A host that names the field something else would not be seen by the guard (it only tightens
   `managed_agent_create`; it never loosens another gate).

A native-memory child process is a process boundary, not an OS memory or network sandbox. Its offline mode relies on a library flag
on the module instance that is loaded, and the size of an IPC message is checked after it is parsed.
