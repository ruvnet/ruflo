/**
 * Beads Cache Layer
 *
 * High-performance LRU cache with TTL support for Beads queries.
 * Implements caching strategies optimized for the performance targets:
 * - Task sync latency: <100ms
 * - Epic status query: <50ms
 * - Dependency resolution: <20ms
 * - Memory overhead: <10MB
 *
 * @see https://github.com/steveyegge/beads
 */

import type {
  BeadsIssue,
  BeadsStats,
  BeadsListParams,
  BeadsReadyParams,
} from './types.js';

// ============================================
// Types
// ============================================

/**
 * Cache entry with metadata
 */
interface CacheEntry<T> {
  /** Cached value */
  value: T;
  /** Timestamp when entry was created */
  createdAt: number;
  /** Timestamp when entry expires */
  expiresAt: number;
  /** Access count for statistics */
  accessCount: number;
  /** Last access timestamp */
  lastAccessedAt: number;
  /** Size estimate in bytes */
  sizeBytes: number;
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  /** Total number of cache hits */
  hits: number;
  /** Total number of cache misses */
  misses: number;
  /** Hit rate percentage (0-100) */
  hitRate: number;
  /** Current number of entries */
  entryCount: number;
  /** Estimated memory usage in bytes */
  memoryUsageBytes: number;
  /** Number of evictions */
  evictions: number;
  /** Average entry age in milliseconds */
  averageAgeMs: number;
}

/**
 * Configuration for the cache
 */
export interface CacheConfig {
  /** Maximum number of entries (default: 1000) */
  maxEntries: number;
  /** Default TTL in milliseconds (default: 30000 = 30s) */
  defaultTtlMs: number;
  /** Maximum memory in bytes (default: 10MB) */
  maxMemoryBytes: number;
  /** Enable statistics tracking (default: true) */
  enableStats: boolean;
  /** Cleanup interval in milliseconds (default: 60000 = 1min) */
  cleanupIntervalMs: number;
}

/**
 * Default cache configuration
 */
export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  maxEntries: 1000,
  defaultTtlMs: 30000, // 30 seconds
  maxMemoryBytes: 10 * 1024 * 1024, // 10MB target from PRD
  enableStats: true,
  cleanupIntervalMs: 60000, // 1 minute
};

/**
 * TTL presets for different query types
 */
export const TTL_PRESETS = {
  /** Issue details - moderate freshness needed */
  ISSUE: 30000, // 30s
  /** Issue list - can be slightly stale */
  LIST: 15000, // 15s
  /** Ready work - needs to be fresh */
  READY: 10000, // 10s
  /** Statistics - can be stale */
  STATS: 60000, // 60s
  /** Dependency resolution - critical for accuracy */
  DEPENDENCY: 5000, // 5s
  /** Epic status - moderate freshness */
  EPIC: 20000, // 20s
} as const;

// ============================================
// Cache Key Generation
// ============================================

/**
 * Generate a cache key from parameters
 * Uses a deterministic serialization for consistent keys
 */
export function generateCacheKey(prefix: string, params?: Record<string, unknown>): string {
  if (!params || Object.keys(params).length === 0) {
    return prefix;
  }

  // Sort keys for deterministic key generation
  const sortedKeys = Object.keys(params).sort();
  const parts = sortedKeys
    .filter((key) => params[key] !== undefined && params[key] !== null)
    .map((key) => {
      const value = params[key];
      if (Array.isArray(value)) {
        return `${key}=${[...value].sort().join(',')}`;
      }
      return `${key}=${String(value)}`;
    });

  return parts.length > 0 ? `${prefix}:${parts.join('&')}` : prefix;
}

/**
 * Generate cache key for list queries
 */
export function listCacheKey(params?: BeadsListParams): string {
  return generateCacheKey('list', params as Record<string, unknown>);
}

/**
 * Generate cache key for ready queries
 */
export function readyCacheKey(params?: BeadsReadyParams): string {
  return generateCacheKey('ready', params as Record<string, unknown>);
}

/**
 * Generate cache key for single issue
 */
export function issueCacheKey(id: string): string {
  return `issue:${id}`;
}

/**
 * Generate cache key for dependency tree
 */
export function dependencyCacheKey(id: string): string {
  return `dep:${id}`;
}

/**
 * Generate cache key for epic status
 */
export function epicCacheKey(id: string): string {
  return `epic:${id}`;
}

// ============================================
// LRU Cache Implementation
// ============================================

/**
 * BeadsCache - High-performance LRU cache with TTL support
 *
 * Features:
 * - LRU eviction policy
 * - TTL-based expiration
 * - Memory limit enforcement
 * - Statistics tracking
 * - Automatic cleanup
 */
export class BeadsCache {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private config: CacheConfig;
  private stats: {
    hits: number;
    misses: number;
    evictions: number;
  };
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private totalMemoryBytes: number = 0;

