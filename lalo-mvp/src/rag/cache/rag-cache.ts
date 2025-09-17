import { SearchResult, RAGQuery } from '../../types/index.js';

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  accessCount: number;
  lastAccessed: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
  averageAccessTime: number;
  memoryUsage: number;
}

export class RAGCache {
  private searchCache = new Map<string, CacheEntry<SearchResult[]>>();
  private embeddingCache = new Map<string, CacheEntry<number[]>>();
  private documentCache = new Map<string, CacheEntry<any>>();

  private stats = {
    hits: 0,
    misses: 0,
    totalAccessTime: 0,
    accessCount: 0
  };

  private defaultTTL = 60 * 60 * 1000; // 1 hour
  private maxCacheSize = 1000;

  constructor(options: { defaultTTL?: number; maxCacheSize?: number } = {}) {
    this.defaultTTL = options.defaultTTL || this.defaultTTL;
    this.maxCacheSize = options.maxCacheSize || this.maxCacheSize;

    // Start cleanup interval
    setInterval(() => this.cleanup(), 5 * 60 * 1000); // Cleanup every 5 minutes
  }

  // Search result caching
  async getSearchResults(query: RAGQuery): Promise<SearchResult[] | null> {
    const startTime = Date.now();
    const key = this.generateSearchKey(query);
    const entry = this.searchCache.get(key);

    if (entry && !this.isExpired(entry)) {
      entry.accessCount++;
      entry.lastAccessed = Date.now();

      this.stats.hits++;
      this.stats.totalAccessTime += Date.now() - startTime;
      this.stats.accessCount++;

      return entry.data;
    }

    this.stats.misses++;
    this.stats.totalAccessTime += Date.now() - startTime;
    this.stats.accessCount++;

    return null;
  }

  async setSearchResults(
    query: RAGQuery,
    results: SearchResult[],
    ttl: number = this.defaultTTL
  ): Promise<void> {
    const key = this.generateSearchKey(query);

    this.searchCache.set(key, {
      data: results,
      timestamp: Date.now(),
      ttl,
      accessCount: 0,
      lastAccessed: Date.now()
    });

    this.enforceMaxSize(this.searchCache);
  }

  // Embedding caching
  async getEmbedding(content: string, type: string = 'text'): Promise<number[] | null> {
    const key = this.generateEmbeddingKey(content, type);
    const entry = this.embeddingCache.get(key);

    if (entry && !this.isExpired(entry)) {
      entry.accessCount++;
      entry.lastAccessed = Date.now();
      this.stats.hits++;
      return entry.data;
    }

    this.stats.misses++;
    return null;
  }

  async setEmbedding(
    content: string,
    embedding: number[],
    type: string = 'text',
    ttl: number = this.defaultTTL * 24 // Embeddings can be cached longer
  ): Promise<void> {
    const key = this.generateEmbeddingKey(content, type);

    this.embeddingCache.set(key, {
      data: embedding,
      timestamp: Date.now(),
      ttl,
      accessCount: 0,
      lastAccessed: Date.now()
    });

    this.enforceMaxSize(this.embeddingCache);
  }

  // Document metadata caching
  async getDocument(documentId: string): Promise<any | null> {
    const entry = this.documentCache.get(documentId);

    if (entry && !this.isExpired(entry)) {
      entry.accessCount++;
      entry.lastAccessed = Date.now();
      this.stats.hits++;
      return entry.data;
    }

    this.stats.misses++;
    return null;
  }

  async setDocument(
    documentId: string,
    document: any,
    ttl: number = this.defaultTTL
  ): Promise<void> {
    this.documentCache.set(documentId, {
      data: document,
      timestamp: Date.now(),
      ttl,
      accessCount: 0,
      lastAccessed: Date.now()
    });

    this.enforceMaxSize(this.documentCache);
  }

  // Batch operations
  async getSearchResultsBatch(queries: RAGQuery[]): Promise<(SearchResult[] | null)[]> {
    return Promise.all(queries.map(query => this.getSearchResults(query)));
  }

  async setSearchResultsBatch(
    entries: Array<{ query: RAGQuery; results: SearchResult[]; ttl?: number }>
  ): Promise<void> {
    await Promise.all(
      entries.map(entry =>
        this.setSearchResults(entry.query, entry.results, entry.ttl)
      )
    );
  }

  // Advanced caching strategies
  async getOrCompute<T>(
    key: string,
    computeFn: () => Promise<T>,
    ttl: number = this.defaultTTL,
    cacheType: 'search' | 'embedding' | 'document' = 'document'
  ): Promise<T> {
    let cache: Map<string, CacheEntry<any>>;

    switch (cacheType) {
      case 'search':
        cache = this.searchCache as any;
        break;
      case 'embedding':
        cache = this.embeddingCache as any;
        break;
      default:
        cache = this.documentCache;
    }

    const entry = cache.get(key);

    if (entry && !this.isExpired(entry)) {
      entry.accessCount++;
      entry.lastAccessed = Date.now();
      this.stats.hits++;
      return entry.data;
    }

    this.stats.misses++;
    const result = await computeFn();

    cache.set(key, {
      data: result,
      timestamp: Date.now(),
      ttl,
      accessCount: 0,
      lastAccessed: Date.now()
    });

    this.enforceMaxSize(cache);
    return result;
  }

