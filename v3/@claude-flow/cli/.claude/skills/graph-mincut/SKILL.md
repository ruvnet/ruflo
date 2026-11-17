---
name: graph-mincut
description: "Find the weakest boundary in a dependency or knowledge graph with an exact minimum cut (@ruvector/mincut-wasm via ruvector). Use when the user asks where to split a module, which files are loosely coupled, what cluster a node belongs to, or how to partition work between agents. Skip for shortest paths or simple neighbour lookups (use agentdb_graph-query k-hop)."
---

# Graph Min-Cut and Partitioning

A minimum cut is the cheapest set of edges whose removal splits a graph in two. On a code graph it marks where a module boundary costs least; around one node it marks the edge of that node's cluster.

## Tools

| Question | Call |
|---|---|
| Natural split points in this codebase | `npx @claude-flow/cli analyze boundaries src/` (alias `mincut`) |
| Which cluster this knowledge-graph node is in, and what its weakest boundary is | `mcp__claude-flow__agentdb_graph-pathfinder` with `algorithm: "dynamic-mincut"` |
| Ranked neighbours, influence | same tool with `algorithm: "personalized-pagerank"` |

Example pathfinder call:

```json
{ "seedNodeId": "entity:auth-module", "query": "auth boundary", "algorithm": "dynamic-mincut",
  "depth": 3, "threshold": 0, "complexityBudget": { "maxMillis": 2000 } }
```

The response includes `paths` (the nodes on the seed's side of the cut, nearest first) and a `mincut` block with `cutValue`, `cutEdges`, `seedSideSize`, `otherSideSize` and `backend`.

## Reading the result

- `backend: "mincut-wasm"` means the exact cut came from the wasm solver that `ruvector` brings in. It is about 30x faster than the JS Stoer-Wagner fallback at 1,000 nodes (187 ms vs 6 s).
- `backend: "js-fallback"` means ruvector is not installed. The JS fallback only runs on neighbourhoods of 300 nodes or fewer. Run `npm i ruvector` to lift that limit.
- A `cutValue` close to the seed's own degree means the seed is weakly attached, so the cut isolates the seed rather than a cluster. Try a larger `depth`.
- `spectral-sparsify` and `connected-component-churn` are k-hop approximations for now. The response marks them with `implementation`.
