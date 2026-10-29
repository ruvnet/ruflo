# ADR 507: cutting the plugin suite's per-turn footprint

Status: Accepted (implemented in PR #TBD; §2.4 closed, see Implementation notes)

Issue: #4581 follow-up 4. Builds on: ADR-451 (`agentTrim`).

## 1. Context

Claude Code keeps the name and description of every skill, agent and command the model can invoke in context on every turn, whether it is used or not. MCP servers start, and hooks fire, in every session where their plugin is enabled.

ruflo's marketplace currently ships 167 skills across its plugins. The largest are ruflo-cost-tracker (24), ruflo-metaharness (13), ruflo-ai-team (12) and ruflo-browser (10). No skill sets `disable-model-invocation`.

`agentTrim` already hides unused agent types and measured about 4,000 tokens saved per request. Skills and commands have no equivalent.

## 2. Decision

### 2.1 Measure first

A new script, `scripts/measure-plugin-footprint.mjs`, reports per plugin:
- skills, commands and agents;
- the characters each contributes to the per-turn listing (name plus description);
- an estimated token count (characters ÷ 4).

It writes `v3/docs/validation/plugin-footprint-<date>.md` and is the before/after evidence for this ADR.

### 2.2 User-invoked by default for operational skills

A skill whose job is something a person asks for explicitly, rather than something the model should pick on its own, gets `disable-model-invocation: true` in its frontmatter. It stays available as `/<skill>` but leaves the model's listing.

The first pass covers:
- release and publish skills;
- dashboards and reports;
- benchmark runners;
- one-shot setup and install skills;
- cost-tracker sub-reports, all of which are reached through `/cost`.

The rule for choosing is written into `plugins/README.md`. A skill the model needs to discover by itself, such as memory search or swarm init guidance, stays model-invoked.

### 2.3 Shorter descriptions

A skill or command description longer than 300 characters is cut to one sentence of what it does and when to use it, keeping the "Use when" phrasing ADR-112 requires. The audit enforces a 300-character ceiling on new skills, and the baseline cannot grow.

### 2.4 Optional mod trim for skills

ruflo-mods gains `skillTrim`, **default off**. It works like `agentTrim`, using the engine's skill-listing hook where one exists:
- It hides model-invoked skills that have not been used in the last 30 days and are not named in the prompt.
- `skillTrimKeep` lists skills that must always stay visible.

If the engine exposes no such hook, `skillTrim` is not built and this section is closed in the PR.

## 3. Consequences

- A person who relied on the model discovering an operational skill must now type `/<skill>`. The plugin README tables say which skills are user-invoked.
- No skill is removed or renamed (ADR-406).

## 4. Verification

- Footprint report before and after, committed.
- Each changed SKILL.md still passes the plugin smoke contracts and the ADR-112 audit.
- A smoke check confirms that every `disable-model-invocation: true` skill is still listed in its plugin README.

## 5. Implementation notes

**Measurement (§2.1).** `scripts/measure-plugin-footprint.mjs` reads `plugins/*/skills/<name>/SKILL.md`, `commands/**/*.md` and `agents/**/*.md` from the tree or from a git ref (`--ref`), and writes `v3/docs/validation/plugin-footprint-<date>[-<label>].md`. With every ruflo plugin enabled:

| | Before (origin/main) | After |
|---|---:|---:|
| Listing characters | 47,743 | 39,402 |
| Estimated tokens per turn | 11,936 | 9,851 |
| User-invoked skills | 0 | 27 |
| Descriptions over 300 characters | 20 | 0 |

That is about 2,085 tokens per turn with everything enabled. The largest drops: ruflo-cost-tracker 1,271 → 542 tokens, ruflo-metaharness 1,255 → 545. Reports: `v3/docs/validation/plugin-footprint-2026-10-29-before.md` and `-after.md`.

The repository has 161 loadable skills, not the 167 in §1: `plugins/ruflo-ai-team/directory/skills/` holds a six-skill copy for the Claude directory submission, which Claude Code does not load from the plugin root. ruflo-ai-team has 6 skills and 6 commands.

**The frontmatter key (§2.2).** `disable-model-invocation` is the key Claude Code reads. The 2.1.289 binary validates it in skill frontmatter, and its Skill tool refuses such a skill with: "cannot be used with Skill tool due to disable-model-invocation … Do not replicate this skill's workflow by other means". A live run with `claude -p --model haiku --plugin-dir plugins/ruflo-cost-tracker` that asked the model to call `ruflo-cost-tracker:cost-anomaly` got exactly that refusal, and the model reported the skill absent from its listing. The control run against the unmodified SKILL.md launched the skill. The skill is still registered as a slash command in both runs.

**Which skills (§2.2).** 27 skills, each matching one of the ADR's categories and not invoked by the model from anywhere else in `plugins/` (agents, commands, skills, hooks):

- ruflo-cost-tracker, 14 sub-reports that `/ruflo-cost` already reaches: cost-anomaly, cost-benchmark, cost-burn, cost-conversation, cost-counterfactual, cost-diff, cost-export, cost-federation, cost-health, cost-projection, cost-report, cost-session, cost-summary, cost-trend.
- ruflo-metaharness, benchmark, spend-gated or scheduled runs and the one-shot scaffold: harness-bench, harness-evolve, harness-learn, harness-mint, harness-oia-audit, harness-security-bench.
- ruflo-workflows: gaia-submission (publishes to an external leaderboard), gaia-architecture-comparison (report).
- ruflo-core: init-project (one-shot setup), ruflo-status (dashboard).
- ruflo-ruvector: vector-setup. ruflo-federation: federation-init. ruflo-agntcy: agntcy-status.

Kept model-invoked on purpose:
- `cost-budget-check`: `ruflo-agent`'s nested-queen agent runs it as a gate before starting a swarm.
- `music-connect`: `/music connect` tells the model to follow that skill.
- The cost-tracker entry points (`cost-advise`, `cost-ledger`, `cost-local`, `cost-openrouter`, `cost-optimize`, `cost-track`, and the `cost-booster-*` and `cost-compact-context` skills): the model is meant to find these from a plain question.

Three places that told the model to use a skill on this list were updated:
- `ruflo-ruvector/commands/vector.md` now asks the user to run `/ruflo-ruvector:vector-setup`.
- The `cost-analyst` agent runs the `/ruflo-cost` script when the user asked for a report.
- The `metaharness-architect` agent names the `/ruflo-metaharness:<skill>` to run.

Each plugin README has a "User-invoked skills (ADR-507)" table. The choosing rule is in `plugins/README.md`. Commands were left alone: no command was moved to user-invoked.

**Descriptions (§2.3).** The 20 skill descriptions over 300 characters were cut to one or two sentences with "Use when …" (215–277 characters), as single-line YAML scalars. No command description was over 300. `scripts/audit-skill-frontmatter.mjs`, already a CI step in `all-plugins-smoke.yml`, now:
- fails any skill or command description over 300 characters, measured unfolded so a `>` block cannot slip past;
- fails any `disable-model-invocation: true` skill that is not named under a "User-invoked" heading in its plugin README.

Because the backlog is now zero, the ceiling is a hard limit and not a baseline. Before the README tables were added, this check failed on all 28 then-marked skills, which is the negative control. `music-connect` was unmarked afterwards. The ADR-112 audit (`audit-tool-descriptions.mjs`) covers MCP tool descriptions only. It is unchanged and passes: 414/414.

Three existing descriptions are not valid strict YAML because they contain an unquoted `: `: `cost-openrouter`, `harness-threat-model` and `llm-config`. They are under 300 characters and outside this change, so they were left as they are.

**`skillTrim` (§2.4) is not built.** The engine has no hook that hides a skill from the model's listing. Evidence from the ruflo-mods engine types (`.claude-plugin/types/claude-code/index.d.ts`, Claude Code 2.1.289):
- `agent.offer` exists for agents only.
- `skill.prompt` fires when a skill's prompt is expanded, so the skill is already chosen by then. It can only rewrite the text.
- `command.describe`'s `isHidden` hides a command from the typeahead and `/help`, not from the model's skill listing, so it would not save these tokens.
- `ContextSkills`/`ContextSkill` are read-only measurements.

No `skillTrim` or `skillTrimKeep` option was added. This section is closed until the engine gains a skill-listing hook.

