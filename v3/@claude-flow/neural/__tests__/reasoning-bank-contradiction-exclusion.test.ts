/**
 * Dream Cycle 2026-11-23 — ReasoningBank contradiction-exclusion enforcement.
 *
 * detectContradictions() marks the lower-quality side of a contradicting
 * pair `consolidated = true`, with the comment "to exclude from retrieval"
 * (src/reasoning-bank.ts). Before this fix, neither retrieve() nor
 * retrieveByContent() ever checked that flag, so a memory the system itself
 * had judged stale/contradicted kept being served back into agent context
 * forever — consolidate()'s contradiction half was a no-op beyond a stats
 * counter. These tests are discriminating: they fail on the pre-fix code
 * and pass after it.
 */

import { describe, it, expect } from 'vitest';
import { createReasoningBank } from '../src/reasoning-bank.js';
import type { Trajectory } from '../src/types.js';

function createTestTrajectory(
  quality: number,
  domain: 'code' | 'creative' | 'reasoning' | 'chat' | 'math' | 'general' = 'code',
  steps: number = 5
): Trajectory {
  return {
    trajectoryId: `test-traj-${Date.now()}-${Math.random()}`,
    context: `Test task for ${domain}`,
    domain,
    steps: Array.from({ length: steps }, (_, i) => ({
      stepId: `step-${i}`,
      timestamp: Date.now() + i * 100,
      action: `action-${i}`,
      stateBefore: new Float32Array(768).fill(i * 0.1),
      stateAfter: new Float32Array(768).fill((i + 1) * 0.1),
      reward: 0.5 + (i / steps) * (quality - 0.5) * 2,
    })),
    qualityScore: quality,
    isComplete: true,
    startTime: Date.now() - 1000,
    endTime: Date.now(),
  };
}

describe('ReasoningBank - contradiction exclusion at retrieval (Dream Cycle 2026-11-23)', () => {
  it('retrieve() must not return a memory detectContradictions() marked consolidated', async () => {
    const bank = createReasoningBank({
      dedupThreshold: 0.95,
      enableContradictionDetection: true,
    });

    // createTestTrajectory's embedding depends only on domain/steps, not
    // quality, so these two share cosine similarity 1.0 (> the 0.8
    // contradiction threshold) with a 0.75 quality gap (> the 0.4
    // threshold) — exactly the "similar context, opposite outcome" shape
    // detectContradictions() exists to catch. Different memoryType
    // (success vs pitfall) keeps dedup from removing either one outright,
    // isolating the contradiction-exclusion path under test.
    const highQualityTraj = createTestTrajectory(0.95, 'code', 5);
    const lowQualityTraj = createTestTrajectory(0.2, 'code', 5);

    const highMemory = await bank.distill(highQualityTraj);
    const lowMemory = await bank.distill(lowQualityTraj);
    expect(highMemory).toBeDefined();
    expect(lowMemory).toBeDefined();
    expect(bank.getStats().memoryCount).toBe(2);

    const result = await bank.consolidate();
    expect(result.contradictionsDetected).toBe(1);
    // detectContradictions() flags the lower-quality entry.
    expect(bank.getStats().consolidatedMemories).toBe(1);

    const results = await bank.retrieve(lowMemory!.embedding, 5);
    const returnedIds = results.map(r => r.memory.memoryId);

    expect(returnedIds).not.toContain(lowMemory!.memoryId);
    expect(returnedIds).toContain(highMemory!.memoryId);
  });

  it('retrieve() falls back to brute force when HNSW returns only consolidated memories', async () => {
    const bank = createReasoningBank({ dedupThreshold: 0.95, enableContradictionDetection: true });
    const highMemory = await bank.distill(createTestTrajectory(0.95, 'code', 5));
    const lowMemory = await bank.distill(createTestTrajectory(0.2, 'code', 5));
    await bank.consolidate();

    // Simulate an HNSW index whose over-fetched hits are all consolidated.
    const internals = bank as unknown as Record<string, unknown>;
    internals.agentdb = {};
    internals.agentdbAvailable = true;
    internals.searchWithAgentDB = async () => [{ id: lowMemory!.memoryId, similarity: 1 }];

    const returnedIds = (await bank.retrieve(lowMemory!.embedding, 5)).map(r => r.memory.memoryId);
    expect(returnedIds).not.toContain(lowMemory!.memoryId);
    expect(returnedIds).toContain(highMemory!.memoryId);
  });

  it('retrieveByContent() must not return a memory detectContradictions() marked consolidated', async () => {
    const bank = createReasoningBank({
      dedupThreshold: 0.95,
      enableContradictionDetection: true,
    });

    const highQualityTraj = createTestTrajectory(0.95, 'code', 5);
    const lowQualityTraj = createTestTrajectory(0.2, 'code', 5);

    const highMemory = await bank.distill(highQualityTraj);
    const lowMemory = await bank.distill(lowQualityTraj);
    expect(highMemory).toBeDefined();
    expect(lowMemory).toBeDefined();

    const result = await bank.consolidate();
    expect(result.contradictionsDetected).toBe(1);

    const results = await bank.retrieveByContent(lowMemory!.strategy, 5);
    const returnedIds = results.map(r => r.memory.memoryId);

    expect(returnedIds).not.toContain(lowMemory!.memoryId);
  });

  it('control: a non-consolidated memory retrieves exactly as before (no behavior change for the common case)', async () => {
    const bank = createReasoningBank({ retrievalK: 3 });

    for (let i = 0; i < 5; i++) {
      await bank.distill(createTestTrajectory(0.7 + i * 0.03, 'reasoning', 4));
    }
    expect(bank.getStats().consolidatedMemories ?? 0).toBe(0);

    const query = new Float32Array(768).fill(0.3);
    const results = await bank.retrieve(query, 3);

    expect(results.length).toBe(3);
  });
});
