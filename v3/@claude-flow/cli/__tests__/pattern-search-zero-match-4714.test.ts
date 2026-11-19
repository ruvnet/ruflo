/**
 * #4714 — agentdb_pattern-search classified a healthy ReasoningBank zero-match
 * as a degraded controller failure.
 *
 * The handler only treated a ReasoningBank result as success when it had
 * results. An empty but healthy result fell through to the legacy
 * pattern-namespace fallback and came back `degraded: true,
 * reason: 'reasoningBank-empty:reasoningBank'`, so a caller that honours
 * `degraded` stopped even though every read completed.
 *
 * The bridge and the legacy store are mocked: these tests pin the handler's
 * classification, not the search backends.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridgeSearchPatterns = vi.fn();
const getBridgeFailureReason = vi.fn(() => null);
const searchEntries = vi.fn();
const listEntries = vi.fn();
const getEntry = vi.fn();

vi.mock('../src/memory/memory-bridge.js', () => ({
  bridgeSearchPatterns,
  getBridgeFailureReason,
}));

vi.mock('../src/memory/memory-initializer.js', () => ({
  searchEntries,
  listEntries,
  getEntry,
}));

const { agentdbPatternSearch } = await import('../src/mcp-tools/agentdb-tools.js');

type SearchResponse = Record<string, unknown> & { results: Array<Record<string, unknown>> };
const search = (params: Record<string, unknown>) => agentdbPatternSearch.handler(params) as Promise<SearchResponse>;

const emptyLegacy = () => {
  searchEntries.mockResolvedValue({ success: true, results: [], searchTime: 0 });
  listEntries.mockResolvedValue({ success: true, entries: [], total: 0 });
};

describe('#4714 agentdb_pattern-search zero-match classification', () => {
  beforeEach(() => {
    bridgeSearchPatterns.mockReset();
    getBridgeFailureReason.mockReset();
    getBridgeFailureReason.mockReturnValue(null);
    searchEntries.mockReset();
    listEntries.mockReset();
    getEntry.mockReset();
  });

  it('healthy ReasoningBank zero-match with an empty legacy fallback is a successful no-match', async () => {
    bridgeSearchPatterns.mockResolvedValue({ results: [], controller: 'reasoningBank' });
    emptyLegacy();

    const found = await search({ query: 'p3-composition-current', topK: 30, minConfidence: 0 });

    expect(found.results).toEqual([]);
    expect(found.degraded).toBe(false);
    expect(found.noMatch).toBe(true);
    expect(found.controller).toBe('reasoningBank');
    expect(found.reason).toBeUndefined();
    // Both sources that were read are named, so "no match" says where it looked.
    expect(found.searched).toEqual(['reasoningBank', 'pattern-namespace']);
    // The legacy pattern namespace was still searched (#1889 / #2226 coverage).
    expect(searchEntries).toHaveBeenCalledWith(expect.objectContaining({ namespace: 'pattern' }));
    expect(listEntries).toHaveBeenCalledWith(expect.objectContaining({ namespace: 'pattern' }));
  });

  it('a ReasoningBank read error is surfaced, never reported as a no-match', async () => {
    bridgeSearchPatterns.mockResolvedValue({
      results: [],
      controller: 'reasoningBank',
      error: 'reasoning_patterns substring scan failed: SQLITE_CORRUPT',
    });
    emptyLegacy();

    const found = await search({ query: 'anything' });

    expect(found.results).toEqual([]);
    expect(found.degraded).toBe(true);
    expect(found.noMatch).toBeUndefined();
    expect(String(found.reason)).toContain('reasoningBank-error');
    expect(String(found.reason)).toContain('SQLITE_CORRUPT');
    expect(found.reasoningBankError).toBe('reasoning_patterns substring scan failed: SQLITE_CORRUPT');
  });

  it('a controller that threw is surfaced even when the legacy fallback finds hits', async () => {
    bridgeSearchPatterns.mockResolvedValue({ results: [], controller: 'reasoningBank', error: 'embedQuery is not a function' });
    searchEntries.mockResolvedValue({
      success: true,
      results: [{ key: 'pattern-1', content: JSON.stringify({ pattern: 'retry with backoff', type: 'general', confidence: 0.9 }), score: 0.7 }],
      searchTime: 0,
    });

    const found = await search({ query: 'retry' });

    expect(found.results).toHaveLength(1);
    expect(found.degraded).toBe(true);
    expect(String(found.reason)).toContain('embedQuery is not a function');
  });

  it('a legacy list failure keeps the response degraded and names the failure', async () => {
    bridgeSearchPatterns.mockResolvedValue({ results: [], controller: 'reasoningBank' });
    searchEntries.mockResolvedValue({ success: true, results: [], searchTime: 0 });
    listEntries.mockResolvedValue({ success: false, entries: [], total: 0, error: 'database is locked' });

    const found = await search({ query: 'anything' });

    expect(found.results).toEqual([]);
    expect(found.degraded).toBe(true);
    expect(found.noMatch).toBeUndefined();
    expect(found.listError).toBe('database is locked');
  });

  it('a legacy semantic failure keeps the response degraded', async () => {
    bridgeSearchPatterns.mockResolvedValue({ results: [], controller: 'reasoningBank' });
    searchEntries.mockResolvedValue({ success: false, results: [], error: 'HNSW index unavailable' });
    listEntries.mockResolvedValue({ success: true, entries: [], total: 0 });

    const found = await search({ query: 'anything' });

    expect(found.degraded).toBe(true);
    expect(found.noMatch).toBeUndefined();
    expect(found.semanticError).toBe('HNSW index unavailable');
  });

  it('ReasoningBank empty + legacy hits keeps the existing degraded labelling', async () => {
    bridgeSearchPatterns.mockResolvedValue({ results: [], controller: 'reasoningBank' });
    searchEntries.mockResolvedValue({
      success: true,
      results: [{ key: 'pattern-1', content: JSON.stringify({ pattern: 'retry with backoff', type: 'general', confidence: 0.9 }), score: 0.7 }],
      searchTime: 0,
    });

    const found = await search({ query: 'retry' });

    expect(found).toMatchObject({
      results: [{ patternId: 'pattern-1', pattern: 'retry with backoff', type: 'general', confidence: 0.9, score: 0.7 }],
      degraded: true,
      reason: 'reasoningBank-empty:reasoningBank',
      controller: 'memory-store-fallback',
      tier: 'semantic',
    });
    expect(found.noMatch).toBeUndefined();
  });

  it('a null bridge result (registry unavailable) stays degraded even when nothing matches', async () => {
    bridgeSearchPatterns.mockResolvedValue(null);
    emptyLegacy();

    const found = await search({ query: 'anything' });

    expect(found.degraded).toBe(true);
    expect(found.reason).toBe('reasoningBank-unavailable:registry-null');
    expect(found.noMatch).toBeUndefined();
  });

  it('normal ReasoningBank hits are returned unchanged', async () => {
    const hits = { results: [{ id: '7', content: 'use a circuit breaker', score: 0.91 }], controller: 'reasoningBank' };
    bridgeSearchPatterns.mockResolvedValue(hits);

    const found = await search({ query: 'circuit breaker' });

    expect(found).toEqual(hits);
    expect(searchEntries).not.toHaveBeenCalled();
    expect(listEntries).not.toHaveBeenCalled();
  });
});
