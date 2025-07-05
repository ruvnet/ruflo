# Swarm Issue - Issue-Based Swarm Coordination

## Overview
Transform GitHub Issues into intelligent swarm tasks, enabling automatic task decomposition and agent coordination.

## Core Features

### 1. Issue-to-Swarm Conversion
```bash
# Create swarm from issue
npx ruv-swarm github issue-to-swarm 456 \
  --auto-decompose \
  --assign-agents

# Batch process multiple issues
npx ruv-swarm github issues-batch \
  --label "swarm-ready" \
  --parallel
```

### 2. Issue Comment Commands
Execute swarm operations via issue comments:

```markdown
<!-- In issue comment -->
/swarm analyze
/swarm decompose 5
/swarm assign @agent-coder
/swarm estimate
/swarm start
```

### 3. Issue Templates for Swarms

```markdown
<!-- .github/ISSUE_TEMPLATE/swarm-task.yml -->
name: Swarm Task
description: Create a task for AI swarm processing
body:
  - type: dropdown
    id: topology
    attributes:
      label: Swarm Topology
      options:
        - mesh
        - hierarchical
        - ring
        - star
  - type: input
    id: agents
    attributes:
      label: Required Agents
      placeholder: "coder, tester, analyst"
  - type: textarea
    id: tasks
    attributes:
      label: Task Breakdown
      placeholder: |
        1. Task one description
        2. Task two description
```

## Issue Label Automation

### Auto-Label Based on Content
```javascript
// .github/swarm-labels.json
{
  "rules": [
    {
      "keywords": ["bug", "error", "broken"],
      "labels": ["bug", "swarm-debugger"],
      "agents": ["debugger", "tester"]
    },
    {
      "keywords": ["feature", "implement", "add"],
      "labels": ["enhancement", "swarm-feature"],
      "agents": ["architect", "coder", "tester"]
    },
    {
      "keywords": ["slow", "performance", "optimize"],
      "labels": ["performance", "swarm-optimizer"],
      "agents": ["analyst", "optimizer"]
    }
  ]
}
```

### Dynamic Agent Assignment
```bash
# Assign agents based on issue content
npx ruv-swarm github issue-analyze 456 \
  --suggest-agents \
  --estimate-complexity \
  --create-subtasks
```

## Issue Swarm Commands

### Initialize from Issue
```bash
# Create swarm with full issue context
npx ruv-swarm github issue-init 456 \
  --load-comments \
  --analyze-references \
  --auto-topology
```

### Task Decomposition
```bash
# Break down issue into subtasks
npx ruv-swarm github issue-decompose 456 \
  --max-subtasks 10 \
  --create-checklist \
  --assign-priorities
```

### Progress Tracking
```bash
# Update issue with swarm progress
npx ruv-swarm github issue-progress 456 \
  --update-checklist \
  --post-summary \
  --eta
```

## Advanced Features

### 1. Issue Dependencies
```bash
# Handle issue dependencies
npx ruv-swarm github issue-deps 456 \
  --resolve-order \
  --parallel-safe \
  --update-blocking
```

### 2. Epic Management
```bash
# Coordinate epic-level swarms
npx ruv-swarm github epic-swarm \
  --epic 123 \
  --child-issues "456,457,458" \
  --orchestrate
```

### 3. Issue Templates
```bash
# Generate issue from swarm analysis
npx ruv-swarm github create-issues \
  --from-analysis \
  --template "bug-report" \
  --auto-assign
```

## Workflow Integration

### GitHub Actions for Issues
```yaml
# .github/workflows/issue-swarm.yml
name: Issue Swarm Handler
on:
  issues:
    types: [opened, labeled, commented]

jobs:
  swarm-process:
    runs-on: ubuntu-latest
    steps:
      - name: Process Issue
        uses: ruvnet/swarm-action@v1
        with:
          command: |
            if [[ "${{ github.event.label.name }}" == "swarm-ready" ]]; then
              npx ruv-swarm github issue-init ${{ github.event.issue.number }}
            fi
```