  // Cache warming
  async warmCache(
    warmingFunctions: Array<{
      key: string;
      computeFn: () => Promise<any>;
      cacheType?: 'search' | 'embedding' | 'document';
      ttl?: number;
    }>
  ): Promise<void> {
    const warmingPromises = warmingFunctions.map(async ({ key, computeFn, cacheType, ttl }) => {
      try {
        await this.getOrCompute(key, computeFn, ttl, cacheType);
      } catch (error) {
        console.warn(`Failed to warm cache for key ${key}:`, error.message);
      }
    });

    await Promise.allSettled(warmingPromises);
  }

  // Invalidation
  invalidateSearch(query?: RAGQuery): void {
    if (query) {
      const key = this.generateSearchKey(query);
      this.searchCache.delete(key);
    } else {
      this.searchCache.clear();
    }
  }

  invalidateEmbedding(content?: string, type?: string): void {
    if (content && type) {
      const key = this.generateEmbeddingKey(content, type);
      this.embeddingCache.delete(key);
    } else {
      this.embeddingCache.clear();
    }
  }

  invalidateDocument(documentId?: string): void {
    if (documentId) {
      this.documentCache.delete(documentId);
    } else {
      this.documentCache.clear();
    }
  }

  invalidateAll(): void {
    this.searchCache.clear();
    this.embeddingCache.clear();
    this.documentCache.clear();
  }

  // Cache management
  private cleanup(): void {
    const now = Date.now();

    // Cleanup expired entries
    this.cleanupExpired(this.searchCache, now);
    this.cleanupExpired(this.embeddingCache, now);
    this.cleanupExpired(this.documentCache, now);

    // Cleanup least recently used if still over size limit
    this.enforceMaxSize(this.searchCache);
    this.enforceMaxSize(this.embeddingCache);
    this.enforceMaxSize(this.documentCache);
  }

  private cleanupExpired<T>(cache: Map<string, CacheEntry<T>>, now: number): void {
    for (const [key, entry] of cache.entries()) {
      if (this.isExpired(entry, now)) {
        cache.delete(key);
      }
    }
  }

  private enforceMaxSize<T>(cache: Map<string, CacheEntry<T>>): void {
    if (cache.size <= this.maxCacheSize) return;

    // Convert to array and sort by last accessed time
    const entries = Array.from(cache.entries())
      .sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed);

    // Remove oldest entries
    const toRemove = cache.size - this.maxCacheSize;
    for (let i = 0; i < toRemove; i++) {
      cache.delete(entries[i][0]);
    }
  }

  private isExpired(entry: CacheEntry<any>, now: number = Date.now()): boolean {
    return now - entry.timestamp > entry.ttl;
  }

  // Key generation
  private generateSearchKey(query: RAGQuery): string {
    const queryStr = JSON.stringify({
      query: query.query,
      filters: query.filters,
      topK: query.topK,
      threshold: query.threshold
    });

    return this.hashString(queryStr);
  }

  private generateEmbeddingKey(content: string, type: string): string {
    return this.hashString(`${type}:${content}`);
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  // Statistics and monitoring
  getStats(): CacheStats {
    const totalEntries = this.searchCache.size + this.embeddingCache.size + this.documentCache.size;
    const hitRate = this.stats.accessCount > 0
      ? this.stats.hits / this.stats.accessCount
      : 0;

    const averageAccessTime = this.stats.accessCount > 0
      ? this.stats.totalAccessTime / this.stats.accessCount
      : 0;

    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      size: totalEntries,
      hitRate,
      averageAccessTime,
      memoryUsage: this.estimateMemoryUsage()
    };
  }

  private estimateMemoryUsage(): number {
    let totalSize = 0;

    // Rough estimation of memory usage
    for (const entry of this.searchCache.values()) {
      totalSize += JSON.stringify(entry.data).length * 2; // Rough UTF-16 estimation
    }

    for (const entry of this.embeddingCache.values()) {
      totalSize += entry.data.length * 8; // 8 bytes per number
    }

    for (const entry of this.documentCache.values()) {
      totalSize += JSON.stringify(entry.data).length * 2;
    }

    return totalSize;
  }

  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      totalAccessTime: 0,
      accessCount: 0
    };
  }

  // Cache preloading strategies
  async preloadFrequentQueries(queries: RAGQuery[]): Promise<void> {
    // This would typically be called with historically frequent queries
    const warmingFunctions = queries.map(query => ({
      key: this.generateSearchKey(query),
      computeFn: async () => {
        // Placeholder - would call actual search function
        return [];
      },
      cacheType: 'search' as const,
      ttl: this.defaultTTL * 2 // Cache frequent queries longer
    }));

    await this.warmCache(warmingFunctions);
  }

  async preloadCommonEmbeddings(contents: Array<{ content: string; type: string }>): Promise<void> {
    const warmingFunctions = contents.map(({ content, type }) => ({
      key: this.generateEmbeddingKey(content, type),
      computeFn: async () => {
        // Placeholder - would call actual embedding function
        return new Array(1536).fill(0);
      },
      cacheType: 'embedding' as const,
      ttl: this.defaultTTL * 24
    }));

    await this.warmCache(warmingFunctions);
  }
}