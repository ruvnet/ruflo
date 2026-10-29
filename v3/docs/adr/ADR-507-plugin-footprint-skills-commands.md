# ADR 507: cutting the plugin suite's per-turn footprint

Status: Proposed (2026-10-29)

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
