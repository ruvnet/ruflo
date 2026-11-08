/**
 * PageRank by power iteration over a dense-index graph.
 *
 * Uses `@ruvnet/sublinear-core` when it is installed (optional dependency,
 * loaded lazily and synchronously through `createRequire`) and otherwise an
 * in-tree implementation with the same semantics:
 *
 * - `damping` is the probability of following an out-edge;
 * - the mass of nodes without out-edges is redistributed by the teleport
 *   vector, so scores always sum to 1;
 * - iteration stops when the L1 change between iterates is <= `tolerance`.
 *
 * Kept in step with @claude-flow/memory/src/pagerank.ts (separate package).
 * @module v3/plugins/integrations/ruvector/pagerank
 */
import { createRequire } from 'node:module';

/** [source, target, weight?] with 0 <= source, target < n. Weight defaults to 1. */
export type IndexEdge = readonly [number, number, number?];

export interface PageRankRunOptions {
  /** Probability of following an out-edge. Default 0.85. */
  damping?: number;
  /** Stop when the L1 change between iterates is <= tolerance. Default 1e-10. */
  tolerance?: number;
  /** Default 100. */
  maxIterations?: number;
  /** Teleport weights by node index; normalized internally. Uniform when omitted or empty. */
  teleport?: ReadonlyMap<number, number>;
}

export interface PageRankRun {
  scores: Float64Array;
  iterations: number;
  /** L1 change of the last iteration. */
  delta: number;
  converged: boolean;
  backend: 'sublinear-core' | 'in-tree';
}

interface SublinearCore {
  graphFromEdges(edges: Iterable<IndexEdge>, options?: { n?: number }): unknown;
  pageRank(graph: unknown, options?: object): { scores: Float64Array; iterations: number; delta: number; converged: boolean };
  personalizedPageRank(graph: unknown, seeds: ReadonlyMap<number, number>, options?: object): { scores: Float64Array; iterations: number; delta: number; converged: boolean };
}

let core: SublinearCore | null | undefined;

function loadCore(): SublinearCore | null {
  if (core === undefined) {
    try {
      const mod = createRequire(import.meta.url)('@ruvnet/sublinear-core') as Partial<SublinearCore>;
      core = typeof mod?.pageRank === 'function'
        && typeof mod.personalizedPageRank === 'function'
        && typeof mod.graphFromEdges === 'function'
        ? (mod as SublinearCore)
        : null;
    } catch {
      core = null;
    }
  }
  return core;
}

/**
 * Test hook: `null` forces the in-tree implementation, `undefined` restores
 * lazy loading, an object substitutes the module.
 */
export function _setSublinearCoreForTests(mod: unknown): void {
  core = mod as SublinearCore | null | undefined;
}

/** Drop self-references, out-of-range endpoints and non-positive or non-finite weights. */
function sanitize(n: number, edges: Iterable<IndexEdge>): Array<[number, number, number]> {
  const clean: Array<[number, number, number]> = [];
  for (const [s, t, rawW] of edges) {
    const w = rawW ?? 1;
    if (!Number.isInteger(s) || !Number.isInteger(t) || s < 0 || t < 0 || s >= n || t >= n) continue;
    if (!Number.isFinite(w) || w <= 0) continue;
    clean.push([s, t, w]);
  }
  return clean;
}

function teleportVector(n: number, teleport?: ReadonlyMap<number, number>): Map<number, number> | null {
  if (!teleport) return null;
  const v = new Map<number, number>();
  let total = 0;
  for (const [i, w] of teleport) {
    if (Number.isInteger(i) && i >= 0 && i < n && Number.isFinite(w) && w > 0) {
      v.set(i, (v.get(i) ?? 0) + w);
      total += w;
    }
  }
  if (total === 0) return null;
  for (const [i, w] of v) v.set(i, w / total);
  return v;
}

/** In-tree power iteration. Exported for tests. */
export function pageRankInTree(
  n: number,
  edges: ReadonlyArray<readonly [number, number, number]>,
  damping: number,
  tolerance: number,
  maxIterations: number,
  teleport: ReadonlyMap<number, number> | null,
): Omit<PageRankRun, 'backend'> {
  const v = new Float64Array(n);
  if (teleport) for (const [i, w] of teleport) v[i] = w;
  else v.fill(1 / n);

  const outWeight = new Float64Array(n);
  for (const [s, , w] of edges) outWeight[s] += w;

  let x = Float64Array.from(v);
  let delta = Infinity;
  let iterations = 0;
  while (iterations < maxIterations) {
    let dangling = 0;
    for (let i = 0; i < n; i++) if (outWeight[i] === 0) dangling += x[i];
    const y = new Float64Array(n);
    for (const [s, t, w] of edges) y[t] += (damping * x[s] * w) / outWeight[s];
    const restart = 1 - damping + damping * dangling;
    delta = 0;
    for (let i = 0; i < n; i++) {
      y[i] += restart * v[i];
      delta += Math.abs(y[i] - x[i]);
    }
    x = y;
    iterations++;
    if (delta <= tolerance) break;
  }
  return { scores: x, iterations, delta, converged: delta <= tolerance };
}

/** PageRank (or personalized PageRank when `teleport` is given) over nodes 0..n-1. */
export function computePageRankScores(
  n: number,
  edges: Iterable<IndexEdge>,
  options: PageRankRunOptions = {},
): PageRankRun {
  const damping = options.damping ?? 0.85;
  const tolerance = options.tolerance ?? 1e-10;
  const maxIterations = options.maxIterations ?? 100;
  if (n === 0) return { scores: new Float64Array(0), iterations: 0, delta: 0, converged: true, backend: 'in-tree' };

  const clean = sanitize(n, edges);
  const teleport = teleportVector(n, options.teleport);
  const lib = loadCore();
  if (lib) {
    const graph = lib.graphFromEdges(clean, { n });
    const opts = { damping, tolerance, maxIterations };
    const r = teleport ? lib.personalizedPageRank(graph, teleport, opts) : lib.pageRank(graph, opts);
    return { scores: r.scores, iterations: r.iterations, delta: r.delta, converged: r.converged, backend: 'sublinear-core' };
  }
  return { ...pageRankInTree(n, clean, damping, tolerance, maxIterations, teleport), backend: 'in-tree' };
}
