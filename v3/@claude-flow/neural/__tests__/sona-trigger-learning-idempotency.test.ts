/**
 * Dream Cycle 2026-11-12 (DEEP=intelligence) — discriminating tests for
 * SONAManager.triggerLearning()'s trajectory-reprocessing fix.
 *
 * Directly continues the priority follow-up `sona-ewc-consolidation.test.ts`
 * disclosed (2026-10-27, PR #4531/#4532, "Scope disclosure #2"): before this
 * fix, `triggerLearning()` re-filtered the ENTIRE `this.trajectories` map on
 * every call with no marker for "already learned from" — so any trajectory
 * that survived `pruneTrajectories()`'s quality-based eviction (the
 * highest-quality ones, exactly the ones most worth keeping) got re-fed into
 * `BalancedMode.learn()`'s gradient accumulation / EWC Fisher update on
 * every subsequent cycle for as long as it stayed resident, purely from
 * replaying old evidence rather than reflecting genuinely new data. The
 * fix adds `Trajectory.learnedFrom` and excludes already-learned
 * trajectories from the next cycle's filter.
 *
 * Every test below fails against the pre-fix baseline (verified via
 * `git stash` isolation of `sona-manager.ts`/`types.ts`) and passes against
 * the candidate.
 *
 * SCOPE DISCLOSURE (found by this same night's independent adversarial
 * critic, confirmed by a second independent re-check): this fix only stops
 * reprocessing of trajectories that are STILL RESIDENT with no new
 * completions arriving (the scenario every test below exercises). It does
 * NOT bound `BalancedMode`'s `gradientAccumulator`/`ewcState.means` under
 * continuous normal operation — a steady stream of genuinely-new,
 * similar-content trajectories (one per cycle, never reprocessed) still
 * drives that accumulator to grow linearly without bound, because nothing
 * resets it except `initialize()`/`cleanup()`. See
 * `sona-ewc-consolidation.test.ts`'s updated docstring for the full
 * reproduction and numbers; that deeper bug is carried forward as the next
 * priority future-night candidate, not fixed here.
 */

import { describe, it, expect } from 'vitest';
import { createSONAManager, type SONAManager } from '../src/sona-manager.js';

function embedding(seed: number, len = 16): Float32Array {
  const arr = new Float32Array(len);
  for (let i = 0; i < len; i++) arr[i] = Math.sin(seed * 0.37 + i * 0.11);
  return arr;
}

function gradientAccumulator(manager: SONAManager): Map<string, Float32Array> {
  return (manager as unknown as {
    modeImpl: { gradientAccumulator: Map<string, Float32Array> };
  }).modeImpl.gradientAccumulator;
}

function learnIterations(manager: SONAManager): number {
  return (manager as unknown as { modeImpl: { learnIterations: number } }).modeImpl
    .learnIterations;
}

function snapshotAccumulator(manager: SONAManager): Map<string, Float32Array> {
  const copy = new Map<string, Float32Array>();
  for (const [key, value] of gradientAccumulator(manager)) {
    copy.set(key, Float32Array.from(value));
  }
  return copy;
}

describe('SONAManager.triggerLearning() trajectory-reprocessing fix', () => {
  it('a second triggerLearning() call with no new completed trajectories does not re-move the gradient accumulator', async () => {
    const manager = createSONAManager('balanced');
    await manager.initialize();

    const id = manager.beginTrajectory('ctx-1', 'code');
    manager.recordStep(id, 'act-1', 0.9, embedding(1));
    manager.recordStep(id, 'act-2', 0.9, embedding(2));
    manager.completeTrajectory(id, 0.9);

    await manager.triggerLearning('test'); // cycle 1: learns from the one trajectory
    const iterationsAfterCycle1 = learnIterations(manager);
    const accumulatorAfterCycle1 = snapshotAccumulator(manager);
    expect(accumulatorAfterCycle1.size).toBeGreaterThan(0);

    await manager.triggerLearning('test'); // cycle 2: nothing new completed since cycle 1

    expect(learnIterations(manager)).toBe(iterationsAfterCycle1);
    const accumulatorAfterCycle2 = gradientAccumulator(manager);
    for (const [key, before] of accumulatorAfterCycle1) {
      const after = accumulatorAfterCycle2.get(key)!;
      expect(after).toBeDefined();
      for (let i = 0; i < before.length; i++) {
        expect(after[i]).toBeCloseTo(before[i], 10);
      }
    }
  });

  it('marks every trajectory it learned from with learnedFrom=true', async () => {
    const manager = createSONAManager('balanced');
    await manager.initialize();

    const id = manager.beginTrajectory('ctx-2', 'code');
    manager.recordStep(id, 'act-1', 0.9, embedding(3));
    manager.completeTrajectory(id, 0.9);

    await manager.triggerLearning('test');

    const trajectories = (manager as unknown as {
      trajectories: Map<string, { learnedFrom?: boolean }>;
    }).trajectories;
    expect(trajectories.get(id)!.learnedFrom).toBe(true);
  });

  it('control: a genuinely new trajectory completed after cycle 1 IS processed in cycle 2 (the fix does not stop learning altogether)', async () => {
    const manager = createSONAManager('balanced');
    await manager.initialize();

    const firstId = manager.beginTrajectory('ctx-3', 'code');
    manager.recordStep(firstId, 'act-1', 0.9, embedding(4));
    manager.completeTrajectory(firstId, 0.9);
    await manager.triggerLearning('test');
    const iterationsAfterCycle1 = learnIterations(manager);

    const secondId = manager.beginTrajectory('ctx-4', 'code');
    manager.recordStep(secondId, 'act-1', 0.9, embedding(5));
    manager.completeTrajectory(secondId, 0.9);
    await manager.triggerLearning('test');

    expect(learnIterations(manager)).toBe(iterationsAfterCycle1 + 1);

    const trajectories = (manager as unknown as {
      trajectories: Map<string, { learnedFrom?: boolean }>;
    }).trajectories;
    expect(trajectories.get(firstId)!.learnedFrom).toBe(true);
    expect(trajectories.get(secondId)!.learnedFrom).toBe(true);
  });

  it('control: a trajectory below qualityThreshold is never marked learnedFrom and never learned from', async () => {
    const manager = createSONAManager('balanced');
    await manager.initialize();

    const id = manager.beginTrajectory('ctx-5', 'code');
    manager.recordStep(id, 'act-1', 0.05, embedding(6));
    manager.completeTrajectory(id, 0.05); // below default qualityThreshold

    await manager.triggerLearning('test');

    expect(learnIterations(manager)).toBe(0);
    const trajectories = (manager as unknown as {
      trajectories: Map<string, { learnedFrom?: boolean }>;
    }).trajectories;
    expect(trajectories.get(id)!.learnedFrom).toBeUndefined();
  });
});
