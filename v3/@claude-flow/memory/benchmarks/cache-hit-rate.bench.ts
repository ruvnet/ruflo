/**
 * Cache Hit Rate Benchmark
 *
 * Target: <0.1ms for cache hits
 *
 * Measures cache performance including hit rate,
 * lookup time, and eviction strategies.
 */

import { benchmark, BenchmarkRunner, formatTime, meetsTarget } from '../framework/benchmark.js';

// ============================================================================
// Cache Implementations
// ============================================================================

/**
 * Simple LRU Cache implementation
 */
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;
  private hits = 0;
  private misses = 0;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
      this.hits++;
      return value;
    }
    this.misses++;
    return undefined;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest (first) entry
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  get hitRate(): number {
    const total = this.hits + this.misses;
    return total > 0 ? this.hits / total : 0;
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

/**
 * TTL Cache with expiration
 */
class TTLCache<K, V> {
  private cache = new Map<K, { value: V; expiry: number }>();
  private defaultTTL: number;
  private hits = 0;
  private misses = 0;

  constructor(defaultTTL: number = 60000) {
    this.defaultTTL = defaultTTL;
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (entry !== undefined) {
      if (Date.now() < entry.expiry) {
        this.hits++;
        return entry.value;
      }
      // Expired
      this.cache.delete(key);
    }
    this.misses++;
    return undefined;
  }

  set(key: K, value: V, ttl?: number): void {
    const expiry = Date.now() + (ttl || this.defaultTTL);
    this.cache.set(key, { value, expiry });
  }

  get hitRate(): number {
    const total = this.hits + this.misses;
    return total > 0 ? this.hits / total : 0;
  }

  get size(): number {
    return this.cache.size;
  }

  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.cache) {
      if (now >= entry.expiry) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

/**
 * Two-level cache (L1 fast, L2 larger)
 */
class TwoLevelCache<K, V> {
  private l1: LRUCache<K, V>;
  private l2: LRUCache<K, V>;
  private l1Hits = 0;
  private l2Hits = 0;
  private misses = 0;

  constructor(l1Size: number = 100, l2Size: number = 1000) {
    this.l1 = new LRUCache<K, V>(l1Size);
    this.l2 = new LRUCache<K, V>(l2Size);
  }

  get(key: K): V | undefined {
    // Check L1 first
    let value = this.l1.get(key);
    if (value !== undefined) {
      this.l1Hits++;
      return value;
    }

    // Check L2
    value = this.l2.get(key);
    if (value !== undefined) {
      this.l2Hits++;
      // Promote to L1
      this.l1.set(key, value);
      return value;
    }

    this.misses++;
    return undefined;
  }

  set(key: K, value: V): void {
    this.l1.set(key, value);
    this.l2.set(key, value);
  }

  get stats(): { l1HitRate: number; l2HitRate: number; missRate: number } {
    const total = this.l1Hits + this.l2Hits + this.misses;
    return {
      l1HitRate: total > 0 ? this.l1Hits / total : 0,
      l2HitRate: total > 0 ? this.l2Hits / total : 0,
      missRate: total > 0 ? this.misses / total : 0,
    };
  }

  clear(): void {
    this.l1.clear();
    this.l2.clear();
    this.l1Hits = 0;
    this.l2Hits = 0;
    this.misses = 0;
  }
}

/**
 * Memoization cache for function results
 */
class MemoCache<T extends (...args: unknown[]) => unknown> {
  private cache = new Map<string, ReturnType<T>>();
  private fn: T;

  constructor(fn: T) {
    this.fn = fn;
  }

  call(...args: Parameters<T>): ReturnType<T> {
    const key = JSON.stringify(args);
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }
    const result = this.fn(...args) as ReturnType<T>;
    this.cache.set(key, result);
    return result;
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }
}

// ============================================================================
// Benchmark Suite
// ============================================================================

export async function runCacheHitRateBenchmarks(): Promise<void> {
  const runner = new BenchmarkRunner('Cache Hit Rate');

  console.log('\n--- Cache Hit Rate Benchmarks ---\n');

  // Prepare test data
  const testKeys = Array.from({ length: 10000 }, (_, i) => `key-${i}`);
  const testValues = testKeys.map((k) => ({ key: k, data: Math.random() }));

  // Benchmark 1: LRU Cache - Cache Hit
  const lruCache = new LRUCache<string, object>(1000);

  // Pre-populate cache
  for (let i = 0; i < 1000; i++) {
    lruCache.set(testKeys[i]!, testValues[i]!);
  }

  const lruHitResult = await runner.run(
    'lru-cache-hit',
    async () => {
      lruCache.get(testKeys[500]!);
    },
    { iterations: 100000 }
  );

  console.log(`LRU Cache Hit: ${formatTime(lruHitResult.mean)}`);
  const hitTarget = meetsTarget('cache-hit', lruHitResult.mean);
  console.log(`  Target (<0.1ms): ${hitTarget.met ? 'PASS' : 'FAIL'}`);

  // Benchmark 2: LRU Cache - Cache Miss
  const lruMissResult = await runner.run(
    'lru-cache-miss',
    async () => {
      lruCache.get('non-existent-key');
    },
    { iterations: 100000 }
  );

  console.log(`LRU Cache Miss: ${formatTime(lruMissResult.mean)}`);

  // Benchmark 3: LRU Cache - Set Operation
  const lruSetResult = await runner.run(
    'lru-cache-set',
    async () => {
      lruCache.set(`new-key-${Date.now()}`, { data: 'test' });
    },
    { iterations: 10000 }
  );

  console.log(`LRU Cache Set: ${formatTime(lruSetResult.mean)}`);

  // Benchmark 4: TTL Cache - Hit
  const ttlCache = new TTLCache<string, object>(60000);

  for (let i = 0; i < 1000; i++) {
    ttlCache.set(testKeys[i]!, testValues[i]!);
  }

  const ttlHitResult = await runner.run(
    'ttl-cache-hit',
    async () => {
      ttlCache.get(testKeys[500]!);
    },
    { iterations: 100000 }
  );

  console.log(`TTL Cache Hit: ${formatTime(ttlHitResult.mean)}`);

  // Benchmark 5: TTL Cache - Cleanup
  // Add some expired entries
  for (let i = 0; i < 100; i++) {
    ttlCache.set(`expired-${i}`, { data: i }, -1); // Already expired
  }

  const ttlCleanupResult = await runner.run(
    'ttl-cache-cleanup',
    async () => {
      ttlCache.cleanup();
    },
    { iterations: 1000 }
  );

  console.log(`TTL Cache Cleanup: ${formatTime(ttlCleanupResult.mean)}`);

  // Benchmark 6: Two-Level Cache - L1 Hit
  const twoLevelCache = new TwoLevelCache<string, object>(100, 1000);

  for (let i = 0; i < 1000; i++) {
    twoLevelCache.set(testKeys[i]!, testValues[i]!);
  }

  // Warm up L1
  for (let i = 0; i < 50; i++) {
    twoLevelCache.get(testKeys[i]!);
  }

  const l1HitResult = await runner.run(
    'two-level-cache-l1-hit',
    async () => {
      twoLevelCache.get(testKeys[25]!);
    },
    { iterations: 100000 }
  );

  console.log(`Two-Level Cache L1 Hit: ${formatTime(l1HitResult.mean)}`);

  // Benchmark 7: Two-Level Cache - L2 Hit (promotes to L1)
  const l2HitResult = await runner.run(
    'two-level-cache-l2-hit',
    async () => {
      twoLevelCache.get(testKeys[500]!);
    },
    { iterations: 50000 }
  );

  console.log(`Two-Level Cache L2 Hit: ${formatTime(l2HitResult.mean)}`);

  // Benchmark 8: Memoization Cache
  const expensiveFn = (n: number): number => {
    let result = 0;
    for (let i = 0; i < n; i++) {
      result += Math.sqrt(i);
    }
    return result;
  };

  const memoCache = new MemoCache(expensiveFn);

  // Prime the cache
  memoCache.call(1000);

  const memoHitResult = await runner.run(
    'memo-cache-hit',
    async () => {
      memoCache.call(1000);
    },
    { iterations: 100000 }
  );

  console.log(`Memo Cache Hit: ${formatTime(memoHitResult.mean)}`);

  const memoMissResult = await runner.run(
    'memo-cache-miss',
    async () => {
      memoCache.call(Math.floor(Math.random() * 10000000));
    },
    { iterations: 100 }
  );

  console.log(`Memo Cache Miss (compute): ${formatTime(memoMissResult.mean)}`);

  // Benchmark 9: Cache with Different Hit Rates
  const cache90 = new LRUCache<string, object>(1000);
  for (let i = 0; i < 1000; i++) {
    cache90.set(testKeys[i]!, testValues[i]!);
  }

  const hitRate90Result = await runner.run(
    'workload-90-percent-hits',
    async () => {
      const isHit = Math.random() < 0.9;
      if (isHit) {
        cache90.get(testKeys[Math.floor(Math.random() * 1000)]!);
      } else {
        cache90.get(`miss-${Date.now()}`);
      }
    },
    { iterations: 10000 }
  );

  console.log(`90% Hit Rate Workload: ${formatTime(hitRate90Result.mean)}`);

  // Benchmark 10: Cache Eviction Under Pressure
  const smallCache = new LRUCache<string, object>(100);

  const evictionResult = await runner.run(
    'cache-with-eviction',
    async () => {
      // Write 200 items to a cache of size 100
      for (let i = 0; i < 200; i++) {
        smallCache.set(`evict-key-${i}`, { data: i });
      }
    },
    { iterations: 100 }
  );

  console.log(`Cache with Eviction (200 to 100): ${formatTime(evictionResult.mean)}`);

  // Summary
  console.log('\n--- Summary ---');
  console.log(`LRU hit: ${formatTime(lruHitResult.mean)} (${lruHitResult.opsPerSecond.toFixed(0)} ops/sec)`);
  console.log(`LRU miss: ${formatTime(lruMissResult.mean)}`);
  console.log(`TTL hit: ${formatTime(ttlHitResult.mean)}`);
  console.log(`L1 hit: ${formatTime(l1HitResult.mean)}`);
  console.log(`L2 hit: ${formatTime(l2HitResult.mean)}`);
  console.log(`Memo hit: ${formatTime(memoHitResult.mean)}`);
  console.log(`\nTwo-Level Cache Stats:`, twoLevelCache.stats);

  // Print full results
  runner.printResults();
}

// ============================================================================
// Cache Optimization Strategies
// ============================================================================

export const cacheOptimizations = {
  /**
   * Optimal cache sizing
   */
  optimalSizing: {
    description: 'Size cache based on working set and memory constraints',
    expectedImprovement: '20-50% hit rate',
    implementation: `
      function calculateOptimalCacheSize(workingSetSize: number, memoryLimit: number): number {
        const avgItemSize = estimateAverageItemSize();
        const maxItems = Math.floor(memoryLimit / avgItemSize);
        return Math.min(workingSetSize * 0.8, maxItems);
      }
    `,
  },

  /**
   * Adaptive TTL
   */
  adaptiveTTL: {
    description: 'Adjust TTL based on access patterns',
    expectedImprovement: '10-30% hit rate',
    implementation: `
      class AdaptiveTTLCache {
        private accessCounts = new Map<string, number>();

        getTTL(key: string): number {
          const count = this.accessCounts.get(key) || 0;
          // Hot keys get longer TTL
          return this.baseTTL * Math.min(10, 1 + Math.log2(count + 1));
        }
      }
    `,
  },

  /**
   * Probabilistic early expiration
   */
  probabilisticExpiry: {
    description: 'Refresh items before expiry to avoid thundering herd',
    expectedImprovement: 'Reduces load spikes by 80%',
    implementation: `
      function shouldRefresh(ttl: number, remaining: number): boolean {
        const beta = 1.0;
        const delta = ttl - remaining;
        const xFetch = Date.now() + delta * beta * Math.log(Math.random());
        return xFetch > Date.now() + remaining;
      }
    `,
  },

  /**
   * Segmented cache
   */
  segmentedCache: {
    description: 'Reduce lock contention with segmented caches',
    expectedImprovement: '2-4x concurrent performance',
    implementation: `
      class SegmentedCache<K, V> {
        private segments: LRUCache<K, V>[];

        constructor(numSegments: number, sizePerSegment: number) {
          this.segments = Array.from(
            { length: numSegments },
            () => new LRUCache<K, V>(sizePerSegment)
          );
        }

        private getSegment(key: K): LRUCache<K, V> {
          const hash = this.hash(key);
          return this.segments[hash % this.segments.length]!;
        }
      }
    `,
  },

  /**
   * Read-through caching
   */
  readThrough: {
    description: 'Automatically fetch missing items',
    expectedImprovement: 'Simplifies code, consistent performance',
    implementation: `
      class ReadThroughCache<K, V> {
        constructor(
          private cache: LRUCache<K, V>,
          private loader: (key: K) => Promise<V>
        ) {}

        async get(key: K): Promise<V> {
          let value = this.cache.get(key);
          if (value === undefined) {
            value = await this.loader(key);
            this.cache.set(key, value);
          }
          return value;
        }
      }
    `,
  },
};

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runCacheHitRateBenchmarks().catch(console.error);
}

export default runCacheHitRateBenchmarks;
