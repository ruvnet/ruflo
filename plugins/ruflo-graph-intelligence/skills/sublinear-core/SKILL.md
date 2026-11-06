---
name: sublinear-core
description: Personalized PageRank, local forward/backward push and sparse diagonally dominant solves with the zero-dependency @ruvnet/sublinear-core. Use for relevance around a few nodes of a large graph or a few entries of A⁻¹b; for ruflo's own knowledge graph use agentdb_graph-pathfinder.
argument-hint: "[ppr|push|solve|estimate]"
allowed-tools: Bash Read Write
---

# Sublinear graph and solver core

`@ruvnet/sublinear-core` 1.0 is the embeddable math from `sublinear-time-solver` with no runtime dependencies (under 30 kB; Node 16+, Bun, Deno, browsers; ESM and CJS). It replaces the 184-dependency `sublinear-time-solver` as this plugin's declared solver dependency. Reach for the full package only when you want its MCP server or CLI.

## Which call

| Question | Call | Cost |
|---|---|---|
| What is relevant around these seed nodes? | `forwardPush(g, seeds, { epsilon })` | O(1 / ((1 − damping) · epsilon)) pushes, independent of graph size |
| How much does every source reach this one target? | `backwardPush(g, target, { epsilon })` | bounded by the in-neighbourhood explored |
| Exact random walk with restart | `personalizedPageRank(g, seeds)` | O(iterations · (n + m)) |
| Global importance | `pageRank(g)` | O(iterations · (n + m)) |
| Solve `A x = b` | `solve(A, b, { method })` (`auto`, `conjugate-gradient`, `gauss-seidel`, `jacobi`, `neumann`) | O(iterations · nnz) |
| One entry of `x` | `estimateEntry(A, b, i, { seed })` | Monte Carlo, independent of n after a one-time check |

## Steps

1. Install into the project that runs the code: `npm i @ruvnet/sublinear-core@^1.0.0`.
2. Build a graph from edges and rank around a seed:
   ```js
   import { graphFromEdges, forwardPush, topK } from '@ruvnet/sublinear-core';
   const g = graphFromEdges([['api', 'auth'], ['auth', 'session'], ['session', 'db'], ['db', 'auth']]);
   const r = forwardPush(g, 'auth', { epsilon: 1e-4 });   // { scores, residualMass, pushes, converged }
   console.log(topK(r.scores, 3, g));                      // [{ node, index, score }, ...]
   ```
3. For a linear system, check dominance first; the iterative methods only guarantee convergence for strictly diagonally dominant (or, for conjugate gradient, symmetric positive definite) matrices:
   ```js
   import { csrFromDense, diagonalDominance, solve, estimateEntry } from '@ruvnet/sublinear-core';
   const A = csrFromDense([[4, -1, 0], [-1, 4, -1], [0, -1, 4]]);
   diagonalDominance(A);              // { strictlyRowDominant, minMargin, jacobiNorm, ... }
   solve(A, [1, 2, 3]);               // { x, residual, iterations, converged, method }
   estimateEntry(A, [1, 2, 3], 1, { seed: 7 });   // { estimate, standardError, walks, steps }
   ```
4. Report `converged` and `residual` (or `residualMass` for push) with every answer. An unconverged result is an approximation, not a failure, but say so.

Inputs are validated and capped (`DEFAULT_LIMITS`), so untrusted JSON cannot force unbounded allocation; errors are `SublinearError` with a `code` such as `NOT_DIAGONALLY_DOMINANT` or `UNKNOWN_NODE`.

## Related

- `agentdb_graph-pathfinder` (ruflo MCP): personalized PageRank and exact min cut over ruflo's own knowledge graph. Prefer it there; it needs no install.
- `sublinear-solver` (installed by `ruflo init`): the full `sublinear-time-solver` CLI and MCP server, for matrices from files.
- agentic-flow 3.2's `sublinear_solve` and `sublinear_pagerank` MCP tools expose the same solves through the external `agentic-flow` plugin.
