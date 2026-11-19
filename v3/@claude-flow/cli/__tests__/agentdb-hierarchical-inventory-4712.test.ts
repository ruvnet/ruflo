/**
 * agentdb_hierarchical-list / agentdb_hierarchical-get (#4712).
 *
 * The bridge registry is replaced with a mock whose `hierarchicalMemory`
 * controller stands in for @claude-flow/memory's TieredMemoryStore, so these
 * tests pin the tool + bridge contract without depending on which memory
 * version is installed.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setMemoryBridgeRegistryForTests } from '../src/memory/memory-bridge.js';
import { agentdbTools } from '../src/mcp-tools/agentdb-tools.js';
import {
  agentdbHierarchicalGet,
  agentdbHierarchicalList,
} from '../src/mcp-tools/agentdb-hierarchical-inventory-tools.js';

afterEach(() => __setMemoryBridgeRegistryForTests(null));

function withHierarchical(hm: Record<string, unknown> | null, fallback: { reason: string } | null = { reason: 'agentdb-export-missing' }) {
  __setMemoryBridgeRegistryForTests({
    get: (n: string) => (n === 'hierarchicalMemory' ? hm : null),
    getBackend: () => null,
    getHierarchicalFallback: () => fallback,
  });
}

/** A durable TieredMemoryStore stand-in. */
function tieredStore(over: Record<string, unknown> = {}) {
  return {
    isDurable: () => true,
    getPersistence: () => 'sqlite',
    store: vi.fn(),
    recall: vi.fn(),
    listEntries: vi.fn().mockReturnValue({ entries: [], nextCursor: null, evaluatedAt: '2026-11-09T00:00:00.000Z' }),
    getEntry: vi.fn().mockReturnValue(null),
    ...over,
  };
}

/** Error shaped like @claude-flow/memory's TieredMemoryInventoryError. */
function typedError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('registration', () => {
  it('registers both tools in agentdbTools, adjacent and in order', () => {
    const names = agentdbTools.map(t => t.name);
    const at = names.indexOf('agentdb_hierarchical-list');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(names.slice(at, at + 2)).toEqual(['agentdb_hierarchical-list', 'agentdb_hierarchical-get']);
    expect(names).toContain('agentdb_hierarchical-recall');
    expect(new Set(names).size).toBe(names.length);
  });

  it('bounds every input in the schema and documents the cursor and status filter', () => {
    const list = agentdbHierarchicalList.inputSchema.properties as Record<string, any>;
    expect(list.limit).toMatchObject({ minimum: 1, maximum: 1000 });
    expect(list.cursor.maxLength).toBe(2048);
    expect(list.status.enum).toEqual(['active', 'expired', 'superseded', 'archived', 'all']);
    expect(list.tier.enum).toEqual(['working', 'episodic', 'semantic']);
    expect(agentdbHierarchicalList.description).toMatch(/Use when/);
    expect(agentdbHierarchicalList.description).toMatch(/cursor/);
    expect(agentdbHierarchicalList.description).toMatch(/superseded/);
    const get = agentdbHierarchicalGet.inputSchema.properties as Record<string, any>;
    expect(get.id.maxLength).toBe(1000);
    expect(agentdbHierarchicalGet.inputSchema.required).toEqual(['id']);
    expect(agentdbHierarchicalGet.description).toMatch(/Use when/);
  });
});

