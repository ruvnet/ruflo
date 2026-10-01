# Durable missions (MCP)

A mission is a persisted dependency graph of **agent**, **signal**, and **external action** steps. It is useful when a task must wait for a person or event across a process restart. The mission API is separate from the existing `workflow_*` API.

## A complete small mission

The examples below show MCP tool names and JSON arguments. First create or identify an agent using the existing `agent_spawn` tool. Then call:

```json
{
  "tool": "mission_create",
  "arguments": {
    "name": "Approve and publish a report",
    "steps": [
      { "stepId": "draft", "kind": "agent", "agentId": "writer-agent-id", "prompt": "Draft the report" },
      { "stepId": "approve", "kind": "signal", "signalName": "editor_approval", "valueType": "approval", "dependsOn": ["draft"] },
      { "stepId": "publish", "kind": "action", "actionName": "publish_report", "request": { "document": "report-123" }, "dependsOn": ["approve"] }
    ]
  }
}
```

Save the returned `missionId`. Call `mission_advance` with that ID. Ruflo runs the draft agent step and returns an armed `pendingSignals` entry. After a person approves, call `mission_signal` with `{"missionId":"...","stepId":"approve","value":true}`. `false` explicitly denies and fails the mission. Signal types can be `string`, finite `number`, `boolean`, JSON `object`, or `approval`.

Call `mission_advance` again. It returns `pendingActions` with `actionName`, `request`, and a stable `idempotencyKey`. **Ruflo has not executed the external action.** The caller must use the appropriate publisher/payment/API tool and record the provider's response. Then call:

```json
{
  "tool": "mission_reconcile",
  "arguments": {
    "missionId": "...",
    "stepId": "publish",
    "outcome": "completed",
    "receipt": "provider-confirmation-id",
    "idempotencyKey": "the-key-returned-by-mission_advance"
  }
}
```

`mission_advance` can then finish downstream steps. `mission_status` shows step state, pending inputs, and an event trail. Dependencies may branch; a step becomes ready only after all `dependsOn` steps complete. This first slice dispatches one agent step at a time.

## Recovery and side effects

Mission files live under the current project's `.claude-flow/missions/` directory with restricted file permissions and atomic replacement. A recorded completed step is not executed again. A process that stops during an agent call leaves the step `running`; the next `mission_advance` detects a dead runner and marks it `ambiguous`. A timeout or other uncertain provider response also becomes `ambiguous`. Ruflo does **not** guess whether that call succeeded.

If the operating system reuses the old worker's PID, liveness alone may remain inconclusive. Inspect `mission_status` to get the running step's `ownerPid` and `ownerRunId`. Verify that the original worker is gone, then call `mission_recover` with the mission and step IDs, that observed `ownerPid`, and written evidence. This marks the step `ambiguous`; it still does not rerun it. A run identifier also detects a changed process instance when the PID equals the current process. For agent calls still running in another live process, do not recover them until the original worker's outcome has been checked.

An external action intent remains pending until a receipt is recorded. If the caller crashed after sending it, check the external provider before choosing `completed`, `failed`, or `not_started` in `mission_reconcile`. Every outcome requires a provider receipt or operator evidence. `not_started` lets the same action intent be issued again; use it only after verifying the action did not occur. A repeated `mission_advance` never resends the action itself.

The returned key can be sent to an external API that supports idempotency. It does **not** create exactly-once behavior for APIs that ignore it. Signal values, action requests, and agent results are capped at 256,000 serialized bytes; an oversized agent result fails the mission without replaying the call. Error details are truncated, and a mission accepts at most 2,048 audit events. This MVP uses local files and short exclusive mutation locks; it does not provide distributed scheduling, multi-host leases, automatic provider reconciliation, compensation, or a daemon that wakes itself when a signal arrives. The caller invokes `mission_advance` after recording an input or receipt.
