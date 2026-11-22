/**
 * #5059 — bridgeSearchPatterns read minConfidence with `|| 0.3`, so an explicit
 * 0 (kept by the handlers since #4728) was searched as 0.3. A spy registry
 * records the threshold each ReasoningBank shape receives.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  __setMemoryBridgeRegistryForTests,
  bridgeSearchPatterns,
} from '../src/memory/memory-bridge.js';

function registryWith(reasoningBank: unknown) {
  return {
    getAgentDB: () => ({ database: { prepare: () => ({ all: () => [] }) }, embedder: null }),
    get: (name: string) => (name === 'reasoningBank' ? reasoningBank : null),
  };
}

describe('#5059 bridgeSearchPatterns keeps an explicit minConfidence of 0', () => {
  beforeEach(() => __setMemoryBridgeRegistryForTests(null));
  afterAll(() => __setMemoryBridgeRegistryForTests(null));

  it('passes threshold 0 to searchPatterns', async () => {
    const calls: Array<{ threshold?: number }> = [];
    __setMemoryBridgeRegistryForTests(registryWith({
      searchPatterns: async (opts: { threshold?: number }) => { calls.push(opts); return []; },
    }));

    await bridgeSearchPatterns({ query: 'x', topK: 5, minConfidence: 0 });

    expect(calls).toHaveLength(1);
    expect(calls[0].threshold).toBe(0);
  });

  it('passes minScore 0 to the legacy search()', async () => {
    const calls: Array<{ minScore?: number }> = [];
    __setMemoryBridgeRegistryForTests(registryWith({
      search: async (_q: string, opts: { minScore?: number }) => { calls.push(opts); return []; },
    }));

    await bridgeSearchPatterns({ query: 'x', topK: 5, minConfidence: 0 });

    expect(calls).toHaveLength(1);
    expect(calls[0].minScore).toBe(0);
  });

  it('still defaults to 0.3 when minConfidence is omitted', async () => {
    const calls: Array<{ threshold?: number }> = [];
    __setMemoryBridgeRegistryForTests(registryWith({
      searchPatterns: async (opts: { threshold?: number }) => { calls.push(opts); return []; },
    }));

    await bridgeSearchPatterns({ query: 'x', topK: 5 });

    expect(calls[0].threshold).toBe(0.3);
  });
});
