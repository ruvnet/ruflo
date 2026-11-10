---
name: sublinear-solver
description: "Solve large sparse diagonally dominant linear systems (Mx = b) and estimate single solution entries without a full solve, using sublinear-time-solver. Use for Laplacian or graph systems, influence estimates, or when only a few entries of the solution are needed. Skip for small graphs or plain PageRank: ruflo's built-in power iteration is much faster there."
---

# Sublinear-Time Solving

`sublinear-time-solver` solves diagonally dominant systems with Neumann-series, random-walk and push methods. Its strength is estimating one entry of the solution in time sublinear in the matrix size. It is a heavy package (about 184 dependencies, 123 MB installed), so ruflo does not install it. Install it only when the problem needs it:

```bash
npm i sublinear-time-solver          # or run it on demand:
npx sublinear-time-solver --help
```

## When it pays off

- Matrices with thousands of rows or more that are row or column diagonally dominant (check with `analyze`).
- You need a handful of entries of `M^-1 b`, not the whole vector.
- You want it as an MCP server alongside ruflo: `npx sublinear-time-solver serve`.

## When it does not

- PageRank or personalized PageRank on ruflo's knowledge graph. Use `mcp__claude-flow__agentdb_graph-pathfinder` (default `personalized-pagerank`). Measured with sublinear-time-solver 1.7.2's `computePageRank`: 1.2 s at 500 nodes and 68 s at 2,000 nodes. The built-in power iteration takes milliseconds at those sizes.
- Matrices that are not diagonally dominant. The methods' convergence guarantees do not hold.

## CLI workflow

```bash
npx sublinear-time-solver generate -t diagonally-dominant -s 1000 -o M.json
npx sublinear-time-solver analyze -m M.json --full         # dominance + condition estimate
npx sublinear-time-solver solve -m M.json -b b.json --method neumann --epsilon 1e-6 -o x.json
```

Matrix JSON is `{ "rows", "cols", "format": "coo", "values", "rowIndices", "colIndices" }` or `{ "rows", "cols", "format": "dense", "data": [[...]] }`.
