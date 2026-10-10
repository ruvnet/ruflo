# Changelog: ruflo-console

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; older versions: `git log -- plugins/ruflo-console`.

## 0.42.2 — 2026-10-10
- fix: the same project on Windows keeps one remembered page and one terminal history whatever the drive-letter case or trailing slash of its folder (`c:\work\app\` and `C:\Work\app` are one workspace)
- fix: any confirmed action whose on-disk check fails is re-checked once after one second, so a hive started from the console shows at once instead of reading "not verified"
- fix: no Linux-only process probe off Linux (macOS, Windows), and the probe timers are cleared when the session ends
- fix: autopilot's kill flag can be cleared on Windows. Starting autopilot on Windows is refused with a plain message until a follow-up: its journal needs atomic appends and its folder fence needs Windows-aware path checks. Stop works as before
- fix: disk writes (settings, journal, envelope, exports) work on Windows through the host's file API; Linux and macOS keep their exact commands
- fix: the home folder is found on Windows (USERPROFILE, HOMEDRIVE+HOMEPATH), so sessions, plugin health and What's new read it
- fix: Windows project folders (`C:\work\app`, `\\server\share\app`) are recognised as project folders for ADRs, export, the catalog and mission cost, and the protected autopilot folders match ignoring case

## 0.42.1 — 2026-10-10
- fix: Mission Control create retries only a real policy-state lock timeout (and a silent failure or a wait that ran out), reads the CLI's own Result: line rather than the Parameters object, undoes every open task of the mission when it must abort, asks the mission record to cancel, and reads the stores back so the result says what they show, not what was asked (#3945)
- fix: a run that reports for itself (mission create, the ADR page writes) now becomes the console's outcome when it ends, so console_state.lastResult carries how it ended however long it took (#3945)

## 0.42.0 — 2026-10-09
- feat: an optional, detect-only Grounding line for Stuart Kerr's third-party ruvnet-brain plugin: Overview says whether it is on, not installed, installed but disabled, or unknown (read from the plugin list and your settings; ruflo works the same without it, and nothing of it is bundled or copied) (ADR-487)
- feat: with the brain on and a mission that names the ruvnet stack (RuVector, RVF, AgentDB, ruflo ...), Claude's mission context carries one fixed line pointing at `search_ruvnet`; Settings → "RuvNet Brain nudge" turns it off (default on). The console never calls the brain and no mission text enters the line
- feat: Settings → "RuvNet Brain install hint" (default off): one dismissible toast per session and an Overview line link its repository when it is not installed; the console never installs it

## 0.41.0 — 2026-10-09
- feat: session workspace on the Room (ADR-486): a Needs you queue (approvals, questions, failures, finished work) across Claude Code, Codex and Ruflo sessions, a session browser grouped by repository and worktree, and a preview of the selected session (latest response, current tool, edited files, test result, cost labelled reported, estimated or unavailable). Discovery is local and read-only: no model call, no process, no wake. Sessions with an ambiguous identity go to an unassigned bucket and raise nothing. A finished session clears only after its preview was drawn. The Overview shows the four counts. Options: sessionWorkspace, sessionPreview (both on).
- feat: ruflo-mods can show those four counts. The console's only write is that summary (counts only, .claude-flow/console/attention.json, in a ruflo project, when a count changes), through the same path Events persistence uses.

## 0.40.8 — 2026-10-09
- fix: an ADR scope glob with many stars no longer freezes the console: the matcher is a bounded two-pointer scan instead of a regex (a 16-star glob against a short path took 38 s; it now takes microseconds, at the real input caps under 10 ms for 9,600 pairs); results are identical on legitimate globs (ADR-480)
- fix: an ADR title over 120 characters is refused with the count on every path (the page field, the `adr-propose` palette entry, `/ruflo run`, `console_run`) instead of being cut into the file name, and a draft whose title was shortened from a mission's objective says so on the confirm card (ADR-481)
- fix: the ADR digest handed to a spawned subagent is checked against the console's exact shape and re-rendered with each record's text quoted; a plugin named `__proto__`, `constructor` or `toString` can no longer corrupt the What's new record (#3941, #3942, thanks @proffesor-for-testing)

## 0.40.7 — 2026-10-09
- fix: the console's disk writes work on macOS and the BSDs: BSD `dd` and `install` refuse `oflag=append`, `conv=excl` and `-D`, so every append (Events, Timeline, the autopilot journal), exclusive create (ADR records, exports, `.gitignore`), create-with-folders and the journal archive copy failed there. The host is asked once (`uname -s`, with its own 3 s deadline and a `process.platform` fallback); Linux keeps the exact GNU argv, other kernels run one of seven constant `sh -c` scripts (frozen set, the path only ever as quoted `$1`, a link or non-regular target refused, `set -C` for O_EXCL), and a failed ADR write says why instead of "it may have appeared meanwhile" (#3938, #3939, thanks @proffesor-for-testing)

## 0.40.6 — 2026-10-09
- fix: times read as times and a swarm reads as itself: the AgentDB mod's "written" age no longer shows 100020735d ago or 0s for a future stamp (it reads n/a), a swarm's agent count and status agree on Overview, Swarm, the topology graph, the status bar and Workflows (a swarm with no listed members says so; "stalled" needs evidence, not just an old record), Workflows agent ages show days, and `mission-goal` says it replaces the goal instead of "nothing is written" (#3935, #3936, thanks @proffesor-for-testing)

## 0.40.5 — 2026-10-09
- fix: a verdict command's "found something" exit (security scans, AIDefence checks, MetaHarness mcp-scan, threat-model and drift) is an answer, not a failure: Claude is told what was found, and a failed run names its real reason (the [ERROR] line, a wrapped tool error) instead of the CLI's [WARN] banner; the answer is read out of stdout in bounded time (#3933, #3934, thanks @proffesor-for-testing)

## 0.40.4 — 2026-10-09
- fix: a task an older CLI stored as "complete", "done", "canceled" or "running" reads as its canonical state everywhere the console decides on status: the kanban lane, Mission Control (it is never handed to Claude again), mission cancel, and the workflow task links (#3931, #3932, thanks @proffesor-for-testing)

## 0.40.3 — 2026-10-08
- fix: the approvals badge (band "n to approve", menu badge, change notices, and the Approvals header) counts only rows a person can act on; a refused mod or a permission deny has no approve or deny action, stays listed on the page as a notice, and no longer holds the badge up with nothing to press (#3920)

## 0.40.2 — 2026-10-08
- fix: a Yes runs only the card it was pressed on: every confirm card has an id and the Yes, Always allow and Always accept buttons carry it, so a card that took the first one's place (the person's own ask) is never answered by a Yes meant for the old one; the stale Yes runs nothing and says so (ADR-450 T17)
- fix: an ask of Claude's that was screened first and landed after its tool call returned is checked against the level and Stop as they are when it lands; a level lowered meanwhile wins
- fix: everything handed to the model goes through one sanitiser (modelLine: escape sequences, then control and invisible characters removed so they cannot split a credential, then invite codes masked, then the cut, then the line withheld if it holds a secret shape): failed-run details, the "already waiting" refusal, the "waiting for the person" and "started" answers, refusals that echo the model's own input, palette entry ids and thrown errors no longer quote a token or an x.ruv.io invite code; a version such as v2.1.0-beta.3 is no longer masked as an invite
- fix: escape stripping is linear: a megabyte of unterminated OSC introducers took seconds, now milliseconds; an unterminated OSC ends at the next introducer or the end of the text
- fix: a mission state, task status, hive role, audit severity or plugin named toString, constructor or __proto__ draws as unknown instead of as native code, and no longer throws in Settings
- fix: Approvals and a mission's objective wrap at narrow widths (80 columns in tmux) instead of being cut with "…" (#3899)

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
