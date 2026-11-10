/**
 * AttentionCoordinator synthetic-embedding memoization
 *
 * getOrCreateEmbedding() rebuilt a fresh Float32Array (O(content.length) hash
 * build) from scratch on every call for AgentOutputs with no pre-supplied
 * `embedding` field. Every coordination mechanism calls it O(n^2) times
 * (O(numHeads*n^2) for multi-head), so the hash build itself was redundantly
 * repeated instead of computed once per AgentOutput.
 */

import { describe, it, expect } from 'vitest';
import { AttentionCoordinator, type AgentOutput } from '../src/attention-coordinator.js';

function makeOutputs(n: number, contentFn?: (i: number) => string): AgentOutput[] {
  return Array.from({ length: n }, (_, i) => ({
    agentId: `agent-${i}`,
    content: contentFn ? contentFn(i) : `agent ${i} output content for coordination test`,
    confidence: 0.5 + (i % 5) / 10,
  }));
}

describe('AttentionCoordinator embedding memoization', () => {
  it('[discriminating] reuses the same Float32Array instance across repeated getOrCreateEmbedding calls for the same AgentOutput', () => {
    const coordinator = new AttentionCoordinator();
    const output = makeOutputs(1)[0];

    const first = (coordinator as any).getOrCreateEmbedding(output);
    const second = (coordinator as any).getOrCreateEmbedding(output);

    expect(second).toBe(first);
  });

  it('[discriminating] wires the memoization cache into the real coordinateAgents() path, not just the unit', async () => {
    const coordinator = new AttentionCoordinator();
    const outputs = makeOutputs(6);

    await coordinator.coordinateAgents(outputs, 'multi-head');

    for (const output of outputs) {
      const cached = (coordinator as any).syntheticEmbeddingCache.get(output);
      expect(cached).toBeDefined();
      // A fresh call must return the cached instance, not rebuild a new one.
      const recomputed = (coordinator as any).getOrCreateEmbedding(output);
      expect(recomputed).toBe(cached);
    }
  });

  it('[control] different AgentOutputs never share a cached embedding (identity-keyed, not content/agentId-keyed)', () => {
    const coordinator = new AttentionCoordinator();
    const [a, b] = makeOutputs(2, (i) => (i === 0 ? 'alpha content' : 'beta content, totally different'));

    const embA = (coordinator as any).getOrCreateEmbedding(a);
    const embB = (coordinator as any).getOrCreateEmbedding(b);

    expect(embA).not.toBe(embB);
    expect(Array.from(embA)).not.toEqual(Array.from(embB));
  });

  it('[control] a pre-supplied output.embedding bypasses the synthetic cache entirely', () => {
    const coordinator = new AttentionCoordinator();
    const explicit = new Float32Array(64).fill(0.1);
    const output: AgentOutput = { agentId: 'agent-x', content: 'irrelevant', embedding: explicit };

    const result = (coordinator as any).getOrCreateEmbedding(output);

    expect(result).toBe(explicit);
    expect((coordinator as any).syntheticEmbeddingCache.has(output)).toBe(false);
  });

  it('[control] coordinateAgents output (attentionWeights, consensus, confidence) is unaffected by caching', async () => {
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

  it('[control] hyperbolic and graph-rope mechanisms also produce stable output with the memoized cache', async () => {
    const coordinator = new AttentionCoordinator();
    const outputs = makeOutputs(5);

    const hyperbolic = await coordinator.coordinateAgents(outputs, 'hyperbolic');
    const graphRope = await coordinator.coordinateAgents(outputs, 'graph-rope');

    expect(hyperbolic.success).toBe(true);
    expect(graphRope.success).toBe(true);
    expect(hyperbolic.attentionWeights).toHaveLength(5);
    expect(graphRope.attentionWeights).toHaveLength(5);
  });
});
