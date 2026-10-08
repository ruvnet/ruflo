# Changelog: ruflo-console

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; older versions: `git log -- plugins/ruflo-console`.

## 0.40.1 — 2026-10-08
- fix: a settings write (or any confirmed ruflo CLI action) no longer aborts with "still running after 90000ms" when the CLI is not in the npm cache (#3914): with the ruflo CLI option on npx it now uses ruflo on PATH, a project-local bin, or the cached npx copy first, and only then a cold download, which gets a 5 minute limit and says "first run downloads the ruflo CLI"
- fix: a timeout or an uncached npx now ends as an error that names the fix (npm i -g ruflo, or npx -y @claude-flow/cli@latest --version once), and a retry after the cache is warm runs at once

## 0.40.0 — 2026-10-08
- feat: advisor checkpoints for mission loops (ADR-483), off by default (Settings → Advisor checkpoints): a read-only second opinion before a plan locks, when the same check fails twice in a row, and before a mission is declared done; a third failure in a row pauses the mission
- feat: each consult is a separate claude -p turn in plan mode on the model you choose (Settings → Advisor model), asked first with the exact command, under the turn budget and the mission spend cap; it is not Claude Code’s in-session advisor, which a mod cannot call
- feat: Loop tab shows the failure state, the consults, the advisor’s cost as claude reported it beside the mission total, and the last answer
- feat: Settings → Subagents return summaries only adds one line to the mission loop prompt

## 0.39.1 — 2026-10-07
- fix: text you type is never silently shortened (ADR-481): the mission goal (was cut at 500 characters), the question, the aside, the guide, the research question, a loop task, help and ask questions, room messages, palette text, start fields, workflow guidance and messages, templates, security and memory fields, the Gates setting and the recall prompt now keep every character; the goal, the loop prompt and the mission context carry it whole
- fix: the one-line field no longer hides what you typed: under any field whose text passes one line, a bordered mirror shows every line (wrapped, growing to 12 lines, then the last lines with a count) with a line count; type a backslash and n for a new line, and Enter sends all of it
- fix: a goal, objective, question or note is drawn in full (wrapped), with an explicit "+N more lines" marker past 40 lines, instead of one clipped line; the Mission Control header shows the objective in full
- fix: over a real limit the action is refused before anything is sent, with the exact limit and the characters over (the field's own 10,000, an argument's 8,000, a ruflo mission objective's 2,000, a loop task's 4,000) and the text stays in the field; AIDefence now screens all of a long text, not its first 2,000 characters

## 0.39.0 — 2026-10-07
- feat: ADRs page under TOOLS: find, propose, accept, reject, deprecate and supersede your own project's Architecture Decision Records, with the exact file and diff in the confirm (ADR-480)
- feat: the page finds your project's ADR folder (docs/adr, docs/adrs, doc/adr, adr, docs/architecture/decisions, docs/decisions ...) or the one in Settings, follows the style of your existing ADRs (MADR, Nygard / adr-tools, ruflo style) and offers to initialise a project that has none
- feat: attach ADRs to a mission: Claude's mission context, the task instruction and spawned swarm agents carry the accepted decisions; changed files are compared with the paths those ADRs name at verify time (a warning in the record, never a block)
- feat: ADR lint (duplicate numbers, dangling or one-sided supersedes, no status or date, missing from the index, broken links); palette entries adr-propose, adr-accept, adr-supersede and more, at the write control level
- feat: Settings gain ADR folder, ADR style and ADR file name pattern

## 0.38.0 — 2026-10-07
- feat: What’s new page under TOOLS: each installed ruflo plugin’s bundled CHANGELOG.md, newest first, with a divider at the last look, breaking changes pinned until dismissed, a new marker on the nav, and one info toast per new version (ADR-478)
- feat: CHANGELOG.md in every plugin, in a fixed format the page parses; the smoke contract checks it for console, mods, swarm and protector
- chore: Settings, Events and update-check ADRs brought up to date; ADR-479 for the MCP HTTP bearer token
- fix: a toast needs no engine.create (bind at session.start too), a throwing clock falls back to the wall clock; update the cost ladder expectati…
- fix: console toasts release held errors on a timer; settings section names toasts; ADR wording

## 0.37.0 — 2026-10-07
- feat: shared toast system with levels, dedupe, persistence and Settings (ADR-477)
- feat: shared toast policy and its call sites (ADR-477), work in progress
- fix: CONSOLE_VERSION follows the manifest (0.36.1)

## 0.36.1 — 2026-10-07
- feat: Settings puts Claude control and spending first, folds ruflo config and plugin options to the end

## 0.36.0 — 2026-10-07
- feat: 0.36.0 integration: eventsPersist option, shared whole-batch append argv, hostile-time hardening, init ignores console/
- fix: log Claude's refused request when the person's card is waiting; mission-auto why when not wired; document the local-read allowlist
- fix: session control cap, gate on read-only entries that act, hostile text/data, mission auto-run guards (#3814 #3815 #3816 #3817 #3818)
- chore: Merge verify/events-0.36 into feat/console-0.36

## 0.35.0 — 2026-10-06
- feat: autopilot envelope editor, parallel hand-over, spend windows, band segment, and the first live run (ADR-470)
- feat: recorded recalls, real vectors on the memory map, log-based stale (ADR-472)
- fix: control plane measured in an interactive session (ADR-471)
- fix: Workflows layout at every dock width, replay play loop, quiet stale presses (ADR-469)
- chore: 0.35.0; re-sign the helpers manifest for the recall-log hook changes (ADR-472)
- chore: incremental transcript parsing, kit-seq runner, tsc clean for specs (ADR-473)

## 0.34.1 — 2026-10-06
- feat: wire control plane, conversation and mission autopilot into the Workflows page (ADR-465, ADR-466)
- feat: interactive control plane and multi-model bridge (ADR-465)
- feat: control tab, Conversation board, truthful stop/message wording (ADR-465 wip)
- feat: autopilot live loop, panel, parked queue and tests (ADR-466)
- feat: conversation model, transports, tests with fake transports (ADR-465 wip)
- feat: autopilot pure core - envelope, journal, step machine, adapt gate, guards (ADR-466)
- feat: control plane data (stop, message, redirect), targets registry, send transports (ADR-465 wip)
- feat: merge the five Workflows features and wire their seams (ADR-459..463)
- chore: and 38 more changes (git log -- plugins/ruflo-console)

## 0.33.23 — 2026-10-05
- feat: band notices, tone border, /ruflo band|notices|quiet (0.33.23)
- feat: Project Anatole section in Security & Doctor (0.33.23)
- fix: keep the Router's running-success curve (an existing test and feature); only explain why it is empty
- fix: the Router block says why it is empty and does not stretch a flat curve over nine outcomes
- fix: the Learning pulse charts mean one thing each and line up (0.33.22)
- fix: smoke step 12 accepts the excluded list as well as the CI baseline for kit tests
- fix: status.json carries version 1 and the *Ms times the Mods scan needs; the console maps the plugin to Security & Doctor
- fix: the Optimizer's answer panel is framed like every other result
- chore: and 3 more changes (git log -- plugins/ruflo-console)

## 0.33.24 — 2026-10-05
- feat: the band shows how long Claude has been working, the tool-call rhythm and the context gauge (0.33.24)
