# ADR 505: pre-compaction snapshot and post-compaction reload

Status: Proposed (2026-10-29)

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
