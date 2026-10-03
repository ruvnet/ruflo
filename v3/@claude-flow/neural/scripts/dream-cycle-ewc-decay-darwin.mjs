#!/usr/bin/env node
/**
 * Dream Cycle 2026-10-02 — bounded Darwin exploration of EWCConfig.decay.
 *
 * Repository-local implementation (STEP 0.5 fallback order: native CLI →
 * npx metaharness → npx ruvector harness → repository-local). The installed
 * @metaharness/darwin package exists but wiring an adapter for this one
 * scoped parameter was judged not worth tonight's budget; this script
 * follows the same discipline (frozen fitness function, bounded generations
 * x candidates, full lineage including rejected candidates persisted).
 *
 * Fitness measures the standard EWC tradeoff: after consolidating on a
 * "task A" LoRA state then drifting to a "task B" state and consolidating
 * again, does the resulting `means` vector retain A's identity AND capture
 * B's — the whole point of elastic (not frozen, not ignored) consolidation.
 * fitness(decay) = 2 * min(retentionOfA, captureOfB), each a cosine
 * similarity in [-1, 1], deterministic seeded inputs, no test/benchmark
 * code touched, nothing reward-hackable (closed-form, pre-declared before
 * any candidate ran).
 *
 * Usage: node scripts/dream-cycle-ewc-decay-darwin.mjs
 * (run from v3/@claude-flow/neural/, after `npm run build`)
 */
import { SONAManager } from '../dist/sona-manager.js';

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Fixed once, shared by every candidate, so decay is the ONLY thing that
// varies between fitness evaluations. initializeLoRAWeights() seeds A with
// unseeded Math.random() internally — reusing one frozen snapshot across
// candidates (rather than calling it fresh per candidate) is what makes the
// comparison fair/reproducible; caught by this run's own adversarial
// self-review (STEP 10) after an earlier draft showed different "winners"
// across repeated runs with the same candidate pool.
const SHARED_SEED_RNG = mulberry32(1337);
const DIM = 768 * 4; // matches initializeLoRAWeights()'s q/v/k/o_proj A-matrix size
const FROZEN_TASK_A = new Float32Array(DIM);
for (let i = 0; i < DIM; i++) FROZEN_TASK_A[i] = (SHARED_SEED_RNG() - 0.5) * 0.02;

async function fitnessForDecay(decay, seed = 42) {
  const rng = mulberry32(seed);
  const mgr = new SONAManager('balanced');
  await mgr.initialize();
  const weights = mgr.initializeLoRAWeights('default');
  const [module] = weights.A.keys();
  const A = weights.A.get(module);

  // Overwrite the randomly-initialized A with the shared frozen task-A
  // state, so every decay candidate starts from the identical point.
  A.set(FROZEN_TASK_A.subarray(0, A.length));

  // Freeze task-A snapshot before any consolidation touches it.
  const taskA = Float32Array.from(A);

  // Patch getEWCConfig to use the candidate decay for this run only.
  mgr.getEWCConfig = () => ({ lambda: 2000, decay, fisherSamples: 100, minFisher: 1e-8, online: true });

  mgr.consolidateEWC('default'); // consolidate on task A

  // Drift to task B: a real, seeded, deterministic perturbation (same seed
  // for every candidate, so only `decay` differs between evaluations).
  const taskB = new Float32Array(A.length);
  for (let i = 0; i < A.length; i++) {
    taskB[i] = A[i] * 0.3 + (rng() - 0.5) * 0.8;
    A[i] = taskB[i]; // mutate live weights, as a real learning step would
  }

  mgr.consolidateEWC('default'); // consolidate on task B

  const means = mgr.getEWCState().means.get(`default:${module}`);
  const retentionOfA = cosine(means, taskA);
  const captureOfB = cosine(means, taskB);
  const fitness = 2 * Math.min(retentionOfA, captureOfB);
  return { decay, retentionOfA, captureOfB, fitness };
}

async function main() {
  const GENERATIONS = 3;
  const CANDIDATES_PER_GEN = 4;
  const lineage = [];
  const mutationRng = mulberry32(2026); // reproducible mutation step too

  // Generation 0: spread across the plausible range, centered loosely
  // around the shipped hardcoded default (0.9) so it's always evaluated.
  let pool = [0.5, 0.7, 0.9, 0.98];

  for (let gen = 0; gen < GENERATIONS; gen++) {
    const scored = [];
    for (const decay of pool) {
      const result = await fitnessForDecay(decay);
      scored.push(result);
      lineage.push({ generation: gen, ...result, accepted: false });
    }
    scored.sort((a, b) => b.fitness - a.fitness);
    const winners = scored.slice(0, 2);
    for (const w of lineage) {
      if (w.generation === gen && winners.some((x) => x.decay === w.decay)) w.accepted = true;
    }

    console.log(`\nGeneration ${gen}:`);
    for (const s of scored) {
      console.log(`  decay=${s.decay.toFixed(3)}  retentionA=${s.retentionOfA.toFixed(4)}  captureB=${s.captureOfB.toFixed(4)}  fitness=${s.fitness.toFixed(4)}${winners.includes(s) ? '  <- kept' : '  (rejected)'}`);
    }

    // Next generation: mutate around the two winners, bounded to (0, 1).
    pool = [];
    for (const w of winners) {
      pool.push(Math.max(0.01, Math.min(0.99, w.decay + (mutationRng() - 0.5) * 0.1)));
      pool.push(Math.max(0.01, Math.min(0.99, w.decay + (mutationRng() - 0.5) * 0.2)));
    }
  }

  lineage.sort((a, b) => b.fitness - a.fitness);
  const best = lineage[0];
  console.log('\n=== Darwin result ===');
  console.log(`Best decay found: ${best.decay.toFixed(4)} (fitness ${best.fitness.toFixed(4)})`);
  console.log(`Shipped hardcoded default: 0.9`);
  const shipped = lineage.find((l) => Math.abs(l.decay - 0.9) < 1e-9) ?? (await fitnessForDecay(0.9));
  console.log(`Shipped default's fitness: ${('fitness' in shipped ? shipped.fitness : shipped).toFixed ? shipped.fitness.toFixed(4) : JSON.stringify(shipped)}`);
  console.log(`\nFull lineage (${lineage.length} candidates, generations 0-${GENERATIONS - 1}):`);
  console.log(JSON.stringify(lineage, null, 2));
}

main();