describe('agentdb_hierarchical-list', () => {
  it('passes validated filters to TieredMemoryStore.listEntries and returns its page', async () => {
    const page = {
      entries: [{ id: 'tm_1', key: 'k', value: 'v', tier: 'semantic', ts: 1, status: 'active', archived: false }],
      nextCursor: 'abc_-',
      evaluatedAt: '2026-11-09T00:00:00.000Z',
    };
    const hm = tieredStore({ listEntries: vi.fn().mockReturnValue(page) });
    withHierarchical(hm);

    const r = await agentdbHierarchicalList.handler({ tier: 'semantic', status: 'all', limit: 5000.7, cursor: 'abc_-' });

    expect(hm.listEntries).toHaveBeenCalledWith({ tier: 'semantic', status: 'all', limit: 1000, cursor: 'abc_-' });
    expect(r).toMatchObject({
      success: true, controller: 'tieredMemoryStore', durable: true, persistence: 'sqlite',
      entries: page.entries, nextCursor: 'abc_-',
    });
  });

  it('defaults status to active and leaves limit to the store', async () => {
    const hm = tieredStore();
    withHierarchical(hm);
    await agentdbHierarchicalList.handler({});
    expect(hm.listEntries).toHaveBeenCalledWith({ tier: undefined, status: 'active', limit: undefined, cursor: undefined });
  });

  it('rejects bad input before reaching the store', async () => {
    const hm = tieredStore();
    withHierarchical(hm);
    for (const params of [
      { tier: 'nonsense' }, { tier: 3 }, { status: 'deleted' }, { limit: '10' }, { limit: Number.NaN },
      { cursor: '' }, { cursor: 'x'.repeat(2049) }, { cursor: 42 },
    ]) {
      const r: any = await agentdbHierarchicalList.handler(params);
      expect(r, JSON.stringify(params)).toMatchObject({ success: false, code: 'invalid-argument' });
    }
    expect(hm.listEntries).not.toHaveBeenCalled();
  });

  it('surfaces a tampered-cursor rejection from the store as a typed failure', async () => {
    withHierarchical(tieredStore({
      listEntries: vi.fn(() => { throw typedError('invalid cursor: not canonical (altered). Restart pagination without a cursor.', 'invalid-cursor'); }),
    }));
    expect(await agentdbHierarchicalList.handler({ cursor: 'forged' })).toMatchObject({
      success: false, code: 'invalid-cursor', error: expect.stringMatching(/^invalid cursor/),
    });
  });

  it('refuses on a volatile store instead of returning an empty page', async () => {
    withHierarchical(tieredStore({
      isDurable: () => false,
      getPersistence: () => 'volatile',
      listEntries: vi.fn(() => { throw typedError('unsupported: volatile store — listEntries reads the persisted tiered_memory table', 'unsupported'); }),
    }));
    const r: any = await agentdbHierarchicalList.handler({});
    expect(r).toMatchObject({ success: false, code: 'unsupported', durable: false, persistence: 'volatile' });
    expect(r.entries).toBeUndefined();
  });

  it('propagates a read failure as success:false, never as an empty inventory', async () => {
    withHierarchical(tieredStore({ listEntries: vi.fn(() => { throw new Error('disk I/O error'); }) }));
    const r: any = await agentdbHierarchicalList.handler({});
    expect(r).toMatchObject({ success: false, error: 'disk I/O error' });
    expect(r.entries).toBeUndefined();
  });

  it('says which @claude-flow/memory is needed when the installed store predates the API', async () => {
    const { listEntries, getEntry, ...old } = tieredStore();
    void listEntries; void getEntry;
    withHierarchical(old);
    expect(await agentdbHierarchicalList.handler({})).toMatchObject({
      success: false, code: 'unsupported', error: expect.stringMatching(/@claude-flow\/memory.*3\.3\.0/),
    });
  });

  it('reports native-unsupported for a native agentdb HierarchicalMemory', async () => {
    withHierarchical({ getStats: vi.fn(), promote: vi.fn(), store: vi.fn(), recall: vi.fn() });
    expect(await agentdbHierarchicalList.handler({})).toMatchObject({ success: false, controller: 'native-unsupported' });
  });

  it('reports an unavailable controller or bridge', async () => {
    withHierarchical(null);
    expect(await agentdbHierarchicalList.handler({})).toMatchObject({ success: false, error: 'HierarchicalMemory not available' });
  });
});

