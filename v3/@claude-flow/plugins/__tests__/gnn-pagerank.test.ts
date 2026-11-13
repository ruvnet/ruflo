/**
 * GraphOperations.pageRank: personalized PageRank used to add the uniform
 * 1/n teleport for every node missing from `personalization` on top of the
 * personalization weights, so the scores summed to ~2 instead of 1. Weighted
 * runs divided by the neighbour count rather than the neighbour's total edge
 * weight, which also leaked mass.
 *
 * Both backends (optional @ruvnet/sublinear-core and the in-tree fallback)
 * must sum to 1 and match a power-iteration reference within 1e-9.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { GraphOperations } from '../src/integrations/ruvector/gnn.js';
import { _setSublinearCoreForTests } from '../src/integrations/ruvector/pagerank.js';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Random undirected graph with weights and a few isolated nodes. */
function makeGraph(n: number, m: number, seed: number) {
  const r = rng(seed);
  const src: number[] = [];
  const tgt: number[] = [];
  const w: number[] = [];
  for (let i = 0; i < m; i++) {
    const a = Math.floor(r() * (n - 5));
    const b = Math.floor(r() * (n - 5));
    if (a === b) continue;
    src.push(a);
    tgt.push(b);
    w.push(0.5 + r() * 2);
  }
  return { nodeFeatures: Array.from({ length: n }, () => [0]), edgeIndex: [src, tgt] as [number[], number[]], edgeWeights: w };
}

/** Reference on the same undirected, de-duplicated, last-weight-wins graph that loadGraph builds. */
function reference(graph: ReturnType<typeof makeGraph>, weighted: boolean, teleport?: Map<number, number>): number[] {
  const n = graph.nodeFeatures.length;
  const W = new Map<string, number>();
  const [s, t] = graph.edgeIndex;
  s.forEach((a, i) => {
    W.set(`${a}-${t[i]}`, graph.edgeWeights[i]);
    W.set(`${t[i]}-${a}`, graph.edgeWeights[i]);
  });
  const edges = [...W].map(([k, w]) => [...k.split('-').map(Number), weighted ? w : 1] as [number, number, number]);
  const out = new Array<number>(n).fill(0);
  for (const [a, , w] of edges) out[a] += w;
  const v = new Array<number>(n).fill(teleport ? 0 : 1 / n);
  if (teleport) {
    const tot = [...teleport.values()].reduce((x, y) => x + y, 0);
    for (const [i, w] of teleport) v[i] = w / tot;
  }
  const d = 0.85;
  let x = v.slice();
  for (let it = 0; it < 10_000; it++) {
    const dangling = x.reduce((acc, xi, i) => (out[i] === 0 ? acc + xi : acc), 0);
    const y = v.map((vi) => (1 - d + d * dangling) * vi);
    for (const [a, b, w] of edges) y[b] += (d * x[a] * w) / out[a];
    const delta = y.reduce((acc, yi, i) => acc + Math.abs(yi - x[i]), 0);
    x = y;
    if (delta < 1e-15) break;
  }
  return x;
}

afterEach(() => _setSublinearCoreForTests(undefined));

// @ruvnet/sublinear-core is optional; skip its cases where it is not installed.
const HAS_CORE = (() => { try { createRequire(import.meta.url).resolve('@ruvnet/sublinear-core'); return true; } catch { return false; } })();
const BACKENDS = ([['sublinear-core', undefined], ['in-tree', null]] as const).filter(([b]) => HAS_CORE || b === 'in-tree');

describe.each(BACKENDS)('GraphOperations.pageRank (%s)', (_name, hook) => {
  const graph = makeGraph(300, 900, 9);

  const run = async (opts: Parameters<GraphOperations['pageRank']>[0]) => {
    _setSublinearCoreForTests(hook);
    const ops = new GraphOperations();
    ops.loadGraph(graph);
    const ranks = await ops.pageRank(opts);
    return Array.from({ length: 300 }, (_, i) => ranks.get(i)!);
  };
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const maxErr = (a: number[], b: number[]) => Math.max(...a.map((ai, i) => Math.abs(ai - b[i])));

  it('global PageRank sums to 1 and matches the reference', async () => {
    const got = await run({});
    expect(sum(got)).toBeCloseTo(1, 12);
    expect(maxErr(got, reference(graph, false))).toBeLessThan(1e-9);
  });

  it('personalized PageRank sums to 1 (was ~1.99) and matches the reference', async () => {
    const seeds = new Map<number, number>([[0, 1]]);
    const got = await run({ personalization: seeds });
    expect(sum(got)).toBeCloseTo(1, 12);
    expect(maxErr(got, reference(graph, false, seeds))).toBeLessThan(1e-9);
  });

  it('weighted PageRank conserves mass and matches the reference', async () => {
    const got = await run({ weighted: true });
    expect(sum(got)).toBeCloseTo(1, 12);
    expect(maxErr(got, reference(graph, true))).toBeLessThan(1e-9);
  });
});
