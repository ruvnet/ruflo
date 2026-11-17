/**
 * PageRank backends: @ruvnet/sublinear-core (optional) and the in-tree
 * fallback must agree with a straightforward power-iteration reference,
 * conserve probability mass, and the fallback must be used when the package
 * is absent.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { computePageRankScores, _setSublinearCoreForTests } from './pagerank.js';
import { MemoryGraph } from './memory-graph.js';
import type { MemoryEntry } from './types.js';

/** Deterministic LCG so the graphs are reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function randomGraph(n: number, avgOut: number, seed: number): Array<[number, number]> {
  const r = rng(seed);
  const edges: Array<[number, number]> = [];
  for (let s = 0; s < n; s++) {
    // ~10% dangling nodes
    if (r() < 0.1) continue;
    const k = 1 + Math.floor(r() * 2 * avgOut);
    for (let j = 0; j < k; j++) {
      const t = Math.floor(r() * n);
      if (t !== s) edges.push([s, t]);
    }
  }
  return edges;
}

/** Reference: dense power iteration run to 1e-15, written independently of pagerank.ts. */
function reference(n: number, edges: Array<[number, number]>, d: number, teleport?: Map<number, number>): number[] {
  const v = new Array<number>(n).fill(teleport ? 0 : 1 / n);
  if (teleport) {
    let tot = 0;
    for (const w of teleport.values()) tot += w;
    for (const [i, w] of teleport) v[i] = w / tot;
  }
  const out = new Array<number>(n).fill(0);
  for (const [s] of edges) out[s]++;
  let x = v.slice();
  for (let it = 0; it < 10_000; it++) {
    const dangling = x.reduce((acc, xi, i) => (out[i] === 0 ? acc + xi : acc), 0);
    const y = v.map((vi) => (1 - d) * vi + d * dangling * vi);
    for (const [s, t] of edges) y[t] += (d * x[s]) / out[s];
    const delta = y.reduce((acc, yi, i) => acc + Math.abs(yi - x[i]), 0);
    x = y;
    if (delta < 1e-15) break;
  }
  return x;
}

const sum = (a: ArrayLike<number>) => Array.from(a).reduce((s, x) => s + x, 0);
const maxErr = (a: ArrayLike<number>, b: number[]) => Math.max(...b.map((bi, i) => Math.abs(a[i] - bi)));

afterEach(() => _setSublinearCoreForTests(undefined));

// @ruvnet/sublinear-core is an optional dependency: the repo-root test run
// (npm workspaces) does not install it, so its cases are skipped there.
const HAS_CORE = (() => { try { createRequire(import.meta.url).resolve('@ruvnet/sublinear-core'); return true; } catch { return false; } })();
const BACKENDS = ([['sublinear-core', undefined], ['in-tree', null]] as const).filter(([b]) => HAS_CORE || b === 'in-tree');

describe.each(BACKENDS)('computePageRankScores (%s)', (backend, hook) => {
  it('uses the expected backend', () => {
    _setSublinearCoreForTests(hook);
    const run = computePageRankScores(3, [[0, 1], [1, 2]]);
    expect(run.backend).toBe(backend);
  });

  it('sums to 1 and matches power iteration within 1e-9 (n=2000, dangling nodes)', () => {
    _setSublinearCoreForTests(hook);
    const n = 2000;
    const edges = randomGraph(n, 4, 7);
    const run = computePageRankScores(n, edges, { damping: 0.85 });
    expect(run.converged).toBe(true);
    expect(sum(run.scores)).toBeCloseTo(1, 12);
    expect(maxErr(run.scores, reference(n, edges, 0.85))).toBeLessThan(1e-9);
  });

  it('personalized: sums to 1, teleports only to seeds, matches reference', () => {
    _setSublinearCoreForTests(hook);
    const n = 500;
    const edges = randomGraph(n, 3, 11);
    const seeds = new Map([[3, 2], [42, 1]]);
    const run = computePageRankScores(n, edges, { teleport: seeds });
    expect(sum(run.scores)).toBeCloseTo(1, 12);
    expect(maxErr(run.scores, reference(n, edges, 0.85, seeds))).toBeLessThan(1e-9);
  });

  it('ignores invalid teleport entries and falls back to uniform when none remain', () => {
    _setSublinearCoreForTests(hook);
    const edges: Array<[number, number]> = [[0, 1], [1, 2], [2, 0], [2, 3]];
    const uniform = computePageRankScores(4, edges);
    const bogus = computePageRankScores(4, edges, { teleport: new Map([[99, 1], [1, -5]]) });
    expect(maxErr(bogus.scores, Array.from(uniform.scores))).toBeLessThan(1e-12);
  });
});

describe('MemoryGraph.computePageRank', () => {
  const entry = (id: string, refs: string[] = []): MemoryEntry => ({
    id, key: id, content: id, type: 'semantic', namespace: 'default', tags: [], metadata: {},
    accessLevel: 'private', createdAt: 0, updatedAt: 0, version: 1, references: refs,
    accessCount: 0, lastAccessedAt: 0,
  });

  it.each(BACKENDS)('matches power iteration within 1e-9 and sums to 1 (%s)', (backend, hook) => {
    _setSublinearCoreForTests(hook);
    const n = 1000;
    const edges = randomGraph(n, 3, 5);
    const g = new MemoryGraph({ maxNodes: n });
    for (let i = 0; i < n; i++) g.addNode(entry(`n${i}`));
    for (const [s, t] of edges) g.addEdge(`n${s}`, `n${t}`, 'reference');

    let event: { backend?: string } = {};
    g.on('pagerank:computed', (e) => { event = e; });
    const ranks = g.computePageRank();
    expect(event.backend).toBe(backend);

    // MemoryGraph de-duplicates parallel edges; mirror that in the reference.
    const unique = [...new Set(edges.map(([s, t]) => `${s},${t}`))].map((k) => k.split(',').map(Number) as [number, number]);
    const ref = reference(n, unique, 0.85);
    const got = Array.from({ length: n }, (_, i) => ranks.get(`n${i}`)!);
    expect(sum(got)).toBeCloseTo(1, 12);
    expect(maxErr(got, ref)).toBeLessThan(1e-9);
  });
});
