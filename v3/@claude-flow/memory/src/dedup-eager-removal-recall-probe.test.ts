/**
 * Dream Cycle 2026-10-08 — mixed-verdict evidence, corrected after
 * independent adversarial review.
 *
 * Frozen hypothesis (STEP 3.3): given `MemoryConsolidator.dedup()`'s
 * pass-2 near-duplicate loop, which calls `HNSWIndex.removePoint()`
 * eagerly for every dropped entry inside a `do { ... } while
 * (roundMerged > 0)` loop that itself depends on `index.search()` for its
 * own next-round candidates, then HNSW `search()` recall@10 for
 * UNRELATED background vectors should measurably degrade mid-`dedup()`
 * relative to a fresh/rebuilt index — the literature's "unreachable
 * points phenomenon" (arXiv 2407.07871), since `removePoint()`
 * (`hnsw-index.ts:412-455`) never repairs the graph it mutates.
 *
 * Two separate verdicts came out of tonight's evaluation:
 *
 * 1. **REJECT (solid, confirmed, not flaky).** The "obvious" fix — defer
 *    `removePoint()` to a single batch after `dedup()` converges,
 *    tombstone-and-filter style like Qdrant/Weaviate — was implemented
 *    and broke a real pre-existing test (`consolidator.test.ts`'s "fully
 *    converges a near-duplicate cluster larger than the search
 *    neighborhood"): merged dropped from 14 to 7 for n=15 identical
 *    vectors. Root cause: for pairwise-identical vectors, deferring
 *    removal means `index.search()` returns the same top-K set every
 *    round (nothing shrinks; ties resolve deterministically), so later
 *    rounds never resurface the rest of the cluster. Eager removal is
 *    load-bearing for this algorithm's completeness. Reverted; not
 *    shipped. An independent adversarial critic re-ran this 17 times
 *    (standalone + combined) with zero failures — this part is solid.
 *
 * 2. **INCONCLUSIVE, corrected (was initially mis-reported as REJECT).**
 *    The first version of this file asserted "no background-recall
 *    degradation" based on only 10 manual re-runs, all of which happened
 *    to pass. An independent adversarial critic re-ran the same
 *    single-trial probe ~46 times and found a genuine ~10% failure rate
 *    at M=16 (the real production default, not a contrived sparse
 *    config) — including one run with a FULL recall collapse to 0,
 *    exactly the "unreachable points" signature the hypothesis predicts.
 *    `HNSWIndex.getRandomLevel()` uses real, unseeded `Math.random()` for
 *    level assignment, so each index build samples a different random
 *    graph topology even with identical, fully-seeded vector content —
 *    the single-trial version was measuring one random draw, not a
 *    stable property. This file now runs MANY independent trials (fresh
 *    index + fresh random graph topology each time, same seeded vector
 *    content) and reports the full distribution rather than one
 *    pass/fail draw, so the real finding — degradation happens
 *    intermittently and can be severe when it does, but not reliably
 *    every time — is visible and durable instead of hidden behind
 *    whichever draw a single run happened to get. This is why the
 *    hypothesis's own verdict is INCONCLUSIVE, not REJECT: a single
 *    experiment could not reliably distinguish "degradation happens"
 *    from "it doesn't" here, and that irreproducibility is itself the
 *    finding, not an artifact to average away.
 *
 * Per the Dream Cycle's own invariants: "A rejected hypothesis with
 * useful evidence is a successful Dream Cycle," "Never weaken tests ...
 * to obtain a favorable result," and "An experiment that could not
 * reliably distinguish the candidate from baseline" is INCONCLUSIVE, not
 * a quiet REJECT. This test exists so that corrected, honest picture is
 * durable, not just narrated in a gist.
 */
import { describe, it, expect } from 'vitest';
import { HNSWIndex } from './hnsw-index.js';

