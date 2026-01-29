---
description: Smart branch creation and switching with conventional naming
allowed-tools: Bash(git:*), Read
category: workflow
argument-hint: "<branch-type/branch-name | branch-name>"
---

# Git Checkout: Smart Branch Management

Create or switch to branches with intelligent naming conventions and setup.

## Current Branch Status

!`git branch --show-current 2>/dev/null || echo "(no branch)"`

## Available Branches

!`git branch -a 2>/dev/null | head -20`

## Branch Creation Task

Based on the arguments provided: `$ARGUMENTS`

Parse the branch specification and create/switch to the appropriate branch.

### Supported Branch Types
- `feature/` - New features and enhancements
- `bugfix/` - Bug fixes (non-critical)
- `hotfix/` - Urgent production fixes
- `release/` - Release preparation branches
- `chore/` - Maintenance and cleanup tasks
- `experiment/` - Experimental features
- `docs/` - Documentation updates
- `test/` - Test-related changes
- `refactor/` - Code refactoring

### Branch Naming Rules
1. If argument contains `/`, use as-is (e.g., `feature/user-auth`)
2. If argument is single word, suggest adding a prefix
3. Convert spaces to hyphens
4. Lowercase all characters
5. Remove special characters except hyphens and slashes
6. Validate branch name is git-compatible

### Workflow

1. **Parse the branch argument**:
   - If empty, show current branch and available branches
   - If contains `/`, treat as type/name format
   - If single word without `/`, ask for branch type or suggest `feature/`

2. **Validate branch name**:
   - Check if branch already exists locally
   - Check if branch exists on remote
   - Ensure name follows git conventions
   - Warn if name is too long (>50 chars)

3. **Create or switch branch**:
   - If branch exists locally: `git checkout <branch>`
   - If branch exists only on remote: `git checkout -b <branch> origin/<branch>`
   - If new branch: `git checkout -b <branch>`

4. **Set up branch configuration**:
   - For hotfix branches: Base off main/master
   - For feature branches: Base off current branch or develop
   - For release branches: Base off develop or main

5. **Report status**:
   - Confirm branch switch/creation
   - Show upstream tracking status
   - Suggest next steps (e.g., "Ready to start working. Use /git:push to set upstream when ready to push.")

### Examples

```bash
# Create feature branch
/git:checkout feature/user-authentication

# Create hotfix from main
/git:checkout hotfix/security-patch

# Switch to existing branch
/git:checkout develop

# Create branch without prefix (will prompt)
/git:checkout payment-integration
```

### Special Handling

For hotfix branches:
- Automatically checkout from main/master first
- Set high priority indicator
- Suggest immediate push after fix

For feature branches:
- Check if develop branch exists, use as base
- Otherwise use current branch as base

For release branches:
- Validate version format if provided (e.g., release/v1.2.0)
- Set up from develop or main

### Error Handling

- If branch name is invalid, suggest corrections
- If checkout fails, show git error and provide guidance
- If working directory is dirty, warn and suggest stashing or committing