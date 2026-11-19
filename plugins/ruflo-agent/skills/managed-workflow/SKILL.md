---
name: managed-workflow
description: Discover and run bounded remote dynamic workflows with Ruflo mod policy, worker inspection and independent acceptance gates
argument-hint: "<task and acceptance test>"
allowed-tools: mcp__plugin_ruflo-core_ruflo__managed_agent_control mcp__plugin_ruflo-core_ruflo__managed_agent_learning mcp__plugin_ruflo-core_ruflo__managed_agent_capabilities mcp__plugin_ruflo-core_ruflo__managed_agent_create mcp__plugin_ruflo-core_ruflo__managed_agent_prompt mcp__plugin_ruflo-core_ruflo__managed_agent_status mcp__plugin_ruflo-core_ruflo__managed_agent_events mcp__plugin_ruflo-core_ruflo__managed_agent_list mcp__plugin_ruflo-core_ruflo__managed_agent_interrupt mcp__plugin_ruflo-core_ruflo__managed_agent_terminate
---

# Bounded managed workflows

Use this for remote Claude tasks with independent pieces and explicit acceptance
tests. Use `wasm-agent` for local isolated work, and `ruflo-workflows` for
persisted approval gates or native workflow scripts. Do not turn a simple task
into remote fanout just because tools are registered.

1. Inspect `managed_agent_capabilities`. Registration, configured credentials,
   provider beta access, tool authorization and remote health are separate facts.
   A configured credential is not proof of access. Never infer remote readiness.
2. The agent mod provides `/agent-mod capabilities` and the workflow mod provides
   `/wf-mod managed`. These commands list tools without making provider calls.
   Dynamic creation through the agent mod is off by default. Existing user
   authorization takes precedence; do not introduce another confirmation when
   the task already authorizes bounded execution.
3. Respect the host's `managedWorkflows`, `maxBudgetCents` and
   `allowInlineAgents` settings. Do not disable policy to bypass a refusal.
   Default maximum is 2500 US cents. Inline agents are off by default, requiring
   predefined agents whose tools were reviewed separately. In flight work can
   exceed a provider budget. This is local creation admission, not a global
   organization spending ceiling or a policy for externally created sessions.
4. Record task scope, source commit, output contract, deadline, budget, allowed
   network hosts and independent acceptance test before creation. Do not put
   keys or MCP tokens in prompts. Never give remote workers recursive Ruflo
   swarm launch, release or broad secret access.
5. Create with `dynamicWorkflows: true`, `budgetCents`, exact `allowedHosts`,
   and appropriate `predefinedAgents`. Save resource IDs. Send one scoped task
   asking for inventory, parallel work, independent reproduction and synthesis.
   Workers share files; require separate worker outputs and serialize patches.
6. Inspect open runs, pauses, failures and every worker thread with
   `managed_agent_events`. A run ending completed never proves correctness.
   Observation timeout does not stop remote work. Interrupt requests a pause;
   terminate confirms session deletion. Clean up only owned resources.
7. Independently test artifacts against the original source and acceptance
   contract. Persist only verified evidence through the repository's memory/RVF
   integration, binding source identity, reproduction commands and real usage.
   Never store credentials or promote an unverified transcript as learned truth.

The console's Mods page shows the agent mod's creation policy, cap, inline
setting and counters. It does not establish cloud run state. This skill grants
no additional tool, network, credential, memory or release authority.

## Verified learning and console use

Use the console Workflows, Cost, Approvals and Learning pages to inspect managed
runs. Snapshots are staleable local observations and never authorize actions.
Use `managed_agent_control` for fresh policy checked inspect/interrupt/terminate;
the host must separately allow the exact session. Never pass an approval flag.

Before a repeated task, ask `managed_agent_learning` for a recommendation in the
exact task/policy/evaluator scope. It is advisory and cannot expand budget,
worker permissions, network access or default models. After independent host
verification, record the closed outcome and host Ed25519 signature. Unknown or
unsigned observations stay quarantined. Never request the verifier private key.
Use `index`/`recall` only for authenticated training evidence; preserve reported
backend/embedding failures. Use `evaluate` on a frozen, disjoint heldout manifest
with three or more trials before treating a strategy as eligible. Eligibility
never grants promotion, deployment or configuration writes.

After the host verifier has tested and signed outcomes, use managed_agent_learning
action=cycle with a closed cycle object: scope, at most 24 evidence records,
optional index, maxP95Ms and evaluation (manifest, baselineId, candidateId).
One atomic batch precedes bounded native indexing and advisory evaluation.
Replays preserve attempt identity. Never place commands, keys, approval or
promotion flags in a cycle. A failed later phase can leave the signed batch
persisted; inspect status and retry the same evidence rather than inventing
new attempts. This is an explicit feedback step, not automatic task execution.
