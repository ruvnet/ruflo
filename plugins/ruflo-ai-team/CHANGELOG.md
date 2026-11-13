# Changelog: ruflo-ai-team

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; older versions: `git log -- plugins/ruflo-ai-team`.

## 0.4.1 — 2026-11-09
- fix(deps): zod ^4.6.7 (GHSA-mrhx-c7xc-m3w5: zod < 4.6.6 can exhaust memory validating oversized constrained collections).

## 0.4.0 — 2026-10-26
- feat: `memory_search` ranks by meaning through Cognitum's managed `/v1/embeddings` (`cognitum-embed`, 384-dim) when `RUFLO_AI_TEAM_EMBEDDINGS_KEY` is set; vectors are stored with each memory (only if the text is unchanged), never returned to callers, and an outage or a missing key falls back to the labelled lexical index, so a search never fails because embeddings did
- feat: memory listing reads newest first, so a team with more than 1000 memories keeps the latest; needs the composite index in `deploy/firestore.indexes.json`, and without it the read falls back to the old unordered query rather than erroring
- feat: the workflow funnel (team created, run started, run completed, memory written, memory searched) is logged as one structured line per success with a hashed tenant and no content
- feat: unauthenticated requests are limited per client (default 600 a minute, `RUFLO_AI_TEAM_ANON_RPM`); OAuth callers and `/health` are never throttled, and the client key is the last `X-Forwarded-For` entry because Cloud Run appends the real address there
- chore: the privacy page discloses that memory text is sent to Cognitum's embeddings service when semantic search is on

## 0.3.5 — 2026-10-24
- feat: the guard also screens `team_create` and `team_update` (team name, objective and roles are shared, retained text like task and memory writes); read tools stay unguarded
- feat: `/team-remember` and `/team-board` commands (memory store/search and the board view)
- feat: each skill ends with the skill to use next (launch, coordinate, monitor, review, lifecycle, remember), so the six read as one workflow
- feat: the builder, researcher and verifier agents say how a ruflo coder, researcher or reviewer agent does the work while the service only records it, and that the builder never verifies its own result
- chore: smoke expects six commands; directory bundle resynced (0.2.0 to 0.3.0)

## 0.3.4 — 2026-10-24
- fix: run and team lists read newest first, so a tenant with more than 100 runs sees its latest runs on the board instead of an arbitrary 100
- fix: evidence exports query audit events by target instead of reading the first 1000 audit records and filtering, which dropped a run's events once a tenant had more audit history than that
- fix: the service reports the plugin version (package.json was still 0.1.6, so /health could not tell a deployment apart)
- chore: Firestore store tests with a limit-after-order double

## 0.3.3 — 2026-10-22
- fix: `annotation-review.md` documented only 12 of the 14 live tools, missing `team_board` and `run_complete` (added at 0.2.0/0.2.1) from its readOnly/destructive/idempotent/openWorld classification table
- chore: smoke now asserts the doc's tool list matches the live server tool set exactly, so this can't silently drift again

## 0.3.2 — 2026-10-12
- fix: the shared text screen now catches `.env` and e-mailed credentials, no longer flags a model's token talk (`--max-tokens`, `/oauth/token`, "token usage"), and no longer flags values that only name where a secret lives (`./service-account.json`, `--set-secrets=NAME=NAME:latest`); every rule stays linear (#4094, thanks @proffesor-for-testing)

## 0.3.1 — 2026-10-12
- fix: stored teams, runs, tasks and memories no longer share mutable objects with the caller or with exported snapshots (#3995)
- fix: run evidence includes the task history of the run in its audit trail (#3996)
- fix: re-remembering a memory keeps its original creation time (#3997)
- fix: a pending vector index build can no longer restore an invalidated tenant index (#4004)
- chore: thanks to @rudycelekli for all four fixes

## 0.3.0 — 2026-10-09
- feat: skills, commands and agents name the connector tools in plain language instead of Claude Code namespaced identifiers (allowed-tools lists only the portable Read tool; the repo audit requires the field), so they read correctly on claude.ai and Cowork
- feat: lifecycle skill covers run_complete (the tasks_incomplete rule); skills state the real status values, template ids and budget range
- feat: README gains examples per surface, what you need, how auth works and what leaves your machine, and troubleshooting
- fix: descriptions lead with what the item does and when to use it, with no angle brackets, and drop wording the service cannot back
- fix: directory bundle skills, commands and agents resynced with the plugin (bundle manifest 0.1.0 to 0.2.0, two added keywords)
- chore: smoke asserts no namespaced tool names, no angle brackets in descriptions, README examples use real commands, bundle copies identical

## 0.2.3 — 2026-10-09
- fix: documentationUrl points at the main branch path, not the feat/ruflo-ai-team branch

## 0.2.2 — 2026-10-05
- fix: shared textsOf reports truncation and every guard fails closed on it

## 0.2.1 — 2026-10-04
- feat: vendor the flag option parser from one origin with the screen sync and drift check (review #2)
- fix: one iterative textsOf in the shared screen — depth, sibling, size caps, object keys and the invisible-character set fixed at the root (ADR-…
- fix: secret screen — a 20+ char value under a secret-named key is a secret even all-letter or UUID-shaped, unless a clear reference (ADR-445)
- fix: secret screen judges values, not names — fewer false positives, vendor keys, URL credentials, env assignments, 200 KB scan (ADR-445)
- chore: one source for the secret screen — sync-mod-screen.mjs regenerates the shared region of 37 screen.ts copies, --check in all-plugins-smoke (…

## 0.2.0 — 2026-10-04
- feat: mod (guard/status/command) as function hooks, ADR-445 pattern

## 0.1.6 — 2026-09-30
- chore: version the #3556 fix as 0.1.6

## 0.1.5 — 2026-09-30
- fix: explicit CORS allowlist and documented public discovery

## 0.1.4 — 2026-09-29
- fix: enlarge workspace rail and restore evidence view

## 0.1.3 — 2026-09-29
- feat: unify ChatGPT workspace navigation

## 0.1.2 — 2026-09-29
- feat: style board as ruOS desktop workspace
