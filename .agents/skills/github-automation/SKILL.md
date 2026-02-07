---
name: github-automation
description: >
  GitHub workflow automation, PR management, issue tracking, and code review coordination. Integrates with GitHub Actions and repository management.
  Use when: PR creation, code review, issue management, release automation, workflow setup.
  Skip when: local-only changes, non-GitHub repositories.
---

# GitHub Automation Skill

## Purpose
GitHub workflow automation, PR management, and repository coordination.

## When to Trigger
- Creating pull requests
- Managing issues
- Setting up CI/CD workflows
- Code review automation
- Release management

## Commands

### Create Pull Request
```bash
gh pr create --title "feat: description" --body "## Summary\n..."
```

### Review Code
```bash
npx claude-flow github review --pr 123
```

### Manage Issues
```bash
npx claude-flow github issues list --state open
npx claude-flow github issues create --title "Bug: ..."
```

### Setup Workflow
```bash
npx claude-flow workflow create --template ci
```

### Release Management
```bash
npx claude-flow deployment release --version 1.0.0
```

## Agent Types

| Agent | Role |
|-------|------|
| `pr-manager` | Pull request lifecycle |
| `code-review-swarm` | Automated code review |
| `issue-tracker` | Issue management |
| `release-manager` | Release automation |
| `workflow-automation` | GitHub Actions |

## Best Practices
1. Use conventional commits
2. Require reviews before merge
3. Run CI on all PRs
4. Automate release notes
