import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __setMemoryBridgeRegistryForTests,
  bridgeRecallEpisodes,
  bridgeSessionEnd,
  bridgeSessionStart,
} from '../src/memory/memory-bridge.js';
import { agentdbEpisodeRecall, agentdbSessionStart } from '../src/mcp-tools/agentdb-tools.js';

// ADR-519: session ends store an episode, session starts / agentdb_episode-recall
// read them back through agentdb 3.2's hybrid retrieveRelevant.

afterEach(() => __setMemoryBridgeRegistryForTests(null));

function registry(reflexion: Record<string, unknown> | null) {
  const store = vi.fn().mockResolvedValue({ success: true });
  const search = vi.fn().mockResolvedValue({ results: [] });
  __setMemoryBridgeRegistryForTests({
    get: (name: string) => (name === 'reflexion' ? reflexion : null),
    // bridgeStoreEntry / bridgeSearchEntries go through the backend; a stub keeps them inert.
    getBackend: () => null,
  });
  return { store, search };
}

describe('session end stores an episode (ADR-519)', () => {
  it('stores the summary as a neutral, unverified episode', async () => {
    const storeEpisode = vi.fn().mockResolvedValue(42);
    registry({ storeEpisode });
    const r = await bridgeSessionEnd({ sessionId: 's1', summary: 'fixed the flaky websocket reconnect test', tasksCompleted: 3 });
    expect(storeEpisode).toHaveBeenCalledOnce();
    const ep = storeEpisode.mock.calls[0][0];
    expect(ep).toMatchObject({ sessionId: 's1', task: 'fixed the flaky websocket reconnect test', reward: 0, success: false, tags: ['session-end'] });
    expect(ep.metadata).toMatchObject({ source: 'session-end', tasksCompleted: 3 });
    expect(r).toMatchObject({ persisted: true, episodeId: 42 });
    expect(r?.controller.startsWith('reflexion')).toBe(true);
  });

  it('stores nothing without a summary', async () => {
    const storeEpisode = vi.fn();
    registry({ storeEpisode });
    await bridgeSessionEnd({ sessionId: 's1' });
    expect(storeEpisode).not.toHaveBeenCalled();
  });

  it('bounds the stored task text', async () => {
    const storeEpisode = vi.fn().mockResolvedValue(1);
    registry({ storeEpisode });
    await bridgeSessionEnd({ sessionId: 's1', summary: 'x'.repeat(20_000) });
    expect(storeEpisode.mock.calls[0][0].task.length).toBe(4_000);
  });

  it('a failing storeEpisode does not throw and reports no episode', async () => {
    registry({ storeEpisode: vi.fn().mockRejectedValue(new Error('disk full')) });
    // The stub registry has no backend, so the memory-entry write fails too and
    // the result is the pre-ADR-519 null; the point is that nothing throws.
    const r = await bridgeSessionEnd({ sessionId: 's1', summary: 'something' });
    expect(r?.episodeId).toBeUndefined();
  });
});

describe('episode recall (ADR-519)', () => {
  const rows = [
    { id: 7, sessionId: 'old', task: 'websocket reconnect fix', reward: 0, success: false, similarity: 0.812345, embedding: new Float32Array(384), tags: ['session-end'], ts: 1 },
  ];

  it('asks for hybrid, not rerank, by default and strips embeddings', async () => {
    const retrieveRelevant = vi.fn().mockResolvedValue(rows);
    registry({ retrieveRelevant });
    const r = await bridgeRecallEpisodes({ task: 'websocket' });
    expect(retrieveRelevant).toHaveBeenCalledWith({ task: 'websocket', k: 5, hybrid: true, rerank: false });
    expect(r).toMatchObject({ success: true, hybrid: true, rerank: false });
    expect(r?.episodes[0]).toEqual({ id: 7, sessionId: 'old', task: 'websocket reconnect fix', reward: 0, success: false, similarity: 0.8123, tags: ['session-end'], ts: 1 });
  });

  it('passes rerank, hybrid=false and filters through, and clamps k', async () => {
    const retrieveRelevant = vi.fn().mockResolvedValue([]);
    registry({ retrieveRelevant });
    await bridgeRecallEpisodes({ task: 'q', k: 500, hybrid: false, rerank: true, onlySuccesses: true, minReward: 0.5, timeWindowDays: 7 });
    expect(retrieveRelevant).toHaveBeenCalledWith({ task: 'q', k: 50, hybrid: false, rerank: true, onlySuccesses: true, minReward: 0.5, timeWindowDays: 7 });
  });

  it('returns null when there is no ReflexionMemory', async () => {
    registry(null);
    expect(await bridgeRecallEpisodes({ task: 'q' })).toBeNull();
  });

  it('session start recalls only when asked', async () => {
    const retrieveRelevant = vi.fn().mockResolvedValue(rows);
    registry({ retrieveRelevant });
    const plain = await bridgeSessionStart({ sessionId: 's2', context: 'websocket' });
    expect(retrieveRelevant).not.toHaveBeenCalled();
    expect(plain?.episodes).toBeUndefined();
    const withRecall = await bridgeSessionStart({ sessionId: 's2', context: 'websocket', recall: true });
    expect(retrieveRelevant).toHaveBeenCalledOnce();
    expect(withRecall).toMatchObject({ controller: 'reflexion', episodes: [{ id: 7 }] });
  });
});

describe('MCP tools (ADR-519)', () => {
  it('agentdb_episode-recall validates the query', async () => {
    registry({ retrieveRelevant: vi.fn().mockResolvedValue([]) });
    expect(await agentdbEpisodeRecall.handler({})).toMatchObject({ success: false });
    expect(await agentdbEpisodeRecall.handler({ query: '   ' })).toMatchObject({ success: false });
    expect(await agentdbEpisodeRecall.handler({ query: 'x'.repeat(10_001) })).toMatchObject({ success: false });
    expect(await agentdbEpisodeRecall.handler({ query: 'q', onlySuccesses: true, onlyFailures: true })).toMatchObject({ success: false });
  });

  it('agentdb_episode-recall keeps rerank off unless asked', async () => {
    const retrieveRelevant = vi.fn().mockResolvedValue([]);
    registry({ retrieveRelevant });
    await agentdbEpisodeRecall.handler({ query: 'q' });
    await agentdbEpisodeRecall.handler({ query: 'q', rerank: true, k: 3 });
    expect(retrieveRelevant.mock.calls[0][0]).toMatchObject({ hybrid: true, rerank: false, k: 5 });
    expect(retrieveRelevant.mock.calls[1][0]).toMatchObject({ rerank: true, k: 3 });
  });

  it('agentdb_session-start advertises recall, hybrid and rerank', () => {
    expect(Object.keys(agentdbSessionStart.inputSchema.properties)).toEqual(
      expect.arrayContaining(['recall', 'k', 'hybrid', 'rerank']),
    );
  });
});
