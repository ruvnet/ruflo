/**
 * #4714 — bridgeSearchPatterns turned read failures into an empty result.
 *
 * `substringSearchReasoningPatterns` caught SQL errors and returned [], and a
 * controller that threw made the whole call return null. Once the
 * agentdb_pattern-search handler reports an empty ReasoningBank result as a
 * healthy no-match, an error disguised as [] would be reported as "nothing
 * found". These tests inject a fake registry so each failure is deterministic.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  __setMemoryBridgeRegistryForTests,
  bridgeSearchPatterns,
} from '../src/memory/memory-bridge.js';

function registryWith(reasoningBank: unknown, database: unknown) {
  return {
    getAgentDB: () => ({ database, embedder: null }),
    get: (name: string) => (name === 'reasoningBank' ? reasoningBank : null),
  };
}

const okDatabase = (rows: unknown[] = []) => ({
  prepare: () => ({ all: () => rows }),
});

const throwingDatabase = () => ({
  prepare: () => {
    throw new Error('SQLITE_CORRUPT: database disk image is malformed');
  },
});

describe('#4714 bridgeSearchPatterns propagates read errors', () => {
  beforeEach(() => __setMemoryBridgeRegistryForTests(null));
  afterAll(() => __setMemoryBridgeRegistryForTests(null));

  it('a healthy empty search returns an empty ReasoningBank result with no error', async () => {
    __setMemoryBridgeRegistryForTests(registryWith({ searchPatterns: async () => [] }, okDatabase()));

    const result = await bridgeSearchPatterns({ query: 'nothing-here', topK: 5, minConfidence: 0 });

    expect(result).toEqual({ results: [], controller: 'reasoningBank' });
  });

  it('a substring-scan SQL error is reported, not returned as []', async () => {
    __setMemoryBridgeRegistryForTests(registryWith({ searchPatterns: async () => [] }, throwingDatabase()));

    const result = await bridgeSearchPatterns({ query: 'anything', topK: 5 });

    expect(result).not.toBeNull();
    expect(result!.results).toEqual([]);
    expect(result!.controller).toBe('reasoningBank');
    expect(result!.error).toContain('SQLITE_CORRUPT');
  });

  it('a controller that throws is reported in-band instead of a bare null', async () => {
    __setMemoryBridgeRegistryForTests(registryWith({
      searchPatterns: async () => { throw new Error('embedQuery is not a function'); },
    }, okDatabase()));

    const result = await bridgeSearchPatterns({ query: 'anything', topK: 5 });

    expect(result).not.toBeNull();
    expect(result!.results).toEqual([]);
    expect(result!.controller).toBe('reasoningBank');
    expect(result!.error).toContain('embedQuery is not a function');
  });

  it('a controller that returns a non-array is reported as an error', async () => {
    __setMemoryBridgeRegistryForTests(registryWith({ searchPatterns: async () => ({ rows: [] }) }, okDatabase()));

    const result = await bridgeSearchPatterns({ query: 'anything', topK: 5 });

    expect(result).not.toBeNull();
    expect(result!.results).toEqual([]);
    expect(result!.error).toMatch(/non-array/);
  });

  it('vector hits are mapped exactly as before', async () => {
    __setMemoryBridgeRegistryForTests(registryWith({
      searchPatterns: async () => [{ id: 3, approach: 'use a circuit breaker', similarity: 0.88 }],
    }, throwingDatabase()));

    const result = await bridgeSearchPatterns({ query: 'circuit', topK: 5 });

    // The substring scan never runs when the vector search has hits, so the
    // broken database does not matter here.
    expect(result).toEqual({
      results: [{ id: '3', content: 'use a circuit breaker', score: 0.88 }],
      controller: 'reasoningBank',
    });
  });

  it('substring-scan hits after an empty vector search are mapped exactly as before', async () => {
    __setMemoryBridgeRegistryForTests(registryWith(
      { searchPatterns: async () => [] },
      okDatabase([{ id: 9, approach: 'retry with backoff', success_rate: 0.6 }]),
    ));

    const result = await bridgeSearchPatterns({ query: 'retry', topK: 5 });

    expect(result).toEqual({
      results: [{ id: '9', content: 'retry with backoff', score: 0.6 }],
      controller: 'reasoningBank',
    });
  });
});