  constructor(config?: Partial<CacheConfig>) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
    };

    // Start cleanup timer
    if (this.config.cleanupIntervalMs > 0) {
      this.startCleanupTimer();
    }
  }

  /**
   * Get a value from the cache
   * @returns The cached value or undefined if not found/expired
   */
  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      if (this.config.enableStats) {
        this.stats.misses++;
      }
      return undefined;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      if (this.config.enableStats) {
        this.stats.misses++;
      }
      return undefined;
    }

    // Update access metadata (LRU tracking)
    entry.accessCount++;
    entry.lastAccessedAt = Date.now();

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    if (this.config.enableStats) {
      this.stats.hits++;
    }

    return entry.value as T;
  }

  /**
   * Set a value in the cache
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttlMs - Optional TTL in milliseconds (uses default if not specified)
   */
  set<T>(key: string, value: T, ttlMs?: number): void {
    const now = Date.now();
    const effectiveTtl = ttlMs ?? this.config.defaultTtlMs;
    const sizeBytes = this.estimateSize(value);

    // Evict if necessary before adding
    this.ensureCapacity(sizeBytes);

    const entry: CacheEntry<T> = {
      value,
      createdAt: now,
      expiresAt: now + effectiveTtl,
      accessCount: 1,
      lastAccessedAt: now,
      sizeBytes,
    };

    // Update or add entry
    const existingEntry = this.cache.get(key);
    if (existingEntry) {
      this.totalMemoryBytes -= existingEntry.sizeBytes;
    }

    this.cache.set(key, entry);
    this.totalMemoryBytes += sizeBytes;
  }

  /**
   * Delete a value from the cache
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      this.totalMemoryBytes -= entry.sizeBytes;
      return this.cache.delete(key);
    }
    return false;
  }

  /**
   * Check if a key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.clear();
    this.totalMemoryBytes = 0;
  }

  /**
   * Get or set pattern - fetches from cache or executes fetcher
   * @param key - Cache key
   * @param fetcher - Async function to fetch value if not cached
   * @param ttlMs - Optional TTL in milliseconds
   */
  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlMs?: number
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await fetcher();
    this.set(key, value, ttlMs);
    return value;
  }

  /**
   * Invalidate entries matching a prefix
   * Useful for invalidating all list queries when data changes
   */
  invalidatePrefix(prefix: string): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Invalidate entries related to a specific issue
   * Called when an issue is created, updated, or deleted
   */
  invalidateIssue(issueId: string): void {
    // Delete the specific issue cache
    this.delete(issueCacheKey(issueId));
    this.delete(dependencyCacheKey(issueId));

    // Check if it's an epic
    this.delete(epicCacheKey(issueId));

    // Invalidate all list and ready caches since they might include this issue
    this.invalidatePrefix('list');
    this.invalidatePrefix('ready');
    this.invalidatePrefix('stats');
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const now = Date.now();
    let totalAge = 0;
    let count = 0;

    for (const entry of this.cache.values()) {
      if (now <= entry.expiresAt) {
        totalAge += now - entry.createdAt;
        count++;
      }
    }

    const total = this.stats.hits + this.stats.misses;

    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: total > 0 ? (this.stats.hits / total) * 100 : 0,
      entryCount: this.cache.size,
      memoryUsageBytes: this.totalMemoryBytes,
      evictions: this.stats.evictions,
      averageAgeMs: count > 0 ? totalAge / count : 0,
    };
  }

  /**
   * Stop the cleanup timer
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.clear();
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Start the automatic cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, this.config.cleanupIntervalMs);

    // Ensure timer doesn't prevent process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Remove expired entries
   */
  private cleanupExpired(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.delete(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Ensure there's capacity for new entry
   */
  private ensureCapacity(newEntrySize: number): void {
    // Check entry count limit
    while (this.cache.size >= this.config.maxEntries) {
      this.evictLRU();
    }

    // Check memory limit
    while (
      this.totalMemoryBytes + newEntrySize > this.config.maxMemoryBytes &&
      this.cache.size > 0
    ) {
      this.evictLRU();
    }
  }

  /**
   * Evict the least recently used entry
   */
  private evictLRU(): void {
    // Map maintains insertion order, first entry is oldest
    const firstKey = this.cache.keys().next().value;
    if (firstKey !== undefined) {
      this.delete(firstKey);
      if (this.config.enableStats) {
        this.stats.evictions++;
      }
    }
  }

  /**
   * Estimate the memory size of a value
   */
  private estimateSize(value: unknown): number {
    if (value === null || value === undefined) {
      return 8;
    }

    if (typeof value === 'string') {
      return value.length * 2 + 40; // UTF-16 + object overhead
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return 16;
    }

    if (Array.isArray(value)) {
      let size = 40; // Array overhead
      for (const item of value) {
        size += this.estimateSize(item);
      }
      return size;
    }

    if (typeof value === 'object') {
      let size = 40; // Object overhead
      for (const key of Object.keys(value)) {
        size += key.length * 2 + 16; // Key string + reference
        size += this.estimateSize((value as Record<string, unknown>)[key]);
      }
      return size;
    }

    return 32; // Default estimate
  }
}

// ============================================
// Cached Beads Wrapper
// ============================================

/**
 * CachedBeadsWrapper wraps a BeadsCliWrapper with caching
 *
 * Provides transparent caching for all read operations while
 * automatically invalidating on write operations.
 */
export class CachedBeadsWrapper {
  private cache: BeadsCache;

  constructor(
    private wrapper: {
      list: (params?: BeadsListParams) => Promise<{ success: boolean; data?: BeadsIssue[] }>;
      ready: (params?: BeadsReadyParams) => Promise<{ success: boolean; data?: BeadsIssue[] }>;
      show: (params: { id: string }) => Promise<{ success: boolean; data?: BeadsIssue }>;
      stats: () => Promise<{ success: boolean; data?: BeadsStats }>;
      depTree: (params: { id: string }) => Promise<{ success: boolean; data?: unknown }>;
      create: (params: unknown) => Promise<{ success: boolean; data?: BeadsIssue }>;
      update: (params: { id: string } & Record<string, unknown>) => Promise<{ success: boolean; data?: BeadsIssue }>;
      close: (params: { id: string } & Record<string, unknown>) => Promise<{ success: boolean; data?: BeadsIssue }>;
    },
    cacheConfig?: Partial<CacheConfig>
  ) {
    this.cache = new BeadsCache(cacheConfig);
  }

  /**
   * List issues with caching
   */
  async list(params?: BeadsListParams): Promise<{ success: boolean; data?: BeadsIssue[] }> {
    const key = listCacheKey(params);
    return this.cache.getOrSet(
      key,
      () => this.wrapper.list(params),
      TTL_PRESETS.LIST
    );
  }

  /**
   * Get ready issues with caching
   */
  async ready(params?: BeadsReadyParams): Promise<{ success: boolean; data?: BeadsIssue[] }> {
    const key = readyCacheKey(params);
    return this.cache.getOrSet(
      key,
      () => this.wrapper.ready(params),
      TTL_PRESETS.READY
    );
  }

  /**
   * Show single issue with caching
   */
  async show(id: string): Promise<{ success: boolean; data?: BeadsIssue }> {
    const key = issueCacheKey(id);
    return this.cache.getOrSet(
      key,
      () => this.wrapper.show({ id }),
      TTL_PRESETS.ISSUE
    );
  }

  /**
   * Get stats with caching
   */
  async stats(): Promise<{ success: boolean; data?: BeadsStats }> {
    const key = 'stats';
    return this.cache.getOrSet(
      key,
      () => this.wrapper.stats(),
      TTL_PRESETS.STATS
    );
  }

  /**
   * Get dependency tree with caching
   */
  async depTree(id: string): Promise<{ success: boolean; data?: unknown }> {
    const key = dependencyCacheKey(id);
    return this.cache.getOrSet(
      key,
      () => this.wrapper.depTree({ id }),
      TTL_PRESETS.DEPENDENCY
    );
  }

  /**
   * Create issue - invalidates relevant caches
   */
  async create(params: unknown): Promise<{ success: boolean; data?: BeadsIssue }> {
    const result = await this.wrapper.create(params);
    if (result.success && result.data) {
      // Invalidate list caches since new issue might appear in results
      this.cache.invalidatePrefix('list');
      this.cache.invalidatePrefix('ready');
      this.cache.delete('stats');
    }
    return result;
  }

  /**
   * Update issue - invalidates relevant caches
   */
  async update(params: { id: string } & Record<string, unknown>): Promise<{ success: boolean; data?: BeadsIssue }> {
    const result = await this.wrapper.update(params);
    if (result.success) {
      this.cache.invalidateIssue(params.id);
    }
    return result;
  }

  /**
   * Close issue - invalidates relevant caches
   */
  async close(params: { id: string } & Record<string, unknown>): Promise<{ success: boolean; data?: BeadsIssue }> {
    const result = await this.wrapper.close(params);
    if (result.success) {
      this.cache.invalidateIssue(params.id);
    }
    return result;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    return this.cache.getStats();
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Destroy the cached wrapper
   */
  destroy(): void {
    this.cache.destroy();
  }
}

/**
 * Factory function to create a cached wrapper
 */
export function createCachedWrapper(
  wrapper: {
    list: (params?: BeadsListParams) => Promise<{ success: boolean; data?: BeadsIssue[] }>;
    ready: (params?: BeadsReadyParams) => Promise<{ success: boolean; data?: BeadsIssue[] }>;
    show: (params: { id: string }) => Promise<{ success: boolean; data?: BeadsIssue }>;
    stats: () => Promise<{ success: boolean; data?: BeadsStats }>;
    depTree: (params: { id: string }) => Promise<{ success: boolean; data?: unknown }>;
    create: (params: unknown) => Promise<{ success: boolean; data?: BeadsIssue }>;
    update: (params: { id: string } & Record<string, unknown>) => Promise<{ success: boolean; data?: BeadsIssue }>;
    close: (params: { id: string } & Record<string, unknown>) => Promise<{ success: boolean; data?: BeadsIssue }>;
  },
  config?: Partial<CacheConfig>
): CachedBeadsWrapper {
  return new CachedBeadsWrapper(wrapper, config);
}
