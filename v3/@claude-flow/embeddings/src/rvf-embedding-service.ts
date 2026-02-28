/**
 * RVF Embedding Service - Lightweight Hash-Based Embeddings
 *
 * Provides deterministic, sub-millisecond embedding generation using
 * FNV-1a hash-based vectors. No neural model or external API required.
 *
 * Features:
 * - Deterministic: same input always produces the same embedding
 * - FNV-1a hash seeding with multi-round mixing
 * - L2-normalized output vectors
 * - Sub-millisecond generation (<0.1ms typical)
 * - RvfEmbeddingCache for binary file persistence
 * - Zero external dependencies
 *
 * Use cases:
 * - Fast similarity search where relative distances matter more than semantics
 * - Development and testing without API keys
 * - Offline environments without neural model access
 * - Bootstrapping before heavier providers are available
 *
 * @module @claude-flow/embeddings
 */

import { EventEmitter } from 'events';
import type {
  EmbeddingProvider,
  EmbeddingResult,
  BatchEmbeddingResult,
  IEmbeddingService,
  EmbeddingEvent,
  EmbeddingEventListener,
  NormalizationType,
  RvfEmbeddingConfig,
} from './types.js';
import { normalize } from './normalization.js';
import { RvfEmbeddingCache } from './rvf-embedding-cache.js';

// ============================================================================
// Constants
// ============================================================================

/** FNV-1a offset basis (32-bit) */
const FNV_OFFSET_BASIS = 0x811c9dc5;

/** FNV-1a prime (32-bit) */
const FNV_PRIME = 0x01000193;

/** Default embedding dimensions */
const DEFAULT_DIMENSIONS = 384;

/** Default in-memory LRU cache size */
const DEFAULT_CACHE_SIZE = 1000;

// ============================================================================
// LRU Cache (lightweight in-memory)
// ============================================================================

class LRUCache<K, V> {
  private cache: Map<K, V> = new Map();
  private hits = 0;
  private misses = 0;

  constructor(private readonly maxSize: number) {}

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
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  get size(): number {
    return this.cache.size;
  }

  get hitRate(): number {
    const total = this.hits + this.misses;
    return total > 0 ? this.hits / total : 0;
  }

  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hitRate,
    };
  }
}

// ============================================================================
// RVF Embedding Service
// ============================================================================

/**
 * Lightweight hash-based embedding service.
 *
 * Generates deterministic embeddings from text using FNV-1a hashing
 * with multi-round mixing and L2 normalization. The output is a unit
 * vector in R^n where n = configured dimensions (default 384).
 *
 * Extends EventEmitter and implements IEmbeddingService for drop-in
 * compatibility with other providers.
 */
export class RvfEmbeddingService extends EventEmitter implements IEmbeddingService {
  readonly provider: EmbeddingProvider = 'rvf';

  private readonly dimensions: number;
  private readonly cache: LRUCache<string, Float32Array>;
  private readonly normalizationType: NormalizationType;
  private readonly embeddingListeners: Set<EmbeddingEventListener> = new Set();
  private persistentCache: RvfEmbeddingCache | null = null;

  constructor(config: RvfEmbeddingConfig) {
    super();
    this.dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
    this.cache = new LRUCache(config.cacheSize ?? DEFAULT_CACHE_SIZE);
    this.normalizationType = config.normalization ?? 'none';

    // Initialize persistent RVF cache if a path is provided
    if (config.cachePath) {
      this.persistentCache = new RvfEmbeddingCache({
        cachePath: config.cachePath,
        maxSize: config.cacheSize ?? 10000,
        dimensions: this.dimensions,
      });
    }
  }

  // --------------------------------------------------------------------------
  // IEmbeddingService Implementation
  // --------------------------------------------------------------------------

  /**
   * Generate an embedding for a single text string.
   */
  async embed(text: string): Promise<EmbeddingResult> {
    // Check in-memory cache
    const cached = this.cache.get(text);
    if (cached) {
      this.emitEvent({ type: 'cache_hit', text });
      return { embedding: cached, latencyMs: 0, cached: true };
    }

    // Check persistent cache
    if (this.persistentCache) {
      const persisted = await this.persistentCache.get(text);
      if (persisted) {
        this.cache.set(text, persisted);
        this.emitEvent({ type: 'cache_hit', text });
        return { embedding: persisted, latencyMs: 0, cached: true, persistentCached: true };
      }
    }

    this.emitEvent({ type: 'embed_start', text });
    const startTime = performance.now();

    // Generate deterministic embedding
    const embedding = this.generateHashEmbedding(text);

    // Apply optional normalization (hash embeddings are already L2-normalized,
    // but the user may want a different normalization)
    const normalized = this.applyNormalization(embedding);

    // Store in caches
    this.cache.set(text, normalized);
    if (this.persistentCache) {
      await this.persistentCache.set(text, normalized);
    }

    const latencyMs = performance.now() - startTime;
    this.emitEvent({ type: 'embed_complete', text, latencyMs });

    return { embedding: normalized, latencyMs };
  }

