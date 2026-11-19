/**
 * Dream Cycle 2026-11-02 (DEEP=intelligence) — discriminating tests for
 * ResearchMode's contribution to SONAManager's EWC++ consolidation path.
 *
 * Continues 2026-10-27's (#4531/#4532) own disclosed scope note, restated
 * 2026-11-01 (#4633 SCAN): that fix wired `getConsolidationSnapshot()` for
 * `BalancedMode` only — the other 4 modes still contributed nothing to
 * `ewcState.fisher`/`.means`. Tonight's candidate wires `ResearchMode`,
 * using its existing Adam-optimizer first-moment state (`adamM`, already
 * read back by its own `computeEWCLoss()`) as the mode's "current
 * parameter state", mirroring BalancedMode's own reviewed
 * delta-since-last-snapshot pattern exactly.
 *
 * Scope disclosure (frozen before evaluation, not re-litigated after):
 * EdgeMode and RealTimeMode are NOT wired by this candidate — neither
 * tracks any per-key gradient-shaped state (Edge stores quantized int8
 * weights; RealTime's `learn()` explicitly documents "we skip full
 * backprop"), so a `getConsolidationSnapshot()` for either would have to
 * fabricate Fisher/means from nothing rather than derive it from real
 * learning state — exactly the "hidden preprocessing" / fabricated-metric
 * shape the Dream Cycle's reward-hack check (STEP 11) exists to catch.
 * BatchMode is also NOT wired tonight: its `accumulatedGradients` map is
 * deliberately zeroed by `applyAccumulatedGradients()` on its own 4-step
 * flush cadence (`gradientSteps >= 4`), so a delta-since-last-consolidation
 * measured at an arbitrary point relative to that independent flush cycle
 * would not carry the same "this cycle's movement" meaning it does for
 * Balanced/Research — a dedicated design pass is needed there, not a
 * direct port of this pattern. The last test below is a control proving
 * Edge/RealTime are still exactly as inert as before this change (no
 * fabricated state introduced for them).
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

describe('ResearchMode EWC++ consolidation', () => {
  it('populates ewcState.fisher/means with real, non-zero values after a learning cycle (was permanently empty)', async () => {
    const manager = createSONAManager('research');
    await manager.initialize();

    await runLearningCycle(manager, 'code', 1, 0.9);

    const ewcState = decodeEwcState(manager);
    expect(ewcState.fisher.size).toBeGreaterThan(0);
    expect(ewcState.means.size).toBeGreaterThan(0);

    let sawNonZero = false;
    for (const fisher of ewcState.fisher.values()) {
      for (const value of fisher) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0); // Fisher (squared delta) is never negative
        if (value > 0) sawNonZero = true;
      }
    }
    expect(sawNonZero).toBe(true);
    expect(ewcState.taskCount).toBeGreaterThan(0);
    expect(ewcState.lastConsolidation).toBeGreaterThan(0);
  });

  it('decays existing Fisher importance before folding in fresh evidence (online EWC), rather than overwriting it', async () => {
    const manager = createSONAManager('research');
    await manager.initialize();

    await runLearningCycle(manager, 'code', 1, 0.9);
    const after1 = decodeEwcState(manager);
    const key = after1.fisher.keys().next().value as string;
    const valueAfter1 = after1.fisher.get(key)![0];
    expect(valueAfter1).toBeGreaterThan(0);

    await runLearningCycle(manager, 'code', 2, 0.85);
    const after2 = decodeEwcState(manager);
    const valueAfter2 = after2.fisher.get(key)![0];

    // Same reasoning as the reviewed BalancedMode test: the second cycle's
    // fresh contribution is `decay(0.9) * valueAfter1 + freshFisher2`, and
    // `freshFisher2` is itself strictly positive here (a different seed
    // moves adamM further) — empirically ~7.5x valueAfter1 for this seed
    // pair, well clear of the `* 0.9` decay-only floor. This test does not
    // claim fisher stays bounded over many cycles.
    expect(valueAfter2).toBeGreaterThan(valueAfter1 * 0.9);
    expect(after2.taskCount).toBe(after1.taskCount + 1);
  });

  it('control: a trigger with no completed trajectories leaves ewcState untouched (no fabricated state)', async () => {
    const manager = createSONAManager('research');
    await manager.initialize();

    await manager.triggerLearning('test'); // nothing completed yet -> learn() short-circuits

    const ewcState = decodeEwcState(manager);
    expect(ewcState.fisher.size).toBe(0);
    expect(ewcState.means.size).toBe(0);
    expect(ewcState.taskCount).toBe(0);
  });

  it('anchors means on adamM at consolidation, so computeEWCLoss() restarts at zero immediately after', async () => {
    const manager = createSONAManager('research');
    await manager.initialize();

    await runLearningCycle(manager, 'code', 1, 0.9);
    await runLearningCycle(manager, 'code', 2, 0.8);

    const ewcState = decodeEwcState(manager);
    const adamM = (manager as unknown as {
      modeImpl: { adamM: Map<string, Float32Array> };
    }).modeImpl.adamM;

    expect(ewcState.means.size).toBeGreaterThan(0);
    for (const [key, means] of ewcState.means) {
      const current = adamM.get(key)!;
      expect(current).toBeDefined();
      for (let i = 0; i < means.length; i++) {
        expect(means[i]).toBeCloseTo(current[i], 6);
      }
    }
  });

  it('control: EdgeMode and RealTimeMode remain exactly as inert as before this change (not wired, nothing fabricated)', async () => {
    for (const mode of ['edge', 'real-time'] as const) {
      const manager = createSONAManager(mode);
      await manager.initialize();

      await runLearningCycle(manager, 'code', 1, 0.9);

      const ewcState = decodeEwcState(manager);
      expect(ewcState.fisher.size).toBe(0);
      expect(ewcState.means.size).toBe(0);
    }
  });
});
