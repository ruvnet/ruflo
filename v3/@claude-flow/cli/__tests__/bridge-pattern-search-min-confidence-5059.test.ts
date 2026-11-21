/**
 * #5059 — bridgeSearchPatterns still turned `minConfidence: 0` into 0.3.
 *
 * #4790 made the MCP handlers pass an explicit 0 through, but the bridge then
 * read it with `options.minConfidence || 0.3` before calling ReasoningBank, so
 * `agentdb_pattern-search {minConfidence:0}` searched with a 0.3 threshold.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('#5059 bridgeSearchPatterns honours minConfidence 0', () => {
  beforeEach(() => __setMemoryBridgeRegistryForTests(null));
  afterAll(() => __setMemoryBridgeRegistryForTests(null));

  it('passes threshold 0 to searchPatterns', async () => {
    const searchPatterns = vi.fn(async () => []);
    __setMemoryBridgeRegistryForTests(registryWith({ searchPatterns }));

    await bridgeSearchPatterns({ query: 'anything', topK: 5, minConfidence: 0 });

    expect(searchPatterns).toHaveBeenCalledWith(expect.objectContaining({ threshold: 0 }));
  });

  it('passes minScore 0 to the legacy search', async () => {
    const search = vi.fn(async () => []);
    __setMemoryBridgeRegistryForTests(registryWith({ search }));

    await bridgeSearchPatterns({ query: 'anything', topK: 5, minConfidence: 0 });

    expect(search).toHaveBeenCalledWith('anything', expect.objectContaining({ minScore: 0 }));
  });

  it('still defaults to 0.3 when minConfidence is omitted', async () => {
    const searchPatterns = vi.fn(async () => []);
    __setMemoryBridgeRegistryForTests(registryWith({ searchPatterns }));

    await bridgeSearchPatterns({ query: 'anything', topK: 5 });

    expect(searchPatterns).toHaveBeenCalledWith(expect.objectContaining({ threshold: 0.3 }));
  });
});
