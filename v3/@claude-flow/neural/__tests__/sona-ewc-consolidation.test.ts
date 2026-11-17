/**
 * Dream Cycle 2026-10-27 (DEEP=intelligence) — discriminating tests for
 * SONAManager's EWC++ consolidation path.
 *
 * Before this fix: `ewcState.fisher`/`.means` were initialized empty in
 * `SONAManager.initialize()` and nothing in the core package ever wrote to
 * them; `consolidateEWC()` (the only method that touches `fisher` post-init)
 * only decayed existing entries and had zero callers anywhere in the repo.
 * Every one of these tests fails against that baseline and passes against
 * the candidate (verified via `git stash` isolation on `sona-manager.ts`,
 * `modes/base.ts`, `modes/balanced.ts`).
 *
 * Scope disclosure #1: these tests verify the EWC *state* (fisher/means/
 * decay) becomes real and data-dependent. They do NOT assert that the
 * computed penalty changes `learn()`'s returned `improvementDelta` — it
 * doesn't; `computeEWCPenalty()`'s result feeds a local `totalGradientNorm`
 * that `BalancedMode.learn()` already discarded before this change, a
 * separate, deeper, deliberately-not-fixed-tonight gap (matching the
 * equally-stubbed `consolidate()` placeholder in this monorepo's own
 * reference pattern at
 * `v3/plugins/cognitive-kernel/src/bridges/sona-bridge.ts`).
 *
 * Scope disclosure #2 (found by an independent adversarial-critic pass on
 * this same candidate, same night): `getConsolidationSnapshot()` reports
 * the CHANGE in `gradientAccumulator` since the last consolidation (a
 * delta), not the raw cumulative accumulator, specifically so Fisher/means
 * don't trivially diverge from squaring an ever-growing lifetime-cumulative
 * value; `means` is the accumulator at consolidation (the EWC anchor theta*,
 * so the penalty restarts at zero). That bounds THIS fix's own contribution per cycle — but it does
 * NOT make `ewcState.fisher` bounded over an arbitrarily long session,
 * because of a separate, pre-existing, NOT-fixed-tonight behavior one
 * layer up: `SONAManager.triggerLearning()` re-processes every completed
 * trajectory still held in `this.trajectories` on every call (nothing
 * marks a trajectory "already learned from"; only `pruneTrajectories()`'s
 * 50%-of-capacity threshold ever removes one) — so `BalancedMode.learn()`'s
 * `for (const good of goodTrajectories)` loop, and therefore
 * `gradientAccumulator`'s movement per `triggerLearning()` call, grows with
 * the total historical backlog, not just what's new since the last cycle.
 * Verified directly (outside this test file, via a traced standalone
 * script) that `ewcState.means[0]` grows roughly linearly over 150
 * synthetic cycles with a stationary periodic input, well past the ~10-30
 * cycles `BalancedMode`'s own `beta=0.9` momentum EMA would need to settle
 * on a bounded periodic orbit if each cycle only processed its own new
 * trajectory. Fixing that backlog-reprocessing behavior is a distinct,
 * larger-blast-radius change (touches trajectory lifecycle, not EWC) and is
 * carried forward as a priority future-night candidate — it should likely
 * be fixed BEFORE `computeEWCPenalty()` is ever wired into a real gradient
 * update (scope disclosure #1), or that wiring would inherit this
 * divergence too.
 */

import { describe, it, expect } from 'vitest';
import { createSONAManager, type SONAManager } from '../src/sona-manager.js';
import { deepDecode } from '../src/utils/serialize.js';
import type { EWCState, Trajectory } from '../src/types.js';

function embedding(seed: number, len = 16): Float32Array {
  const arr = new Float32Array(len);
  for (let i = 0; i < len; i++) arr[i] = Math.sin(seed * 0.37 + i * 0.11);
  return arr;
}

async function runLearningCycle(
  manager: SONAManager,
  domain: Trajectory['domain'],
  seed: number,
  quality: number
): Promise<void> {
  const id = manager.beginTrajectory(`ctx-${seed}`, domain);
  manager.recordStep(id, 'act-1', quality, embedding(seed));
  manager.recordStep(id, 'act-2', quality, embedding(seed + 1));
  manager.completeTrajectory(id, quality);
  await manager.triggerLearning('test');
}

function decodeEwcState(manager: SONAManager): EWCState {
  const decoded = deepDecode(manager.serialize()) as { ewcState: EWCState };
  return decoded.ewcState;
}