function xorshift32(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function buildClusteredCorpus(n: number, dim: number, numClusters: number, seed: number): Float32Array[] {
  const rand = xorshift32(seed);
  const centers: Float32Array[] = [];
  for (let c = 0; c < numClusters; c++) {
    const center = new Float32Array(dim);
    for (let d = 0; d < dim; d++) center[d] = (rand() - 0.5) * 20;
    centers.push(center);
  }
  const vectors: Float32Array[] = [];
  for (let i = 0; i < n; i++) {
    const center = centers[i % numClusters];
    const v = new Float32Array(dim);
    for (let d = 0; d < dim; d++) v[d] = center[d] + (rand() - 0.5) * 1.5;
    vectors.push(v);
  }
  return vectors;
}

function bruteForceTopK(query: Float32Array, corpus: Float32Array[], ids: string[], k: number): Set<string> {
  const scored = corpus.map((v, i) => {
    let dot = 0, nv = 0, nq = 0;
    for (let d = 0; d < v.length; d++) {
      dot += v[d] * query[d];
      nv += v[d] * v[d];
      nq += query[d] * query[d];
    }
    const cos = dot / (Math.sqrt(nv) * Math.sqrt(nq) + 1e-9);
    return { id: ids[i], dist: 1 - cos };
  });
  scored.sort((a, b) => a.dist - b.dist);
  return new Set(scored.slice(0, k).map((s) => s.id));
}

async function measureRecall(
  index: HNSWIndex,
  backgroundCorpus: Float32Array[],
  backgroundIds: string[],
  queryIdxs: number[],
  k: number,
): Promise<number> {
  let total = 0;
  for (const qi of queryIdxs) {
    const query = backgroundCorpus[qi];
    const gt = bruteForceTopK(query, backgroundCorpus, backgroundIds, k);
    const results = await index.search(query, k, 200);
    const returned = new Set(results.map((r) => r.id));
    let hits = 0;
    for (const id of returned) if (gt.has(id)) hits++;
    total += hits / k;
  }
  return total / queryIdxs.length;
}

interface TrialResult {
  recallBefore: number;
  recallAfter: number;
  delta: number;
}

async function runTrial(
  background: Float32Array[],
  backgroundIds: string[],
  dupBase: Float32Array,
  dupIds: string[],
  queryIdxs: number[],
  dim: number,
  m: number,
  k: number,
): Promise<TrialResult> {
  const index = new HNSWIndex({ dimensions: dim, metric: 'cosine', M: m, efConstruction: 200 });

  let dupCursor = 0;
  for (let i = 0; i < background.length; i++) {
    await index.addPoint(backgroundIds[i], background[i]);
    if (i % 7 === 0 && dupCursor < dupIds.length) {
      await index.addPoint(dupIds[dupCursor], dupBase);
      dupCursor++;
    }
  }
  while (dupCursor < dupIds.length) {
    await index.addPoint(dupIds[dupCursor], dupBase);
    dupCursor++;
  }

  const recallBefore = await measureRecall(index, background, backgroundIds, queryIdxs, k);

  // Simulate dedup()'s real mergeGroup() behavior exactly: eagerly
  // removePoint() every dup-cluster member except one keeper — current,
  // unmodified production code in consolidator.ts.
  for (let i = 1; i < dupIds.length; i++) {
    await index.removePoint(dupIds[i]);
  }

  const recallAfter = await measureRecall(index, background, backgroundIds, queryIdxs, k);
  return { recallBefore, recallAfter, delta: recallAfter - recallBefore };
}

describe('Dream Cycle 2026-10-08 — dedup() eager-removal collateral recall (hypothesis: INCONCLUSIVE, corrected)', () => {
  it(
    'measures the FULL DISTRIBUTION of background recall@10 impact across many independent graph builds, at M=16 (production default), instead of a single flaky draw',
    async () => {
      const DIM = 32;
      const N_BG = 400;
      const NUM_CLUSTERS = 12;
      const DUP_CLUSTER_SIZE = 200;
      const NUM_QUERIES = 40;
      const K = 10;
      const M = 16; // production default (hnsw-index.ts mergeConfig: `M || 16`)
      const N_TRIALS = 24; // each trial independently resamples HNSWIndex's unseeded Math.random() graph topology

      const background = buildClusteredCorpus(N_BG, DIM, NUM_CLUSTERS, 2026);
      const backgroundIds = background.map((_, i) => `bg-${i}`);

      const dupRand = xorshift32(777);
      const dupBase = new Float32Array(DIM);
      for (let d = 0; d < DIM; d++) dupBase[d] = background[0][d] + (dupRand() - 0.5) * 0.1;
      const dupIds = Array.from({ length: DUP_CLUSTER_SIZE }, (_, i) => `dup-${i}`);

      const cluster0Idxs = Array.from({ length: N_BG }, (_, i) => i).filter((i) => i % NUM_CLUSTERS === 0);
      const rand = xorshift32(1337);
      const queryIdxs = Array.from({ length: Math.min(NUM_QUERIES, cluster0Idxs.length) }, () =>
        cluster0Idxs[Math.floor(rand() * cluster0Idxs.length)],
      );

      const trials: TrialResult[] = [];
      for (let t = 0; t < N_TRIALS; t++) {
        trials.push(await runTrial(background, backgroundIds, dupBase, dupIds, queryIdxs, DIM, M, K));
      }

      const deltas = trials.map((t) => t.delta);
      const meanDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      const worstDelta = Math.min(...deltas);
      const bestDelta = Math.max(...deltas);
      const degradedCount = deltas.filter((d) => d < -0.05).length;
      const catastrophicCount = trials.filter((t) => t.recallAfter < 0.5 && t.recallBefore >= 0.5).length;

      // eslint-disable-next-line no-console
      console.log(JSON.stringify({
        N_TRIALS,
        meanDelta,
        worstDelta,
        bestDelta,
        degradedCount,
        catastrophicCount,
        note: 'degradedCount/catastrophicCount > 0 is EXPECTED some fraction of the time — this is the INCONCLUSIVE finding itself, not a bug in this harness. See file docstring.',
      }, null, 2));

      // Sanity check only: the harness itself works (background recall is
      // meaningfully above chance before any removal happens at all,
      // averaged across trials). This is NOT a "no degradation" claim —
      // that claim was false (see docstring) and is deliberately not
      // asserted here. Individual-trial degradation, including
      // occasional severe collapse, is expected and is the finding.
      const meanRecallBefore = trials.reduce((a, t) => a + t.recallBefore, 0) / trials.length;
      expect(meanRecallBefore).toBeGreaterThan(0.5);
      expect(trials.length).toBe(N_TRIALS);
    },
    120_000,
  );
});