### Issue Board Integration
```bash
# Sync with project board
npx ruv-swarm github issue-board-sync \
  --project "Development" \
  --column-mapping '{
    "To Do": "pending",
    "In Progress": "active",
    "Done": "completed"
  }'
```

## Issue Types & Strategies

### Bug Reports
```bash
# Specialized bug handling
npx ruv-swarm github bug-swarm 456 \
  --reproduce \
  --isolate \
  --fix \
  --test
```

### Feature Requests
```bash
# Feature implementation swarm
npx ruv-swarm github feature-swarm 456 \
  --design \
  --implement \
  --document \
  --demo
```

### Technical Debt
```bash
# Refactoring swarm
npx ruv-swarm github debt-swarm 456 \
  --analyze-impact \
  --plan-migration \
  --execute \
  --validate
```

## Automation Examples

### Auto-Close Stale Issues
```bash
# Process stale issues with swarm
npx ruv-swarm github stale-issues \
  --days 30 \
  --analyze-each \
  --suggest-action \
  --auto-close-if "no-activity"
```

### Issue Triage
```bash
# Automated triage system
npx ruv-swarm github triage \
  --unlabeled \
  --analyze-content \
  --suggest-labels \
  --assign-priority
```

### Duplicate Detection
```bash
# Find duplicate issues
npx ruv-swarm github find-duplicates \
  --threshold 0.8 \
  --link-related \
  --close-duplicates
```

## Integration Patterns

### 1. Issue-PR Linking
```bash
# Link issues to PRs automatically
npx ruv-swarm github link-pr \
  --issue 456 \
  --pr 789 \
  --update-both
```

### 2. Milestone Coordination
```bash
# Coordinate milestone swarms
npx ruv-swarm github milestone-swarm \
  --milestone "v2.0" \
  --parallel-issues \
  --track-progress
```

### 3. Cross-Repo Issues
```bash
# Handle issues across repositories
npx ruv-swarm github cross-repo \
  --issue "org/repo#456" \
  --related "org/other-repo#123" \
  --coordinate
```

## Metrics & Analytics

### Issue Resolution Time
```bash
# Analyze swarm performance
npx ruv-swarm github issue-metrics \
  --issue 456 \
  --metrics "time-to-close,agent-efficiency,subtask-completion"
```

### Swarm Effectiveness
```bash
# Generate effectiveness report
npx ruv-swarm github effectiveness \
  --issues "closed:>2024-01-01" \
  --compare "with-swarm,without-swarm"
```

## Best Practices

### 1. Issue Templates
- Include swarm configuration options
- Provide task breakdown structure
- Set clear acceptance criteria
- Include complexity estimates

### 2. Label Strategy
- Use consistent swarm-related labels
- Map labels to agent types
- Priority indicators for swarm
- Status tracking labels

### 3. Comment Etiquette
- Clear command syntax
- Progress updates in threads
- Summary comments for decisions
- Link to relevant PRs

## Security & Permissions

1. **Command Authorization**: Validate user permissions before executing commands
2. **Rate Limiting**: Prevent spam and abuse of issue commands
3. **Audit Logging**: Track all swarm operations on issues
4. **Data Privacy**: Respect private repository settings

## Examples

### Complex Bug Investigation
```bash
# Issue #789: Memory leak in production
npx ruv-swarm github issue-init 789 \
  --topology hierarchical \
  --agents "debugger,analyst,tester,monitor" \
  --priority critical \
  --reproduce-steps
```

### Feature Implementation
```bash
# Issue #234: Add OAuth integration
npx ruv-swarm github issue-init 234 \
  --topology mesh \
  --agents "architect,coder,security,tester" \
  --create-design-doc \
  --estimate-effort
```

### Documentation Update
```bash
# Issue #567: Update API documentation
npx ruv-swarm github issue-init 567 \
  --topology ring \
  --agents "researcher,writer,reviewer" \
  --check-links \
  --validate-examples
```

See also: [swarm-pr.md](./swarm-pr.md), [project-board-sync.md](./project-board-sync.md)