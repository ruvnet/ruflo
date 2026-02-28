/**
 * Tests for RvfEmbeddingCache and RvfEmbeddingService
 *
 * Covers CRUD, LRU eviction, TTL expiry, binary persistence,
 * dimension validation, deterministic hashing, L2 normalization,
 * caching, batch operations, interface conformance, and shutdown.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { RvfEmbeddingCache } from '../v3/@claude-flow/embeddings/src/rvf-embedding-cache.js';
import { RvfEmbeddingService } from '../v3/@claude-flow/embeddings/src/rvf-embedding-service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'rvf-test-'));
}

function makeEmbedding(dims: number, fill = 0.5): Float32Array {
  const arr = new Float32Array(dims);
  arr.fill(fill);
  return arr;
}

function l2Norm(v: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  return Math.sqrt(sum);
}

// ---------------------------------------------------------------------------
// RvfEmbeddingCache
// ---------------------------------------------------------------------------

describe('RvfEmbeddingCache', () => {
  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -- CRUD ----------------------------------------------------------------

  describe('CRUD operations', () => {
    it('set/get stores and retrieves an embedding', async () => {
      const cache = new RvfEmbeddingCache({
        cachePath: join(tmpDir, 'cache.rvec'),
        dimensions: 4,
      });
      const emb = makeEmbedding(4, 0.25);
      await cache.set('hello', emb);

      const result = await cache.get('hello');
      assert.ok(result, 'Expected non-null result');
      assert.equal(result.length, 4);
      assert.ok(Math.abs(result[0] - 0.25) < 1e-6);
      await cache.close();
    });

    it('has returns true for existing keys and false for missing keys', async () => {
      const cache = new RvfEmbeddingCache({
        cachePath: join(tmpDir, 'cache.rvec'),
        dimensions: 4,
      });
      await cache.set('exists', makeEmbedding(4));

      assert.equal(await cache.has('exists'), true);
      assert.equal(await cache.has('missing'), false);
      await cache.close();
    });

    it('delete removes an entry and returns correct boolean', async () => {
      const cache = new RvfEmbeddingCache({
        cachePath: join(tmpDir, 'cache.rvec'),
        dimensions: 4,
      });
      await cache.set('key1', makeEmbedding(4));

      assert.equal(await cache.delete('key1'), true);
      assert.equal(await cache.has('key1'), false);
      assert.equal(await cache.delete('key1'), false);
      await cache.close();
    });

    it('clear removes all entries', async () => {
      const cache = new RvfEmbeddingCache({
        cachePath: join(tmpDir, 'cache.rvec'),
        dimensions: 4,
      });
      await cache.set('a', makeEmbedding(4));
      await cache.set('b', makeEmbedding(4));
      assert.equal(await cache.size(), 2);

      await cache.clear();
      assert.equal(await cache.size(), 0);
      assert.equal(await cache.has('a'), false);
      await cache.close();
    });

    it('size returns the number of entries', async () => {
      const cache = new RvfEmbeddingCache({
        cachePath: join(tmpDir, 'cache.rvec'),
        dimensions: 4,
      });
      assert.equal(await cache.size(), 0);
      await cache.set('x', makeEmbedding(4));
      assert.equal(await cache.size(), 1);
      await cache.set('y', makeEmbedding(4));
      assert.equal(await cache.size(), 2);
      await cache.close();
    });
  });

  // -- LRU Eviction --------------------------------------------------------

  describe('LRU eviction', () => {
    it('evicts oldest entries when maxSize is exceeded', async () => {
      const cache = new RvfEmbeddingCache({
        cachePath: join(tmpDir, 'cache.rvec'),
        maxSize: 5,
        dimensions: 4,
      });

      // Insert 6 entries to exceed maxSize of 5
      for (let i = 0; i < 6; i++) {
        await cache.set(`key-${i}`, makeEmbedding(4, i * 0.1));
      }

      // After eviction to 90% of 5 = 4, size should be <= 5
      const sz = await cache.size();
      assert.ok(sz <= 5, `Expected size <= 5, got ${sz}`);
      await cache.close();
    });
  });

  // -- TTL Expiry ----------------------------------------------------------

  describe('TTL expiry', () => {
    it('returns null for expired entries', async () => {
      const cache = new RvfEmbeddingCache({
        cachePath: join(tmpDir, 'cache.rvec'),
        ttlMs: 1, // 1ms TTL - will expire almost instantly
        dimensions: 4,
      });
      await cache.set('ephemeral', makeEmbedding(4));

      // Wait for the entry to expire
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = await cache.get('ephemeral');
      assert.equal(result, null, 'Expected expired entry to return null');
      await cache.close();
    });

    it('has returns false for expired entries', async () => {
      const cache = new RvfEmbeddingCache({
        cachePath: join(tmpDir, 'cache.rvec'),
        ttlMs: 1,
        dimensions: 4,
      });
      await cache.set('temp', makeEmbedding(4));
      await new Promise((resolve) => setTimeout(resolve, 10));

      assert.equal(await cache.has('temp'), false);
      await cache.close();
    });
  });

  // -- Binary Persistence --------------------------------------------------

  describe('binary persistence', () => {
    it('data survives close and reinit cycle', async () => {
      const cachePath = join(tmpDir, 'persist.rvec');
      const emb = makeEmbedding(4, 0.42);

      // Write
      const cache1 = new RvfEmbeddingCache({
        cachePath,
        dimensions: 4,
      });
      await cache1.set('persist-test', emb);
      await cache1.close();

      // Reopen and read
      const cache2 = new RvfEmbeddingCache({
        cachePath,
        dimensions: 4,
      });
      const loaded = await cache2.get('persist-test');
      assert.ok(loaded, 'Expected persisted entry to be loaded');
      assert.equal(loaded.length, 4);
      // Float32 precision: values should be very close
      assert.ok(Math.abs(loaded[0] - 0.42) < 1e-5);
      await cache2.close();
    });
  });

  // -- Binary Format -------------------------------------------------------

  describe('binary format', () => {
    it('file starts with RVEC magic bytes (0x52 0x56 0x45 0x43)', async () => {
      const cachePath = join(tmpDir, 'magic.rvec');
      const cache = new RvfEmbeddingCache({
        cachePath,
        dimensions: 4,
      });
      await cache.set('magic-check', makeEmbedding(4));
      await cache.close();

      assert.ok(existsSync(cachePath), 'Cache file should exist');
      const buf = readFileSync(cachePath);
      assert.equal(buf[0], 0x52, 'R');
      assert.equal(buf[1], 0x56, 'V');
      assert.equal(buf[2], 0x45, 'E');
      assert.equal(buf[3], 0x43, 'C');
    });
  });

  // -- Dimension Validation ------------------------------------------------

  describe('dimension validation', () => {
    it('throws error when embedding dimensions do not match configured dimensions', async () => {
      const cache = new RvfEmbeddingCache({
        cachePath: join(tmpDir, 'dim.rvec'),
        dimensions: 4,
      });

      await assert.rejects(
        () => cache.set('wrong-dims', makeEmbedding(8)),
        (err: Error) => {
          assert.ok(err.message.includes('Dimension mismatch'));
          assert.ok(err.message.includes('expected 4'));
          assert.ok(err.message.includes('got 8'));
          return true;
        }
      );
      await cache.close();
    });
  });
});

// ---------------------------------------------------------------------------
// RvfEmbeddingService
// ---------------------------------------------------------------------------

describe('RvfEmbeddingService', () => {
  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -- embed() -------------------------------------------------------------

  describe('embed()', () => {
    it('returns a Float32Array of correct dimensions', async () => {
      const svc = new RvfEmbeddingService({ provider: 'rvf', dimensions: 64 });
      const result = await svc.embed('test input');

      assert.ok(result.embedding instanceof Float32Array);
      assert.equal(result.embedding.length, 64);
      assert.equal(typeof result.latencyMs, 'number');
      await svc.shutdown();
    });

    it('uses default 384 dimensions when not specified', async () => {
      const svc = new RvfEmbeddingService({ provider: 'rvf' });
      const result = await svc.embed('default dims');

      assert.equal(result.embedding.length, 384);
      await svc.shutdown();
    });

    it('is deterministic - same input produces same output', async () => {
      const svc = new RvfEmbeddingService({ provider: 'rvf', dimensions: 32 });

      // Clear cache between calls to force regeneration
      const r1 = await svc.embed('determinism check');
      svc.clearCache();
      const r2 = await svc.embed('determinism check');

      assert.deepEqual(
        Array.from(r1.embedding as Float32Array),
        Array.from(r2.embedding as Float32Array),
        'Embeddings for the same input must be identical'
      );
      await svc.shutdown();
    });

    it('produces different embeddings for different inputs', async () => {
      const svc = new RvfEmbeddingService({ provider: 'rvf', dimensions: 32 });
      const r1 = await svc.embed('apple');
      const r2 = await svc.embed('banana');

      const a = r1.embedding as Float32Array;
      const b = r2.embedding as Float32Array;
      let same = true;
      for (let i = 0; i < a.length; i++) {
        if (Math.abs(a[i] - b[i]) > 1e-9) { same = false; break; }
      }
      assert.equal(same, false, 'Different inputs should yield different embeddings');
      await svc.shutdown();
    });
  });

  // -- L2 Normalization ----------------------------------------------------

  describe('L2 normalization', () => {
    it('output vectors are unit length (norm approximately 1.0)', async () => {
      const svc = new RvfEmbeddingService({ provider: 'rvf', dimensions: 128 });
      const result = await svc.embed('normalization test');
      const norm = l2Norm(result.embedding as Float32Array);

      assert.ok(
        Math.abs(norm - 1.0) < 1e-5,
        `Expected norm ~1.0, got ${norm}`
      );
      await svc.shutdown();
    });

    it('multiple different texts all produce unit vectors', async () => {
      const svc = new RvfEmbeddingService({ provider: 'rvf', dimensions: 64 });
      const texts = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];

      for (const text of texts) {
        const result = await svc.embed(text);
        const norm = l2Norm(result.embedding as Float32Array);
        assert.ok(
          Math.abs(norm - 1.0) < 1e-5,
          `Expected unit vector for "${text}", got norm ${norm}`
        );
      }
      await svc.shutdown();
    });
  });

  // -- embedBatch() --------------------------------------------------------

  describe('embedBatch()', () => {
    it('returns the correct number of embeddings', async () => {
      const svc = new RvfEmbeddingService({ provider: 'rvf', dimensions: 32 });
      const texts = ['one', 'two', 'three', 'four'];
      const result = await svc.embedBatch(texts);

      assert.equal(result.embeddings.length, 4);
      assert.equal(typeof result.totalLatencyMs, 'number');
      assert.equal(typeof result.avgLatencyMs, 'number');
      await svc.shutdown();
    });

    it('reports cache hits for previously embedded texts', async () => {
      const svc = new RvfEmbeddingService({ provider: 'rvf', dimensions: 32 });

      // Pre-embed some texts
      await svc.embed('cached-a');
      await svc.embed('cached-b');

      // Batch with mix of cached and new
      const result = await svc.embedBatch(['cached-a', 'cached-b', 'new-c']);

      assert.ok(result.cacheStats, 'Expected cacheStats to be defined');
      assert.equal(result.cacheStats!.hits, 2);
      assert.equal(result.cacheStats!.misses, 1);
      await svc.shutdown();
    });
  });

  // -- Caching -------------------------------------------------------------

  describe('caching', () => {
    it('second call for same text returns cached result', async () => {
      const svc = new RvfEmbeddingService({ provider: 'rvf', dimensions: 32 });

      const r1 = await svc.embed('cache me');
      assert.ok(!r1.cached, 'First call should not be cached');

      const r2 = await svc.embed('cache me');
      assert.equal(r2.cached, true, 'Second call should be cached');
      assert.equal(r2.latencyMs, 0, 'Cached result should report 0 latency');
      await svc.shutdown();
    });
  });

  // -- Persistent Cache Integration ----------------------------------------

  describe('persistent cache integration', () => {
    it('with cachePath, data persists across service instances', async () => {
      const cachePath = join(tmpDir, 'svc-persist.rvec');

      // First instance: embed and shutdown
      const svc1 = new RvfEmbeddingService({
        provider: 'rvf',
        dimensions: 32,
        cachePath,
      });
      const r1 = await svc1.embed('persistent text');
      await svc1.shutdown();

      // Second instance: should find the persistent entry
      const svc2 = new RvfEmbeddingService({
        provider: 'rvf',
        dimensions: 32,
        cachePath,
      });
      const r2 = await svc2.embed('persistent text');

      assert.equal(r2.cached, true, 'Should be a cache hit from persistent store');
      assert.equal(r2.persistentCached, true, 'Should flag persistent cache hit');

      // Verify the embeddings match
      const a = r1.embedding as Float32Array;
      const b = r2.embedding as Float32Array;
      for (let i = 0; i < a.length; i++) {
        assert.ok(
          Math.abs(a[i] - b[i]) < 1e-5,
          `Mismatch at index ${i}: ${a[i]} vs ${b[i]}`
        );
      }
      await svc2.shutdown();
    });
  });

  // -- IEmbeddingService Interface -----------------------------------------

  describe('IEmbeddingService interface', () => {
    it('provider property is "rvf"', () => {
      const svc = new RvfEmbeddingService({ provider: 'rvf' });
      assert.equal(svc.provider, 'rvf');
    });

    it('implements all required methods', () => {
      const svc = new RvfEmbeddingService({ provider: 'rvf' });
      assert.equal(typeof svc.embed, 'function');
      assert.equal(typeof svc.embedBatch, 'function');
      assert.equal(typeof svc.clearCache, 'function');
      assert.equal(typeof svc.getCacheStats, 'function');
      assert.equal(typeof svc.shutdown, 'function');
    });
  });

  // -- getCacheStats() -----------------------------------------------------

  describe('getCacheStats()', () => {
    it('returns correct hit/miss structure after operations', async () => {
      const svc = new RvfEmbeddingService({
        provider: 'rvf',
        dimensions: 16,
        cacheSize: 100,
      });

      // Initial state
      const stats0 = svc.getCacheStats();
      assert.equal(stats0.size, 0);
      assert.equal(stats0.maxSize, 100);
      assert.equal(stats0.hitRate, 0);

      // Generate some embeddings
      await svc.embed('stat-a');
      await svc.embed('stat-b');
      await svc.embed('stat-a'); // cache hit

      const stats1 = svc.getCacheStats();
      assert.equal(stats1.size, 2);
      assert.ok(stats1.hitRate > 0, 'Hit rate should be > 0 after cache hit');
      await svc.shutdown();
    });
  });

  // -- shutdown() ----------------------------------------------------------

  describe('shutdown()', () => {
    it('clears in-memory cache', async () => {
      const svc = new RvfEmbeddingService({ provider: 'rvf', dimensions: 16 });
      await svc.embed('before-shutdown');

      const statsBefore = svc.getCacheStats();
      assert.equal(statsBefore.size, 1);

      await svc.shutdown();

      const statsAfter = svc.getCacheStats();
      assert.equal(statsAfter.size, 0);
    });

    it('closes persistent cache without error', async () => {
      const svc = new RvfEmbeddingService({
        provider: 'rvf',
        dimensions: 16,
        cachePath: join(tmpDir, 'shutdown.rvec'),
      });
      await svc.embed('shutdown-persist');

      // Should not throw
      await svc.shutdown();
    });

    it('removes event listeners on shutdown', async () => {
      const svc = new RvfEmbeddingService({ provider: 'rvf', dimensions: 16 });
      let called = false;
      svc.addEventListener(() => { called = true; });
      await svc.embed('pre-shutdown');
      assert.equal(called, true, 'Listener should fire before shutdown');

      await svc.shutdown();
      called = false;

      // After shutdown, listeners should be cleared, but embed still works
      // (the in-memory cache is cleared, so it regenerates)
      await svc.embed('post-shutdown');
      assert.equal(called, false, 'Listener should not fire after shutdown');
    });
  });

  // -- Event system --------------------------------------------------------

  describe('event system', () => {
    it('fires embed_start and embed_complete for new embeddings', async () => {
      const svc = new RvfEmbeddingService({ provider: 'rvf', dimensions: 16 });
      const events: string[] = [];
      svc.addEventListener((e) => events.push(e.type));

      await svc.embed('event-test');

      assert.ok(events.includes('embed_start'));
      assert.ok(events.includes('embed_complete'));
      await svc.shutdown();
    });

    it('fires cache_hit for cached embeddings', async () => {
      const svc = new RvfEmbeddingService({ provider: 'rvf', dimensions: 16 });
      const events: string[] = [];
      await svc.embed('hit-test'); // first call (miss)

      svc.addEventListener((e) => events.push(e.type));
      await svc.embed('hit-test'); // second call (hit)

      assert.ok(events.includes('cache_hit'));
      await svc.shutdown();
    });

    it('removeEventListener stops delivering events', async () => {
      const svc = new RvfEmbeddingService({ provider: 'rvf', dimensions: 16 });
      let count = 0;
      const listener = () => { count++; };

      svc.addEventListener(listener);
      await svc.embed('before-remove');
      const countBefore = count;

      svc.removeEventListener(listener);
      count = 0;
      await svc.embed('after-remove');
      assert.equal(count, 0, 'Listener should not fire after removal');
      assert.ok(countBefore > 0, 'Listener should have fired before removal');
      await svc.shutdown();
    });
  });
});
