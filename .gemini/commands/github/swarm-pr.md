# Swarm PR - Managing Swarms through Pull Requests

## Overview
Create and manage AI swarms directly from GitHub Pull Requests, enabling seamless integration with your development workflow.

## Core Features

### 1. PR-Based Swarm Creation
```bash
# Create swarm from PR description
gh pr view 123 --json body | npx ruv-swarm swarm create-from-pr

# Auto-spawn agents based on PR labels
gh pr view 123 --json labels | npx ruv-swarm swarm auto-spawn
```

### 2. PR Comment Commands
Execute swarm commands via PR comments:

```markdown
<!-- In PR comment -->
/swarm init mesh 6
/swarm spawn coder "Implement authentication"
/swarm spawn tester "Write unit tests"
/swarm status
```

### 3. Automated PR Workflows

```yaml
# .github/workflows/swarm-pr.yml
name: Swarm PR Handler
on:
  pull_request:
    types: [opened, labeled]
  issue_comment:
    types: [created]

jobs:
  swarm-handler:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Handle Swarm Command
        run: |
          if [[ "${{ github.event.comment.body }}" == /swarm* ]]; then
            npx ruv-swarm github handle-comment \
              --pr ${{ github.event.pull_request.number }} \
              --comment "${{ github.event.comment.body }}"
          fi
```

## PR Label Integration

### Automatic Agent Assignment
Map PR labels to agent types:

```json
{
  "label-mapping": {
    "bug": ["debugger", "tester"],
    "feature": ["architect", "coder", "tester"],
    "refactor": ["analyst", "coder"],
    "docs": ["researcher", "writer"],
    "performance": ["analyst", "optimizer"]
  }
}
```

### Label-Based Topology
```bash
# Small PR (< 100 lines): ring topology
# Medium PR (100-500 lines): mesh topology  
# Large PR (> 500 lines): hierarchical topology
npx ruv-swarm github pr-topology --pr 123
```

## PR Swarm Commands

### Initialize from PR
```bash
# Create swarm with PR context
npx ruv-swarm github pr-init 123 \
  --auto-agents \
  --load-diff \
  --analyze-impact
```

### Progress Updates
```bash
# Post swarm progress to PR
npx ruv-swarm github pr-update 123 \
  --comment "🐝 Swarm Progress: 75% complete" \
  --details
```

### Code Review Integration
```bash
# Create review agents
npx ruv-swarm github pr-review 123 \
  --agents "security,performance,style" \
  --post-comments
```

## Advanced Features

### 1. Multi-PR Swarm Coordination
```bash
# Coordinate swarms across related PRs
npx ruv-swarm github multi-pr \
  --prs "123,124,125" \
  --strategy "parallel" \
  --share-memory
```

### 2. PR Dependency Analysis
```bash
# Analyze PR dependencies
npx ruv-swarm github pr-deps 123 \
  --spawn-agents \
  --resolve-conflicts
```

### 3. Automated PR Fixes
```bash
# Auto-fix PR issues
npx ruv-swarm github pr-fix 123 \
  --issues "lint,test-failures" \
  --commit-fixes
```

## Best Practices

### 1. PR Templates
```markdown
<!-- .github/pull_request_template.md -->
## Swarm Configuration
- Topology: [mesh/hierarchical/ring/star]
- Max Agents: [number]
- Auto-spawn: [yes/no]
- Priority: [high/medium/low]

## Tasks for Swarm
- [ ] Task 1 description
- [ ] Task 2 description
```

### 2. Status Checks
```yaml
# Require swarm completion before merge
required_status_checks:
  contexts:
    - "swarm/tasks-complete"
    - "swarm/tests-pass"
    - "swarm/review-approved"
```

### 3. PR Merge Automation
```bash
# Auto-merge when swarm completes
npx ruv-swarm github pr-automerge 123 \
  --when "all-tasks-complete" \
  --require-reviews 2
```

## Webhook Integration

### Setup Webhook Handler
```javascript
// webhook-handler.js
const { createServer } = require('http');
const { execSync } = require('child_process');

createServer((req, res) => {
  if (req.url === '/github-webhook') {
    const event = JSON.parse(body);
    
    if (event.action === 'opened' && event.pull_request) {
      execSync(`npx ruv-swarm github pr-init ${event.pull_request.number}`);
    }
    
    res.writeHead(200);
    res.end('OK');
  }
}).listen(3000);
```

## Examples

### Feature Development PR
```bash
# PR #456: Add user authentication
npx ruv-swarm github pr-init 456 \
  --topology hierarchical \
  --agents "architect,coder,tester,security" \
  --auto-assign-tasks
```

### Bug Fix PR
```bash
# PR #789: Fix memory leak
npx ruv-swarm github pr-init 789 \
  --topology mesh \
  --agents "debugger,analyst,tester" \
  --priority high
```

### Documentation PR
```bash
# PR #321: Update API docs
npx ruv-swarm github pr-init 321 \
  --topology ring \
  --agents "researcher,writer,reviewer" \
  --validate-links
```

## Metrics & Reporting

### PR Swarm Analytics
```bash
# Generate PR swarm report
npx ruv-swarm github pr-report 123 \
  --metrics "completion-time,agent-efficiency,token-usage" \
  --format markdown
```

### Dashboard Integration
```bash
# Export to GitHub Insights
npx ruv-swarm github export-metrics \
  --pr 123 \
  --to-insights
```

## Security Considerations

1. **Token Permissions**: Ensure GitHub tokens have appropriate scopes
2. **Command Validation**: Validate all PR comments before execution
3. **Rate Limiting**: Implement rate limits for PR operations
4. **Audit Trail**: Log all swarm operations for compliance

## Integration with Claude Code

When using with Claude Code:
1. Claude Code reads PR diff and context
2. Swarm coordinates approach based on PR type
3. Agents work in parallel on different aspects
4. Progress updates posted to PR automatically
5. Final review performed before marking ready

See also: [swarm-issue.md](./swarm-issue.md), [workflow-automation.md](./workflow-automation.md)