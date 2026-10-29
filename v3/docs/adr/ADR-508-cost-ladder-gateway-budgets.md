# ADR 508: the cost ladder feeds gateway budgets

Status: Proposed (2026-10-29)

Issue: #4581 follow-up 2. Builds on: ADR-404 (the mod's cost ladder), the ruflo-cost-tracker plugin, the meta-llm gateway.

## 1. Context

ruflo-mods' cost ladder (`costBudgetUsd`, `costHardStop`) watches the session's live cost through `session.measure`. It announces the 50, 75, 90 and 100% rungs once each. At 100%, it can refuse new subagent spawns. It cannot stop the model call that pushes spend past the line, and it knows nothing about other sessions or other machines.

Gateways can enforce budgets for real. LiteLLM, for example, can be put in front of Claude Code through `ANTHROPIC_BASE_URL` and then:
- enforce `max_budget` over a rolling `budget_duration` (24h, 7d or 30d);
- stack several windows through `budget_limits`;
- fall back to a cheaper model when a per-model budget runs out (`model_max_budget` plus `budget_fallbacks`, on virtual keys, from v1.92).

The meta-llm gateway that ruflo users run behind `cognitum-*` models has its own allowance tiers. A gateway sees every request. It cannot see which tool or subagent caused the spend.

## 2. Decision

Keep attribution in the mod. Put enforcement in the gateway, and connect the two with a file.

### 2.1 One budget file, read by both

`.claude-flow/cost/budget.json` (version 1) holds the budget:

```json
{ "version": 1, "windows": [ { "usd": 10, "period": "24h" }, { "usd": 100, "period": "30d" } ], "hardStop": true, "fallbackModel": "haiku" }
```

- The mod reads it when `costBudgetUsd` is 0. It uses the smallest window's `usd` for the per-session ladder, and announces which window is closest to its limit.
- `ruflo cost budget set --daily 10 --monthly 100` writes the file.

### 2.2 Export to a gateway

`ruflo cost budget export --gateway litellm` prints the LiteLLM key settings for the current budget (`budget_limits`, `model_max_budget`, `budget_fallbacks`) as YAML or as a `/key/generate` JSON body. `--apply --url <proxy> --key-env LITELLM_MASTER_KEY` posts it.

- The master key is read from the environment variable named by `--key-env` (or from a `userConfig` sensitive option, ADR-506). It is never taken from argv.
- `--gateway meta-llm` is accepted only once meta-llm documents a budget API. Until then it fails with a pointer to this ADR. ruflo never guesses an endpoint.

### 2.3 Attribution stays in the mod

The mod keeps a per-session breakdown of `session.measure` cost deltas, by subagent type (from `agent.spawn`) and by the tool that ran just before each delta. At session end it writes the breakdown to the cost-tracker's ledger, so `ruflo cost report` can say which agents and tools spent the money. This is the part the gateway cannot see.

### 2.4 When the gateway refuses

When a model call fails with a budget error, ruflo-mods toasts once: `budget: the gateway refused the request (<window> spent)`. It records the event. It does not retry or change models itself; that is the gateway's fallback configuration.

## 3. Security

- No gateway credential is stored in the budget file.
- `--apply` sends only the budget fields, to the URL given, over HTTPS unless the host is loopback.

## 4. Verification

- Unit tests:
  - budget file validation, including hostile files: negative values, unknown periods, oversized arrays;
  - the ladder reads the file;
  - the LiteLLM export output matches LiteLLM's documented schema field by field;
  - `--apply` refuses plain HTTP to a non-loopback host.
- Attribution is tested in the mods harness with scripted `session.measure` and `agent.spawn` events.
