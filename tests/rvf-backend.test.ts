import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RvfBackend } from '../v3/@claude-flow/memory/src/rvf-backend.js';
import type {
  MemoryEntry,
  MemoryQuery,
  SearchOptions,
  IMemoryBackend,
} from '../v3/@claude-flow/memory/src/types.js';

// -- Helpers --

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'rvf-test-'));
}

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  const now = Date.now();
  return {
    id: `e-${Math.random().toString(36).slice(2, 10)}`,
    key: 'test-key',
    content: 'test content',
    type: 'semantic',
    namespace: 'default',
    tags: [],
    metadata: {},
    accessLevel: 'private',
    createdAt: now,
    updatedAt: now,
    version: 1,
    references: [],
    accessCount: 0,
    lastAccessedAt: now,
    ...overrides,
  };
}

function randomVec(dim = 4): Float32Array {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = Math.random() - 0.5;
  // normalise so cosine is meaningful
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (norm > 0) for (let i = 0; i < dim; i++) v[i] /= norm;
  return v;
}

// -- Tests --

describe('RvfBackend', () => {
  let tmpDir: string;
  let backend: RvfBackend;

  beforeEach(async () => {
    tmpDir = makeTmpDir();
    backend = new RvfBackend({
      databasePath: join(tmpDir, 'test.rvf'),
      dimensions: 4,
      autoPersistInterval: 0, // disable timer in tests
    });
    await backend.initialize();
  });

  afterEach(async () => {
    try { await backend.shutdown(); } catch {}
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  // ---- 1. Constructor & Config ----
  describe('constructor & config', () => {
    it('should apply default config values', async () => {
      const b = new RvfBackend({ databasePath: ':memory:' });
      await b.initialize();
      const stats = await b.getStats();
      assert.equal(stats.totalEntries, 0);
      await b.shutdown();
    });

    it('should accept custom dimensions and metric', async () => {
      const b = new RvfBackend({
        databasePath: ':memory:',
        dimensions: 8,
        metric: 'dot',
      });
      await b.initialize();
      const health = await b.healthCheck();
      assert.equal(health.status, 'healthy');
      await b.shutdown();
    });
  });

  // ---- 2. Initialize / Shutdown ----
  describe('initialize & shutdown', () => {
    it('should be idempotent on double init', async () => {
      await backend.initialize(); // second call
      const stats = await backend.getStats();
      assert.equal(stats.totalEntries, 0);
    });

    it('should persist file on shutdown when dirty', async () => {
      await backend.store(makeEntry());
      await backend.shutdown();
      assert.ok(existsSync(join(tmpDir, 'test.rvf')));
    });

    it('should reload entries after shutdown + reinit', async () => {
      const entry = makeEntry({ id: 'persist-1', key: 'k1' });
      await backend.store(entry);
      await backend.shutdown();

      const b2 = new RvfBackend({
        databasePath: join(tmpDir, 'test.rvf'),
        dimensions: 4,
        autoPersistInterval: 0,
      });
      await b2.initialize();
      const got = await b2.get('persist-1');
      assert.ok(got);
      assert.equal(got.key, 'k1');
      assert.equal(got.content, entry.content);
      await b2.shutdown();
    });

    it('should be a no-op when shutdown is called before init', async () => {
      const b = new RvfBackend({ databasePath: ':memory:' });
      await b.shutdown(); // should not throw
    });
  });

  // ---- 3. CRUD ----
  describe('CRUD operations', () => {
    it('store and get by id', async () => {
      const entry = makeEntry({ id: 'crud-1' });
      await backend.store(entry);
      const got = await backend.get('crud-1');
      assert.ok(got);
      assert.equal(got.id, 'crud-1');
    });

    it('get returns null for missing id', async () => {
      const got = await backend.get('nonexistent');
      assert.equal(got, null);
    });

    it('get increments accessCount', async () => {
      await backend.store(makeEntry({ id: 'ac-1', accessCount: 0 }));
      await backend.get('ac-1');
      const got = await backend.get('ac-1');
      assert.ok(got);
      assert.equal(got.accessCount, 2);
    });

    it('getByKey retrieves by namespace + key', async () => {
      await backend.store(makeEntry({ id: 'bk-1', namespace: 'ns1', key: 'mykey' }));
      const got = await backend.getByKey('ns1', 'mykey');
      assert.ok(got);
      assert.equal(got.id, 'bk-1');
    });

    it('getByKey returns null for wrong namespace', async () => {
      await backend.store(makeEntry({ namespace: 'ns1', key: 'mykey' }));
      assert.equal(await backend.getByKey('ns2', 'mykey'), null);
    });

    it('update modifies entry and bumps version', async () => {
      await backend.store(makeEntry({ id: 'up-1', content: 'old', version: 1 }));
      const updated = await backend.update('up-1', { content: 'new' });
      assert.ok(updated);
      assert.equal(updated.content, 'new');
      assert.equal(updated.version, 2);
    });

    it('update returns null for missing id', async () => {
      assert.equal(await backend.update('missing', { content: 'x' }), null);
    });

    it('delete removes entry and returns true', async () => {
      await backend.store(makeEntry({ id: 'del-1' }));
      assert.equal(await backend.delete('del-1'), true);
      assert.equal(await backend.get('del-1'), null);
    });

    it('delete returns false for missing id', async () => {
      assert.equal(await backend.delete('missing'), false);
    });
  });

  // ---- 4. Query ----
  describe('query', () => {
    beforeEach(async () => {
      await backend.bulkInsert([
        makeEntry({ id: 'q1', namespace: 'alpha', key: 'a1', type: 'episodic', tags: ['urgent'], createdAt: 1000, updatedAt: 1000 }),
        makeEntry({ id: 'q2', namespace: 'alpha', key: 'a2', type: 'semantic', tags: ['urgent', 'bug'], createdAt: 2000, updatedAt: 2000 }),
        makeEntry({ id: 'q3', namespace: 'beta', key: 'b1', type: 'semantic', tags: [], createdAt: 3000, updatedAt: 3000 }),
        makeEntry({ id: 'q4', namespace: 'beta', key: 'prefix-abc', type: 'procedural', tags: ['bug'], createdAt: 4000, updatedAt: 4000 }),
      ]);
    });

    it('filters by namespace', async () => {
      const r = await backend.query({ type: 'exact', namespace: 'alpha', limit: 10 });
      assert.equal(r.length, 2);
      assert.ok(r.every(e => e.namespace === 'alpha'));
    });

    it('filters by tags (AND logic)', async () => {
      const r = await backend.query({ type: 'tag', tags: ['urgent', 'bug'], limit: 10 });
      assert.equal(r.length, 1);
      assert.equal(r[0].id, 'q2');
    });

    it('filters by memoryType', async () => {
      const r = await backend.query({ type: 'exact', memoryType: 'procedural', limit: 10 });
      assert.equal(r.length, 1);
      assert.equal(r[0].id, 'q4');
    });

    it('filters by keyPrefix', async () => {
      const r = await backend.query({ type: 'prefix', keyPrefix: 'prefix-', limit: 10 });
      assert.equal(r.length, 1);
      assert.equal(r[0].id, 'q4');
    });

    it('filters by createdAfter / createdBefore', async () => {
      const r = await backend.query({ type: 'exact', createdAfter: 1500, createdBefore: 3500, limit: 10 });
      assert.equal(r.length, 2); // q2 (2000) and q3 (3000)
    });

    it('respects limit', async () => {
      const r = await backend.query({ type: 'exact', limit: 2 });
      assert.equal(r.length, 2);
    });

    it('respects offset', async () => {
      const all = await backend.query({ type: 'exact', limit: 100 });
      const page = await backend.query({ type: 'exact', limit: 100, offset: 2 });
      assert.equal(page.length, all.length - 2);
    });

    it('excludes expired entries by default', async () => {
      await backend.store(makeEntry({ id: 'exp-1', expiresAt: 1 })); // already expired
      const r = await backend.query({ type: 'exact', limit: 100 });
      assert.ok(!r.some(e => e.id === 'exp-1'));
    });

    it('includes expired entries when includeExpired is true', async () => {
      await backend.store(makeEntry({ id: 'exp-2', expiresAt: 1 }));
      const r = await backend.query({ type: 'exact', limit: 100, includeExpired: true });
      assert.ok(r.some(e => e.id === 'exp-2'));
    });
  });

  // ---- 5. Search ----
  describe('search', () => {
    it('finds similar vectors via cosine similarity', async () => {
      const target = new Float32Array([1, 0, 0, 0]);
      const similar = new Float32Array([0.9, 0.1, 0, 0]);
      const dissimilar = new Float32Array([0, 0, 0, 1]);

      await backend.store(makeEntry({ id: 's1', embedding: similar }));
      await backend.store(makeEntry({ id: 's2', embedding: dissimilar }));

      const results = await backend.search(target, { k: 2 });
      assert.ok(results.length >= 1);
      assert.equal(results[0].entry.id, 's1');
      assert.ok(results[0].score > results[results.length - 1].score);
    });

    it('applies threshold filtering', async () => {
      await backend.store(makeEntry({ id: 'th1', embedding: new Float32Array([1, 0, 0, 0]) }));
      await backend.store(makeEntry({ id: 'th2', embedding: new Float32Array([0, 0, 0, 1]) }));

      const results = await backend.search(new Float32Array([1, 0, 0, 0]), {
        k: 10,
        threshold: 0.9,
      });
      assert.equal(results.length, 1);
      assert.equal(results[0].entry.id, 'th1');
    });

    it('filters by namespace in search', async () => {
      const vec = new Float32Array([1, 0, 0, 0]);
      await backend.store(makeEntry({ id: 'ns1', namespace: 'keep', embedding: vec }));
      await backend.store(makeEntry({ id: 'ns2', namespace: 'skip', embedding: vec }));

      const results = await backend.search(vec, {
        k: 10,
        filters: { type: 'exact', limit: 10, namespace: 'keep' },
      });
      assert.ok(results.every(r => r.entry.namespace === 'keep'));
    });

    it('limits results to k', async () => {
      for (let i = 0; i < 5; i++) {
        await backend.store(makeEntry({ id: `k${i}`, embedding: randomVec() }));
      }
      const results = await backend.search(randomVec(), { k: 2 });
      assert.ok(results.length <= 2);
    });

    it('returns empty for empty database', async () => {
      const results = await backend.search(randomVec(), { k: 5 });
      assert.equal(results.length, 0);
    });
  });

  // ---- 6. Bulk Operations ----
  describe('bulk operations', () => {
    it('bulkInsert stores multiple entries', async () => {
      const entries = Array.from({ length: 5 }, (_, i) =>
        makeEntry({ id: `bulk-${i}`, key: `k${i}` })
      );
      await backend.bulkInsert(entries);
      assert.equal(await backend.count(), 5);
    });

    it('bulkDelete removes specified entries', async () => {
      await backend.bulkInsert([
        makeEntry({ id: 'bd-1' }),
        makeEntry({ id: 'bd-2' }),
        makeEntry({ id: 'bd-3' }),
      ]);
      const deleted = await backend.bulkDelete(['bd-1', 'bd-3', 'nonexistent']);
      assert.equal(deleted, 2);
      assert.equal(await backend.count(), 1);
      assert.ok(await backend.get('bd-2'));
    });
  });

  // ---- 7. Namespace Operations ----
  describe('namespace operations', () => {
    beforeEach(async () => {
      await backend.bulkInsert([
        makeEntry({ id: 'n1', namespace: 'a', key: 'k1' }),
        makeEntry({ id: 'n2', namespace: 'a', key: 'k2' }),
        makeEntry({ id: 'n3', namespace: 'b', key: 'k3' }),
      ]);
    });

    it('count without namespace returns total', async () => {
      assert.equal(await backend.count(), 3);
    });

    it('count with namespace returns filtered count', async () => {
      assert.equal(await backend.count('a'), 2);
      assert.equal(await backend.count('b'), 1);
      assert.equal(await backend.count('empty'), 0);
    });

    it('listNamespaces returns all unique namespaces', async () => {
      const ns = await backend.listNamespaces();
      assert.deepEqual(ns.sort(), ['a', 'b']);
    });

    it('clearNamespace removes only that namespace', async () => {
      const cleared = await backend.clearNamespace('a');
      assert.equal(cleared, 2);
      assert.equal(await backend.count(), 1);
      assert.ok(await backend.get('n3'));
    });
  });

  // ---- 8. Persistence & Binary Format ----
  describe('persistence', () => {
    it('persisted file starts with RVF magic bytes', async () => {
      await backend.store(makeEntry({ id: 'magic-1' }));
      await backend.shutdown();

      const buf = readFileSync(join(tmpDir, 'test.rvf'));
      assert.equal(buf[0], 0x52); // R
      assert.equal(buf[1], 0x56); // V
      assert.equal(buf[2], 0x46); // F
      assert.equal(buf[3], 0x00); // \0
    });

    it('embeddings survive round-trip', async () => {
      const vec = new Float32Array([0.1, 0.2, 0.3, 0.4]);
      await backend.store(makeEntry({ id: 'emb-1', embedding: vec }));
      await backend.shutdown();

      const b2 = new RvfBackend({
        databasePath: join(tmpDir, 'test.rvf'),
        dimensions: 4,
        autoPersistInterval: 0,
      });
      await b2.initialize();
      const got = await b2.get('emb-1');
      assert.ok(got?.embedding);
      for (let i = 0; i < 4; i++) {
        assert.ok(Math.abs(got.embedding[i] - vec[i]) < 1e-6);
      }
      await b2.shutdown();
    });

    it(':memory: path does not create a file', async () => {
      const b = new RvfBackend({ databasePath: ':memory:', dimensions: 4 });
      await b.initialize();
      await b.store(makeEntry());
      await b.shutdown();
      // no file should be created anywhere for :memory:
    });
  });

  // ---- 9. HNSW Index ----
  describe('HNSW index', () => {
    it('search reflects added and removed vectors', async () => {
      const vec = new Float32Array([1, 0, 0, 0]);
      await backend.store(makeEntry({ id: 'h1', embedding: vec }));

      let results = await backend.search(vec, { k: 5 });
      assert.ok(results.some(r => r.entry.id === 'h1'));

      await backend.delete('h1');
      results = await backend.search(vec, { k: 5 });
      assert.ok(!results.some(r => r.entry.id === 'h1'));
    });

    it('indexes vectors from bulkInsert', async () => {
      const entries = Array.from({ length: 3 }, (_, i) =>
        makeEntry({ id: `bi-${i}`, embedding: randomVec() })
      );
      await backend.bulkInsert(entries);

      const results = await backend.search(entries[0].embedding!, { k: 10 });
      assert.ok(results.length > 0);
    });
  });

  // ---- 10. Stats & Health ----
  describe('stats & health', () => {
    it('getStats returns correct counts', async () => {
      await backend.bulkInsert([
        makeEntry({ id: 'st1', namespace: 'x', type: 'episodic', content: 'abc' }),
        makeEntry({ id: 'st2', namespace: 'x', type: 'semantic', content: 'def' }),
        makeEntry({ id: 'st3', namespace: 'y', type: 'episodic', content: 'ghi' }),
      ]);
      const stats = await backend.getStats();
      assert.equal(stats.totalEntries, 3);
      assert.equal(stats.entriesByNamespace['x'], 2);
      assert.equal(stats.entriesByNamespace['y'], 1);
      assert.equal(stats.entriesByType['episodic'], 2);
      assert.equal(stats.entriesByType['semantic'], 1);
      assert.ok(stats.memoryUsage > 0);
    });

    it('getStats includes HNSW stats when vectors present', async () => {
      await backend.store(makeEntry({ embedding: randomVec() }));
      const stats = await backend.getStats();
      assert.ok(stats.hnswStats);
      assert.equal(stats.hnswStats.vectorCount, 1);
    });

    it('healthCheck returns healthy after init', async () => {
      const health = await backend.healthCheck();
      assert.equal(health.status, 'healthy');
      assert.ok(health.timestamp > 0);
      assert.equal(health.issues.length, 0);
    });

    it('healthCheck returns unhealthy before init', async () => {
      const b = new RvfBackend({ databasePath: ':memory:', dimensions: 4 });
      const health = await b.healthCheck();
      assert.equal(health.status, 'unhealthy');
      assert.ok(health.issues.length > 0);
    });
  });

  // ---- 11. Edge Cases ----
  describe('edge cases', () => {
    it('handles empty database gracefully', async () => {
      assert.equal(await backend.count(), 0);
      assert.deepEqual(await backend.listNamespaces(), []);
      assert.deepEqual(await backend.query({ type: 'exact', limit: 10 }), []);
      const stats = await backend.getStats();
      assert.equal(stats.totalEntries, 0);
    });

    it('init with missing file dir creates it on persist', async () => {
      const deepPath = join(tmpDir, 'sub', 'dir', 'deep.rvf');
      const b = new RvfBackend({
        databasePath: deepPath,
        dimensions: 4,
        autoPersistInterval: 0,
      });
      await b.initialize();
      await b.store(makeEntry());
      await b.shutdown();
      assert.ok(existsSync(deepPath));
    });

    it('handles corrupt file without crashing', async () => {
      const path = join(tmpDir, 'corrupt.rvf');
      const { writeFileSync } = await import('node:fs');
      writeFileSync(path, Buffer.from('RVF\0garbage data here'));

      const b = new RvfBackend({
        databasePath: path,
        dimensions: 4,
        autoPersistInterval: 0,
      });
      // should not throw - gracefully handles corrupt data
      await b.initialize();
      assert.equal(await b.count(), 0);
      await b.shutdown();
    });

    it('store overwrites entry with same id', async () => {
      await backend.store(makeEntry({ id: 'ow-1', content: 'first' }));
      await backend.store(makeEntry({ id: 'ow-1', content: 'second' }));
      const got = await backend.get('ow-1');
      assert.equal(got?.content, 'second');
    });
  });

  // ---- 12. IMemoryBackend Interface Conformance ----
  describe('IMemoryBackend conformance', () => {
    it('implements all required interface methods', () => {
      const requiredMethods: (keyof IMemoryBackend)[] = [
        'initialize', 'shutdown', 'store', 'get', 'getByKey',
        'update', 'delete', 'query', 'search', 'bulkInsert',
        'bulkDelete', 'count', 'listNamespaces', 'clearNamespace',
        'getStats', 'healthCheck',
      ];
      for (const method of requiredMethods) {
        assert.equal(typeof (backend as any)[method], 'function', `missing method: ${method}`);
      }
    });

    it('all methods return promises', async () => {
      const entry = makeEntry({ id: 'iface-1' });
      assert.ok(backend.store(entry) instanceof Promise);
      assert.ok(backend.get('x') instanceof Promise);
      assert.ok(backend.getByKey('ns', 'k') instanceof Promise);
      assert.ok(backend.update('x', {}) instanceof Promise);
      assert.ok(backend.delete('x') instanceof Promise);
      assert.ok(backend.query({ type: 'exact', limit: 1 }) instanceof Promise);
      assert.ok(backend.search(randomVec(), { k: 1 }) instanceof Promise);
      assert.ok(backend.bulkInsert([]) instanceof Promise);
      assert.ok(backend.bulkDelete([]) instanceof Promise);
      assert.ok(backend.count() instanceof Promise);
      assert.ok(backend.listNamespaces() instanceof Promise);
      assert.ok(backend.clearNamespace('x') instanceof Promise);
      assert.ok(backend.getStats() instanceof Promise);
      assert.ok(backend.healthCheck() instanceof Promise);
    });
  });
});
