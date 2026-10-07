/**
 * EWC penalty dead-path (Dream Cycle 2026-10-07)
 *
 * Independent finding, corroborating and extending the still-unmerged
 * dream/2026-10-02-intelligence branch (PR #3622, "wire
 * SONAManager.consolidateEWC() into triggerLearning()"): even once that
 * commit lands, `ewcState.fisher`/`means` get populated under
 * `${domain}:${module}` keys sized to the LoRA rank (LoRA-weight space).
 * None of the three modes that read `ewcState.fisher`/`means`
 * (BalancedMode.computeEWCPenalty, ResearchMode.computeEWCLoss,
 * BatchMode.applyAccumulatedGradients) ever look a value up under that key
 * scheme — each uses its own private, differently-keyed, differently-
 * dimensioned accumulator (gradientAccumulator keyed 'positive'/'negative';
 * adamM keyed 'step_<i>'; accumulatedGradients keyed by plain
 * trajectory.domain — all three sized to the state-embedding dimension,
 * not the LoRA rank). So EWC regularization silently contributes exactly
 * zero penalty in every mode, on `main` today AND after #3622 lands as
 * currently written.
 *
 * These tests make that always-zero condition observable (via the new
 * ewcPenaltyLookupHits/Misses counters on each mode) instead of letting it
 * stay an invisible no-op, and a control test proves the counters
 * themselves are wired correctly (a hand-aligned key DOES register a hit).
 */

import { describe, it, expect } from 'vitest';
// Imported from the built dist/ output, not src/, by necessity: importing
// any modes/*.ts file directly crashes vitest/vite-node's SSR transform
// with "Class extends value undefined is not a constructor or null"
// (real-time.ts's `extends BaseModeImplementation` resolves through the
// modes/index.ts barrel before base.ts's export is initialized — a
// pre-existing circular-import quirk, independently reproduced here, not
// introduced by this change). dist/ is current as of this session's own
// build pass (verified against src/ line-for-line for the changed files).
import { BalancedMode } from '../dist/modes/balanced.js';
import { ResearchMode } from '../dist/modes/research.js';
import { BatchMode } from '../dist/modes/batch.js';
import type {
  SONAModeConfig,
  ModeOptimizations,
  EWCState,
  Trajectory,
  TrajectoryStep,
} from '../src/types.js';

function makeConfig(overrides: Partial<SONAModeConfig> = {}): SONAModeConfig {
  return {
    mode: 'balanced',
    loraRank: 4,
    learningRate: 0.002,
    batchSize: 2,
    trajectoryCapacity: 100,
    patternClusters: 10,
    qualityThreshold: 0.5,
    maxLatencyMs: 50,
    memoryBudgetMb: 50,
    ewcLambda: 2000,
    ...overrides,
  };
}

function makeOptimizations(): ModeOptimizations {
  return {
    enableSIMD: false,
    useMicroLoRA: false,
    gradientCheckpointing: false,
    useHalfPrecision: false,
    patternCaching: true,
    asyncUpdates: false,
  };
}

function makeStep(seed: number, dim = 8): TrajectoryStep {
  const stateBefore = new Float32Array(dim);
  const stateAfter = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    stateBefore[i] = Math.sin(seed + i);
    stateAfter[i] = Math.cos(seed + i);
  }
  return {
    stepId: `step-${seed}`,
    timestamp: Date.now(),
    action: 'test-action',
    stateBefore,
    stateAfter,
    reward: 0.8,
  };
}

function makeTrajectory(id: string, domain: Trajectory['domain'], quality: number): Trajectory {
  return {
    trajectoryId: id,
    context: 'test',
    domain,
    steps: [makeStep(1), makeStep(2)],
    qualityScore: quality,
    isComplete: true,
    startTime: Date.now(),
    endTime: Date.now() + 10,
  };
}

/**
 * Builds an EWCState the way the pending, not-yet-merged
 * dream/2026-10-02-intelligence consolidateEWC() wiring fix (PR #3622)
 * would populate it: one entry per `${domain}:${module}` key, dimensioned
 * to the LoRA rank.
 */
