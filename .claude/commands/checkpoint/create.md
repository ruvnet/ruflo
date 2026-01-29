---
description: Create a git stash checkpoint with optional description
category: workflow
allowed-tools: Bash(git stash:*), Bash(git add:*), Bash(git status:*)
argument-hint: "[optional description]"
---

## Create a checkpoint

Create a git stash checkpoint to save your current working state.

## Current status
!`git status --short`

## Task

Create a git stash checkpoint while keeping all current changes in the working directory. Steps:

1. If no description provided in $ARGUMENTS, use current timestamp as "YYYY-MM-DD HH:MM:SS"
2. Create a stash object without modifying the working directory:
   - First add all files temporarily: `git add -A`
   - Create the stash object: `git stash create "claude-checkpoint: $ARGUMENTS"`
   - This returns a commit SHA that we need to capture
3. Store the stash object in the stash list:
   - `git stash store -m "claude-checkpoint: $ARGUMENTS" <SHA>`
4. Reset the index to unstage files: `git reset`
5. Confirm the checkpoint was created and show what was saved

Note: Using `git stash create` + `git stash store` creates a checkpoint without touching your working directory.

Example: If user runs `/checkpoint before major refactor`, it creates a stash checkpoint while leaving all your files exactly as they are.