# Hooks System

## Hook Categories

| Category | Hooks | Purpose |
|----------|-------|---------|
| Core | `pre-edit`, `post-edit`, `pre-command`, `post-command`, `pre-task`, `post-task` | Tool lifecycle |
| Session | `session-start`, `session-end`, `session-restore`, `notify` | Context management |
| Intelligence | `route`, `explain`, `pretrain`, `build-agents`, `transfer` | Pattern learning |
| Agent Teams | `teammate-idle`, `task-completed` | Multi-agent coordination |

## Background Workers

| Worker | Priority | Description |
|--------|----------|-------------|
| `optimize` | high | Performance optimization |
| `audit` | critical | Security analysis |
| `map` | normal | Codebase mapping |
| `testgaps` | normal | Test coverage analysis |
| `consolidate` | low | Memory consolidation |

## Commands

```bash
npx claude-flow@v3alpha hooks pre-task --description "[task]"
npx claude-flow@v3alpha hooks post-task --task-id "[id]" --success true
npx claude-flow@v3alpha hooks session-start --session-id "[id]"
npx claude-flow@v3alpha hooks session-end --export-metrics true
npx claude-flow@v3alpha hooks route --task "[task]"
npx claude-flow@v3alpha hooks worker list
npx claude-flow@v3alpha hooks worker dispatch --trigger audit
```
