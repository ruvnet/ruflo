---
description: Restore project to a previous checkpoint
category: workflow
allowed-tools: Bash(git stash:*), Bash(git status:*), Bash(git reset:*), Bash(grep:*), Bash(head:*)
argument-hint: "<checkpoint-number|latest>"
---

## Restore to checkpoint

Restore your project files to a previous checkpoint created with /checkpoint.

## Available checkpoints
!`git stash list | grep "claude-checkpoint" | head -10`

## Current status
!`git status --short`

## Task

Restore the project to a previous checkpoint. Based on $ARGUMENTS:

1. Parse the argument:
   - If empty or "latest": Find the most recent claude-checkpoint stash
   - If a number (e.g. "2"): Use stash@{2} if it's a claude-checkpoint
   - Otherwise: Show error and list available checkpoints

2. Check for uncommitted changes with `git status --porcelain`. If any exist:
   - Create a temporary backup stash: `git stash push -m "claude-restore-backup: $(date +%Y-%m-%d_%H:%M:%S)"`
   - Note the stash reference for potential recovery

3. Apply the checkpoint:
   - Use `git stash apply stash@{n}` (not pop, to preserve the checkpoint)
   - If there's a conflict due to uncommitted changes that were stashed, handle gracefully

4. Show what was restored:
   - Display which checkpoint was applied
   - If uncommitted changes were backed up, inform user how to recover them

Example outputs:
- For `/restore`: "Restored to checkpoint: before major refactor (stash@{0})"
- For `/restore 3`: "Restored to checkpoint: working OAuth implementation (stash@{3})"
- With uncommitted changes: "Backed up current changes to stash@{0}. Restored to checkpoint: before major refactor (stash@{1})"