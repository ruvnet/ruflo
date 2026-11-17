---
name: managed-agent
description: Run an Anthropic Claude Managed Agent — a cloud agent harness (container + filesystem + tools), the cloud counterpart of the local wasm-agent runtime
argument-hint: "<create|prompt|status|events|list|terminate> [options]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__managed_agent_control mcp__plugin_ruflo-core_ruflo__managed_agent_learning mcp__plugin_ruflo-core_ruflo__managed_agent_capabilities mcp__plugin_ruflo-core_ruflo__managed_agent_create mcp__plugin_ruflo-core_ruflo__managed_agent_prompt mcp__plugin_ruflo-core_ruflo__managed_agent_status mcp__plugin_ruflo-core_ruflo__managed_agent_events mcp__plugin_ruflo-core_ruflo__managed_agent_list mcp__plugin_ruflo-core_ruflo__managed_agent_terminate mcp__plugin_ruflo-core_ruflo__managed_agent_interrupt mcp__plugin_ruflo-core_ruflo__wasm_agent_create Bash
---

# Managed Agent (Anthropic cloud runtime)

`ruflo-agent` has two agent runtimes behind one mental model:

| Runtime | Tools | Use it when |
|---|---|---|
| **WASM** (local, `rvagent`) | `wasm_agent_*` / `wasm_gallery_*` | fast, free, ephemeral, offline, untrusted code in a sandbox |
| **Managed** (Anthropic cloud) | `managed_agent_*` (this skill) | long-running / async work (minutes–hours), a real cloud container with pre-installed packages + network, persistent filesystem + transcript across turns |

This skill drives the **managed** runtime — Anthropic's [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview) (beta). The model: **Agent** (model + system + tools + MCP servers + skills) → **Environment** (container template) → **Session** (running instance) → **Events** (turns / tool-use / status, persisted server-side). See `docs/adr/0001-wasm-contract.md` and project ADR-115.

## Prerequisites

- `ANTHROPIC_API_KEY` (or `CLAUDE_API_KEY`) in the environment, with Claude Managed Agents beta access.
- If absent, every `managed_agent_*` tool returns a structured "use `wasm_agent_create` for a local no-key runtime" error — fall back to the WASM skill.

## Steps

1. **Create** — `mcp__plugin_ruflo-core_ruflo__managed_agent_create`
   `{ model?, system?, name?, networking?, packages?, initScript?, mcpServers?, skills? }`
   → `{ sessionId, agentId, environmentId, status }`. Provisions Agent + Environment + Session. Save the three ids.
   - `mcpServers`: `[{type:"url", url, name, authorization_token?}]` — the cloud agent must be able to *reach* the URL. A local `ruflo mcp start` is **not** reachable from Anthropic's cloud; deploy/tunnel an HTTP ruflo MCP server first if you want the cloud agent to have ruflo's tools.
   - `packages`: `{pip?:[], npm?:[], apt?:[], cargo?:[], gem?:[], go?:[]}` — installed in the container.

2. **Prompt** — `mcp__plugin_ruflo-core_ruflo__managed_agent_prompt`
   `{ sessionId, message, maxWaitMs? }` → sends a user turn, polls the event log until the session goes idle (default 180s, capped 600s) → `{ finished, status, stopReason, assistantText, toolUses[], eventCount }`. For very long tasks, raise `maxWaitMs` or follow up with `managed_agent_events`.

3. **Inspect** — `mcp__plugin_ruflo-core_ruflo__managed_agent_status` `{ sessionId }` (idle/running/error) · `mcp__plugin_ruflo-core_ruflo__managed_agent_events` `{ sessionId, raw? }` (full transcript: user turns, agent thinking, tool_use, tool_result, status — the cloud counterpart of `wasm_agent_files`).

4. **List** — `mcp__plugin_ruflo-core_ruflo__managed_agent_list` `{ limit? }` — every session on the org (so you can see which are still running / billing).

5. **Terminate** — `mcp__plugin_ruflo-core_ruflo__managed_agent_terminate` `{ sessionId, environmentId? }` — **always do this when done**: running sessions consume runtime and tokens. Pass `environmentId` to also delete the environment ruflo created.

## Cost & safety

- Managed Agents bill per session (LM tokens + container time) and are rate-limited per org. Estimate before a long run; record completed sessions to the `cost-tracking` namespace.
- Treat orphaned sessions like leaked resources — `managed_agent_list` then `managed_agent_terminate` anything stale.
- Beta API (`managed-agents-2026-04-01`); dynamic workflows are opt-in beta; outcomes remain outside this adapter.

## Quick example

```
managed_agent_create  { "model": "claude-haiku-4-5-20251001", "system": "Terse. Do exactly what is asked.", "name": "scratch" }
  → { sessionId: "sesn_…", agentId: "agent_…", environmentId: "env_…", status: "idle" }
managed_agent_prompt  { "sessionId": "sesn_…", "message": "echo hello > /tmp/x && cat /tmp/x — then stop." , "maxWaitMs": 60000 }
  → { finished: true, status: "idle", stopReason: "end_turn", assistantText: "Done.", toolUses: [{name:"bash", input:{command:"echo hello > /tmp/x && cat /tmp/x"}}] }
managed_agent_terminate { "sessionId": "sesn_…", "environmentId": "env_…" }
  → { sessionDeleted: true, environmentDeleted: true }
```

## Dynamic workflow procedure

1. Create with `dynamicWorkflows: true`, `budgetCents: "2500"` ($25), and exact
   `allowedHosts`. Networking is limited. Use `predefinedAgents` for restricted
   workers; otherwise inline agents inherit lead tools. Never expose recursive
   swarm launch or release tools to remote workers.
2. Prompt the lead to run inventory, review, reproduction and synthesis phases.
   Use separate worker output paths because the cloud sandbox is shared.
3. Follow `workflowRuns`, `openRuns`, `blocked`, `observedFailures` and
   `verification`. Budget/permission pauses are not completion. `finished`
   requires a new final idle after all runs end, and does not prove correctness.
4. Read child thread IDs in `managed_agent_events`; pass `threadId` to read each
   worker. Independently validate artifacts before merging or promoting memory.
5. `managed_agent_interrupt` queues a pause, never confirms cancellation.
   Observation timeouts leave remote work running. Delete the session explicitly
   when finished; delete only environments you own. Preserve IDs returned on
   failed creation and inspect ambiguous failures before retrying.

The six original tools remain available, plus `managed_agent_interrupt`, `managed_agent_control` (host-policy gated inspect, interrupt and terminate), `managed_agent_learning` and local `managed_agent_capabilities`. `managed_agent_interrupt` is gated like `managed_agent_control`; `managed_agent_terminate` is gated the same way once the host sets `RUFLO_MANAGED_CONTROL=1`.
No automatic gateway deployment, recursive delegation, budget escalation,
artifact execution, repository merge, memory promotion or RVF signing occurs.

Use `/managed-workflow` for the full dynamic workflow procedure and
`managed_agent_capabilities`, `/agent-mod capabilities` or `/wf-mod managed` to
discover the adapter. Default mod policy disables dynamic creation and inline
agents; enable only the settings needed for an already authorized task.

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