describe('agentdb_hierarchical-get', () => {
  it('returns an active entry with its status', async () => {
    const entry = { id: 'tm_1', key: 'k', value: 'v', tier: 'working', ts: 1, status: 'active', archived: false };
    const hm = tieredStore({ getEntry: vi.fn().mockReturnValue(entry) });
    withHierarchical(hm);
    const r = await agentdbHierarchicalGet.handler({ id: 'tm_1' });
    expect(hm.getEntry).toHaveBeenCalledWith('tm_1', { includeInactive: false });
    expect(r).toMatchObject({ success: true, found: true, entry });
  });

  it('forwards includeInactive for superseded / expired history', async () => {
    const entry = { id: 'tm_old', key: 'k', value: 'v1', tier: 'semantic', ts: 1, supersededBy: 'tm_new', status: 'superseded', archived: true };
    const hm = tieredStore({ getEntry: vi.fn().mockReturnValue(entry) });
    withHierarchical(hm);
    const r = await agentdbHierarchicalGet.handler({ id: 'tm_old', includeInactive: true });
    expect(hm.getEntry).toHaveBeenCalledWith('tm_old', { includeInactive: true });
    expect(r).toMatchObject({ success: true, found: true, entry: { status: 'superseded' } });
  });

  it('returns found:false for a missing id', async () => {
    withHierarchical(tieredStore());
    expect(await agentdbHierarchicalGet.handler({ id: 'tm_missing' })).toMatchObject({ success: true, found: false, entry: null });
  });

  it('rejects a malformed id or includeInactive before reaching the store', async () => {
    const hm = tieredStore();
    withHierarchical(hm);
    for (const params of [{}, { id: '' }, { id: 7 }, { id: 'x'.repeat(1001) }, { id: 'tm_1', includeInactive: 'yes' }]) {
      expect(await agentdbHierarchicalGet.handler(params), JSON.stringify(params)).toMatchObject({ success: false, code: 'invalid-argument' });
    }
    expect(hm.getEntry).not.toHaveBeenCalled();
  });

  it('refuses on a volatile store', async () => {
    withHierarchical(tieredStore({
      isDurable: () => false,
      getPersistence: () => 'volatile',
      getEntry: vi.fn(() => { throw typedError('unsupported: volatile store — getEntry', 'unsupported'); }),
    }));
    expect(await agentdbHierarchicalGet.handler({ id: 'tm_1' })).toMatchObject({ success: false, code: 'unsupported', persistence: 'volatile' });
  });
});

describe('end to end against the workspace TieredMemoryStore source', () => {
  it('lists and reads back entries through the tools', async () => {
    // Source import: the published @claude-flow/memory is externalised in this
    // suite and may predate the API, so exercise the code this PR ships.
    const { TieredMemoryStore } = await import('../../memory/src/tiered-memory.js');
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(':memory:');
    try {
      const store = new TieredMemoryStore({ db });
      const old = store.store('fact', 'v1', 'semantic');
      const fresh = store.store('fact', 'v2', 'semantic', { supersedes: old.id });
      withHierarchical(store as unknown as Record<string, unknown>);

      const active: any = await agentdbHierarchicalList.handler({ tier: 'semantic' });
      expect(active).toMatchObject({ success: true, persistence: 'sqlite' });
      expect(active.entries.map((e: any) => e.id)).toEqual([fresh.id]);
      const all: any = await agentdbHierarchicalList.handler({ tier: 'semantic', status: 'all' });
      expect(all.totalEstimate).toBe(2);
      expect(await agentdbHierarchicalGet.handler({ id: old.id })).toMatchObject({ success: true, found: false });
      expect(await agentdbHierarchicalGet.handler({ id: old.id, includeInactive: true })).toMatchObject({
        found: true, entry: { status: 'superseded', supersededBy: fresh.id },
      });
      const forged: any = await agentdbHierarchicalList.handler({ tier: 'semantic', cursor: 'e30' });
      expect(forged).toMatchObject({ success: false, code: 'invalid-cursor' });
    } finally {
      db.close();
    }
  });
});
