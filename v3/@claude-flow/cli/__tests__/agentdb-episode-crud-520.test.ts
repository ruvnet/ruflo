import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setMemoryBridgeRegistryForTests } from '../src/memory/memory-bridge.js';
import {
  agentdbEpisodeDelete,
  agentdbEpisodeGet,
  agentdbEpisodeList,
  agentdbEpisodeUpdate,
} from '../src/mcp-tools/agentdb-episode-tools.js';
import { agentdbTools } from '../src/mcp-tools/agentdb-tools.js';
import { parseEpisodeId } from '../src/memory/episode-crud.js';

// ADR-520: episode get / list / update / delete over agentdb 3.3's ReflexionMemory.

afterEach(() => __setMemoryBridgeRegistryForTests(null));

function withReflexion(reflexion: Record<string, unknown> | null) {
  __setMemoryBridgeRegistryForTests({ get: (n: string) => (n === 'reflexion' ? reflexion : null), getBackend: () => null });
}

const episode = (over: Record<string, unknown> = {}) => ({
  id: 7, sessionId: 's1', task: 'fixed the flaky test', reward: 0, success: false, embedding: new Float32Array(384), ...over,
});

describe('tool registration', () => {
  it('registers the four episode CRUD tools next to recall', () => {
    const names = agentdbTools.map(t => t.name);
    for (const n of ['agentdb_episode-recall', 'agentdb_episode-get', 'agentdb_episode-list', 'agentdb_episode-update', 'agentdb_episode-delete']) {
      expect(names).toContain(n);
    }
  });
});

describe('ids', () => {
  it('accepts only positive integers, never a parseInt prefix', () => {
    expect(parseEpisodeId(7)).toBe(7);
    expect(parseEpisodeId('7')).toBe(7);
    for (const bad of ['12-notes', '1e3', -1, 0, 1.5, '', null, undefined, {}]) expect(parseEpisodeId(bad)).toBeNull();
  });
  it('rejects a malformed id before reaching agentdb', async () => {
    const deleteEpisode = vi.fn();
    withReflexion({ getEpisode: vi.fn(), deleteEpisode });
    expect(await agentdbEpisodeDelete.handler({ id: '12-notes' })).toMatchObject({ success: false, error: expect.stringMatching(/positive integer/) });
    expect(deleteEpisode).not.toHaveBeenCalled();
  });
});

describe('agentdb_episode-get', () => {
  it('returns the episode without its embedding', async () => {
    withReflexion({ getEpisode: vi.fn().mockReturnValue(episode()) });
    const r: any = await agentdbEpisodeGet.handler({ id: 7 });
    expect(r).toMatchObject({ success: true, episode: { id: 7, task: 'fixed the flaky test' } });
    expect(r.episode.embedding).toBeUndefined();
  });
  it('returns episode: null when missing', async () => {
    withReflexion({ getEpisode: vi.fn().mockReturnValue(null) });
    expect(await agentdbEpisodeGet.handler({ id: 9 })).toEqual({ success: true, episode: null });
  });
  it('says what is needed on agentdb < 3.3', async () => {
    withReflexion({ retrieveRelevant: vi.fn() });
    expect(await agentdbEpisodeGet.handler({ id: 1 })).toMatchObject({ success: false, error: expect.stringMatching(/3\.3\.0/) });
  });
  it('reports an unavailable bridge', async () => {
    withReflexion(null);
    expect(await agentdbEpisodeGet.handler({ id: 1 })).toMatchObject({ success: false, error: expect.stringMatching(/not available/) });
  });
});

describe('agentdb_episode-list', () => {
  it('passes filters through and bounds text', async () => {
    const listEpisodes = vi.fn().mockReturnValue({ items: [episode({ task: 'x'.repeat(10_000) })], total: 31, limit: 20, offset: 0 });
    withReflexion({ listEpisodes });
    const r: any = await agentdbEpisodeList.handler({ sessionId: 's1', success: false, limit: 20 });
    expect(listEpisodes).toHaveBeenCalledWith({ sessionId: 's1', success: false, limit: 20, offset: 0, order: 'newest' });
    expect(r.total).toBe(31);
    expect(r.episodes[0].task.length).toBe(4000);
  });
  it('rejects bad paging', async () => {
    withReflexion({ listEpisodes: vi.fn() });
    expect(await agentdbEpisodeList.handler({ limit: 1000 })).toMatchObject({ success: false });
    expect(await agentdbEpisodeList.handler({ offset: -1 })).toMatchObject({ success: false });
    expect(await agentdbEpisodeList.handler({ order: 'sideways' })).toMatchObject({ success: false });
  });
});

