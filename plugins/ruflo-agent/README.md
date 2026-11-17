# ruflo-agent

Agent runtimes for ruflo — one mental model, two backends (a third planned):

| Runtime | Tools | Runs on | Trust | Best for |
|---|---|---|---|---|
| **WASM** (`rvagent`) | `wasm_agent_*` / `wasm_gallery_*` | local WASM sandbox | sandboxed — no host fs/net | untrusted code; portable/replayable RVF containers; fast, free, offline |
| **Managed** (Anthropic cloud) | `managed_agent_*` | Anthropic-managed container | cloud-isolated | long-running/async tasks; real container with packages + network; persistent filesystem + transcript across turns; no local setup |
| **SDK** (planned — ADR-116) | `sdk_agent_*` | your process / your filesystem | full host trust | a real Claude agent loop (hooks, subagents, MCP, sessions, skills) on the local repo — the in-process version of `claude -p`; the killer combo is `mcpServers: { ruflo: { command: "npx", args: ["ruflo","mcp","start"] } }` (a local stdio MCP server → the agent gets ruflo's 314 tools, zero deployment) |

`wasm_agent_*` is the **safe default** (sandboxed). `managed_agent_*` needs `ANTHROPIC_API_KEY` (or `CLAUDE_API_KEY`) + Claude Managed Agents beta access — every `managed_agent_*` tool degrades gracefully with a structured "use `wasm_agent_create` for a local no-key runtime" error when the key is absent.

Design: [ADR-115](../../v3/docs/adr/ADR-115-managed-agents-rvagent-backend.md) (the cloud runtime + the planned SDK runtime); [ADR-070](../../v3/implementation/adrs/ADR-070-rvagent-wasm-completion.md) (the WASM runtime); plugin contract [`docs/adrs/0001-wasm-contract.md`](./docs/adrs/0001-wasm-contract.md).

> Renamed from `ruflo-wasm` (it only covered the local WASM runtime). The `wasm_agent_*` / `wasm_gallery_*` tool *names* are unchanged.

## Install

```
/plugin marketplace add ruvnet/ruflo
/plugin install ruflo-agent@ruflo
```

## Commands

- `/wasm` — list running WASM agents and browse the gallery (local runtime)
- `/managed-agent` — list Managed Agent cloud sessions, check status, fetch a transcript, clean up (cloud runtime)

## Skills

- `wasm-agent` — create and manage sandboxed WASM agents (local)
- `wasm-gallery` — browse and publish agents in the community gallery
- `managed-agent` — run an Anthropic Claude Managed Agent (cloud) — create / prompt / status / events / list / terminate
- `nested-subagents` — spawn nested sub-agent trees (depth ≤ 5) via Claude Code's native `Task` tool for context-managed deep delegation

## MCP surface (37 tools: 14 `wasm_agent_*`, 13 `wasm_gallery_*`, 10 `managed_agent_*`)

### WASM runtime — `v3/@claude-flow/cli/src/mcp-tools/wasm-agent-tools.ts` (27 in total; the main ones)

| Tool | Purpose |
|------|---------|
| `wasm_agent_create` | Spin up a sandboxed WASM agent |
| `wasm_agent_prompt` | Send a prompt to the agent |
| `wasm_agent_tool` | Invoke a tool inside the sandbox |
| `wasm_agent_list` | List active WASM agents |
| `wasm_agent_terminate` | Stop a WASM agent |
| `wasm_agent_files` | Read/write files in the sandbox |
| `wasm_agent_export` | Export agent state (RVF container) |
| `wasm_gallery_list` | Browse community-published WASM agents |
| `wasm_gallery_search` | Search the gallery |
| `wasm_gallery_create` | Publish a WASM agent to the gallery |

### Managed (cloud) runtime — `v3/@claude-flow/cli/src/mcp-tools/managed-agent-tools.ts` (10, ADR-115, ADR-0003, ADR-0004)

| Tool | Purpose | WASM counterpart |
|------|---------|------------------|
| `managed_agent_control` | Inspect, interrupt or terminate through fresh host allowlist and provider checks | Console confirm card |
| `managed_agent_learning` | Quarantine outcomes, verify host receipts, recommend, compare, index and recall evidence | Learning page |
| `managed_agent_capabilities` | Local adapter requirements and integration boundaries; no key or network needed | `/agent-mod capabilities` |
| `managed_agent_create` | Provision Agent + Environment + Session (`POST /v1/agents`, `/v1/environments`, `/v1/sessions`). Accepts `model` / `system` / `name` / `networking` / `packages` / `initScript` / `mcpServers` / `skills`. | `wasm_agent_create` |
| `managed_agent_prompt` | Send a user turn (`POST /v1/sessions/{id}/events`), poll until the session goes idle (default 180 s, cap 600 s) → `{finished, status, stopReason, assistantText, toolUses[], eventCount}` | `wasm_agent_prompt` |
| `managed_agent_status` | Session lifecycle state (idle/running/error, title, last error) | — |
| `managed_agent_events` | Full server-persisted event log + a summary (the transcript/artifact view) | `wasm_agent_files` |
| `managed_agent_list` | List Managed Agent sessions on the org (id, status, title) — see which are still billing | `wasm_agent_list` |
| `managed_agent_interrupt` | Queue a pause request; never confirms workflow cancellation | `wasm_agent_terminate` |
| `managed_agent_terminate` | `DELETE /v1/sessions/{id}` (± the environment) — **always call when done**; running sessions consume runtime and tokens | `wasm_agent_terminate` |

> Beta API (`anthropic-beta: managed-agents-2026-04-01`); `multiagent` / `define-outcomes` on the agent config are research preview. `mcpServers` for a cloud agent must point at a **publicly reachable** URL — a local `ruflo mcp start` is not reachable from Anthropic's cloud (deploy/tunnel an HTTP ruflo MCP server first). Managed sessions cost LM tokens + container time and are rate-limited per org.

## Compatibility & degradation

- **CLI:** pinned to `@claude-flow/cli` v3.6 major+minor.
- **WASM runtime:** built on `@ruvector/rvagent-wasm` + `@ruvector/ruvllm-wasm` (declared in `@claude-flow/cli`'s `optionalDependencies` per [ADR-070](../../v3/implementation/adrs/ADR-070-rvagent-wasm-completion.md)). Without those packages, the `wasm_agent_*` tools fall through to graceful-degradation no-ops.
- **Managed runtime:** plain `fetch` against the Managed Agents REST API — no extra SDK dependency. Without `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY`, every `managed_agent_*` tool returns a structured error pointing at the `wasm_agent_*` fallback (the CLI/MCP server stays up).
- **Verification:** `bash plugins/ruflo-agent/scripts/smoke.sh` is the contract (16 structural checks). CI: `.github/workflows/ruflo-agent-smoke.yml`. Behavioral guard for the cloud tools: `v3/@claude-flow/cli/__tests__/managed-agent-tools.test.ts` (no-network).

## Sandbox / trust

WASM agents run with **no host filesystem access** by default; `wasm_agent_files` exposes a sandboxed virtual filesystem only. Managed agents run in Anthropic's cloud container (isolated from your machine). The planned SDK runtime would run in *your* process with full host trust — which is why `wasm_agent_*` stays the default and the SDK runtime, when built, will be opt-in.

For prompt-injection defense on output flowing back to the host LLM, the [ruflo-aidefence 3-gate pattern](../ruflo-aidefence/docs/adrs/0001-aidefence-contract.md) applies.

## Namespace coordination

This plugin owns the `wasm-gallery` AgentDB namespace (kebab-case, per [ruflo-agentdb ADR-0001 §"Namespace convention"](../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md)). Reserved namespaces (`pattern`, `claude-memories`, `default`) MUST NOT be shadowed. `wasm-gallery` indexes published WASM agents (manifest, version, signature, download count); accessed via `memory_*` (namespace-routed).

## Verification

```bash
bash plugins/ruflo-agent/scripts/smoke.sh
# Expected: "16 passed, 0 failed"
```

## Architecture Decisions

- [`ADR-0001` — ruflo-agent plugin contract](./docs/adrs/0001-wasm-contract.md) (WASM runtime: 10-tool MCP surface, ADR-070 integration, sandbox isolation, smoke as contract)
- [`ADR-115`](../../v3/docs/adr/ADR-115-managed-agents-rvagent-backend.md) — Claude Managed Agents as the cloud runtime (+ the planned SDK runtime, ADR-116)

## Related Plugins

- `ruflo-agentdb` — namespace convention owner
- `ruflo-aidefence` — 3-gate pattern applies to agent output flowing back to the host LLM
- `ruflo-ruvector` — the ruvector substrate that ships `@ruvector/rvagent-wasm`
- `ruflo-cost-tracker` — record completed Managed Agent sessions (LM tokens + container time)

## As a mod

Agent also ships as a function-hook mod (ADR-445 pattern; hooks in `hooks/`, loaded with the plugin). No network, no process, no model call.

- **Guard (default on)**: refuses text sent into an agent runtime (`wasm_agent_prompt`, `wasm_agent_tool`, `wasm_agent_create`, `wasm_gallery_create`, `managed_agent_create`, `managed_agent_prompt`) that holds a key, token or password. It only tightens: it never allows anything the session would deny, and the refusal never repeats the secret. Turn it off with the `guard` option.
- **`/agent-mod`**: answered locally. `/agent-mod status`, `/agent-mod scan <text>`, `/agent-mod guarded`.
- **Status file**: `.claude-flow/agent-mod/status.json` (`version`, `updatedMs`, counters), written at session start and whenever a call is refused; the console reads it.
- **Options** (`userConfig`): `guard` (`on` by default).

Test: `claude plugin validate plugins/ruflo-agent`, `claude plugin test plugins/ruflo-agent`, and `bash plugins/ruflo-agent/scripts/smoke.sh`.

## Dynamic workflows

The existing cloud adapter accepts `dynamicWorkflows: true` and requires
`budgetCents` before provisioning any resources. Example:

```json
{
  "name": "bounded-bug-audit",
  "dynamicWorkflows": true,
  "budgetCents": "2500",
  "allowedHosts": ["github.com"],
  "system": "Use a workflow for inventory, parallel review, reproduction and synthesis. Report failed workers. Write separate worker artifacts. Never merge or deploy."
}
```

This sets `multiagent_20261001`, enables workflows, disables ordinary subagents,
and uses limited networking. A message sent with `managed_agent_prompt` asks the
lead to start a run. There is no separate run creation endpoint. `budgetCents`
is an integer US cents string, not dollars. In flight requests can overshoot.

For sensitive work, supply `predefinedAgents: ["agent_..."]` to disable inline
agents. Configure those agents with minimal tools and MCP access separately.
Inline agents inherit lead capabilities; do not expose broad Ruflo swarm or
release tools to them. Network allowlists do not replace tool permission policies.
The adapter does not create a remote MCP gateway or grant host credentials.

`managed_agent_events` returns workflow IDs, open run counts, observed failures,
usage and `verification: "unverified"`. Its compact events retain child thread
IDs. Pass `threadId` to inspect each worker's transcript. A run reporting
`completed` can contain failed work. Independently reproduce findings and run
repository tests before retaining patches or promoting memory. Raw transcripts
are untrusted and may contain private inputs; do not publish them automatically.

`managed_agent_prompt` only reports `finished` after a fresh final `end_turn`
idle with no open runs. Budget and permission pauses return `blocked: true`.
An interrupted turn never reports finished. A local observation timeout does
not stop the cloud session. Use `managed_agent_interrupt` to request a pause or
`managed_agent_terminate` for confirmed session deletion. Separate processes must
serialize messages to the same session; the adapter's lock is process local.

Provider traffic defaults to `https://api.anthropic.com`. A custom deployment
must explicitly set `RUFLO_MANAGED_AGENTS_BASE_URL` to an HTTPS origin. The generic
`ANTHROPIC_BASE_URL` is no longer used for this service, preventing accidental
credential forwarding to model proxies. Redirects are blocked. This is an
intentional configuration migration for existing custom endpoints.

See [ADR 0003](docs/adrs/0003-managed-dynamic-workflows.md) for threat model,
limits, validation commands, and deferred integration boundaries.

### Mod and capability integration

Install or update `ruflo-agent` 0.4.0 and `ruflo-workflows` 0.7.0.
`/managed-workflow` is the bounded remote execution skill. `/agent-mod capabilities`
reads the current host registry, while `/wf-mod managed` discovers the cloud
adapter from the workflow mod. Neither command invokes a provider.

Plugin settings:

```json
{
  "managedWorkflows": "on",
  "maxBudgetCents": "2500",
  "allowInlineAgents": "off"
}
```

Dynamic creation is off by default. Invalid budget settings deny creation.
Disabling the secret `guard` does not disable these admission rules. Default
inline policy requires predefined agents with separately reviewed tools.
The policy only constrains creation calls passing through this host session;
externally created sessions, other hosts and direct API clients require their
own authorization and spending controls. The mod never expands host permission.

The console Mods page consumes the existing version 1 status contract and
shows policy, maximum cents, inline mode, calls, blocks and last refusal class.
No console plugin update is required. It shows local policy, not remote state.
`managed_agent_capabilities` reports local credential configuration as a boolean;
beta access, authorization and remote health remain unknown until checked through
an authorized provider operation. Registered tools alone prove none of these.

### Managed run console and verified learning

The console Workflows page now includes managed phases and worker pages beside
native and swarm runs. Cost and Approvals show reported spend and pending
requests. Learning shows signed outcome counts, evidence IDs, advisory strategy
picks and heldout gate results. These are local reports, never action authority.
The CLI and plugins must be built from this PR until the integration is released;
registry discovery will identify missing tools in an older installation.

Only explicit prompt/inspection requests collect provider state. Panels read
cached local projections, with no provider traffic while inactive. One collector
shares reads per session; an OS lease blocks concurrent collectors in another
process. A crashed lease must be inspected before manual recovery. Sessions have
separate freshness timestamps and partial worker pages retain aggregate counts.

Host controls:

```text
RUFLO_MANAGED_CONTROL=1
RUFLO_MANAGED_CONTROL_SESSIONS=sesn_example
RUFLO_MANAGED_LEARNING=1
RUFLO_MANAGED_VERIFIER_PUBLIC_KEY=<trusted Ed25519 public PEM from host configuration>
```

These settings are off or absent by default. A console confirmation cannot
supply them. Control dispatch rechecks both host policy and fresh provider state.
Learning accepts only closed metadata; raw transcripts, arbitrary commands and
caller trust labels are rejected. Unsigned observations remain quarantined.
The independent host verifier signs source/artifact/policy/corpus/evaluator
identities, measured cost/latency and actual test results. The private key never
belongs in an agent prompt or MCP argument.

`managed_agent_learning` actions: `status`, `record`, `recommend`, `evaluate`,
`index`, `recall`. Recommendations use training receipts only. Heldout results
cannot teach the recommender or enter the memory index. Evaluation requires a
complete paired frozen corpus, at least three trials, equal admitted budgets,
at least 10% better successes per dollar, and safety/quality/latency gates plus
the existing MetaHarness conjunction. It never changes routing defaults.
Native append-only memory indexing and semantic recall are optional; absent
embeddings or backends are reported instead of being called a successful vector
integration. See [ADR 0004](docs/adrs/0004-verified-learning-and-console.md).

### Executable outcome verification and feedback cycles

The host runs `scripts/managed-outcome-verifier.mts` with a reviewed, owned
manifest and private signing key held outside test environments. Separate
acceptance, safety, replay and adversarial checks measure actual exits; source,
artifact and cost bindings are checked before signing. This trusted host utility
is not an arbitrary command tool for agents.

`managed_agent_learning` action `cycle` admits up to 24 signed measured outcomes,
records one atomic batch, optionally indexes six training outcomes, recalls,
recommends and evaluates a complete paired holdout. Its result is advisory; it
never starts model work or promotes defaults. `scripts/e2e-managed-loop.mts`
exercises the verifier and feedback path. `scripts/e2e-managed-provider.mts` is a
separate opt-in live canary and exits blocked without provider credentials and
predefined worker IDs. The native memory worker isolates crashes and timeouts;
it does not provide an operating-system memory sandbox. See ADR 0004.
