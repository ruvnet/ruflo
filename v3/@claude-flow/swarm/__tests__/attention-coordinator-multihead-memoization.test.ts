/**
 * AttentionCoordinator.multiHeadAttentionCoordination() redundant-head fix
 *
 * computeAttentionScore()'s `head` parameter is never read in its body, so
 * every one of the numHeads=8 outer-loop iterations computed a byte-identical
 * O(n^2) cosine-similarity matrix, then averaged 8 identical copies (a no-op).
 * Fixed by memoizing each (i, j) pair's score once per
 * multiHeadAttentionCoordination() call (flat typed-array cache, not a
 * string-keyed Map — a string-keyed Map was measured slower than the
 * original redundant loop at n>=400, since getOrCreateEmbedding() is already
 * memoized and the per-pair cosine work is cheap relative to string-key
 * hashing). Deferred 2026-10-30 (scored 4.60/5) to keep that night's patch to
 * one conceptual change; picked up directly tonight.
 */

import { describe, it, expect } from 'vitest';
import { AttentionCoordinator, type AgentOutput } from '../src/attention-coordinator.js';

function makeOutputs(n: number, contentFn?: (i: number) => string): AgentOutput[] {
  return Array.from({ length: n }, (_, i) => ({
    agentId: `agent-${i}`,
    content: contentFn ? contentFn(i) : `agent ${i} output content for coordination test, varied length ${'x'.repeat(i % 7)}`,
    confidence: 0.5 + (i % 5) / 10,
  }));
}

describe('AttentionCoordinator multi-head redundant-score memoization', () => {
  it('[discriminating] computeAttentionScore is called exactly n^2 times, not numHeads*n^2', async () => {
    for (const n of [5, 12, 23]) {
      const coordinator = new AttentionCoordinator();
      let calls = 0;
      const original = (coordinator as any).computeAttentionScore.bind(coordinator);
      (coordinator as any).computeAttentionScore = (...args: unknown[]) => {
        calls++;
        return original(...args);
      };

      await coordinator.coordinateAgents(makeOutputs(n), 'multi-head');

      expect(calls).toBe(n * n);
    }
  });

  it('[discriminating] each unique (i, j) pair is scored exactly once per call', async () => {
    const n = 9;
    const coordinator = new AttentionCoordinator();
    const seenPairs: Array<[AgentOutput, AgentOutput]> = [];
    const original = (coordinator as any).computeAttentionScore.bind(coordinator);
    (coordinator as any).computeAttentionScore = (a: AgentOutput, b: AgentOutput) => {
      seenPairs.push([a, b]);
      return original(a, b);
    };

    const outputs = makeOutputs(n);
    await coordinator.coordinateAgents(outputs, 'multi-head');

    const pairKeys = new Set(seenPairs.map(([a, b]) => `${a.agentId},${b.agentId}`));
    expect(pairKeys.size).toBe(seenPairs.length); // no (i, j) pair repeats
    expect(seenPairs.length).toBe(n * n); // every ordered pair, including i === j, covered once
  });

  it('[control] output is mathematically unaffected: equals a single (non-redundant) pass, not an average of 8 identical copies', async () => {
    const n = 6;
    const outputs = makeOutputs(n);
    const coordinator = new AttentionCoordinator();

    const result = await coordinator.coordinateAgents(outputs, 'multi-head');

    // Ground truth: compute the single-head attention weights directly via
    // the same private helper, bypassing the multi-head loop entirely.
    const expectedWeights = outputs.map((_, i) => {
      let sum = 0;
      for (let j = 0; j < n; j++) {
        sum += (coordinator as any).computeAttentionScore(outputs[i], outputs[j]);
      }
      return sum / n;
    });

    for (let i = 0; i < n; i++) {
      expect(result.attentionWeights[i]).toBeCloseTo(expectedWeights[i], 10);
    }
  });

  it('[control] output is stable and deterministic across repeated calls with equivalent inputs', async () => {
    const outputs = makeOutputs(8);

    const run1 = await new AttentionCoordinator().coordinateAgents(
      outputs.map((o) => ({ ...o })),
      'multi-head'
    );
    const run2 = await new AttentionCoordinator().coordinateAgents(
      outputs.map((o) => ({ ...o })),
      'multi-head'
    );

    expect(run1.attentionWeights).toEqual(run2.attentionWeights);
    expect(run1.confidence).toBeCloseTo(run2.confidence, 10);
    expect(run1.consensusOutput).toEqual(run2.consensusOutput);
  });

  it('[control] a fresh per-call cache does not leak state across separate coordinateAgents() calls', async () => {
    const coordinator = new AttentionCoordinator();
    const first = makeOutputs(5, (i) => `first batch content ${i}`);
    const second = makeOutputs(5, (i) => `completely different second batch content ${i}`);

    const r1 = await coordinator.coordinateAgents(first, 'multi-head');
    const r2 = await coordinator.coordinateAgents(second, 'multi-head');

    expect(r1.attentionWeights).not.toEqual(r2.attentionWeights);
  });

  it('[control] other mechanisms (flash, linear, hyperbolic, graph-rope, moe) are untouched by this change', async () => {
    const coordinator = new AttentionCoordinator();
    const outputs = makeOutputs(5);

    for (const mechanism of ['flash', 'linear', 'hyperbolic', 'graph-rope', 'moe'] as const) {
      const result = await coordinator.coordinateAgents(outputs, mechanism);
      expect(result.success).toBe(true);
      expect(result.attentionWeights).toHaveLength(5);
    }
  });

  it('[control] n=0 and n=1 edge cases do not throw', async () => {
    const coordinator = new AttentionCoordinator();

    await expect(coordinator.coordinateAgents([], 'multi-head')).resolves.toMatchObject({ success: true });
    await expect(coordinator.coordinateAgents(makeOutputs(1), 'multi-head')).resolves.toMatchObject({
      success: true,
    });
  });
});
