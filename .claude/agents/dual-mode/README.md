# Dual-Mode Agents (Claude Code + Codex)

Optional agents for orchestrating hybrid workflows combining Claude Code (interactive) and Codex (headless) execution.

## Available Agents

| Agent | File | Platform | Purpose |
|-------|------|----------|---------|
| `dual-orchestrator` | dual-orchestrator.md | dual | Orchestrate hybrid Claude+Codex workflows |
| `codex-coordinator` | codex-coordinator.md | dual | Coordinate multiple headless Codex workers |
| `codex-worker` | codex-worker.md | codex | Headless background worker with self-learning |

## Architecture

```
┌─────────────────────────────────────────────────┐
│   CLAUDE CODE (Interactive)                     │
│   ├─ Complex reasoning                         │
│   ├─ Architecture decisions                    │
│   └─ Real-time review                          │
├─────────────────────────────────────────────────┤
│   dual-orchestrator                             │
│   ├─ Routes tasks to appropriate platform      │
│   └─ Coordinates hybrid workflows              │
├─────────────────────────────────────────────────┤
│   codex-coordinator                             │
│   ├─ Spawns headless workers                   │
│   ├─ Tracks progress via memory                │
│   └─ Aggregates results                        │
├─────────────────────────────────────────────────┤
│   CODEX (Headless)                              │
│   ├─ codex-worker instances                    │
│   ├─ Run in parallel via `claude -p`           │
│   └─ Store results in shared memory            │
└─────────────────────────────────────────────────┘
```

## Quick Start

### 1. Hybrid Development Workflow
```bash
# Interactive design → Parallel implementation → Interactive review
# Use dual-orchestrator agent
```

### 2. Spawn Parallel Workers
```bash
# Initialize coordination
npx claude-flow@v3alpha swarm init --topology hierarchical --max-agents 4

# Spawn workers
claude -p "Implement auth service" --session-id auth-1 &
claude -p "Write auth tests" --session-id auth-2 &
wait

# Collect results
npx claude-flow@v3alpha memory list --namespace results
```

## When to Use Each Agent

### dual-orchestrator
- Starting a new feature that needs both design and implementation
- Deciding whether a task needs interactive reasoning or can run headlessly
- Coordinating end-to-end hybrid workflows

### codex-coordinator
- Spawning multiple parallel workers for batch execution
- Managing worker lifecycle and result aggregation
- When the task is already well-defined and can be parallelized

### codex-worker
- Individual headless execution units
- Self-learning workers that check memory before/after tasks
- Background implementation tasks

## Related Skills

See `.claude/skills/dual-mode/` for skill commands:
- `/dual-spawn` - Spawn headless workers
- `/dual-coordinate` - Full hybrid workflow
- `/dual-collect` - Collect worker results

## Platform Routing

| Task Type | Platform | Agent |
|-----------|----------|-------|
| Design/Architecture | Claude Code | dual-orchestrator |
| Debugging | Claude Code | - |
| Implementation | Codex | codex-worker |
| Testing | Codex | codex-worker |
| Documentation | Codex | codex-worker |
| Code Review | Claude Code | - |
| Hybrid Feature | Both | dual-orchestrator |
