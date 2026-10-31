/**
 * #4597 hive-mind/performance scan: the integration AttentionCoordinator's
 * cache key hashed only the first 8 elements of each vector. Two values with
 * the same prefix but different tails collided, so the second compute()
 * returned an output computed from the first value.
 *
 * The key now hashes every element (length included) and the optional mask.
 */
import { describe, expect, it } from 'vitest';
import { AttentionCoordinator } from '../attention-coordinator.js';

function coordinator(): AttentionCoordinator {
  return new AttentionCoordinator({ mechanism: 'flash' });
}

describe('AttentionCoordinator cache key completeness', () => {
  it('does not reuse a value whose first 8 elements match but tail differs', async () => {
    const attention = coordinator();
    await attention.initialize();

    const query = Array.from({ length: 10 }, (_, i) => 0.1 + i * 0.01);
    const key = Array.from({ length: 10 }, (_, i) => 0.2 + i * 0.01);
    const prefix = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];

    const first = await attention.compute({
      query,
      key,
      value: [...prefix, 1, 2],
      useCache: true,
    });
    const second = await attention.compute({
      query,
      key,
      value: [...prefix, 3, 4],
      useCache: true,
    });

    expect(first.output).toEqual([...prefix, 1, 2]);
    expect(second.output).toEqual([...prefix, 3, 4]);
    expect(second.cacheHit).toBe(false);
  });

  it('still serves an identical request from the cache', async () => {
    const attention = coordinator();
    await attention.initialize();

    const params = {
      query: [0.1, 0.2, 0.3],
      key: [0.4, 0.5, 0.6],
      value: [0.7, 0.8, 0.9],
      useCache: true,
    };

    const first = await attention.compute(params);
    expect(first.cacheHit).toBe(false);

    const second = await attention.compute(params);

    expect(second.cacheHit).toBe(true);
    expect(second.output).toEqual(first.output);
  });

  it('does not reuse a delegated result when only the mask differs', async () => {
    const attention = coordinator();
    await attention.initialize();
    attention.setAgenticFlowReference({
      compute: async ({ mask }) => ({
        output: [mask?.[0] ? 1 : 0],
        latencyMs: 1,
        memoryBytes: 0,
        mechanism: 'flash',
      }),
      setMechanism: async () => {},
      getMetrics: async () => ({
        avgLatencyMs: 0,
        throughputTps: 0,
        memoryEfficiency: 0,
        speedupFactor: 0,
      }),
    } as never);

    const vector = Array.from({ length: 513 }, () => 0.1);
    const first = await attention.compute({
      query: vector,
      key: vector,
      value: vector,
      mask: vector.map(() => true),
      useCache: true,
    });
    const second = await attention.compute({
      query: vector,
      key: vector,
      value: vector,
      mask: vector.map(() => false),
      useCache: true,
    });

    expect(first.output).toEqual([1]);
    expect(second.output).toEqual([0]);
  });
});
