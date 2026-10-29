# ADR 508: the cost ladder feeds gateway budgets

Status: Accepted (implemented in PR #4592, 2026-10-29)

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

## 5. Implementation notes

What shipped, and where it differs from the sketch above.

- **Option.** One new ruflo-mods option, `costLedger` (default on), covers the mod side: the budget-file fallback, attribution and the refusal toast. It does nothing outside a ruflo project (no `.claude-flow/`). With it off and `costBudgetUsd` at 0 the mod hooks no cost events, as before.
- **Budget file.** `period` follows LiteLLM's `budget_duration` grammar (`^[1-9][0-9]{0,3}[smhd]$`), so `24h`, `7d` and `30d` pass and `1mo`, `week` or `-1d` do not. A file is rejected whole if it has more than 8 windows, a `usd` outside (0, 1 000 000], a repeated period, a non-boolean `hardStop`, or a `fallbackModel` outside a plain model-name charset. A rejected file means no budget, never a zero budget. Unknown fields are dropped. The validator lives twice, in `plugins/ruflo-mods/hooks/cost/file.ts` (the mod may not import outside its folder) and in `v3/@claude-flow/cli/src/cost/budget-file.ts`. `__tests__/cost-budget-gateway.test.ts` runs both over the same hostile corpus and requires identical answers.
- **Ladder.** When `costBudgetUsd` is 0, the ladder uses the window with the smallest `usd` and names it in the toast, for example `(24h window)`. The mod sees only one session's spend, so that window is always the one nearest its limit; the longer windows are the gateway's job. The file's `hardStop` acts as `costHardStop`. As before, `session.measure` reports after each turn, so the hard stop applies from the turn after the one that crossed 100%. A single long `-p` turn is not stopped part way through.
- **Attribution.** It is written to `.claude-flow/cost/attribution.jsonl` (one line per session, newest 500 kept), not to the cost-tracker's memory namespace. The mod may not spawn the CLI, and `_ledger.mjs` is a read-only aggregator of provider logs. The new `ruflo cost report` reads this file. A subagent's tool calls are charged to the type its `agent.spawn` gave; an id it never saw is charged to `subagent`. A delta before any tool runs is charged to `(model)`. Names are limited to 64 per session, and the rest are charged to `other`.
- **Refusal detection (§2.4).** `turn.complete` carries no API error kind, and `turn.step` has no error field either. Live on Claude Code 2.1.289, a turn that dies on a LiteLLM budget error has `reason: 'error'` and `answer: ''`. The error text is the transcript's last message: a synthetic assistant message, `API Error: 400 … ExceededTokenBudget …`. So, only for a main-loop turn whose reason is `error`, the mod reads that one message through `$.session.messages()`, and only when it starts with `API Error`. It matches LiteLLM's `budget_exceeded`, `ExceededTokenBudget` and "budget has been exceeded" wording. A model's own answer is never read. No new event was needed; smoke step 5 is unchanged.
- **Export.** `budget_limits` gets one `{ budget_duration, max_budget }` per window. `model_max_budget` (`{ budget_limit, time_period }` from the ladder window) and `budget_fallbacks` (`{ model: [fallbackModel] }`) are emitted only with `--model <gateway model>`. The budget file names no primary model, and ruflo does not invent a gateway model name. Field names were checked against docs.litellm.ai (`/docs/proxy/users`, `/docs/proxy/budget_fallbacks`; `budget_fallbacks` needs LiteLLM v1.92.0 or later). The format option is the CLI's global `--format`: `json` prints the `/key/generate` body, anything else prints YAML. A command-local `--format yaml` collided with the global choices (`text|json|table`), which the live run caught.
- **`--apply`.** It POSTs to `<url>/key/generate`. The rules are:
  - HTTPS only, or plain HTTP to `localhost`, `127.0.0.1` or `[::1]`;
  - no credentials, query or fragment in the URL;
  - `redirect: 'error'`, so a redirect cannot leave HTTPS or loopback;
  - a 15 s timeout;
  - only the budget fields go in the body;
  - the master key comes only from the variable `--key-env` names (an upper-case variable name; a pasted key is refused).

  The generated virtual key is printed masked unless `--print-key` is given. The `userConfig` sensitive-option source (ADR-506) is not wired yet.
- **meta-llm.** `--gateway meta-llm` exits 2 with a pointer to this ADR and sends nothing.
- **Open: the budget file is project-writable.** The model can edit or delete `.claude-flow/cost/budget.json` mid-session, for example with the Edit tool. Doing so lowers the ladder and lifts the file's `hardStop`. `costBudgetUsd` and `costHardStop`, which live in user settings, cannot be changed this way. No ruflo-mods guard protects `.claude-flow/` control files today. Whether to add a tighten-only `tool.check` deny for writes to this file is left to the integration owner.
- **Default on.** `costLedger` defaults to `true`, by analogy with `learningLoop` (ADR-502). The cost is one `stat` per `session.measure`, one append per session, and the transcript read on error turns. Default-on versus opt-in is left to the integration owner.
- **Command home.** There was no `ruflo cost` CLI command; the cost-tracker plugin's `/ruflo-cost` is a prompt command over scripts. `cost` is a new top-level CLI command (`v3/@claude-flow/cli/src/commands/cost.ts`, listed in `RUFLO_CLI_COMMANDS`). `plugins/ruflo-cost-tracker/commands/ruflo-cost.md` points to it.

### Live validation (Claude Code 2.1.289, `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`, `--plugin-dir plugins/ruflo-mods`)

1. **Fake LiteLLM on loopback, no model spend.** Every request got LiteLLM's documented `budget_exceeded` 400. `claude -p` printed `API Error: 400 Authentication Error, ExceededTokenBudget: …`. The mod wrote `{"totalUsd":0,…,"refusals":1,"budget":{"usd":10,"period":"24h"}}`.
2. **One haiku run.** The model ran Bash, then spawned a `general-purpose` subagent. The mod wrote `{"totalUsd":0.196703,"byAgent":{"main":0.159246,"general-purpose":0.037457},"byTool":{"Bash":0.141942,"Agent":0.054761},…}`. `ruflo cost report` showed the same split.
3. **The CLI against the fake gateway.** `cost budget set --daily 10 --monthly 100 --fallback-model haiku` wrote the file. `export --gateway litellm --model claude-opus-4-5` printed `budget_limits`, `model_max_budget` and `budget_fallbacks`. `--apply --url http://127.0.0.1:47508 --key-env …` posted only `budget_limits`, with a bearer header. `--apply --url http://example.com:4000` was refused before any request. `--gateway meta-llm` exited 2.
