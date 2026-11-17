---
name: sublinear-solver
description: >
  Solve large sparse diagonally dominant systems (Mx = b) and estimate single solution entries with sublinear-time-solver.
  Use when: Laplacian/graph systems with thousands of rows, only a few solution entries needed, a solver MCP server is wanted.
  Skip when: small graphs or plain PageRank (ruflo's built-in power iteration is far faster).
---

# Sublinear Solver Skill

## Purpose
`sublinear-time-solver` implements Neumann-series, random-walk and push solvers for diagonally dominant systems. It can estimate one entry of `M^-1 b` without solving the whole system. It is heavy (about 184 dependencies, 123 MB), so it is installed on demand, not with ruflo.

## When to Trigger
- matrix is row or column diagonally dominant and large
- you need a few entries of the solution, not the full vector

## When to Skip
- PageRank on ruflo's graph: use `agentdb_graph-pathfinder` (default personalized-pagerank). Measured `computePageRank` in sublinear-time-solver 1.7.2: 1.2 s at 500 nodes, 68 s at 2,000 nodes. The built-in takes milliseconds.
- matrices that are not diagonally dominant

## Commands

### Generate, analyze, solve
```bash
npx sublinear-time-solver generate -t diagonally-dominant -s 1000 -o M.json
npx sublinear-time-solver analyze -m M.json --full
npx sublinear-time-solver solve -m M.json -b b.json --method neumann --epsilon 1e-6 -o x.json
```

### Run as an MCP server
```bash
npx sublinear-time-solver serve
```

## Best Practices
1. Run `analyze --full` first: convergence depends on diagonal dominance
2. Matrix JSON: `{"rows","cols","format":"coo","values","rowIndices","colIndices"}` or dense `{"format":"dense","data":[[...]]}`
