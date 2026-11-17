---
name: managed-agent
description: Anthropic Claude Managed Agents (cloud runtime) — list cloud sessions, check status, fetch a transcript, clean up
---

Manage Claude Managed Agent sessions (the cloud agent runtime; the local WASM runtime is the `/wasm` command).

1. Call `mcp__plugin_ruflo-core_ruflo__managed_agent_list` to show every Managed Agent session on this org (id, status, title) — note which are still `running` (i.e. still billing).
2. For a specific session: `mcp__plugin_ruflo-core_ruflo__managed_agent_status` `{ sessionId }` (idle/running/error) and `mcp__plugin_ruflo-core_ruflo__managed_agent_events` `{ sessionId }` (full transcript + a summary: assistantText, toolUses).
3. To run new work: `mcp__plugin_ruflo-core_ruflo__managed_agent_create` then `mcp__plugin_ruflo-core_ruflo__managed_agent_prompt` (see the `managed-agent` skill for the full flow + the cost/cleanup notes).
4. Clean up stale sessions: `mcp__plugin_ruflo-core_ruflo__managed_agent_terminate` `{ sessionId, environmentId? }` — running sessions consume runtime and tokens.

If `managed_agent_*` returns "needs ANTHROPIC_API_KEY" → no key/beta access; use the local `/wasm` runtime instead.

For dynamic workflows create with `dynamicWorkflows: true`, integer
`budgetCents` ("2500" = $25), and an exact `allowedHosts` list. Follow open runs
and worker transcripts before independently validating results. A completed run
is unverified. `managed_agent_interrupt` requests a pause; it never confirms
cancellation. A polling timeout does not stop cloud work. See the managed-agent
skill for the bounded workflow procedure.

For local discovery first inspect `managed_agent_capabilities`, which needs no
key and makes no network call. `/agent-mod capabilities` shows actual registry
names and plugin settings. `/managed-workflow` provides the bounded procedure.
