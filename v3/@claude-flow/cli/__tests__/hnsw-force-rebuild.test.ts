/** A forced HNSW rebuild reloads from SQLite instead of the persisted index. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';

// A vector engine that persists per storagePath across instances, like
// @ruvector/core's VectorDb, with insert as an upsert by id. Registered under
// both module IDs for the same reason as hnsw-metadata-atomic-4739.test.ts.
const store = vi.hoisted(() => new Map<string, Map<string, Float32Array>>());
const ruvectorCoreStub = vi.hoisted(() => () => ({
  default: {
    VectorDb: class {
      private readonly vectors: Map<string, Float32Array>;
      constructor(options: { storagePath: string }) {
        if (!store.has(options.storagePath)) store.set(options.storagePath, new Map());
        this.vectors = store.get(options.storagePath)!;
      }
      async len() { return this.vectors.size; }
      async insert(item: { id: string; vector: Float32Array }) { this.vectors.set(item.id, item.vector); }
    },
  },
}));
vi.mock('/@id/@ruvector/core', ruvectorCoreStub);
vi.mock('@ruvector/core', ruvectorCoreStub);

import * as memory from '../src/memory/memory-initializer.js';

async function writeMemoryDb(path: string, rows: Array<{ id: string; updatedAt: number }>): Promise<void> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`CREATE TABLE memory_entries (
    id TEXT PRIMARY KEY, key TEXT, namespace TEXT, content TEXT,
    embedding TEXT, status TEXT, updated_at INTEGER)`);
  db.run('BEGIN');
  const insert = db.prepare('INSERT INTO memory_entries VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const row of rows) {
    insert.run([row.id, row.id, 'default', row.id, '[1,0,0]', 'active', row.updatedAt]);
  }
  insert.free();
  db.run('COMMIT');
  fs.writeFileSync(path, Buffer.from(db.export()));
  db.close();
}

describe('getHNSWIndex({ forceRebuild: true })', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(join(tmpdir(), 'ruflo-hnsw-rebuild-'));
    vi.stubEnv('CLAUDE_FLOW_MEMORY_PATH', root);
    vi.stubEnv('CLAUDE_FLOW_DISABLE_BRIDGE', '1');
    memory.clearHNSWIndex();
    memory._resetMemoryRootCache();
    store.clear();
  });

  afterEach(() => {
    memory.clearHNSWIndex();
    memory._resetMemoryRootCache();
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('replaces a persisted index with the rows SQLite has now', async () => {
    // a previous run persisted an index and metadata holding only `gone`
    expect(await memory.addToHNSWIndex('gone', [1, 0, 0], { id: 'gone', key: 'gone', namespace: 'default', content: 'gone' })).toBe(true);
    memory.clearHNSWIndex();
    await writeMemoryDb(join(root, 'memory.db'), [{ id: 'kept', updatedAt: 1 }, { id: 'added', updatedAt: 2 }]);

    const rebuilt = await memory.getHNSWIndex({ dimensions: 3, forceRebuild: true });
    expect([...rebuilt!.entries.keys()].sort()).toEqual(['added', 'kept']);

    // the next process loads the rebuilt metadata, not the old one
    memory.clearHNSWIndex();
    const reloaded = await memory.getHNSWIndex({ dimensions: 3 });
    expect([...reloaded!.entries.keys()].sort()).toEqual(['added', 'kept']);
  });

  it('keeps the newest rows when SQLite holds more than the load cap', async () => {
    const rows = Array.from({ length: 10_001 }, (_, i) => ({ id: `row-${i}`, updatedAt: i }));
    // insertion order puts the newest row last, where an unordered LIMIT drops it
    await writeMemoryDb(join(root, 'memory.db'), rows);

    const index = await memory.getHNSWIndex({ dimensions: 3, forceRebuild: true });
    expect(index!.entries.size).toBe(10_000);
    expect(index!.entries.has('row-10000')).toBe(true);
    expect(index!.entries.has('row-0')).toBe(false);
  });
});
