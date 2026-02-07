---
name: hooks-automation
description: >
  Automated hook lifecycle management with 17 hooks and 12 background workers. Manages pre/post task, edit, command, and session events.
  Use when: automating workflows, tracking changes, session management, background processing.
  Skip when: manual operations, one-off tasks, no automation needed.
---

# Hooks Automation Skill

## Purpose
Manage hook lifecycle and background workers for automated workflows.

## Hook Categories

| Category | Hooks | Purpose |
|----------|-------|---------|
| **Core** | `pre-edit`, `post-edit`, `pre-command`, `post-command`, `pre-task`, `post-task` | Tool lifecycle |
| **Session** | `session-start`, `session-end`, `session-restore`, `notify` | Context management |
| **Intelligence** | `route`, `explain`, `pretrain`, `build-agents`, `transfer` | Neural learning |
| **Learning** | `intelligence` | Reinforcement learning |

## Background Workers

| Worker | Priority | Description |
|--------|----------|-------------|
| `ultralearn` | normal | Deep knowledge acquisition |
| `optimize` | high | Performance optimization |
| `consolidate` | low | Memory consolidation |
| `predict` | normal | Predictive preloading |
| `audit` | critical | Security analysis |
| `map` | normal | Codebase mapping |

## Commands

### Core Hooks
```bash
npx claude-flow hooks pre-task --description "[task]"
npx claude-flow hooks post-task --task-id "[id]" --success true
npx claude-flow hooks post-edit --file "[file]" --train-patterns
```

### Session Management
```bash
npx claude-flow hooks session-start --session-id "[id]"
npx claude-flow hooks session-end --export-metrics true
npx claude-flow hooks session-restore --session-id "[id]"
```

### Background Workers
```bash
npx claude-flow hooks worker list
npx claude-flow hooks worker dispatch --trigger audit
npx claude-flow hooks worker status
```

## Best Practices
1. Use session-start at beginning of work
2. Run post-edit with --train-patterns for learning
3. Dispatch audit worker for security-sensitive changes
4. Export metrics at session-end for analysis
