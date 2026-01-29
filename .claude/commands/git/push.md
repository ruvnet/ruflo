---
description: Intelligently push commits to remote with safety checks and insights
category: workflow
allowed-tools: Bash(git:*), Task
---

Push commits to remote repository with appropriate safety checks and branch management.

## Git Expert Integration
For complex push scenarios (force push requirements, diverged branches, upstream conflicts, protected branch workflows), consider using the Task tool with `git-expert` subagent for specialized git expertise.

## Efficiency Note:
Be concise. Use single bash calls where possible. Skip verbose explanations and intermediate status messages. Execute the push directly if safe, show only the result.

## Instructions for Claude:

1. Run safety checks in a single bash call:
!git status --porcelain=v1 && echo "---" && git branch -vv | grep "^\*" && echo "---" && git remote -v | head -2 && echo "---" && git log --oneline @{u}..HEAD 2>/dev/null

Parse output to check:
- Any uncommitted changes (warn if present)
- Current branch and tracking info
- Remote repository URL
- Commits to be pushed

2. If safe to push (no uncommitted changes), execute push immediately:
   - For tracked branch: `git push`
   - For new branch: `git push -u origin [branch-name]`
   - If behind remote: Stop and suggest `git pull --rebase`

3. Show only the final result:
   - If successful: Show the push output with ✅ emoji and success message
   - If failed: Show error and suggest fix
   - If unsafe: Show what needs to be done first

4. Special cases to handle:
   - Diverged branches: Suggest rebase or merge strategy
   - No upstream branch: Use -u flag
   - Force push needed: Warn strongly, require confirmation
   - Protected branch: Remind about PR workflow

Example concise output:
- Skip: "Let me check if it's safe to push"
- Skip: "I'll analyze your branch status"
- Skip: "Ready to push X commits"
- Skip: "Executing push..."
- Just show the push result directly