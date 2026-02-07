---
name: agent-coordination
description: >
  Agent spawning, lifecycle management, and coordination patterns. Manages 60+ agent types with specialized capabilities.
  Use when: spawning agents, coordinating multi-agent tasks, managing agent pools.
  Skip when: single-agent work, no coordination needed.
---

# Agent Coordination Skill

## Purpose
Spawn and coordinate agents for complex multi-agent tasks.

## Agent Types

### Core Development
`coder`, `reviewer`, `tester`, `planner`, `researcher`

### V3 Specialized
`security-architect`, `security-auditor`, `memory-specialist`, `performance-engineer`

### Swarm Coordination
`hierarchical-coordinator`, `mesh-coordinator`, `adaptive-coordinator`, `collective-intelligence-coordinator`

### Consensus
`byzantine-coordinator`, `raft-manager`, `gossip-coordinator`, `consensus-builder`

### GitHub
`pr-manager`, `code-review-swarm`, `issue-tracker`, `release-manager`

### SPARC
`sparc-coord`, `sparc-coder`, `specification`, `pseudocode`, `architecture`, `refinement`

## Commands

### Spawn Agent
```bash
npx claude-flow agent spawn --type coder --name my-coder
```

### List Agents
```bash
npx claude-flow agent list --filter active
```

### Agent Status
```bash
npx claude-flow agent status --id agent-123
```

### Agent Metrics
```bash
npx claude-flow agent metrics --id agent-123
```

### Stop Agent
```bash
npx claude-flow agent stop --id agent-123
```

### Pool Management
```bash
npx claude-flow agent pool --size 5 --type coder
```

## Routing Codes

| Code | Task | Agents |
|------|------|--------|
| 1 | Bug Fix | coordinator, researcher, coder, tester |
| 3 | Feature | coordinator, architect, coder, tester, reviewer |
| 5 | Refactor | coordinator, architect, coder, reviewer |
| 7 | Performance | coordinator, perf-engineer, coder |
| 9 | Security | coordinator, security-architect, auditor |

## Best Practices
1. Use hierarchical topology for coordination
2. Keep agent count under 8 for tight coordination
3. Use specialized agents for specific tasks
4. Coordinate via memory, not direct communication
