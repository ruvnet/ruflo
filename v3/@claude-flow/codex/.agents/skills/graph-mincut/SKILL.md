---
name: graph-mincut
description: >
  Exact minimum cut over code and knowledge graphs (@ruvector/mincut-wasm via ruvector) to find the weakest boundaries.
  Use when: deciding where to split a module, finding loosely coupled files, finding a node's cluster, partitioning work between agents.
  Skip when: shortest paths or plain neighbour lookups.
---

# Graph Min-Cut Skill

## Purpose
A minimum cut is the cheapest set of edges that splits a graph in two. In a code graph it is where a module boundary costs least. Around one node of the knowledge graph it marks that node's cluster.

## When to Trigger
- "where should this module be split?"
- "what belongs with X?"
- assigning disjoint file sets to parallel agents

## When to Skip
- reachability or k-hop questions (use `agentdb_graph-query`)

## Commands

### Code boundaries
```bash
npx @claude-flow/cli analyze boundaries src/
```

### Seed-local cut in the knowledge graph
```bash
npx @claude-flow/cli mcp exec -t agentdb_graph-pathfinder -p '{"seedNodeId":"entity:auth-module","query":"auth boundary","algorithm":"dynamic-mincut","depth":3,"threshold":0,"complexityBudget":{"maxMillis":2000}}'
```
`paths` lists the seed's side of the cut, nearest first. `mincut` reports `cutValue`, `cutEdges`, side sizes and `backend`.

## Reading Results
- `backend: mincut-wasm` is the exact wasm solver, about 30x faster than the JS fallback at 1,000 nodes.
- `backend: js-fallback` means ruvector is missing. The fallback only handles neighbourhoods of 300 nodes or fewer (`npm i ruvector`).
- If the cut only isolates the seed, the seed is weakly attached. Raise `depth`.

## Best Practices
1. Cut at the weakest boundary first, then recurse on the larger side
2. Treat `spectral-sparsify` / `connected-component-churn` results as k-hop approximations (the response says so)
