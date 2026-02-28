/**
 * RVF Embedding Cache - Pure TypeScript Binary File Cache
 *
 * Replaces the sql.js-based PersistentEmbeddingCache with a lightweight
 * pure-TS binary file format. No native dependencies required.
 *
 * Features:
 * - Map-based in-memory cache with periodic flush to binary file
 * - LRU eviction tracked via access timestamps
 * - TTL support for cache entries
 * - Deterministic FNV-1a text hashing for keys
 * - Binary format: RVEC magic + entry records
 *
 * Binary entry format:
 *   [4-byte key-hash][4-byte dims][dims*4 bytes float32][8-byte timestamp][8-byte access-count]
 *
 * @module @claude-flow/embeddings
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { dirname } from 'path';

/** Validate a file path is safe */
function validatePath(p: string): void {
  if (p.includes('\0')) throw new Error('Cache path contains null bytes');
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for RVF embedding cache
 */
export interface RvfEmbeddingCacheConfig {
  /** Path to the binary cache file */
  cachePath: string;
  /** Maximum number of entries (default: 10000) */
  maxSize?: number;
  /** TTL in milliseconds (default: 7 days) */
  ttlMs?: number;
  /** Embedding dimensions (used for validation) */
  dimensions?: number;
}

// ============================================================================
// Cache Entry
// ============================================================================

interface CacheEntry {
  embedding: Float32Array;
  createdAt: number;
  accessedAt: number;
  accessCount: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Binary file magic bytes: "RVEC" */
const MAGIC = new Uint8Array([0x52, 0x56, 0x45, 0x43]); // R V E C

/** Default TTL: 7 days in milliseconds */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Default max entries */
const DEFAULT_MAX_SIZE = 10000;

/** Auto-flush interval: 30 seconds */
const AUTO_FLUSH_INTERVAL_MS = 30000;

/** FNV-1a offset basis (32-bit) */
const FNV_OFFSET_BASIS = 0x811c9dc5;

/** FNV-1a prime (32-bit) */
const FNV_PRIME = 0x01000193;

// ============================================================================
// RVF Embedding Cache
// ============================================================================

/**
 * Pure-TS binary file embedding cache with LRU eviction and TTL support.
 *
 * Stores embeddings as raw Float32Array bytes keyed by FNV-1a text hashes.
 * Uses an in-memory Map with periodic flush to a compact binary file.
 */
export class RvfEmbeddingCache {
  private readonly cachePath: string;
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly dimensions: number | undefined;

  private entries: Map<number, CacheEntry> = new Map();
  private textToHash: Map<string, number> = new Map();
  private dirty = false;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private initialized = false;

  constructor(config: RvfEmbeddingCacheConfig) {
    this.cachePath = config.cachePath;
    this.maxSize = config.maxSize ?? DEFAULT_MAX_SIZE;
    this.ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
    this.dimensions = config.dimensions;
    validatePath(this.cachePath);
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  /**
   * Lazily initialize the cache: load from disk if file exists, start auto-flush.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    // Ensure parent directory exists
    const dir = dirname(this.cachePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Load existing cache file
    if (existsSync(this.cachePath)) {
      this.loadFromFile();
    }

    // Clean expired entries on startup
    this.cleanExpired();

    // Start auto-flush timer
    this.startAutoFlush();

    this.initialized = true;
  }

  // --------------------------------------------------------------------------
  // Public API (matches PersistentEmbeddingCache)
  // --------------------------------------------------------------------------

  /**
   * Get an embedding from the cache by text.
   * Returns null if not found or expired.
   */
  async get(text: string): Promise<Float32Array | null> {
    await this.ensureInitialized();

    const hash = this.hashText(text);
    const entry = this.entries.get(hash);

    if (!entry) {
      return null;
    }

    // Check TTL
    const now = Date.now();
    if (now - entry.createdAt > this.ttlMs) {
      this.entries.delete(hash);
      this.textToHash.delete(text);
      this.dirty = true;
      return null;
    }

    // Update LRU tracking
    entry.accessedAt = now;
    entry.accessCount++;
    this.dirty = true;

    return entry.embedding;
  }

  /**
   * Store an embedding in the cache.
   * Triggers LRU eviction if the cache exceeds maxSize.
   */
  async set(text: string, embedding: Float32Array): Promise<void> {
    await this.ensureInitialized();

    // Validate dimensions if configured
    if (this.dimensions !== undefined && embedding.length !== this.dimensions) {
      throw new Error(
        `Dimension mismatch: expected ${this.dimensions}, got ${embedding.length}`
      );
    }

    const hash = this.hashText(text);
    const now = Date.now();

    // Copy the embedding to avoid external mutation
    const copy = new Float32Array(embedding.length);
    copy.set(embedding);

    const existing = this.entries.get(hash);
    if (existing) {
      existing.embedding = copy;
      existing.accessedAt = now;
      existing.accessCount++;
    } else {
      this.entries.set(hash, {
        embedding: copy,
        createdAt: now,
        accessedAt: now,
        accessCount: 1,
      });
      this.textToHash.set(text, hash);
    }

    this.dirty = true;

    // Evict if over capacity
    this.evictIfNeeded();
  }

  /**
   * Check whether the cache contains an embedding for the given text.
   */
  async has(text: string): Promise<boolean> {
    await this.ensureInitialized();

    const hash = this.hashText(text);
    const entry = this.entries.get(hash);

    if (!entry) return false;

    // Check TTL
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.entries.delete(hash);
      this.textToHash.delete(text);
      this.dirty = true;
      return false;
    }

    return true;
  }

  /**
   * Delete a specific entry from the cache.
   * Returns true if the entry existed and was deleted.
   */
  async delete(text: string): Promise<boolean> {
    await this.ensureInitialized();

    const hash = this.hashText(text);
    const existed = this.entries.delete(hash);
    this.textToHash.delete(text);

    if (existed) {
      this.dirty = true;
    }

    return existed;
  }

  /**
   * Clear all entries from the cache and persist the empty state.
   */
  async clear(): Promise<void> {
    await this.ensureInitialized();

    this.entries.clear();
    this.textToHash.clear();
    this.dirty = true;
    this.flushToFile();
  }

  /**
   * Return the number of entries currently in the cache.
   */
  async size(): Promise<number> {
    await this.ensureInitialized();
    return this.entries.size;
  }

  /**
   * Flush pending changes to disk and stop the auto-flush timer.
   */
  async close(): Promise<void> {
    this.stopAutoFlush();

    if (this.dirty) {
      this.flushToFile();
    }

    this.entries.clear();
    this.textToHash.clear();
    this.initialized = false;
  }

  // --------------------------------------------------------------------------
  // Hashing
  // --------------------------------------------------------------------------

  /**
   * FNV-1a 32-bit hash of the input text.
   * Deterministic: same input always produces the same hash.
   */
  private hashText(text: string): number {
    let hash = FNV_OFFSET_BASIS;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, FNV_PRIME) >>> 0;
    }
    return hash;
  }

  // --------------------------------------------------------------------------
  // LRU Eviction
  // --------------------------------------------------------------------------

  /**
   * If the cache exceeds maxSize, evict the least-recently-accessed entries
   * until we are back at 90% capacity.
   */
  private evictIfNeeded(): void {
    if (this.entries.size <= this.maxSize) return;

    const targetSize = Math.floor(this.maxSize * 0.9);
    const toEvict = this.entries.size - targetSize;

    // Sort entries by accessedAt ascending (oldest first)
    const sorted = [...this.entries.entries()].sort(
      (a, b) => a[1].accessedAt - b[1].accessedAt
    );

    // Build reverse map for O(1) lookup (hash → text)
    const hashToText = new Map<number, string>();
    for (const [text, hash] of this.textToHash) {
      hashToText.set(hash, text);
    }

    for (let i = 0; i < toEvict && i < sorted.length; i++) {
      const [hash] = sorted[i];
      this.entries.delete(hash);
      const text = hashToText.get(hash);
      if (text !== undefined) this.textToHash.delete(text);
    }

    this.dirty = true;
  }

  // --------------------------------------------------------------------------
  // TTL Cleanup
  // --------------------------------------------------------------------------

  /**
   * Remove all entries whose createdAt timestamp is older than TTL.
   */
  private cleanExpired(): void {
    const cutoff = Date.now() - this.ttlMs;
    const toDelete: number[] = [];

    for (const [hash, entry] of this.entries) {
      if (entry.createdAt < cutoff) {
        toDelete.push(hash);
      }
    }

    // Build reverse map for O(1) lookup
    const hashToText = new Map<number, string>();
    for (const [text, h] of this.textToHash) {
      hashToText.set(h, text);
    }

    for (const hash of toDelete) {
      this.entries.delete(hash);
      const text = hashToText.get(hash);
      if (text !== undefined) this.textToHash.delete(text);
    }

    if (toDelete.length > 0) {
      this.dirty = true;
    }
  }

  // --------------------------------------------------------------------------
  // Auto-Flush Timer
  // --------------------------------------------------------------------------

  private startAutoFlush(): void {
    if (this.flushTimer) return;

    this.flushTimer = setInterval(() => {
      if (this.dirty) {
        this.flushToFile();
      }
    }, AUTO_FLUSH_INTERVAL_MS);
    if (this.flushTimer.unref) this.flushTimer.unref();
  }

  private stopAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  // --------------------------------------------------------------------------
  // Binary Serialization
  // --------------------------------------------------------------------------

  /**
   * Write all entries to the binary cache file.
   *
   * Format:
   *   [4-byte magic "RVEC"]
   *   For each entry:
   *     [4-byte key-hash (uint32)]
   *     [4-byte dims (uint32)]
   *     [dims * 4 bytes float32 data]
   *     [8-byte createdAt (float64, used as timestamp)]
   *     [8-byte accessCount (float64)]
   */
  private flushToFile(): void {
    try {
      // Version 2 format: magic(4) + version(4) + entries...
      // Entry: hash(4) + dims(4) + embedding(dims*4) + createdAt(8) + accessedAt(8) + accessCount(8)
      let totalSize = MAGIC.length + 4; // magic + version uint32
      for (const [, entry] of this.entries) {
        totalSize += 4 + 4 + entry.embedding.length * 4 + 8 + 8 + 8;
      }

      const buffer = new ArrayBuffer(totalSize);
      const view = new DataView(buffer);
      const bytes = new Uint8Array(buffer);
      let offset = 0;

      // Write magic
      bytes.set(MAGIC, 0);
      offset += MAGIC.length;

      // Write format version
      view.setUint32(offset, 2, true);
      offset += 4;

      // Write entries
      for (const [hash, entry] of this.entries) {
        // Key hash (uint32, little-endian)
        view.setUint32(offset, hash, true);
        offset += 4;

        // Dimensions (uint32, little-endian)
        view.setUint32(offset, entry.embedding.length, true);
        offset += 4;

        // Embedding data (float32 array, little-endian)
        for (let i = 0; i < entry.embedding.length; i++) {
          view.setFloat32(offset, entry.embedding[i], true);
          offset += 4;
        }

        // createdAt as float64 (little-endian) - v2: separate from accessedAt
        view.setFloat64(offset, entry.createdAt, true);
        offset += 8;

        // accessedAt as float64 (little-endian)
        view.setFloat64(offset, entry.accessedAt, true);
        offset += 8;

        // Access count as float64 (little-endian)
        view.setFloat64(offset, entry.accessCount, true);
        offset += 8;
      }

      // Ensure parent directory exists
      const dir = dirname(this.cachePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const tmpSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const tmpPath = this.cachePath + '.tmp.' + tmpSuffix;
      writeFileSync(tmpPath, Buffer.from(buffer));
      renameSync(tmpPath, this.cachePath);
      this.dirty = false;
    } catch (error) {
      console.error(
        '[rvf-embedding-cache] Flush error:',
        error instanceof Error ? error.message : error
      );
    }
  }

  /**
   * Load entries from the binary cache file.
   */
  private loadFromFile(): void {
    try {
      const fileBuffer = readFileSync(this.cachePath);
      if (fileBuffer.length < MAGIC.length) return;

      const buffer = fileBuffer.buffer.slice(
        fileBuffer.byteOffset,
        fileBuffer.byteOffset + fileBuffer.byteLength
      );
      const view = new DataView(buffer);
      const bytes = new Uint8Array(buffer);
      let offset = 0;

      // Verify magic
      for (let i = 0; i < MAGIC.length; i++) {
        if (bytes[offset + i] !== MAGIC[i]) {
          console.warn('[rvf-embedding-cache] Invalid magic bytes, skipping load');
          return;
        }
      }
      offset += MAGIC.length;

      // Check for version header (v2+)
      let formatVersion = 1;
      if (offset + 4 <= buffer.byteLength) {
        const possibleVersion = view.getUint32(offset, true);
        if (possibleVersion === 2) {
          formatVersion = possibleVersion;
          offset += 4;
        }
      }

      // Read entries
      while (offset + 8 <= buffer.byteLength) {
        // Need at least 4 (hash) + 4 (dims) = 8 bytes for the header
        const hash = view.getUint32(offset, true);
        offset += 4;

        const dims = view.getUint32(offset, true);
        offset += 4;

        const entryDataSize = formatVersion === 2
          ? dims * 4 + 8 + 8 + 8   // v2: embedding + createdAt + accessedAt + accessCount
          : dims * 4 + 8 + 8;       // v1: embedding + accessedAt + accessCount
        if (offset + entryDataSize > buffer.byteLength) {
          console.warn('[rvf-embedding-cache] Truncated entry, stopping load');
          break;
        }

        // Read embedding
        const embedding = new Float32Array(dims);
        for (let i = 0; i < dims; i++) {
          embedding[i] = view.getFloat32(offset, true);
          offset += 4;
        }

        let createdAt: number;
        let accessedAt: number;
        let accessCount: number;

        if (formatVersion >= 2) {
          createdAt = view.getFloat64(offset, true);
          offset += 8;
          accessedAt = view.getFloat64(offset, true);
          offset += 8;
          accessCount = view.getFloat64(offset, true);
          offset += 8;
        } else {
          // v1: only accessedAt was stored, use it as createdAt too
          accessedAt = view.getFloat64(offset, true);
          offset += 8;
          accessCount = view.getFloat64(offset, true);
          offset += 8;
          createdAt = accessedAt;
        }

        this.entries.set(hash, {
          embedding,
          createdAt,
          accessedAt,
          accessCount,
        });
      }
    } catch (error) {
      console.warn(
        '[rvf-embedding-cache] Load error:',
        error instanceof Error ? error.message : error
      );
    }
  }
}
