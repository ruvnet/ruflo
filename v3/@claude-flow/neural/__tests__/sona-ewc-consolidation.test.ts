/**
 * SONA / EWC consolidation wiring (Dream Cycle 2026-10-02, intelligence surface).
 *
 * Finding: `SONAManager.consolidateEWC()` had zero callers anywhere in the
 * repo (`triggerLearning()` never invoked it), and even called directly its
 * `ewcState.fisher`/`means` maps were never populated from anywhere — every
 * mode's private `computeEWCPenalty()` therefore always iterated an empty
 * map and returned exactly 0, regardless of `ewcLambda`. EWC++ guarded a
 * data structure (a pattern-confidence ledger in a *different* package,
 * `cli/src/memory/ewc-consolidation.ts`) structurally decoupled from the
 * LoRA adapter weights SONA actually carries. This test exercises the real,
 * shipped behavior end-to-end through the public API.
 *
 * Imports from `../dist/sona-manager.js` (the BUILT output), not `../src/...`
 * — same workaround `persistence.test.ts` documents and PR #3394/#3395 used.
 * Importing `sona-manager.ts` (or any `modes/*.ts` file) directly under this
 * package's vitest/vite-node transform throws `Class extends value undefined`
 * for `RealTimeMode extends BaseModeImplementation` — confirmed still present
 * pre-existing, test-tooling-only (plain `node dist/sona-manager.js` and the
 * full package build are both clean; only vite-node's SSR transform of this
 * file's circular-ish `modes/` import graph is affected). Run `npm run build`
 * before `npm test` so `dist/` reflects current `src/`.
 */

import { describe, it, expect, beforeAll } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SONAManager: any;

beforeAll(async () => {
  ({ SONAManager } = await import('../dist/sona-manager.js'));
});

function completeHighQualityTrajectory(mgr: any): void {
  const id = mgr.beginTrajectory('ewc-consolidation-test', 'general');
  mgr.recordStep(id, 'act', 1, new Float32Array([0.1, 0.2, 0.3]));
  mgr.completeTrajectory(id, 0.9);
}

describe('SONAManager EWC consolidation (consolidateEWC wiring)', () => {
  it('triggerLearning() now calls consolidateEWC() — taskCount advances from a completed trajectory', async () => {
    const mgr = new SONAManager('balanced');
    await mgr.initialize();
    mgr.initializeLoRAWeights('default');

    expect(mgr.getEWCState().taskCount).toBe(0);

    completeHighQualityTrajectory(mgr);
    await mgr.triggerLearning('test');

    // Before this fix: triggerLearning() never called consolidateEWC() at
    // all, so taskCount stayed 0 forever no matter how many learning cycles
    // ran — the discriminating assertion is this strict inequality.
    expect(mgr.getEWCState().taskCount).toBe(1);
  });

  it('consolidateEWC() populates Fisher/means from the live LoRA weights instead of leaving them permanently empty', async () => {
    const mgr = new SONAManager('balanced');
    await mgr.initialize();
    const weights = mgr.initializeLoRAWeights('default');

    const stateBefore = mgr.getEWCState();
    expect(stateBefore.fisher.size).toBe(0);
    expect(stateBefore.means.size).toBe(0);

    mgr.consolidateEWC('default');

    const stateAfter = mgr.getEWCState();
    expect(stateAfter.fisher.size).toBeGreaterThan(0);
    expect(stateAfter.means.size).toBe(stateAfter.fisher.size);

    // Means must reflect the actual current LoRA A-matrix values, not a
    // placeholder — spot-check one tracked module against the real weights.
    const [firstModule] = weights.A.keys();
    const means = stateAfter.means.get(`default:${firstModule}`);
    const A = weights.A.get(firstModule);
    expect(means).toBeDefined();
    expect(Array.from(means as Float32Array)).toEqual(Array.from(A as Float32Array));

    // Fisher importance must be non-trivial (not all-zero) whenever the
    // underlying LoRA weights are non-zero — initializeLoRAWeights() seeds A
    // with small random nonzero values.
    const fisher = stateAfter.fisher.get(`default:${firstModule}`) as Float32Array;
    const fisherSum = Array.from(fisher).reduce((s, v) => s + v, 0);
    expect(fisherSum).toBeGreaterThan(0);
  });

  it('a second consolidation decays prior importance and blends in fresh importance (EWC++ online update), not a reset to a fixed value', async () => {
    const mgr = new SONAManager('balanced');
    await mgr.initialize();
    const weights = mgr.initializeLoRAWeights('default');
    const [module] = weights.A.keys();
    const key = `default:${module}`;

    mgr.consolidateEWC('default');
    const fisherGen1 = Array.from(mgr.getEWCState().fisher.get(key) as Float32Array);

    // Simulate a learning step actually moving the LoRA weights (today's
    // disclosed, separate gap: no mode's learn() does this yet — see the
    // module docstring on consolidateEWC()). A public Map the test can
    // legitimately mutate directly, same as any other caller of
    // initializeLoRAWeights()'s returned weights object.
    const A = weights.A.get(module) as Float32Array;
    for (let i = 0; i < A.length; i++) A[i] = A[i] * 3 + 0.05;

    mgr.consolidateEWC('default');
    const fisherGen2 = Array.from(mgr.getEWCState().fisher.get(key) as Float32Array);

    // Gen2 must differ from Gen1 (the map is live-updating, not frozen after
    // first write) AND must not simply equal the freshly-computed importance
    // alone (proving decay of the prior value actually contributed, not just
    // an overwrite).
    expect(fisherGen2).not.toEqual(fisherGen1);

    const freshOnly = Array.from(A).map((v) => v * v * (1 - mgr.getEWCConfig().decay));
    expect(fisherGen2).not.toEqual(freshOnly);
  });

  it('baseline-shape regression guard: consolidateEWC() is a no-op without a LoRA domain initialized, and without ewcState (uninitialized manager)', async () => {
    const mgr = new SONAManager('balanced');
    // Not initialized: ewcState is null — must not throw.
    expect(() => mgr.consolidateEWC('default')).not.toThrow();
    expect(mgr.getEWCState()).toBeNull();

    await mgr.initialize();
    // Initialized but no LoRA weights for 'default' yet — decay-only path,
    // still must not throw, and must not fabricate fisher/means out of
    // nothing.
    mgr.consolidateEWC('default');
    expect(mgr.getEWCState().fisher.size).toBe(0);
    expect(mgr.getEWCState().taskCount).toBe(1);
  });
});
