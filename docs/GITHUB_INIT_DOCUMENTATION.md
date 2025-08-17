# GitHub Integration Commands Documentation

## Overview

Claude Flow v2.0.0 now provides separate initialization commands for standard and GitHub-enhanced features. This allows users to choose the level of integration they need.

## Standard Init Command

### Usage
```bash
npx claude-flow@alpha init
# or
./claude-flow init
```

### Features
The standard init command provides:

1. **Basic Git Checkpoints**
   - Automatic checkpoint creation before/after file edits
   - Task checkpoints for new work
   - Session summaries
   - No GitHub CLI integration

2. **Standard Permissions**
   - Git commands (add, commit, tag, branch, checkout, stash)
   - No GitHub CLI (gh) permissions
   - Full Claude Flow functionality

3. **Standard Checkpoint Hooks**
   - Uses `standard-checkpoint-hooks.sh`
   - Local Git operations only
   - No GitHub release creation

### Settings Created
```json
{
  "env": {
    "CLAUDE_FLOW_CHECKPOINTS_ENABLED": "true"
  },
  "permissions": {
    "allow": [
      "Bash(git tag *)",
      "Bash(git branch *)",
      "Bash(git checkout *)",
      "Bash(git stash *)"
      // No gh commands
    ]
  }
}
```

## GitHub Init Command

### Usage
```bash
npx claude-flow@alpha github init
# or
./claude-flow github init
```

### Features
The GitHub init command provides everything from standard init PLUS:

1. **GitHub-Enhanced Checkpoints**
   - Automatic GitHub releases for checkpoints
   - Enhanced task checkpoints with release notes
   - Session summaries as GitHub releases
   - Full GitHub CLI integration

2. **Extended Permissions**
   - All standard Git permissions
   - Full GitHub CLI permissions (gh release, pr, issue, workflow, repo, api)
   - GitHub-specific environment variables

3. **Combined Hook System**
   - **Claude Flow Hooks**: All standard hooks for agent coordination, memory, formatting
   - **GitHub Checkpoint Hooks**: Additional hooks for GitHub releases
   - Both hook systems run in parallel for maximum functionality
   - Uses `github-checkpoint-hooks.sh` alongside Claude Flow hooks

### Settings Created
```json
{
  "env": {
    "CLAUDE_FLOW_AUTO_COMMIT": "false",
    "CLAUDE_FLOW_AUTO_PUSH": "false",
    "CLAUDE_FLOW_HOOKS_ENABLED": "true",
    "CLAUDE_FLOW_TELEMETRY_ENABLED": "true",
    "CLAUDE_FLOW_REMOTE_EXECUTION": "true",
    "CLAUDE_FLOW_GITHUB_INTEGRATION": "true",
    "CLAUDE_FLOW_CHECKPOINTS_ENABLED": "true",
    "CREATE_GH_RELEASE": "true"
  },
  "permissions": {
    "allow": [
      // All standard permissions plus:
      "Bash(gh release *)",
      "Bash(gh pr *)",
      "Bash(gh issue *)",
      "Bash(gh workflow *)",
      "Bash(gh repo *)",
      "Bash(gh api *)"
    ]
  },
  "hooks": {
    // Includes BOTH:
    // 1. All Claude Flow hooks (pre/post command, edit, session)
    // 2. GitHub checkpoint hooks running alongside
  }
}
```

## When to Use Each Command

### Use Standard Init When:
- You don't need GitHub integration
- Working on private/local projects
- GitHub CLI is not available
- You want simpler checkpoint management
- Security policies restrict GitHub CLI usage

### Use GitHub Init When:
- You want checkpoint sharing via GitHub releases
- Working on GitHub-hosted projects
- Need enhanced rollback capabilities
- Want to share checkpoints with team members
- GitHub CLI is installed and configured

## Checkpoint Management

### Standard Checkpoints
```bash
# List checkpoints
.claude/helpers/checkpoint-manager.sh list

# Rollback to checkpoint
.claude/helpers/checkpoint-manager.sh rollback checkpoint-YYYYMMDD-HHMMSS

# View checkpoint details
.claude/helpers/checkpoint-manager.sh show checkpoint-YYYYMMDD-HHMMSS
```

### GitHub-Enhanced Checkpoints
```bash
# All standard commands plus:

# View GitHub releases
gh release list

# Download release checkpoint
gh release download checkpoint-YYYYMMDD-HHMMSS

# Create manual release checkpoint
gh release create manual-checkpoint --title "Manual Checkpoint" --notes "Description"
```

## Migration Between Modes

### Upgrading from Standard to GitHub
If you initially used standard init and want GitHub features:

```bash
# Run GitHub init with --force flag
npx claude-flow@alpha github init --force
```

This will:
- Replace standard checkpoint hooks with GitHub versions
- Update settings.json with GitHub permissions
- Preserve existing checkpoints
- Enable GitHub release creation

### Downgrading from GitHub to Standard
If you want to remove GitHub integration:

```bash
# Run standard init with --force flag
npx claude-flow@alpha init --force
```

This will:
- Replace GitHub checkpoint hooks with standard versions
- Remove GitHub CLI permissions
- Preserve existing checkpoints
- Disable GitHub release creation

## Troubleshooting

### GitHub CLI Not Found
If you run GitHub init without GitHub CLI:
- Warning displayed but init continues
- Checkpoint hooks created but releases disabled
- Install GitHub CLI: https://cli.github.com/

### Permission Denied Errors
If checkpoint hooks fail:
```bash
# Make scripts executable
chmod +x .claude/helpers/*.sh
```

### No Git Repository
Both commands require Git:
```bash
# Initialize Git first
git init
```

## Best Practices

1. **Choose Early**: Decide on standard vs GitHub before starting project
2. **Commit Regularly**: Both modes create automatic checkpoints on file edits
3. **Review Checkpoints**: Use checkpoint-manager.sh to review and clean old checkpoints
4. **Team Collaboration**: Use GitHub mode for shared projects
5. **Security**: Use standard mode for sensitive projects where GitHub CLI access is restricted

## Summary

Claude Flow v2.0.0 provides flexible initialization options:
- **Standard init**: Local Git checkpoints without external dependencies
- **GitHub init**: Enhanced checkpoints with GitHub release integration

Choose based on your project needs and available tools.