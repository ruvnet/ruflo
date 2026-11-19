---
id: ADR-0003
title: Bounded Managed Agents dynamic workflows
status: Proposed
date: 2026-10-24
---

## Outcome and scope

Extend ADR-115's existing cloud executor rather than create another provider
stack. Users can opt into Anthropic dynamic workflows, observe runs and worker
failures, interrupt work and preserve evidence without treating generated claims
as verified results. The existing six tools remain; interrupt and local capabilities are additive.
The native `workflow_*` scheduler and WASM runtime are unchanged.

Inputs: task text, an API credential held by the host, optional model, exact
network hosts, a mandatory dynamic-session budget, optional predefined agents.
Outputs: provider resource IDs, acknowledged message ID, run states, usage,
thread references, explicit blocked/interrupted/finished observations, unverified
assistant text. Assumption: the caller is authorized to use the configured
Anthropic organization. These tools are not a tenant authorization gateway.

## Primary source research

Reviewed 2026-10-24. The beta header stays `managed-agents-2026-04-01` and the
existing API version stays pinned to `2023-06-01`; no unrelated API migration.

1. [Multiagent configuration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration):
   `multiagent_20261001`; workflows are agent generated and start from a user
   message. Disable ordinary subagents explicitly. Restrict inline capability
   inheritance with predefined agents when required.
