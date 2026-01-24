/**
 * Beads Cache Layer Tests
 *
 * TDD London School tests for BeadsCache and CachedBeadsWrapper.
 * Tests focus on behavior verification including:
 * - LRU eviction policy
 * - TTL-based expiration
 * - Memory limits
 * - Cache statistics
 * - Performance benchmarks
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BeadsCache,
  CachedBeadsWrapper,
  createCachedWrapper,
  generateCacheKey,
  listCacheKey,
  readyCacheKey,
  issueCacheKey,
  dependencyCacheKey,
  epicCacheKey,
  DEFAULT_CACHE_CONFIG,
  TTL_PRESETS,
  type CacheConfig,
} from '../../src/beads/cache.js';
import type { BeadsIssue, BeadsStats, BeadsListParams } from '../../src/beads/types.js';

// Mock issue factory
function createMockIssue(id: string, title: string = 'Test Issue'): BeadsIssue {
  return {
    id,
    title,
    status: 'open',
    priority: 2,
    type: 'task',
    labels: [],
    dependencies: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

describe('BeadsCache', () => {
  let cache: BeadsCache;

  beforeEach(() => {
    // Create cache with no auto-cleanup for predictable tests
    cache = new BeadsCache({ cleanupIntervalMs: 0 });
  });

  afterEach(() => {
    cache.destroy();
    vi.restoreAllMocks();
  });

  describe('basic operations', () => {
    it('should store and retrieve values', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return undefined for missing keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should overwrite existing values', () => {
      cache.set('key1', 'value1');
      cache.set('key1', 'value2');
      expect(cache.get('key1')).toBe('value2');
    });

    it('should delete entries', () => {
      cache.set('key1', 'value1');
      expect(cache.delete('key1')).toBe(true);
      expect(cache.get('key1')).toBeUndefined();
    });

    it('should return false when deleting nonexistent key', () => {
      expect(cache.delete('nonexistent')).toBe(false);
    });

    it('should check if key exists', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('should clear all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBeUndefined();
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after TTL', async () => {
      cache.set('key1', 'value1', 50); // 50ms TTL

      expect(cache.get('key1')).toBe('value1');

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(cache.get('key1')).toBeUndefined();
    });

    it('should not expire entries before TTL', async () => {
      cache.set('key1', 'value1', 100);

      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(cache.get('key1')).toBe('value1');
    });

    it('should use default TTL when not specified', () => {
      const customCache = new BeadsCache({
        defaultTtlMs: 100,
        cleanupIntervalMs: 0,
      });

      customCache.set('key1', 'value1');

      // Entry should exist initially
      expect(customCache.get('key1')).toBe('value1');

      customCache.destroy();
    });

    it('should report expired entries as not existing via has()', async () => {
      cache.set('key1', 'value1', 50);

      expect(cache.has('key1')).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(cache.has('key1')).toBe(false);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used when at capacity', () => {
      const smallCache = new BeadsCache({
        maxEntries: 3,
        cleanupIntervalMs: 0,
      });

      smallCache.set('key1', 'value1');
      smallCache.set('key2', 'value2');
      smallCache.set('key3', 'value3');

      // Access key1 to make it recently used
      smallCache.get('key1');

      // Add key4, should evict key2 (least recently used)
      smallCache.set('key4', 'value4');

      expect(smallCache.get('key2')).toBeUndefined();
      expect(smallCache.get('key1')).toBe('value1');
      expect(smallCache.get('key3')).toBe('value3');
      expect(smallCache.get('key4')).toBe('value4');

      smallCache.destroy();
    });

    it('should update access order on get', () => {
      const smallCache = new BeadsCache({
        maxEntries: 2,
        cleanupIntervalMs: 0,
      });

      smallCache.set('key1', 'value1');
      smallCache.set('key2', 'value2');

      // Access key1 to make it more recently used than key2
      smallCache.get('key1');

      // Add key3, should evict key2
      smallCache.set('key3', 'value3');

      expect(smallCache.get('key1')).toBe('value1');
      expect(smallCache.get('key2')).toBeUndefined();

      smallCache.destroy();
    });
  });

  describe('memory limits', () => {
    it('should evict entries when memory limit exceeded', () => {
      const memLimitedCache = new BeadsCache({
        maxMemoryBytes: 500, // Small limit
        maxEntries: 100,
        cleanupIntervalMs: 0,
      });

      // Add entries until memory is exceeded
      memLimitedCache.set('key1', 'a'.repeat(100));
      memLimitedCache.set('key2', 'b'.repeat(100));
      memLimitedCache.set('key3', 'c'.repeat(100));
      memLimitedCache.set('key4', 'd'.repeat(100));
      memLimitedCache.set('key5', 'e'.repeat(100));

      // Some early entries should be evicted
      const stats = memLimitedCache.getStats();
      expect(stats.memoryUsageBytes).toBeLessThanOrEqual(500 + 300); // Allow some overhead

      memLimitedCache.destroy();
    });
  });

  describe('statistics', () => {
    it('should track cache hits', () => {
      cache.set('key1', 'value1');
      cache.get('key1');
      cache.get('key1');

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
    });

    it('should track cache misses', () => {
      cache.get('nonexistent1');
      cache.get('nonexistent2');

      const stats = cache.getStats();
      expect(stats.misses).toBe(2);
    });

    it('should calculate hit rate', () => {
      cache.set('key1', 'value1');
      cache.get('key1'); // hit
      cache.get('key1'); // hit
      cache.get('nonexistent'); // miss

      const stats = cache.getStats();
      expect(stats.hitRate).toBeCloseTo(66.67, 1);
    });

    it('should count entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      const stats = cache.getStats();
      expect(stats.entryCount).toBe(3);
    });

    it('should track evictions', () => {
      const smallCache = new BeadsCache({
        maxEntries: 2,
        cleanupIntervalMs: 0,
      });

      smallCache.set('key1', 'value1');
      smallCache.set('key2', 'value2');
      smallCache.set('key3', 'value3'); // evicts key1
      smallCache.set('key4', 'value4'); // evicts key2

      const stats = smallCache.getStats();
      expect(stats.evictions).toBe(2);

      smallCache.destroy();
    });
  });

  describe('getOrSet', () => {
    it('should return cached value without calling fetcher', async () => {
      cache.set('key1', 'cached');
      const fetcher = vi.fn().mockResolvedValue('fresh');

      const result = await cache.getOrSet('key1', fetcher);

      expect(result).toBe('cached');
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('should call fetcher and cache result on miss', async () => {
      const fetcher = vi.fn().mockResolvedValue('fresh');

      const result = await cache.getOrSet('key1', fetcher);

      expect(result).toBe('fresh');
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(cache.get('key1')).toBe('fresh');
    });

    it('should use custom TTL for fetched value', async () => {
      const fetcher = vi.fn().mockResolvedValue('fresh');

      await cache.getOrSet('key1', fetcher, 50);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(cache.get('key1')).toBeUndefined();
    });
  });

  describe('invalidation', () => {
    it('should invalidate entries by prefix', () => {
      cache.set('list:status=open', []);
      cache.set('list:status=closed', []);
      cache.set('ready:limit=5', []);

      const count = cache.invalidatePrefix('list');

      expect(count).toBe(2);
      expect(cache.has('list:status=open')).toBe(false);
      expect(cache.has('list:status=closed')).toBe(false);
      expect(cache.has('ready:limit=5')).toBe(true);
    });

    it('should invalidate all related caches for an issue', () => {
      cache.set('issue:bd-a1b2', createMockIssue('bd-a1b2'));
      cache.set('dep:bd-a1b2', {});
      cache.set('epic:bd-a1b2', {});
      cache.set('list:status=open', []);
      cache.set('ready:limit=5', []);
      cache.set('stats', {});

      cache.invalidateIssue('bd-a1b2');

      expect(cache.has('issue:bd-a1b2')).toBe(false);
      expect(cache.has('dep:bd-a1b2')).toBe(false);
      expect(cache.has('epic:bd-a1b2')).toBe(false);
      expect(cache.has('list:status=open')).toBe(false);
      expect(cache.has('ready:limit=5')).toBe(false);
      expect(cache.has('stats')).toBe(false);
    });
  });
});

describe('Cache Key Generation', () => {
  describe('generateCacheKey', () => {
    it('should generate key with prefix only for empty params', () => {
      expect(generateCacheKey('test')).toBe('test');
      expect(generateCacheKey('test', {})).toBe('test');
    });

    it('should include params in key', () => {
      const key = generateCacheKey('test', { status: 'open', priority: 1 });
      expect(key).toContain('status=open');
      expect(key).toContain('priority=1');
    });

    it('should sort keys for deterministic output', () => {
      const key1 = generateCacheKey('test', { b: '2', a: '1' });
      const key2 = generateCacheKey('test', { a: '1', b: '2' });
      expect(key1).toBe(key2);
    });

    it('should handle array values', () => {
      const key = generateCacheKey('test', { labels: ['bug', 'api'] });
      expect(key).toContain('labels=api,bug');
    });

    it('should skip null and undefined values', () => {
      const key = generateCacheKey('test', {
        status: 'open',
        priority: undefined,
        assignee: null,
      });
      expect(key).toContain('status=open');
      expect(key).not.toContain('priority');
      expect(key).not.toContain('assignee');
    });
  });

  describe('specific key generators', () => {
    it('should generate list cache key', () => {
      const params: BeadsListParams = { status: 'open', limit: 10 };
      const key = listCacheKey(params);
      expect(key).toContain('list');
      expect(key).toContain('status=open');
    });

    it('should generate ready cache key', () => {
      const key = readyCacheKey({ limit: 5, priority: 1 });
      expect(key).toContain('ready');
    });

    it('should generate issue cache key', () => {
      expect(issueCacheKey('bd-a1b2')).toBe('issue:bd-a1b2');
    });

    it('should generate dependency cache key', () => {
      expect(dependencyCacheKey('bd-a1b2')).toBe('dep:bd-a1b2');
    });

    it('should generate epic cache key', () => {
      expect(epicCacheKey('bd-epic')).toBe('epic:bd-epic');
    });
  });
});

describe('CachedBeadsWrapper', () => {
  let cachedWrapper: CachedBeadsWrapper;
  let mockWrapper: {
    list: ReturnType<typeof vi.fn>;
    ready: ReturnType<typeof vi.fn>;
    show: ReturnType<typeof vi.fn>;
    stats: ReturnType<typeof vi.fn>;
    depTree: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockWrapper = {
      list: vi.fn().mockResolvedValue({
        success: true,
        data: [createMockIssue('bd-1'), createMockIssue('bd-2')],
      }),
      ready: vi.fn().mockResolvedValue({
        success: true,
        data: [createMockIssue('bd-ready')],
      }),
      show: vi.fn().mockResolvedValue({
        success: true,
        data: createMockIssue('bd-show'),
      }),
      stats: vi.fn().mockResolvedValue({
        success: true,
        data: { total: 10, open: 5, in_progress: 2, closed: 3 },
      }),
      depTree: vi.fn().mockResolvedValue({
        success: true,
        data: {},
      }),
      create: vi.fn().mockResolvedValue({
        success: true,
        data: createMockIssue('bd-new'),
      }),
      update: vi.fn().mockResolvedValue({
        success: true,
        data: createMockIssue('bd-updated'),
      }),
      close: vi.fn().mockResolvedValue({
        success: true,
        data: createMockIssue('bd-closed'),
      }),
    };

    cachedWrapper = new CachedBeadsWrapper(mockWrapper, { cleanupIntervalMs: 0 });
  });

  afterEach(() => {
    cachedWrapper.destroy();
    vi.restoreAllMocks();
  });

  describe('read operations caching', () => {
    it('should cache list results', async () => {
      await cachedWrapper.list({ status: 'open' });
      await cachedWrapper.list({ status: 'open' });

      expect(mockWrapper.list).toHaveBeenCalledTimes(1);
    });

    it('should cache with different params separately', async () => {
      await cachedWrapper.list({ status: 'open' });
      await cachedWrapper.list({ status: 'closed' });

      expect(mockWrapper.list).toHaveBeenCalledTimes(2);
    });

    it('should cache ready results', async () => {
      await cachedWrapper.ready({ limit: 5 });
      await cachedWrapper.ready({ limit: 5 });

      expect(mockWrapper.ready).toHaveBeenCalledTimes(1);
    });

    it('should cache show results', async () => {
      await cachedWrapper.show('bd-a1b2');
      await cachedWrapper.show('bd-a1b2');

      expect(mockWrapper.show).toHaveBeenCalledTimes(1);
    });

    it('should cache stats results', async () => {
      await cachedWrapper.stats();
      await cachedWrapper.stats();

      expect(mockWrapper.stats).toHaveBeenCalledTimes(1);
    });

    it('should cache depTree results', async () => {
      await cachedWrapper.depTree('bd-a1b2');
      await cachedWrapper.depTree('bd-a1b2');

      expect(mockWrapper.depTree).toHaveBeenCalledTimes(1);
    });
  });

  describe('write operations cache invalidation', () => {
    it('should invalidate caches on create', async () => {
      await cachedWrapper.list({ status: 'open' });
      await cachedWrapper.create({ title: 'New Issue' });
      await cachedWrapper.list({ status: 'open' });

      expect(mockWrapper.list).toHaveBeenCalledTimes(2);
    });

    it('should invalidate related caches on update', async () => {
      await cachedWrapper.show('bd-a1b2');
      await cachedWrapper.list({ status: 'open' });
      await cachedWrapper.update({ id: 'bd-a1b2', status: 'closed' });
      await cachedWrapper.show('bd-a1b2');
      await cachedWrapper.list({ status: 'open' });

      expect(mockWrapper.show).toHaveBeenCalledTimes(2);
      expect(mockWrapper.list).toHaveBeenCalledTimes(2);
    });

    it('should invalidate related caches on close', async () => {
      await cachedWrapper.show('bd-a1b2');
      await cachedWrapper.close({ id: 'bd-a1b2', reason: 'done' });
      await cachedWrapper.show('bd-a1b2');

      expect(mockWrapper.show).toHaveBeenCalledTimes(2);
    });
  });

  describe('cache statistics', () => {
    it('should provide cache statistics', async () => {
      await cachedWrapper.list({ status: 'open' });
      await cachedWrapper.list({ status: 'open' }); // hit
      await cachedWrapper.list({ status: 'closed' }); // miss

      const stats = cachedWrapper.getCacheStats();
      expect(stats.hits).toBeGreaterThanOrEqual(1);
      expect(stats.entryCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('cache control', () => {
    it('should allow manual cache clearing', async () => {
      await cachedWrapper.list({ status: 'open' });
      cachedWrapper.clearCache();
      await cachedWrapper.list({ status: 'open' });

      expect(mockWrapper.list).toHaveBeenCalledTimes(2);
    });
  });
});

describe('Performance Benchmarks', () => {
  describe('cache performance targets', () => {
    it('should achieve <100ms for cached task sync', async () => {
      const cache = new BeadsCache({ cleanupIntervalMs: 0 });
      const issues = Array.from({ length: 100 }, (_, i) =>
        createMockIssue(`bd-${i}`, `Issue ${i}`)
      );
      cache.set('list:all', issues);

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        cache.get('list:all');
      }
      const duration = performance.now() - start;

      // 1000 operations should complete in <100ms
      expect(duration).toBeLessThan(100);

      cache.destroy();
    });

    it('should achieve <50ms for cached epic status query', async () => {
      const cache = new BeadsCache({ cleanupIntervalMs: 0 });
      const epicStatus = {
        totalChildren: 10,
        completedChildren: 5,
        percentComplete: 50,
      };
      cache.set('epic:bd-epic', epicStatus);

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        cache.get('epic:bd-epic');
      }
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(50);

      cache.destroy();
    });

    it('should achieve <20ms for cached dependency resolution', async () => {
      const cache = new BeadsCache({ cleanupIntervalMs: 0 });
      const dependencies = ['bd-1', 'bd-2', 'bd-3'];
      cache.set('dep:bd-a1b2', dependencies);

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        cache.get('dep:bd-a1b2');
      }
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(20);

      cache.destroy();
    });

    it('should stay under 10MB memory for typical workload', () => {
      const cache = new BeadsCache({
        maxMemoryBytes: 10 * 1024 * 1024, // 10MB
        cleanupIntervalMs: 0,
      });

      // Simulate typical workload: 500 issues, 100 lists, 50 epics
      for (let i = 0; i < 500; i++) {
        cache.set(`issue:bd-${i}`, createMockIssue(`bd-${i}`));
      }
      for (let i = 0; i < 100; i++) {
        cache.set(
          `list:query-${i}`,
          Array.from({ length: 20 }, (_, j) => createMockIssue(`bd-list-${i}-${j}`))
        );
      }
      for (let i = 0; i < 50; i++) {
        cache.set(`epic:bd-epic-${i}`, {
          children: Array.from({ length: 10 }, (_, j) => createMockIssue(`bd-child-${j}`)),
        });
      }

      const stats = cache.getStats();
      expect(stats.memoryUsageBytes).toBeLessThan(10 * 1024 * 1024);

      cache.destroy();
    });
  });
});

describe('TTL Presets', () => {
  it('should have appropriate TTLs for different query types', () => {
    // Issue details need moderate freshness
    expect(TTL_PRESETS.ISSUE).toBe(30000);

    // List can be slightly stale
    expect(TTL_PRESETS.LIST).toBeLessThan(TTL_PRESETS.ISSUE);

    // Ready work needs to be fresh
    expect(TTL_PRESETS.READY).toBeLessThan(TTL_PRESETS.LIST);

    // Stats can be stale
    expect(TTL_PRESETS.STATS).toBeGreaterThan(TTL_PRESETS.ISSUE);

    // Dependencies need accuracy
    expect(TTL_PRESETS.DEPENDENCY).toBeLessThan(TTL_PRESETS.READY);
  });
});

describe('createCachedWrapper factory', () => {
  it('should create a CachedBeadsWrapper instance', () => {
    const mockWrapper = {
      list: vi.fn(),
      ready: vi.fn(),
      show: vi.fn(),
      stats: vi.fn(),
      depTree: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      close: vi.fn(),
    };

    const wrapper = createCachedWrapper(mockWrapper);
    expect(wrapper).toBeInstanceOf(CachedBeadsWrapper);
    wrapper.destroy();
  });
});
