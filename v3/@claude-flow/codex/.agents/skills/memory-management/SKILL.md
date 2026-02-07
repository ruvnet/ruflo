---
name: memory-management
description: >
  AgentDB memory system with HNSW vector search.
  Use when: need to store patterns, search for solutions, semantic lookup.
  Skip when: no learning needed, ephemeral tasks.
---

# Memory Management Skill

## Purpose
AgentDB memory system with HNSW vector search.

## When to Trigger
- need to store patterns
- search for solutions
- semantic lookup

## When to Skip
- no learning needed
- ephemeral tasks

## Commands

### Store Data
Store a pattern in memory

```bash
npx @claude-flow/cli memory store --key "key" --value "value" --namespace patterns
```

### Search Data
Semantic search in memory

```bash
npx @claude-flow/cli memory search --query "search terms" --limit 10
```



## Best Practices
1. Check memory for existing patterns before starting
2. Use hierarchical topology for coordination
3. Store successful patterns after completion
4. Document any new learnings
