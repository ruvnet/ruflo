# ADR 505: pre-compaction snapshot and post-compaction reload

Status: Accepted (implemented in PR #PENDING, 2026-10-29)

Issue: #4581 follow-up 3. Builds on: ADR-451 item 7 (`compactCarry`), ADR-502 (lessons), ADR-404.

## 1. Context

When Claude Code compacts a conversation, only the summary survives.

What ruflo does today:
- `compactCarry` adds at most 600 characters of ids and status words to the summarizer's instructions.
- Nothing keeps the transcript itself.
- Nothing puts ruflo's memory back after compaction.

How claude-mem and Nowledge Mem handle it, with classic hooks:
- They save the session before compaction, in PreCompact.
- After compaction, a SessionStart `compact` hook re-injects a bounded summary.
- They fall back through several sources when one is empty.

The mod engine offers more than classic hooks for this:
- `session.compact` carries `e.messages`, the transcript about to be compacted, and `e.agentId`.
- The next main-loop `prompt.submit` can carry context that the model reads and the person does not see.

## 2. Decision

Add a new ruflo-mods option, `compactSnapshot`, **on by default**. It only writes a local file and adds a bounded block after a compaction that has already lost information.

### 2.1 Before: snapshot

This runs on `session.compact` for the main loop (`agentId` absent), before `next(e)`.

**What is written:** a new `.claude-flow/sessions/compactions/<iso-time>.jsonl` with one line per message:
- the role;
- the text content, cut to 2,000 characters;
- the names and ids of any tool calls.

Tool inputs and outputs are never written. Each line passes through the shared secret and injection screen, and a line with a finding is stored as `[redacted]`.

**Limits:**
- 400 messages per snapshot;
- 2 MiB per snapshot;
- the newest 10 snapshots are kept and older ones are deleted.

**Failure handling:** the compaction is never blocked, delayed or rewritten. A failed write is logged to debug and dropped.

### 2.2 After: reload once

The mod sets `state.compacted = true`. On the next main-loop `prompt.submit`, it adds one `[RUFLO_AFTER_COMPACT]` context block of at most 2,000 characters, built from these sources in order:

1. up to 3 lessons from this session that matched a prompt (ADR-502);
2. the last 5 loop outcomes recorded this session: the task cut to 80 characters, the outcome word, and the verifier command;
3. open swarm and claim ids, as `compactCarry` gathers them;
4. the project-relative path of the snapshot just written, so the model can `Read` it if it needs a detail back.

The flag is then cleared:
- A source that fails or is empty is skipped.
- If every source is empty, no block is added.
- The whole block is screened, and a block that fails the screen is dropped.

### 2.3 Relation to `compactCarry`

`compactCarry` shapes the summary itself. `compactSnapshot` keeps the transcript and restores ruflo's state afterwards. They are independent and can both be on.

## 3. Security and privacy

- **Snapshots are local.** They hold conversation text in `.claude-flow/`, which `ruflo init` adds to `.gitignore`. When snapshots exist, `ruflo doctor` warns if `.claude-flow/` is not ignored by git.
- **The reload block contains only ruflo's own validated data.** It is built from in-memory state and validated files, never from snapshot content.
- **Turning it off:** `compactSnapshot: false`.

## 4. Verification

Harness tests:
- A snapshot is written only on a main-loop compaction, and it is bounded, rotated and screened.
- The compaction proceeds even when the write fails.
- The reload block is added exactly once and stays within bounds.
- No block is added when no source has anything to give.

Real-binary tier (ADR-504): `/compact` in a scripted session produces a snapshot.

## 5. Implementation notes

Built as `plugins/ruflo-mods/hooks/compact-snapshot/` (`snapshot.ts` pure line building and bounds, `reload.ts` pure block, `index.ts` hooks), option `compactSnapshot` (default `true`). Deviations from section 2, each forced by the engine:

- **File names and rotation.** `$.fs` has `read`, `write`, `list`, `exists`, `stat` and `ancestors` but no delete, so the mod cannot remove old snapshots. Instead of `<iso-time>.jsonl` files it writes ten fixed slots, `snapshot-0.jsonl` … `snapshot-9.jsonl`: a missing slot first, else the one with the oldest mtime. The newest ten are still the ones kept. The ISO time, trigger and counts go in the first (header) line of each file. This also avoids `:` in file names, which Windows refuses.
- **Triggers.** Only `manual`, `auto` and `plugin` compactions write. `precompute` installs nothing, and the compaction that later uses its result dispatches `session.compact` again, so snapshotting there would write twice and set the reload flag for a compaction that has not happened. The matcher is `{ trigger: /^(?:manual|auto|plugin)$/ }`, which also keeps the module loadable next to `compactCarry`'s bare `session.compact` registration (#4485).
- **Reload flag only when the compaction stood.** `next(e)` can resolve `{ skip }` (a vetoing hook or a classic PreCompact block); then nothing was lost and no block is added.
- **Not blocking or delaying.** The snapshot text is built from `e.messages` before `next(e)`, and the write runs beside the compaction and is awaited after it, so a slow or failing write never holds the compaction up. A failure is logged with `$.ui.log(…, { to: 'debug' })` and counted in `/ruflo-mods`.
- **Only in a ruflo project.** The module writes nothing unless `.claude-flow/` already exists, because `$.fs.write` creates directories and a default-on option must not create an un-ignored transcript folder in an arbitrary project.
- **Slash prompts.** The reload block waits for the next prompt that is not a slash command and not empty.
- **Sources 1 and 2.** The learning loop's state kept only counts, so it now also keeps the newest 3 distinct lessons shown and the newest 5 recorded turns (`loop/status.ts`). With `learningLoop` off those sources are empty and are skipped.
- **Source 3** reuses `compact/block.ts` through a new `openIdLines()`, the same validated swarm and claim lines `compactCarry` builds, without its heading or session words.
- **Doctor.** `ruflo doctor` (and `--component compact-snapshots`) runs `git check-ignore` on a snapshot path, so `ruflo init`'s nested `.claude-flow/.gitignore` (`sessions/`) counts as ignored; it warns only when snapshots exist and git would commit them.

Live check (Claude Code 2.1.289, haiku, `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`, `--plugin-dir plugins/ruflo-mods`, option left at its default, one `stream-json` session in a scratch project with `.claude-flow/` and a canary swarm): a filler turn, then `/compact` (a `compact_boundary` was emitted), wrote `.claude-flow/sessions/compactions/snapshot-0.jsonl` holding the header and the three transcript messages. Asked afterwards, from context alone, whether a `[RUFLO_AFTER_COMPACT]` block was present, the model repeated the canary swarm line and the snapshot path from it. Three haiku calls, about $0.11.