2. [Workflow runs](https://platform.claude.com/docs/en/managed-agents/workflow-runs):
   run events occur on the primary session history. Runs remain open until
   status_ended. Provider completed does not imply successful worker execution.
   Current limits list 1,000 agents per run, 64 concurrently working threads
   without a concurrency guarantee, and a default 24 hour lifetime. The adapter
   does not advertise unenforceable per-run concurrency controls.
3. [Budgets](https://platform.claude.com/docs/en/managed-agents/budgets):
   attach at session creation; amount is canonical integer US cents, not dollars.
   Budget stops new model requests. In flight requests and tools can overshoot.
4. [Event API](https://platform.claude.com/docs/en/api/beta/sessions/events/list):
   chronological order, opaque next_page/page cursor; processed_at can be null
   while a submitted user event is queued. The send acknowledgement supplies
   the new user event ID.
5. [Events and interruption](https://platform.claude.com/docs/en/managed-agents/events-and-streaming):
   interrupts are asynchronous and do not end workflow runs. Permission pauses
   and budget pauses must not be called completion.
6. [Thread events](https://platform.claude.com/docs/en/api/beta/sessions/threads/events/list):
   inspect worker-specific events through the existing events tool's threadId.

## Decision and alternatives

| Alternative | Delivery and latency | Cost and risk | Decision |
| --- | --- | --- | --- |
| Extend existing REST adapter | No new runtime dependency; existing registration | One provider boundary to harden | Selected |
| Add a separate SDK/provider stack | More packaging and duplicate credential handling | Additional dependency and lifecycle drift | Rejected for this increment |
| Replace Ruflo orchestration with managed workflows | Requires migration; provider controls execution | Provider coupling; weakens portability | Rejected |

The adapter remains optional and performs no model call unless a user invokes
the managed tools. Dynamic creation requires budgetCents and limited networking;
legacy creation keeps its old networking default for compatibility. Generic
ANTHROPIC_BASE_URL is intentionally replaced by a dedicated HTTPS-origin
RUFLO_MANAGED_AGENTS_BASE_URL override to avoid sending organization credentials
to an unrelated model proxy. Redirects are refused.

## Control flow and invariants

1. Validate dynamic config before network activity. Construct a supported
   multiagent block; do not forward arbitrary multiagent JSON. Provision agent,
   environment and budgeted session. Return IDs for all known resources.
2. On a definite creation rejection, delete known resources created by that
   call, in reverse order. On ambiguous network/5xx failure preserve resources
   and return cleanupRequired. The server may have created a session before
   losing the response. Never blindly retry mutating requests.
3. Prompt: acquire a process-local session lock, send once, obtain message ID.
   Poll complete chronological history until that exact message has processed.
   Carry prior still-open runs but exclude old ended-run failures.
4. Reduce only current-turn processed events. Subsequently query with inclusive
   processed_at watermark and deduplicate IDs, including equal timestamps.
   Follow every next_page. Do not use a timestamp from the client clock.
5. Return blocked for budget/permission pause. Completion requires all runs to
   end and a subsequent final end_turn idle. An interrupt never counts as
   completion. A run's completed result never sets verification to passed.
6. A local timeout does not stop the remote session. Interrupt only requests a
   pause. Deletion confirms session termination; environment deletion only
   follows successful session deletion and contributes to cleanup success.

Success walkthrough: create budgeted session, acknowledge message, observe
run creation, worker output, run end, lead final idle. Report finished and
unverified; caller inspects workers and independently tests artifacts.

Failure walkthrough: provider handles a failed worker and ends a run completed.
The primary transcript may not include that error. Return unverified and
needsThreadInspection regardless. If the inspected worker reports session.error,
surface observedFailures. Never promote memory or merge a patch automatically.

## Security model and operational bounds

| Threat | Control | Residual risk |
| --- | --- | --- |
| Token amplification or recursive delegation | Mandatory cents budget; ordinary subagents disabled; document narrow MCP grants | In flight overshoot; inline workers inherit capabilities |
| Credential forwarding | Dedicated endpoint override, HTTPS origin only, redirects blocked | Operator can deliberately choose a custom HTTPS service |
| Secret leakage in exception output | Generic transport errors; discard upstream error bodies | Task transcripts can legitimately contain private content; caller must protect them |
| Stale or malformed lifecycle evidence | Message-ID boundary, validated pages, open-run tracking, independent verification required | Provider beta semantics can change |
| Memory/response exhaustion | 8 MB response, 16 MB transcript, 10,000 events, 100 pages; repeated cursor rejection | Large valid runs require external inspection; no silent truncation |
| Shared sandbox file races | Separate worker outputs; serialize patch application | Policy belongs to configured agents and caller, not prose alone |
| Duplicate writes/retries | Local prompt lock; no automatic POST retries | Multiple Ruflo processes require an external session ownership lock |
| Destructive cleanup after uncertain POST | Retain resources and disclose cleanupRequired | Manual resource reconciliation can be required |

Each HTTP call is bounded to 30 seconds. Prompt event reads share the remaining
observation deadline; sleep never extends it. Event inspection has a 30 second
deadline. The prompt wait setting bounds observation only, not remote lifetime.

Do not expose these organization-scoped tools directly to an untrusted remote
agent. A future deployed MCP gateway must independently enforce tenant identity,
tool allowlists, expiry, recursion depth and action capabilities. Network policy
is not a substitute for agent tool permission policies.

## Implementation loop and acceptance

Implement a narrow increment, run regression fixtures, inspect the diff with an
independent reviewer, fix confirmed issues, rerun tests, then benchmark against
the frozen source. Retain performance changes only when outputs and security
invariants match. No automatic release, merge, budget increase or capability
expansion is part of this loop.

| Requirement | Executable evidence |
| --- | --- |
| Budget and network admission before side effects | managed-workflows.test.ts dynamic admission cases |
| Current-turn lifecycle and final-idle semantics | historical idle, open runs, interruption and old failed run regressions |
| Failure transparency | API failure, malformed event and worker error fixtures |
| Bounded observation | page cycle/shape, transcript and deadline guards |
| Cleanup integrity | definite rejection, ambiguous failure and deletion failure fixtures |
| Optional offline runtime | managed-agent-tools.test.ts no-key fallback for all seven tools |
| Existing workflows unchanged | workflow validation, resume and ownership regression suites |
| Measured optimization | scripts/bench-managed-workflows.mjs, exact frozen source summarizer |

See [validation receipt](../../../../docs/validation/managed-dynamic-workflows.md)
for commands, measured results and limitations. Live provider validation and
equal-dollar model quality comparison remain separate release/adoption gates.

## Deferred boundaries and rollback

No remote MCP deployment, no task_assign/federation integration, no replacement
of workflow_run, no automatic artifact execution, no memory promotion and no
signed RVF export. Existing memory/RVF services can consume independently
verified artifacts later; a transcript is not a signed cognitive artifact.

Rollback: stop using dynamicWorkflows on new sessions, explicitly terminate
existing sessions and owned environments, or revert this PR. Removing the local
adapter does not stop remote sessions. No new production state schema or npm
dependency requires migration.

## Plugin and mod integration refinement

`ruflo-agent` 0.4.0 adds an independent creation admission hook. The optional
secret guard never disables dynamic policy. Settings default to cloud fanout
off, inline agents off, maximum 2500 US cents. A malformed configured cap becomes
zero and denies dynamic creation. Flat and wrapped tool input shapes are supported;
ambiguous mixed shapes are refused. The hook can deny or forward unchanged,
never grant permission over a downstream host denial.

`/agent-mod capabilities` refreshes the live tool registry locally, displays full
names and missing tools, and marks duplicate suffixes ambiguous. A failed registry
read is unknown, not missing. `managed_agent_capabilities` exposes local runtime
facts without network activity. Credential presence is a boolean; provider health,
beta access and authorization remain unknown. The descriptor names memory/RVF
boundaries without granting those capabilities.

`ruflo-workflows` 0.7.0 adds `/wf-mod managed` to discover that descriptor and route
to the new `managed-workflow` skill. The generic console already consumes modVersion,
summary and refusal class through version 1 status files, so the agent mod supplies
bounded static policy metadata without raw prompts, credentials or session IDs.

Admission is host-session-local. It does not govern externally created sessions,
other Ruflo processes or direct provider clients. Existing provider budgets and
host action capabilities remain independent. No new remote execution or provider
readiness is implied by plugin installation or registry discovery.

## Superseding integration detail

[ADR 0004](0004-verified-learning-and-console.md) extends this decision with all
five console/learning priorities: unified managed runs, shared collectors,
budget/blocker panels, fresh-policy controls and host-authenticated advisory
learning. It preserves the original unverified provider-completion boundary and
adds no automatic default/promotion authority. The optional memory bridge stores
verified training evidence rather than promoting a model or policy.