describe('agentdb_episode-update', () => {
  it('sends only the given fields and reports whether it re-embedded', async () => {
    const updateEpisode = vi.fn().mockResolvedValue({ episode: episode({ success: true, critique: 'worked' }), reembedded: true, changedFields: ['critique', 'success'] });
    withReflexion({ updateEpisode });
    const r = await agentdbEpisodeUpdate.handler({ id: 7, critique: 'worked', success: true, metadata: { verifiedBy: 'ci' } });
    expect(updateEpisode).toHaveBeenCalledWith(7, { critique: 'worked', success: true, metadata: { verifiedBy: 'ci' } }, { replaceMetadata: false });
    expect(r).toMatchObject({ success: true, reembedded: true, changedFields: ['critique', 'success'], episode: { critique: 'worked' } });
  });
  it('allows null to clear a nullable field but not the task', async () => {
    const updateEpisode = vi.fn().mockResolvedValue({ episode: episode(), reembedded: false, changedFields: ['critique'] });
    withReflexion({ updateEpisode });
    expect(await agentdbEpisodeUpdate.handler({ id: 7, critique: null })).toMatchObject({ success: true });
    expect(updateEpisode.mock.calls[0][1]).toEqual({ critique: null });
    expect(await agentdbEpisodeUpdate.handler({ id: 7, task: null })).toMatchObject({ success: false });
    expect(await agentdbEpisodeUpdate.handler({ id: 7, task: '   ' })).toMatchObject({ success: false });
  });
  it('rejects unknown fields, bad values, pollution and empty patches without calling agentdb', async () => {
    const updateEpisode = vi.fn();
    withReflexion({ updateEpisode });
    for (const bad of [
      { id: 7, sessionId: 'x' },
      { id: 7, reward: 2 },
      { id: 7, success: 'yes' },
      { id: 7, tags: [1] },
      { id: 7, metadata: [] },
      { id: 7, metadata: JSON.parse('{"a":{"__proto__":{"p":1}}}') },
      { id: 7, metadata: { big: 'x'.repeat(70_000) } },
      { id: 7 },
    ]) {
      expect(await agentdbEpisodeUpdate.handler(bad as any)).toMatchObject({ success: false });
    }
    expect(updateEpisode).not.toHaveBeenCalled();
    expect(({} as any).p).toBeUndefined();
  });
  it('passes agentdb validation errors through, with paths stripped', async () => {
    withReflexion({ updateEpisode: vi.fn().mockRejectedValue(new Error('episode 7 was modified concurrently; retry the update at /home/u/x/y.ts')) });
    const r: any = await agentdbEpisodeUpdate.handler({ id: 7, task: 'new' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/modified concurrently/);
    expect(r.error).not.toContain('/home/u/');
  });
  it('returns episode: null for a missing id', async () => {
    withReflexion({ updateEpisode: vi.fn().mockResolvedValue(null) });
    expect(await agentdbEpisodeUpdate.handler({ id: 99, reward: 1 })).toMatchObject({ success: true, episode: null });
  });
});

describe('agentdb_episode-delete', () => {
  it('deletes through agentdb', async () => {
    const deleteEpisode = vi.fn().mockResolvedValue(true);
    withReflexion({ getEpisode: vi.fn(), deleteEpisode });
    expect(await agentdbEpisodeDelete.handler({ id: 7 })).toEqual({ success: true, deleted: true });
    expect(deleteEpisode).toHaveBeenCalledWith(7);
  });
  it('refuses the pre-3.3 deleteEpisode, which parseInt-ed ids and left vectors behind', async () => {
    const deleteEpisode = vi.fn();
    withReflexion({ deleteEpisode });
    expect(await agentdbEpisodeDelete.handler({ id: 7 })).toMatchObject({ success: false, error: expect.stringMatching(/3\.3\.0/) });
    expect(deleteEpisode).not.toHaveBeenCalled();
  });
});