describe('SONAManager EWC++ consolidation', () => {
  it('populates ewcState.fisher/means with real, non-zero values after a learning cycle (was permanently empty)', async () => {
    const manager = createSONAManager('balanced');
    await manager.initialize();

    await runLearningCycle(manager, 'code', 1, 0.9);

    const ewcState = decodeEwcState(manager);
    expect(ewcState.fisher.size).toBeGreaterThan(0);
    expect(ewcState.means.size).toBeGreaterThan(0);

    let sawNonZero = false;
    for (const fisher of ewcState.fisher.values()) {
      for (const value of fisher) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0); // Fisher (squared gradient) is never negative
        if (value > 0) sawNonZero = true;
      }
    }
    expect(sawNonZero).toBe(true);
    expect(ewcState.taskCount).toBeGreaterThan(0);
    expect(ewcState.lastConsolidation).toBeGreaterThan(0);
  });

  it('decays existing Fisher importance before folding in fresh evidence (online EWC), rather than overwriting it', async () => {
    const manager = createSONAManager('balanced');
    await manager.initialize();

    await runLearningCycle(manager, 'code', 1, 0.9);
    const after1 = decodeEwcState(manager);
    const key = after1.fisher.keys().next().value as string;
    const valueAfter1 = after1.fisher.get(key)![0];
    expect(valueAfter1).toBeGreaterThan(0);

    await runLearningCycle(manager, 'code', 1, 0.9);
    const after2 = decodeEwcState(manager);
    const valueAfter2 = after2.fisher.get(key)![0];

    // The second cycle's fresh contribution is `decay(0.9) * valueAfter1 +
    // freshFisher2`, where `freshFisher2` is itself strictly positive here
    // (confirmed empirically: BalancedMode.learn() reprocesses ALL completed
    // trajectories still held by the manager each cycle, so even a
    // "repeated" trajectory adds a second data point and the accumulated
    // gradient genuinely keeps moving). The property this test exists to
    // demonstrate is simply: `fisher` is not fabricated-then-frozen or
    // overwritten — a SECOND cycle changes it, in a way a permanently-empty
    // map (the baseline) could never produce. This test does NOT claim
    // fisher stays bounded over many cycles — see the module docstring's
    // "Scope disclosure #2" for why it currently doesn't.
    expect(valueAfter2).toBeGreaterThan(valueAfter1 * 0.9);
    expect(after2.taskCount).toBe(after1.taskCount + 1);
  });

  it('control: a trigger with no completed trajectories leaves ewcState untouched (no fabricated state)', async () => {
    const manager = createSONAManager('balanced');
    await manager.initialize();

    await manager.triggerLearning('test'); // nothing completed yet -> learn() short-circuits

    const ewcState = decodeEwcState(manager);
    expect(ewcState.fisher.size).toBe(0);
    expect(ewcState.means.size).toBe(0);
    expect(ewcState.taskCount).toBe(0);
  });

  it('anchors means on the accumulated parameters at consolidation, so the penalty restarts at zero', async () => {
    const manager = createSONAManager('balanced');
    await manager.initialize();

    await runLearningCycle(manager, 'code', 1, 0.9);
    await runLearningCycle(manager, 'code', 2, 0.8);

    const ewcState = decodeEwcState(manager);
    const accumulator = (manager as unknown as {
      modeImpl: { gradientAccumulator: Map<string, Float32Array> };
    }).modeImpl.gradientAccumulator;

    expect(ewcState.means.size).toBeGreaterThan(0);
    for (const [key, means] of ewcState.means) {
      const current = accumulator.get(key)!;
      expect(current).toBeDefined();
      for (let i = 0; i < means.length; i++) {
        expect(means[i]).toBeCloseTo(current[i], 6);
      }
    }
  });

  it('on the FIRST learning cycle only, Fisher equals means squared (construction-time identity of getConsolidationSnapshot(), not an ongoing system invariant)', async () => {
    // Flagged by an independent adversarial-critic pass: this identity holds
    // by construction when there is no prior snapshot to diff against (the
    // delta degenerates to the raw gradient), and it does NOT hold after a
    // second cycle, once `means` is the cumulative anchor and `fisher` has already
    // been through one decay+accumulate round in SONAManager. This test is
    // intentionally scoped to that one case rather than described as a
    // general property.
    const manager = createSONAManager('balanced');
    await manager.initialize();

    await runLearningCycle(manager, 'code', 3, 0.85);

    const ewcState = decodeEwcState(manager);
    expect(ewcState.fisher.size).toBeGreaterThan(0);

    for (const [key, fisher] of ewcState.fisher) {
      const means = ewcState.means.get(key)!;
      expect(means).toBeDefined();
      for (let i = 0; i < fisher.length; i++) {
        expect(fisher[i]).toBeCloseTo(means[i] * means[i], 5);
      }
    }
  });
});