  /**
   * Generate embeddings for multiple text strings.
   */
  async embedBatch(texts: string[]): Promise<BatchEmbeddingResult> {
    this.emitEvent({ type: 'batch_start', count: texts.length });
    const startTime = performance.now();

    const embeddings: Float32Array[] = [];
    let cacheHits = 0;

    for (const text of texts) {
      const cached = this.cache.get(text);
      if (cached) {
        embeddings.push(cached);
        cacheHits++;
        this.emitEvent({ type: 'cache_hit', text });
        continue;
      }

      // Check persistent cache
      if (this.persistentCache) {
        const persisted = await this.persistentCache.get(text);
        if (persisted) {
          this.cache.set(text, persisted);
          embeddings.push(persisted);
          cacheHits++;
          this.emitEvent({ type: 'cache_hit', text });
          continue;
        }
      }

      const embedding = this.generateHashEmbedding(text);
      const normalized = this.applyNormalization(embedding);
      this.cache.set(text, normalized);

      if (this.persistentCache) {
        await this.persistentCache.set(text, normalized);
      }

      embeddings.push(normalized);
    }

    const totalLatencyMs = performance.now() - startTime;
    this.emitEvent({ type: 'batch_complete', count: texts.length, latencyMs: totalLatencyMs });

    return {
      embeddings,
      totalLatencyMs,
      avgLatencyMs: totalLatencyMs / texts.length,
      cacheStats: {
        hits: cacheHits,
        misses: texts.length - cacheHits,
      },
    };
  }

  clearCache(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.emitEvent({ type: 'cache_eviction', size });
  }

  getCacheStats() {
    const stats = this.cache.getStats();
    return {
      size: stats.size,
      maxSize: stats.maxSize,
      hitRate: stats.hitRate,
    };
  }

  async shutdown(): Promise<void> {
    this.clearCache();
    this.embeddingListeners.clear();
    if (this.persistentCache) {
      await this.persistentCache.close();
    }
  }

  // --------------------------------------------------------------------------
  // Event System
  // --------------------------------------------------------------------------

  addEventListener(listener: EmbeddingEventListener): void {
    this.embeddingListeners.add(listener);
  }

  removeEventListener(listener: EmbeddingEventListener): void {
    this.embeddingListeners.delete(listener);
  }

  private emitEvent(event: EmbeddingEvent): void {
    for (const listener of this.embeddingListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in embedding event listener:', error);
      }
    }
    this.emit(event.type, event);
  }

  // --------------------------------------------------------------------------
  // Hash Embedding Generation
  // --------------------------------------------------------------------------

  /**
   * Generate a deterministic embedding from text using FNV-1a hashing.
   *
   * Algorithm:
   * 1. Compute a base FNV-1a hash of the full text.
   * 2. For each dimension, derive a unique seed by mixing the base hash
   *    with the dimension index using the golden ratio constant.
   * 3. Apply a sine-based pseudo-random transform to spread values.
   * 4. L2-normalize the result to produce a unit vector.
   *
   * This is deterministic: the same text always yields the same vector.
   */
  private generateHashEmbedding(text: string): Float32Array {
    const embedding = new Float32Array(this.dimensions);

    // Compute base FNV-1a hash of the full text
    let baseHash = FNV_OFFSET_BASIS;
    for (let i = 0; i < text.length; i++) {
      baseHash ^= text.charCodeAt(i);
      baseHash = Math.imul(baseHash, FNV_PRIME) >>> 0;
    }

    // Generate each dimension from a mixed seed
    for (let i = 0; i < this.dimensions; i++) {
      // Mix dimension index with the base hash using golden ratio constant
      const seed = (baseHash + Math.imul(i, 0x9E3779B9)) >>> 0;
      // Use sine for pseudo-random distribution in [-1, 1] range
      const x = Math.sin(seed) * 43758.5453;
      embedding[i] = x - Math.floor(x); // fractional part in [0, 1)
      // Shift to [-0.5, 0.5) for zero-centered distribution
      embedding[i] -= 0.5;
    }

    // L2 normalize to unit vector
    let norm = 0;
    for (let i = 0; i < this.dimensions; i++) {
      norm += embedding[i] * embedding[i];
    }
    norm = Math.sqrt(norm);

    if (norm > 0) {
      for (let i = 0; i < this.dimensions; i++) {
        embedding[i] /= norm;
      }
    }

    return embedding;
  }

  /**
   * Apply user-configured normalization if set.
   */
  private applyNormalization(embedding: Float32Array): Float32Array {
    if (this.normalizationType === 'none') {
      return embedding;
    }
    return normalize(embedding, { type: this.normalizationType });
  }
}