function makeLoraKeyedEwcState(domain: string, loraRank: number): EWCState {
  const fisher = new Map<string, Float32Array>();
  const means = new Map<string, Float32Array>();
  for (const module of ['q_proj', 'v_proj', 'k_proj', 'o_proj']) {
    const key = `${domain}:${module}`;
    fisher.set(key, new Float32Array(loraRank).fill(0.5));
    means.set(key, new Float32Array(loraRank).fill(0.1));
  }
  return { means, fisher, taskCount: 1, lastConsolidation: Date.now() };
}

describe('EWC penalty dead-path (Dream Cycle 2026-10-07)', () => {
  it('balanced.ts: computeEWCPenalty never finds a matching gradientAccumulator entry', async () => {
    const config = makeConfig({ mode: 'balanced', loraRank: 4 });
    const mode = new BalancedMode(config, makeOptimizations());
    await mode.initialize();

    const ewcState = makeLoraKeyedEwcState('code', config.loraRank);
    const trajectories = [makeTrajectory('t1', 'code', 0.9), makeTrajectory('t2', 'code', 0.9)];

    await mode.learn(trajectories, config, ewcState);

    const stats = mode.getStats();
    expect(stats.ewcPenaltyLookupHits).toBe(0);
    expect(stats.ewcPenaltyLookupMisses).toBeGreaterThan(0);
  });

  it('research.ts: computeEWCLoss never finds a matching adamM entry', async () => {
    const config = makeConfig({ mode: 'research', loraRank: 4, batchSize: 2 });
    const mode = new ResearchMode(config, makeOptimizations());
    await mode.initialize();

    const ewcState = makeLoraKeyedEwcState('code', config.loraRank);
    const trajectories = [makeTrajectory('t1', 'code', 0.9), makeTrajectory('t2', 'code', 0.9)];

    await mode.learn(trajectories, config, ewcState);

    const stats = mode.getStats();
    expect(stats.ewcPenaltyLookupHits).toBe(0);
    expect(stats.ewcPenaltyLookupMisses).toBeGreaterThan(0);
  });

  it('batch.ts: applyAccumulatedGradients never finds a matching accumulatedGradients entry', async () => {
    const config = makeConfig({ mode: 'batch', loraRank: 8, batchSize: 2 });
    const mode = new BatchMode(config, makeOptimizations());
    await mode.initialize();

    const ewcState = makeLoraKeyedEwcState('code', config.loraRank);

    // 4 calls x 2 trajectories = batchSize(2) fills each call, so
    // processBatchLearning runs 4 times and gradientSteps reaches 4 on
    // the 4th call, triggering applyAccumulatedGradients().
    for (let i = 0; i < 4; i++) {
      await mode.learn(
        [makeTrajectory(`t-${i}-a`, 'code', 0.9), makeTrajectory(`t-${i}-b`, 'code', 0.9)],
        config,
        ewcState
      );
    }

    const stats = mode.getStats();
    expect(stats.ewcPenaltyLookupHits).toBe(0);
    expect(stats.ewcPenaltyLookupMisses).toBeGreaterThan(0);
  });

  it('control: a hand-aligned key DOES register a hit (proves the counter is wired correctly, not hardcoded)', async () => {
    const config = makeConfig({ mode: 'balanced', loraRank: 4 });
    const mode = new BalancedMode(config, makeOptimizations());
    await mode.initialize();

    // balanced.ts's own gradientAccumulator is keyed 'positive'/'negative',
    // dimensioned to the state-embedding space (8, matching makeStep's
    // dim). Align the EWC state to that key space directly, bypassing
    // consolidateEWC() entirely, to prove a hit is possible in principle.
    const fisher = new Map<string, Float32Array>([['positive', new Float32Array(8).fill(0.1)]]);
    const means = new Map<string, Float32Array>([['positive', new Float32Array(8).fill(0.05)]]);
    const ewcState: EWCState = { fisher, means, taskCount: 1, lastConsolidation: Date.now() };

    await mode.learn([makeTrajectory('t1', 'code', 0.9)], config, ewcState);

    const stats = mode.getStats();
    expect(stats.ewcPenaltyLookupHits).toBeGreaterThan(0);
  });
});
