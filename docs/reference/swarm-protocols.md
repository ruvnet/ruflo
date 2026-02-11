# Swarm Protocols

## Default Configuration

```javascript
mcp__ruv-swarm__swarm_init({
  topology: "hierarchical",
  maxAgents: 8,
  strategy: "specialized"
})
```

## When to Use Swarms

**Use swarms for:** multi-file changes (3+), feature implementation, refactoring across modules, API changes with tests, security changes, performance optimization.

**Skip swarms for:** single file edits, 1-2 line bug fixes, documentation updates, config changes, questions.

## Agent Routing

| Task Type | Agents |
|-----------|--------|
| Bug Fix | coordinator, researcher, coder, tester |
| Feature | coordinator, planner, coder, tester, reviewer |
| Refactor | coordinator, planner, coder, reviewer |
| Performance | coordinator, performance, coder |
| Security | coordinator, security, reviewer |

## Swarm Protocol Pattern

```javascript
// 1. Init swarm via MCP
mcp__ruv-swarm__swarm_init({ topology: "hierarchical", maxAgents: 8, strategy: "specialized" })

// 2. Spawn agents via Task tool (ALL in same message)
Task("Researcher", "Analyze requirements...", "researcher")
Task("Coder", "Implement solution...", "coder")
Task("Tester", "Write tests...", "tester")
```
