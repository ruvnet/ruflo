/**
 * #1227 — AgentMemoryScope (project | local | user) wired into memory
 * operations as a NAMESPACE PREFIX in the same store:
 *
 *   agent-memory:<scope>:<agentId>:<namespace>
 *
 * London-school: the memory layer is replaced by an in-memory fake keyed on
 * (namespace, key), so these tests pin what namespace each handler asks the
 * layer for — the thing that decides isolation — without a real database.
 *
 * Pre-fix, `scope`/`agentId` were ignored: every scope wrote the same row,
 * and memory_list_scopes did not exist.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = { key: string; namespace: string; content: string; tags: string[] };

const fake = vi.hoisted(() => {
  const rows = new Map<string, Row>();
  const id = (ns: string, key: string) => `${ns}\u0000${key}`;
  return {
    rows,
    storeEntry: vi.fn(async (o: { key: string; value: string; namespace?: string; tags?: string[] }) => {
      const namespace = o.namespace ?? 'default';
      rows.set(id(namespace, o.key), { key: o.key, namespace, content: o.value, tags: o.tags ?? [] });
      return { success: true, id: `id-${rows.size}` };
    }),
    getEntry: vi.fn(async (o: { key: string; namespace?: string }) => {
      const row = rows.get(id(o.namespace ?? 'default', o.key));
      if (!row) return { success: true, found: false };
      return {
        success: true,
        found: true,
        entry: { ...row, id: 'x', accessCount: 0, createdAt: 'c', updatedAt: 'u', hasEmbedding: false },
      };
    }),
    searchEntries: vi.fn(async (o: { query: string; namespace?: string; limit?: number }) => {
      const ns = o.namespace || 'all';
      const results = [...rows.values()]
        .filter((r) => (ns === 'all' || r.namespace === ns) && r.content.includes(o.query))
        .slice(0, o.limit ?? 10)
        .map((r) => ({ id: r.key, key: r.key, namespace: r.namespace, content: r.content, score: 0.9 }));
      return { success: true, results, searchTime: 1 };
    }),
    listEntries: vi.fn(async (o: { namespace?: string; limit?: number; offset?: number }) => {
      const all = [...rows.values()].filter((r) => !o.namespace || r.namespace === o.namespace);
      const offset = o.offset ?? 0;
      const page = all.slice(offset, offset + (o.limit ?? 50));
      return {
        success: true,
        total: all.length,
        entries: page.map((r) => ({ ...r, id: 'x', accessCount: 0, createdAt: 'c', updatedAt: 'u', hasEmbedding: false, size: r.content.length })),
      };
    }),
  };
});

vi.mock('fs', async (orig) => ({
  ...(await orig<typeof import('fs')>()),
  existsSync: vi.fn(() => false),
}));

vi.mock('../src/memory/memory-initializer.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  storeEntry: fake.storeEntry,
  getEntry: fake.getEntry,
  searchEntries: fake.searchEntries,
  listEntries: fake.listEntries,
  deleteEntry: vi.fn(async () => ({ deleted: true })),
  initializeMemoryDatabase: vi.fn(async () => ({ success: true })),
  checkMemoryInitialization: vi.fn(async () => ({ initialized: true, version: '3.0.0', features: {} })),
  resolveDbPath: vi.fn(() => '/fake/memory.db'),
}));

vi.mock('../src/output.js', () => ({ output: new Proxy({}, { get: () => vi.fn() }) }));
vi.mock('../src/prompt.js', () => ({ confirm: vi.fn(async () => true), select: vi.fn(), input: vi.fn() }));
vi.mock('../src/mcp-client.js', () => ({ callMCPTool: vi.fn(), MCPClientError: class extends Error {} }));

import { memoryTools } from '../src/mcp-tools/memory-tools.js';
import { memoryCommand } from '../src/commands/memory.js';

function tool(name: string) {
  const t = memoryTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not registered`);
  return t;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (name: string, input: Record<string, unknown>) => tool(name).handler(input) as Promise<any>;

const SCOPES = ['project', 'local', 'user'] as const;

beforeEach(() => {
  fake.rows.clear();
  vi.clearAllMocks();
});

describe('#1227 memory_store / memory_retrieve with scope', () => {
  it.each(SCOPES)('round-trips a value in the %s scope under the prefixed namespace', async (scope) => {
    const stored = await call('memory_store', { key: 'style', value: `tabs-${scope}`, namespace: 'prefs', scope, agentId: 'coder' });
    expect(stored.success).toBe(true);
    expect(stored.namespace).toBe(`agent-memory:${scope}:coder:prefs`);
    expect(stored.scope).toBe(scope);
    expect(stored.agentId).toBe('coder');
    expect(fake.storeEntry).toHaveBeenCalledWith(expect.objectContaining({ namespace: `agent-memory:${scope}:coder:prefs` }));

    const got = await call('memory_retrieve', { key: 'style', namespace: 'prefs', scope, agentId: 'coder' });
    expect(got.found).toBe(true);
    expect(got.value).toBe(`tabs-${scope}`);
    expect(got.scope).toBe(scope);
  });

  it('defaults the namespace to "default" inside the scope', async () => {
    const stored = await call('memory_store', { key: 'k', value: 'v', scope: 'local', agentId: 'coder' });
    expect(stored.namespace).toBe('agent-memory:local:coder:default');
    expect((await call('memory_retrieve', { key: 'k', scope: 'local', agentId: 'coder' })).found).toBe(true);
  });
});

describe('#1227 cross-scope isolation', () => {
  beforeEach(async () => {
    for (const scope of SCOPES) {
      await call('memory_store', { key: 'secret', value: `marker ${scope}`, scope, agentId: 'coder' });
    }
    await call('memory_store', { key: 'secret', value: 'marker unscoped' });
  });

  it('keeps one row per scope instead of overwriting a shared row', () => {
    expect(fake.rows.size).toBe(4);
  });

  it.each(SCOPES)('retrieve in %s returns only that scope\'s value', async (scope) => {
    const got = await call('memory_retrieve', { key: 'secret', scope, agentId: 'coder' });
    expect(got.value).toBe(`marker ${scope}`);
  });

  it('a different agent in the same scope sees nothing', async () => {
    const got = await call('memory_retrieve', { key: 'secret', scope: 'project', agentId: 'tester' });
    expect(got.found).toBe(false);
    const found = await call('memory_search', { query: 'marker', scope: 'project', agentId: 'tester', threshold: 0 });
    expect(found.results).toEqual([]);
  });

  it.each(SCOPES)('search in %s returns only that scope\'s rows', async (scope) => {
    const found = await call('memory_search', { query: 'marker', scope, agentId: 'coder', threshold: 0 });
    expect(found.results.map((r: { value: string }) => r.value)).toEqual([`marker ${scope}`]);
    expect(found.scope).toBe(scope);
    expect(fake.searchEntries).toHaveBeenLastCalledWith(expect.objectContaining({ namespace: `agent-memory:${scope}:coder:default` }));
  });
});

describe('#1227 unscoped behaviour is unchanged', () => {
  it('store/retrieve without scope use the plain namespace', async () => {
    const stored = await call('memory_store', { key: 'k', value: 'v', namespace: 'patterns' });
    expect(stored.namespace).toBe('patterns');
    expect(stored).not.toHaveProperty('scope');
    expect(fake.storeEntry).toHaveBeenCalledWith(expect.objectContaining({ namespace: 'patterns' }));
    const got = await call('memory_retrieve', { key: 'k', namespace: 'patterns' });
    expect(got.found).toBe(true);
    expect(got.namespace).toBe('patterns');
  });

  it('a scoped read does not see pre-existing unscoped data, and an unscoped read does not see scoped data', async () => {
    await call('memory_store', { key: 'k', value: 'legacy' });
    expect((await call('memory_retrieve', { key: 'k', scope: 'project', agentId: 'coder' })).found).toBe(false);
    await call('memory_store', { key: 'k2', value: 'scoped', scope: 'project', agentId: 'coder' });
    expect((await call('memory_retrieve', { key: 'k2' })).found).toBe(false);
  });

  it('search with no namespace and no scope still passes namespace undefined (every namespace)', async () => {
    await call('memory_store', { key: 'a', value: 'needle one', namespace: 'patterns' });
    await call('memory_store', { key: 'b', value: 'needle two', scope: 'user', agentId: 'coder' });
    const found = await call('memory_search', { query: 'needle', threshold: 0 });
    expect(fake.searchEntries).toHaveBeenLastCalledWith(expect.objectContaining({ namespace: undefined }));
    // Documented choice: unscoped all-namespace search spans scoped rows too.
    expect(found.results).toHaveLength(2);
    expect(found).not.toHaveProperty('scope');
  });

  it('search with an explicit unscoped namespace is passed through verbatim', async () => {
    await call('memory_search', { query: 'q', namespace: 'patterns' });
    expect(fake.searchEntries).toHaveBeenLastCalledWith(expect.objectContaining({ namespace: 'patterns' }));
  });
});

describe('#1227 scope / agentId validation', () => {
  it('rejects an unknown scope', async () => {
    const r = await call('memory_store', { key: 'k', value: 'v', scope: 'global', agentId: 'coder' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/scope must be one of: project, local, user/);
    expect(fake.storeEntry).not.toHaveBeenCalled();
  });

  it('requires agentId with scope, and scope with agentId', async () => {
    expect((await call('memory_store', { key: 'k', value: 'v', scope: 'local' })).error).toMatch(/requires agentId/);
    expect((await call('memory_store', { key: 'k', value: 'v', agentId: 'coder' })).error).toMatch(/requires scope/);
    expect((await call('memory_retrieve', { key: 'k', agentId: 'coder' })).error).toMatch(/requires scope/);
    expect((await call('memory_search', { query: 'q', scope: 'user' })).error).toMatch(/requires agentId/);
    expect(fake.storeEntry).not.toHaveBeenCalled();
    expect(fake.getEntry).not.toHaveBeenCalled();
    expect(fake.searchEntries).not.toHaveBeenCalled();
  });

  it.each(['../etc', 'a b', 'co:der', 'co.der', 'x;rm'])('rejects agentId %j', async (agentId) => {
    const r = await call('memory_store', { key: 'k', value: 'v', scope: 'project', agentId });
    expect(r.success).toBe(false);
    expect(fake.storeEntry).not.toHaveBeenCalled();
  });

  it('rejects a scoped namespace that overflows the 128-character namespace limit', async () => {
    const r = await call('memory_store', { key: 'k', value: 'v', scope: 'project', agentId: 'coder', namespace: 'n'.repeat(120) });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/128/);
  });

  it('declares scope as an enum and agentId as a string on the three tools', () => {
    for (const name of ['memory_store', 'memory_retrieve', 'memory_search']) {
      const props = tool(name).inputSchema.properties as Record<string, { type: string; enum?: string[] }>;
      expect(props.scope.enum).toEqual(['project', 'local', 'user']);
      expect(props.agentId.type).toBe('string');
    }
  });
});

describe('#1227 memory_list_scopes', () => {
  it('is registered last in the tools array', () => {
    expect(memoryTools[memoryTools.length - 1].name).toBe('memory_list_scopes');
  });

  it('reports every scope, its agents and namespaces with entry counts', async () => {
    await call('memory_store', { key: 'a', value: 'v', namespace: 'prefs', scope: 'project', agentId: 'coder' });
    await call('memory_store', { key: 'b', value: 'v', namespace: 'prefs', scope: 'project', agentId: 'coder' });
    await call('memory_store', { key: 'c', value: 'v', scope: 'project', agentId: 'tester' });
    await call('memory_store', { key: 'd', value: 'v', scope: 'user', agentId: 'coder' });
    await call('memory_store', { key: 'e', value: 'v', namespace: 'patterns' });

    const r = await call('memory_list_scopes', {});
    expect(r.success).toBe(true);
    expect(r.scopes.map((s: { scope: string }) => s.scope)).toEqual(['project', 'local', 'user']);
    expect(r.scopes[0]).toEqual({
      scope: 'project',
      entries: 3,
      agents: [
        { agentId: 'coder', namespaces: [{ namespace: 'prefs', storedNamespace: 'agent-memory:project:coder:prefs', entries: 2 }] },
        { agentId: 'tester', namespaces: [{ namespace: 'default', storedNamespace: 'agent-memory:project:tester:default', entries: 1 }] },
      ],
    });
    expect(r.scopes[1]).toEqual({ scope: 'local', entries: 0, agents: [] });
    expect(r.scopes[2].agents[0].agentId).toBe('coder');
    expect(r.unscopedEntries).toBe(1);
    expect(r.totalEntries).toBe(5);
  });

  it('is read-only', async () => {
    await call('memory_list_scopes', {});
    expect(fake.storeEntry).not.toHaveBeenCalled();
  });

  it('reports a failed listing as a failure, not an empty store', async () => {
    fake.listEntries.mockResolvedValueOnce({ success: false, entries: [], total: 0, error: 'db locked' } as never);
    const r = await call('memory_list_scopes', {});
    expect(r.success).toBe(false);
    expect(r.error).toBe('db locked');
  });
});

describe('#1227 CLI memory store / retrieve / search --scope --agent', () => {
  async function run(name: string, flags: Record<string, unknown>) {
    const cmd = memoryCommand.subcommands!.find((c) => c.name === name)!;
    return cmd.action!({ flags: { format: 'json', ...flags }, args: [], interactive: false } as never);
  }

  it('declares --scope (with choices) and --agent on store, retrieve and search', () => {
    for (const name of ['store', 'retrieve', 'search']) {
      const opts = memoryCommand.subcommands!.find((c) => c.name === name)!.options!;
      expect(opts.find((o) => o.name === 'scope')?.choices).toEqual(['project', 'local', 'user']);
      expect(opts.find((o) => o.name === 'agent')).toBeDefined();
    }
  });

  it('store and retrieve use the scoped namespace, isolated per scope', async () => {
    expect((await run('store', { key: 'k', value: 'local-v', scope: 'local', agent: 'coder' })).success).toBe(true);
    expect(fake.storeEntry).toHaveBeenLastCalledWith(expect.objectContaining({ namespace: 'agent-memory:local:coder:default' }));
    expect((await run('retrieve', { key: 'k', scope: 'local', agent: 'coder' })).success).toBe(true);
    expect((await run('retrieve', { key: 'k', scope: 'user', agent: 'coder' })).success).toBe(false);
  });

  it('search with --scope stays inside that scope', async () => {
    await run('store', { key: 'k', value: 'needle', scope: 'project', agent: 'coder' });
    await run('search', { query: 'needle', scope: 'project', agent: 'coder', threshold: 0 });
    expect(fake.searchEntries).toHaveBeenLastCalledWith(expect.objectContaining({ namespace: 'agent-memory:project:coder:default' }));
  });

  it('without --scope the CLI namespace is unchanged', async () => {
    await run('store', { key: 'k', value: 'v', namespace: 'patterns' });
    expect(fake.storeEntry).toHaveBeenLastCalledWith(expect.objectContaining({ namespace: 'patterns' }));
  });

  it('rejects --scope without --agent before touching the store', async () => {
    const r = await run('store', { key: 'k', value: 'v', scope: 'local' });
    expect(r.success).toBe(false);
    expect(fake.storeEntry).not.toHaveBeenCalled();
  });
});
