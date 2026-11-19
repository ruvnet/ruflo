# ADR 512: the learning loop on classic hooks, for every ruflo project

Status: Accepted (implemented in PR #4604)

Issue: #4581. Builds on: ADR-502 (the loop), ADR-503 (gaming defences), ADR-511 (actionable lessons), ADR-404 (one owner per event), ADR-504 (real-binary tier).

## 1. Context

Until now only the ruflo-mods plugin recorded verified turns and showed lessons. Mods are early access and opt-in (`ruflo mods install`), so most ruflo projects (classic hooks from `ruflo init`) never learned anything. They also never got an improvement to the loop.

Classic hooks are separate processes, one per event. They differ from the mod in two ways that matter here:

- They have no in-process `tool.call` event.
- `ruflo init` registers no PostToolUse hook for Bash, so a test command's exit status never arrives as a hook event.

One more limit: `helper-refresh` copies the package's helper **files** into each project on its next `ruflo` command, but never rewrites a project's `settings.json`. So a change can reach existing users only through hooks they already have: UserPromptSubmit → `route` and SessionEnd/PreCompact → `session-end`.

## 2. Decision

### 2.1 Replay the transcript

Every hook receives `transcript_path`. That transcript holds each tool call and its result. A Bash command that exits non-zero has `is_error: true`, which was checked against real transcripts.

- `route` replays the turns that finished since the last look, then prints the lessons for the new prompt.
- `session-end` replays the rest. On PreCompact (the same handler, mid-session), the open turn is left open, because it may still edit and verify.

A per-session byte offset in `.claude-flow/data/classic-loop.json` means each turn is read once.

- A transcript shorter than its offset is read again from the start.
- A last line without its newline is never consumed.
- One call reads at most 8 MiB.

A Bash call with `run_in_background: true` has no exit status, so it never decides an outcome. This is in addition to the `backgroundTaskId`, `timedOutAfterMs` and `interrupted` fields the mod's `verdict` already reads; real transcripts were checked to put all three in `toolUseResult`.

A record's id comes from its prompt's byte position, so a replay that runs twice writes the same id, and the ingest ledger trains it once.

### 2.2 One implementation, bundled

`plugins/ruflo-mods/hooks/loop/transcript.ts` rebuilds each turn from the transcript and feeds it to the mod's own `start`/`step`/`line`/`classify`/`verdict`. It shows lessons through the mod's own `parseLessons`/`pick`/`lessonBlock`.

`plugins/ruflo-mods/scripts/build-learning-loop-helper.mjs` bundles that code with esbuild into `.claude/helpers/learning-loop.cjs`.

- The bundle is committed, in both helper copies, and the `mod-guidance` CI job fails if it is stale.
- It is a critical helper: it is signed in the helpers manifest, and helper-refresh installs it.

So an outcome, a taint and a lesson are decided the same way on both paths, with no second implementation to drift.

### 2.3 Never record a turn twice

When its loop is on in a ruflo project, the mod adds `learning-loop` to `RUFLO_MODS_OWNS`. The classic helper records nothing and prints no lessons when that variable names `learning-loop`, or `route` (which a pre-ADR-512 mod owns whenever its loop runs).

Two existing behaviours stay as they were:

- `ownedByMod` still checks only `route` and `post-edit`.
- An older helper ignores the new word.

### 2.4 Training

`session-end` starts a detached `ruflo hooks verified-ingest --quiet` (the `spawnDetachedHookRefresh` path) when `verified-trajectories.jsonl` is newer than the ingest ledger. At most one spawn a minute per project.

- The ingest runs whichever CLI the helper finds: the marketplace copy, a project install, then a global install.
- With none, it falls back to `npx`, as the existing `refresh-funnel` spawn does. That is the one network-reaching path the loop has, and it is bounded by the one-a-minute stamp and by `ingestDue`.
- An older CLI ignores the unknown `--quiet` flag (checked against 3.65.0).

The record step runs **before** `session-end`'s de-duplication. That de-dup is keyed on the session id, so after a PreCompact the real SessionEnd would otherwise never record the last turn. This is safe because recording is idempotent.

### 2.5 Opt-out

- Per project: `"learningLoop": { "enabled": false }` in `.claude-flow/config.json`.
- Per process: `RUFLO_LEARNING_LOOP=0`.

The loop is on by default everywhere, as ADR-502 §6 decided for the mod. It does nothing outside a ruflo project (no `.claude-flow/`).

## 3. Consequences

- Every `ruflo init` project records verified turns and sees lessons after its next `ruflo` command refreshes the helpers. Nothing has to be reinstalled.
- Classic and mod records share one file, one ingest and one lessons file.
- The agent a record names comes from the classic router (`router.cjs`), as the classic routing banner does.
- `hook-handler.cjs` changed, so the helpers manifest is re-signed in the same change, as for #4136.
- The replay depends on Claude Code's transcript format. It reads only `type`, `isSidechain`, `isMeta`, `isCompactSummary`, `timestamp`, `message.content` blocks and `toolUseResult`. A field it cannot read leaves a turn `unknown` (never trained); it never invents an outcome. The real-binary contract below runs on the pinned engine, so a format change is caught when the pin is bumped.

## 4. Verification

$0:

- `__tests__/mods/mods-learning-loop-classic.test.ts`:
  - **Replay equals the mod.** A replayed turn's record is identical to the one the mod's own `step` calls produce. Failure, unknown, interrupted, backgrounded and test-edit (tainted) turns all decide as in the mod. Subagent, meta, slash-command and orphan-result lines are ignored.
  - **Offsets.** The open turn is kept; ids are stable across replays; an unfinished last line is never consumed.
  - **Lessons.** `lessonsFor` produces exactly the mod's block.
  - **The real hook-handler, spawned.** `route` records once. PreCompact leaves the turn open; SessionEnd closes it, including after a PreCompact. Nothing is recorded when the mod announces `learning-loop`, or when the loop is turned off by env or config.
  - **End to end.** Three classic-recorded successes from three sessions → the real `ingestVerifiedOutcomes` with SONA → the next prompt's `route` output names `src/money.js`.
  - **Shipping.** Both bundle copies are identical; the bundle matches its source; every critical-helper list names it.
- `__tests__/real-binary/classic-loop.test.ts` (contract 6, real `claude` 2.1.289, mock model, no plugin loaded):
  - A scripted fix turn becomes one `verified-success` naming `src/add.js`.
  - A lesson reaches the model's request through the classic `route` hook.
- The mod ownership tests now expect `learning-loop` in the handshake, including the "new project helper, old `$HOME` helper" case, where both paths would otherwise record.
