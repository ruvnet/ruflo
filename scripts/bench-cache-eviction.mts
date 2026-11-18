#!/usr/bin/env -S npx tsx
/**
 * Dream-cycle 2026-11-18 bounded Darwin-style parameter sweep for
 * CacheManager's new frequency-aware eviction (frequencyWeight /
 * evictionScanWindow). Repository-local implementation: the native
 * `metaharness evolve --bench` CLI path requires a built CLI dist that is
 * not reproducible in this checkout (unbuilt `@claude-flow/swarm` dist,
 * pre-existing on main), so this script plays the same role -- bounded
 * generations x candidates, a frozen fitness function, real evaluation
 * against the real CacheManager class (not a reimplementation) -- without
 * introducing a new dependency, per STEP 0.5's repository-local fallback.
 *
 * Bounds enforced (STEP 12 default budget): max 3 generations, max 4
 * candidates/generation, promote exactly 1 lineage winner.
 */
import { readFileSync } from 'node:fs';
import { CacheManager } from '../v3/@claude-flow/memory/src/cache-manager.js';

interface Task {
  id: string;
  seed: number;
  numKeys: number;
  maxSize: number;
  numOps: number;
  skewExponent: number;
  goldenTopFraction: number;
}

interface Corpus {
  tasks: Task[];
}

interface Candidate {
  frequencyWeight: number;
  evictionScanWindow: number;
}

// Deterministic mulberry32 PRNG -- no external dependency, fully reproducible from seed.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function zipfianKeyIndex(rand: () => number, numKeys: number, exponent: number): number {
  // Rejection-free approximation: rank by 1/(i+1)^exponent weights via inverse CDF sampling.
  const weights: number[] = [];
  let total = 0;
  for (let i = 0; i < numKeys; i++) {
    const w = 1 / Math.pow(i + 1, exponent);
    weights.push(w);
    total += w;
  }
  const r = rand() * total;
  let cum = 0;
  for (let i = 0; i < numKeys; i++) {
    cum += weights[i];
    if (r <= cum) return i;
  }
  return numKeys - 1;
}

function runTask(task: Task, candidate: Candidate): { retention: number; opsPerSec: number } {
  const rand = mulberry32(task.seed);
  const keys = Array.from({ length: task.numKeys }, (_, i) => `k${i}`);
  const trueAccessCount = new Array(task.numKeys).fill(0);

  const cache = new CacheManager<number>({
    maxSize: task.maxSize,
    frequencyWeight: candidate.frequencyWeight,
    evictionScanWindow: candidate.evictionScanWindow,
  });

  const start = performance.now();
  for (let op = 0; op < task.numOps; op++) {
    const idx = zipfianKeyIndex(rand, task.numKeys, task.skewExponent);
    trueAccessCount[idx]++;
    const key = keys[idx];
    if (cache.get(key) === null) {
      cache.set(key, idx);
    }
  }
  const elapsedMs = performance.now() - start;
  const opsPerSec = task.numOps / (elapsedMs / 1000);

  const rankedByTrueFreq = keys
    .map((k, i) => ({ k, freq: trueAccessCount[i] }))
    .sort((a, b) => b.freq - a.freq);
  const goldenCount = Math.max(1, Math.floor(task.numKeys * task.goldenTopFraction));
  const golden = rankedByTrueFreq.slice(0, goldenCount).map((x) => x.k);

  const resident = new Set(cache.keys());
  const retained = golden.filter((k) => resident.has(k)).length;
  const retention = retained / golden.length;

  return { retention, opsPerSec };
}

function evaluate(corpus: Corpus, candidate: Candidate, baseline: Candidate) {
  const perTask = corpus.tasks.map((task) => {
    const cand = runTask(task, candidate);
    const base = runTask(task, baseline);
    return { task: task.id, cand, base };
  });

  const qualityDeltas = perTask.map((t) => t.cand.retention - t.base.retention);
  const quality = clamp01(0.5 + avg(qualityDeltas) / 2);
  const successRate = avg(perTask.map((t) => (t.cand.retention >= t.base.retention - 1e-9 ? 1 : 0)));
  const latencyRatios = perTask.map((t) => t.cand.opsPerSec / t.base.opsPerSec);
  const latency = clamp01(avg(latencyRatios) / 1.0);
  const costEfficiency = 1; // deterministic in-process code, $0
  const reproducibility = 1; // seeded PRNG, fully deterministic
  const safety = successRate; // no regression vs. baseline on any task

  const fitness =
    0.35 * quality + 0.2 * successRate + 0.15 * latency + 0.1 * costEfficiency + 0.1 * reproducibility + 0.1 * safety;

  return {
    candidate,
    quality,
    successRate,
    latency,
    costEfficiency,
    reproducibility,
    safety,
    fitness,
    meanRetentionDelta: avg(qualityDeltas),
    meanOpsRatio: avg(latencyRatios),
  };
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function main() {
  const corpus: Corpus = JSON.parse(readFileSync('.harness/bench-memory-eviction-2026-11-18.json', 'utf-8'));
  const baseline: Candidate = { frequencyWeight: 0, evictionScanWindow: 32 };

  const lineage: Array<ReturnType<typeof evaluate> & { generation: number }> = [];

  // Generation 1: sweep frequencyWeight, fixed window=32 (4 candidates).
  const gen1Weights = [0.25, 0.5, 0.75, 1.0];
  let gen1Results = gen1Weights.map((w) =>
    evaluate(corpus, { frequencyWeight: w, evictionScanWindow: 32 }, baseline)
  );
  gen1Results.forEach((r) => lineage.push({ ...r, generation: 1 }));
  let winner = gen1Results.slice().sort((a, b) => b.fitness - a.fitness)[0];

  // Generation 2: sweep evictionScanWindow around winner's weight (4 candidates).
  const gen2Windows = [8, 16, 32, 64];
  let gen2Results = gen2Windows.map((win) =>
    evaluate(corpus, { frequencyWeight: winner.candidate.frequencyWeight, evictionScanWindow: win }, baseline)
  );
  gen2Results.forEach((r) => lineage.push({ ...r, generation: 2 }));
  winner = [...gen1Results, ...gen2Results].sort((a, b) => b.fitness - a.fitness)[0];

  // Generation 3: fine-tune weight around winner (4 candidates).
  const base = winner.candidate.frequencyWeight;
  const gen3Weights = [Math.max(0.05, base - 0.2), Math.max(0.05, base - 0.1), Math.min(1, base + 0.1), Math.min(1, base + 0.2)];
  let gen3Results = gen3Weights.map((w) =>
    evaluate(corpus, { frequencyWeight: w, evictionScanWindow: winner.candidate.evictionScanWindow }, baseline)
  );
  gen3Results.forEach((r) => lineage.push({ ...r, generation: 3 }));

  const finalWinner = lineage.slice().sort((a, b) => b.fitness - a.fitness)[0];
  const baselineEval = evaluate(corpus, baseline, baseline);

  console.log(JSON.stringify({ baselineEval, lineage, finalWinner }, null, 2));
}

main();
// Each CacheManager instance starts an un-refed cleanup setInterval
// (see the 2026-11-18 architecture-review disclosure of cache-manager.ts's
// missing .unref() -- a separate, disclosed-not-fixed finding tonight).
// This script creates ~150 short-lived instances and never calls
// shutdown() on them, so force a clean exit rather than waiting on them.
process.exit(0);
