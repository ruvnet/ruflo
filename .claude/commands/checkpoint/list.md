---
description: List all Claude Code checkpoints with time and description
category: workflow
allowed-tools: Bash(git stash:*)
---

## List Claude Code checkpoints

Display all checkpoints created by Claude Code during this and previous sessions.

## Task

List all Claude Code checkpoints. Steps:

1. Run `git stash list` to get all stashes
2. Filter for lines containing "claude-checkpoint:" using grep or by parsing the output
3. For each matching stash line (format: `stash@{n}: On branch: message`):
   - Extract the stash number from `stash@{n}`
   - Extract the branch name after "On "
   - Extract the checkpoint description after "claude-checkpoint: "
   - Use `git log -1 --format="%ai" stash@{n}` to get the timestamp for each stash

4. Format and display as:
   ```
   Claude Code Checkpoints:
   [n] YYYY-MM-DD HH:MM:SS - Description (branch)
   ```
   Where n is the stash index number

5. If `git stash list | grep "claude-checkpoint:"` returns nothing, display:
   "No checkpoints found. Use /checkpoint [description] to create one."

Example: A stash line like `stash@{2}: On main: claude-checkpoint: before auth refactor`
Should display as: `[2] 2025-01-15 10:30:45 - before auth refactor (main)`