import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type {
  IMemoryBackend,
  MemoryEntry,
  MemoryEntryUpdate,
  MemoryQuery,
  SearchOptions,
  SearchResult,
  BackendStats,
  HealthCheckResult,
  MemoryType,
} from './types.js';
import { HNSWIndex } from './hnsw-index.js';

// ----------------------------------------------------------------------------
// RvfVectorIndex — RvfBackend's vector index, backed by the canonical
// `HNSWIndex` from `src/hnsw-index.ts` (ADR-125: one HNSW implementation).
//
// It replaces the inlined `HnswLite`, whose search seeded from the first
// `efConstruction` vectors in insertion order and BFS'd over a flat
// neighbour graph: on 5,000 random 384-dim unit vectors it reached
// recall@10 = 0.091 against exact search (0.079 at 1536-dim), and every
// insert was an O(n) brute-force scan. HNSWIndex measured 0.888 (384-dim)
// and 0.744 (1536-dim) on the same data, 0.990 on clustered data.
// @ruvector/diskann was also measured (0.896 / 0.739) but a vector inserted
// after build() is not searchable until a full rebuild (3.6 s at 1k vectors),
// which breaks store()-then-search(); see the RvfBackend recall test.
//
// Small indexes (<= EXACT_SEARCH_MAX vectors) are searched exactly, so the
// common small memory store keeps recall 1.0. Embeddings whose length does not
// match the configured dimensions are kept out of the graph (HNSWIndex
// rejects them) and are only reachable through the exact scan. Not exported.
// ----------------------------------------------------------------------------

interface HnswSearchResult {
  id: string;
  score: number;
}

/** Below this many indexed vectors, search() is an exact scan. */
const EXACT_SEARCH_MAX = 1000;

class RvfVectorIndex {
  private readonly vectors = new Map<string, Float32Array>();
  private readonly graph: HNSWIndex;
  private readonly dimensions: number;
  private readonly efConstruction: number;
  private readonly metric: 'cosine' | 'euclidean' | 'dot';

  constructor(dimensions: number, m: number, efConstruction: number, metric: 'cosine' | 'euclidean' | 'dot') {
    this.dimensions = dimensions;
    this.efConstruction = efConstruction;
    this.metric = metric;
    this.graph = new HNSWIndex({
      dimensions,
      M: m,
      efConstruction,
      // RvfBackend never capped its index; keep that (maxElements is advisory
      // in RvfBackendConfig).
      maxElements: Number.MAX_SAFE_INTEGER,
      metric,
    });
  }

  get size(): number { return this.vectors.size; }

  async add(id: string, vector: Float32Array): Promise<void> {
    if (this.vectors.has(id)) await this.remove(id);
    this.vectors.set(id, vector);
    if (vector.length === this.dimensions) await this.graph.addPoint(id, vector);
  }

  async remove(id: string): Promise<void> {
    if (!this.vectors.delete(id)) return;
    if (this.graph.has(id)) await this.graph.removePoint(id);
  }

  async search(query: Float32Array, k: number, threshold?: number): Promise<HnswSearchResult[]> {
    if (this.vectors.size === 0 || k <= 0) return [];
    if (this.vectors.size <= EXACT_SEARCH_MAX || query.length !== this.dimensions) {
      return this.exact(query, k, threshold);
    }
    const ef = Math.max(k, this.efConstruction);
    const raw = await this.graph.search(query, k, ef);
    const out: HnswSearchResult[] = [];
    for (const r of raw) {
      if (!this.vectors.has(r.id)) continue;
      const score = this.toScore(r.distance);
      if (threshold !== undefined && score < threshold) continue;
      out.push({ id: r.id, score });
    }
    return out;
  }

  private exact(query: Float32Array, k: number, threshold?: number): HnswSearchResult[] {
    const results: HnswSearchResult[] = [];
    for (const [id, vec] of this.vectors) {
      if (vec.length !== query.length) continue;
      const score = this.similarity(query, vec);
      if (threshold !== undefined && score < threshold) continue;
      results.push({ id, score });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  }

  /** Map HNSWIndex distances back to the similarity scale RvfBackend reports. */
  private toScore(distance: number): number {
    if (this.metric === 'dot') return -distance;
    if (this.metric === 'euclidean') return 1 / (1 + distance);
    return 1 - distance;
  }

  private similarity(a: Float32Array, b: Float32Array): number {
    if (this.metric === 'dot') return dotProduct(a, b);
    if (this.metric === 'euclidean') return 1 / (1 + euclideanDistance(a, b));
    return cosineSimilarity(a, b);
  }
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function euclideanDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; sum += d * d; }
  return Math.sqrt(sum);
}

/** Validate a file path is safe (no null bytes, no traversal above root) */
function validatePath(p: string): void {
  if (p === ':memory:') return;
  if (p.includes('\0')) throw new Error('Path contains null bytes');
  const resolved = resolve(p);
  if (resolved.includes('\0')) throw new Error('Resolved path contains null bytes');
}

export interface RvfBackendConfig {
  databasePath: string;
  dimensions?: number;
  metric?: 'cosine' | 'euclidean' | 'dot';
  quantization?: 'fp32' | 'fp16' | 'int8';
  hnswM?: number;
  hnswEfConstruction?: number;
  maxElements?: number;
  verbose?: boolean;
  defaultNamespace?: string;
  autoPersistInterval?: number;
}

interface RvfHeader {
  magic: string;
  version: number;
  dimensions: number;
  metric: string;
  quantization: string;
  entryCount: number;
  createdAt: number;
  updatedAt: number;
}

const MAGIC = 'RVF\0';
const VERSION = 1;
const DEFAULT_DIMENSIONS = 1536;
const DEFAULT_M = 16;
const DEFAULT_EF_CONSTRUCTION = 200;
const DEFAULT_MAX_ELEMENTS = 100000;
const DEFAULT_PERSIST_INTERVAL = 30000;

/**
 * Pure-TS RVF backend: entries live in memory and persist to a single
 * `RVF\0` snapshot file at `databasePath`, with `RvfVectorIndex` (the canonical HNSWIndex) for search.
 *
 * There is deliberately no `@ruvector/rvf` native path (#4279). The SDK is a
 * vector index (u64 ids, `{id, distance}` results, no payloads), so it cannot
 * hold `MemoryEntry` records, and a native store opened at `databasePath`
 * would compete with the snapshot for the same file.
 */
export class RvfBackend implements IMemoryBackend {
  private entries = new Map<string, MemoryEntry>();
  private keyIndex = new Map<string, string>();
  private hnswIndex: RvfVectorIndex | null = null;
  private config: Required<RvfBackendConfig>;
  private initialized = false;
  private dirty = false;
  private persisting = false;
  private persistTimer: ReturnType<typeof setInterval> | null = null;
  private queryTimes: number[] = [];
  private searchTimes: number[] = [];

  constructor(config: RvfBackendConfig) {
    const dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
    if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 10000) {
      throw new Error(`Invalid dimensions: ${dimensions}. Must be an integer between 1 and 10000.`);
    }
    this.config = {
      databasePath: config.databasePath,
      dimensions,
      metric: config.metric ?? 'cosine',
      quantization: config.quantization ?? 'fp32',
      hnswM: config.hnswM ?? DEFAULT_M,
      hnswEfConstruction: config.hnswEfConstruction ?? DEFAULT_EF_CONSTRUCTION,
      maxElements: config.maxElements ?? DEFAULT_MAX_ELEMENTS,
      verbose: config.verbose ?? false,
      defaultNamespace: config.defaultNamespace ?? 'default',
      autoPersistInterval: config.autoPersistInterval ?? DEFAULT_PERSIST_INTERVAL,
    };
    validatePath(this.config.databasePath);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.hnswIndex = new RvfVectorIndex(
      this.config.dimensions,
      this.config.hnswM,
      this.config.hnswEfConstruction,
      this.config.metric,
    );
    await this.loadFromDisk();

    if (this.config.autoPersistInterval > 0 && this.config.databasePath !== ':memory:') {
      this.persistTimer = setInterval(() => {
        if (this.dirty && !this.persisting) this.persistToDisk().catch(() => {});
      }, this.config.autoPersistInterval);
      if (this.persistTimer.unref) this.persistTimer.unref();
    }

    this.initialized = true;
    if (this.config.verbose) {
      console.log(`[RvfBackend] Initialized, ${this.entries.size} entries loaded`);
    }
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }

    if (this.dirty) {
      await this.persistToDisk();
    }

    this.entries.clear();
    this.keyIndex.clear();
    this.hnswIndex = null;
    this.initialized = false;
  }

  async store(entry: MemoryEntry): Promise<void> {
    const ns = entry.namespace || this.config.defaultNamespace;
    const e = ns !== entry.namespace ? { ...entry, namespace: ns } : entry;
    this.entries.set(e.id, e);
    this.keyIndex.set(this.compositeKey(e.namespace, e.key), e.id);
    if (this.hnswIndex) {
      // Upsert: add() replaces any previous vector for this id; an entry
      // re-stored without an embedding must not keep its old one searchable.
      if (e.embedding) await this.hnswIndex.add(e.id, e.embedding);
      else await this.hnswIndex.remove(e.id);
    }
    this.dirty = true;
  }

  async get(id: string): Promise<MemoryEntry | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;
    entry.accessCount++;
    entry.lastAccessedAt = Date.now();
    return entry;
  }

  async getByKey(namespace: string, key: string): Promise<MemoryEntry | null> {
    const id = this.keyIndex.get(this.compositeKey(namespace, key));
    if (!id) return null;
    return this.get(id);
  }

  async update(id: string, updateData: MemoryEntryUpdate): Promise<MemoryEntry | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;

    const updated: MemoryEntry = {
      ...entry,
      ...updateData,
      updatedAt: Date.now(),
      version: entry.version + 1,
    };
    this.entries.set(id, updated);
    // MemoryEntryUpdate has no `embedding`, but untyped callers can pass one;
    // keep the index in step with the stored entry either way.
    if (this.hnswIndex && updated.embedding !== entry.embedding) {
      if (updated.embedding) await this.hnswIndex.add(id, updated.embedding);
      else await this.hnswIndex.remove(id);
    }
    this.dirty = true;
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.entries.delete(id);
    this.keyIndex.delete(this.compositeKey(entry.namespace, entry.key));
    if (this.hnswIndex) await this.hnswIndex.remove(id);
    this.dirty = true;
    return true;
  }

  async query(q: MemoryQuery): Promise<MemoryEntry[]> {
    const start = performance.now();
    let results = Array.from(this.entries.values());

    if (q.namespace) results = results.filter(e => e.namespace === q.namespace);
    if (q.key) results = results.filter(e => e.key === q.key);
    if (q.keyPrefix) results = results.filter(e => e.key.startsWith(q.keyPrefix!));
    if (q.tags?.length) results = results.filter(e => q.tags!.every(t => e.tags.includes(t)));
    if (q.memoryType) results = results.filter(e => e.type === q.memoryType);
    if (q.accessLevel) results = results.filter(e => e.accessLevel === q.accessLevel);
    if (q.ownerId) results = results.filter(e => e.ownerId === q.ownerId);
    if (q.createdAfter) results = results.filter(e => e.createdAt > q.createdAfter!);
    if (q.createdBefore) results = results.filter(e => e.createdAt < q.createdBefore!);
    if (q.updatedAfter) results = results.filter(e => e.updatedAt > q.updatedAfter!);
    if (q.updatedBefore) results = results.filter(e => e.updatedAt < q.updatedBefore!);
    if (!q.includeExpired) {
      const now = Date.now();
      results = results.filter(e => !e.expiresAt || e.expiresAt > now);
    }

    if (q.type === 'semantic' && q.embedding && this.hnswIndex) {
      const searchResults = await this.hnswIndex.search(q.embedding, q.limit, q.threshold);
      const idSet = new Set(searchResults.map(r => r.id));
      results = results.filter(e => idSet.has(e.id));
    }

    const offset = q.offset ?? 0;
    results = results.slice(offset, offset + q.limit);

    this.recordTiming(this.queryTimes, start);
    return results;
  }

  async search(embedding: Float32Array, options: SearchOptions): Promise<SearchResult[]> {
    const start = performance.now();
    let results: SearchResult[];

    if (this.hnswIndex) {
      const raw = await this.hnswIndex.search(embedding, options.k * 2, options.threshold);
      results = [];
      for (const r of raw) {
        const entry = this.entries.get(r.id);
        if (!entry) continue;
        if (options.filters?.namespace && entry.namespace !== options.filters.namespace) continue;
        if (options.filters?.tags && !options.filters.tags.every(t => entry.tags.includes(t))) continue;
        if (options.filters?.memoryType && entry.type !== options.filters.memoryType) continue;
        results.push({ entry, score: r.score, distance: 1 - r.score });
      }
      results = results.slice(0, options.k);
    } else {
      results = this.bruteForceSearch(embedding, options);
    }

    this.recordTiming(this.searchTimes, start);
    return results;
  }

  async bulkInsert(entries: MemoryEntry[]): Promise<void> {
    for (const entry of entries) {
      this.entries.set(entry.id, entry);
      this.keyIndex.set(this.compositeKey(entry.namespace, entry.key), entry.id);
      if (entry.embedding && this.hnswIndex) await this.hnswIndex.add(entry.id, entry.embedding);
    }
    this.dirty = true;
  }

  async bulkDelete(ids: string[]): Promise<number> {
    let count = 0;
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (entry) {
        this.entries.delete(id);
        this.keyIndex.delete(this.compositeKey(entry.namespace, entry.key));
        if (this.hnswIndex) await this.hnswIndex.remove(id);
        count++;
      }
    }
    this.dirty = true;
    return count;
  }

  async count(namespace?: string): Promise<number> {
    if (!namespace) return this.entries.size;
    let c = 0;
    for (const entry of this.entries.values()) {
      if (entry.namespace === namespace) c++;
    }
    return c;
  }

  async listNamespaces(): Promise<string[]> {
    const ns = new Set<string>();
    for (const entry of this.entries.values()) ns.add(entry.namespace);
    return Array.from(ns);
  }

  async clearNamespace(namespace: string): Promise<number> {
    const toDelete: string[] = [];
    for (const [id, entry] of this.entries) {
      if (entry.namespace === namespace) toDelete.push(id);
    }
    for (const id of toDelete) {
      const entry = this.entries.get(id)!;
      this.entries.delete(id);
      this.keyIndex.delete(this.compositeKey(entry.namespace, entry.key));
      if (this.hnswIndex) await this.hnswIndex.remove(id);
    }
    if (toDelete.length > 0) this.dirty = true;
    return toDelete.length;
  }

  async getStats(): Promise<BackendStats> {
    const entriesByNamespace: Record<string, number> = {};
    const entriesByType: Record<string, number> = {};
    let memoryUsage = 0;

    for (const entry of this.entries.values()) {
      entriesByNamespace[entry.namespace] = (entriesByNamespace[entry.namespace] ?? 0) + 1;
      entriesByType[entry.type] = (entriesByType[entry.type] ?? 0) + 1;
      memoryUsage += entry.content.length * 2;
      if (entry.embedding) memoryUsage += entry.embedding.byteLength;
    }

    const avgQuery = this.avg(this.queryTimes);
    const avgSearch = this.avg(this.searchTimes);

    return {
      totalEntries: this.entries.size,
      entriesByNamespace,
      entriesByType: entriesByType as Record<MemoryType, number>,
      memoryUsage,
      hnswStats: this.hnswIndex ? {
        vectorCount: this.hnswIndex.size,
        memoryUsage: this.hnswIndex.size * this.config.dimensions * 4,
        avgSearchTime: avgSearch,
        buildTime: 0,
      } : undefined,
      avgQueryTime: avgQuery,
      avgSearchTime: avgSearch,
    };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const issues: string[] = [];
    const recommendations: string[] = [];

    if (!this.initialized) issues.push('Backend not initialized');

    const status = issues.length === 0
      ? 'healthy'
      : issues.some(i => i.includes('not initialized')) ? 'unhealthy' : 'degraded';

    return {
      status,
      components: {
        storage: { status: this.initialized ? 'healthy' : 'unhealthy', latency: 0 },
        index: { status: this.hnswIndex ? 'healthy' : 'degraded', latency: 0 },
        cache: { status: 'healthy', latency: 0 },
      },
      timestamp: Date.now(),
      issues,
      recommendations,
    };
  }

  private compositeKey(namespace: string, key: string): string {
    return `${namespace}\0${key}`;
  }

  private bruteForceSearch(embedding: Float32Array, options: SearchOptions): SearchResult[] {
    const results: SearchResult[] = [];
    for (const entry of this.entries.values()) {
      if (!entry.embedding) continue;
      const score = cosineSimilarity(embedding, entry.embedding);
      if (options.threshold && score < options.threshold) continue;
      if (options.filters?.namespace && entry.namespace !== options.filters.namespace) continue;
      if (options.filters?.tags && !options.filters.tags.every(t => entry.tags.includes(t))) continue;
      results.push({ entry, score, distance: 1 - score });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, options.k);
  }

  private recordTiming(arr: number[], start: number): void {
    arr.push(performance.now() - start);
    if (arr.length > 100) arr.shift();
  }

  private avg(arr: number[]): number {
    return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  }

  private async loadFromDisk(): Promise<void> {
    if (this.config.databasePath === ':memory:') return;
    if (!existsSync(this.config.databasePath)) return;

    try {
      const raw = await readFile(this.config.databasePath);
      if (raw.length < 8) return;

      const magic = String.fromCharCode(raw[0], raw[1], raw[2], raw[3]);
      if (magic !== MAGIC) return;

      const headerLen = raw.readUInt32LE(4);
      const MAX_HEADER_SIZE = 10 * 1024 * 1024; // 10MB max header
      if (headerLen > MAX_HEADER_SIZE || 8 + headerLen > raw.length) return;
      const headerJson = raw.subarray(8, 8 + headerLen).toString('utf-8');
      let header: RvfHeader;
      try {
        header = JSON.parse(headerJson);
      } catch {
        if (this.config.verbose) console.error('[RvfBackend] Corrupt RVF header');
        return;
      }
      if (!header || typeof header.entryCount !== 'number' || typeof header.version !== 'number') return;

      let offset = 8 + headerLen;
      for (let i = 0; i < header.entryCount; i++) {
        if (offset + 4 > raw.length) break;
        const entryLen = raw.readUInt32LE(offset);
        offset += 4;
        if (offset + entryLen > raw.length) break;

        const entryJson = raw.subarray(offset, offset + entryLen).toString('utf-8');
        offset += entryLen;

        const parsed = JSON.parse(entryJson);
        if (parsed.embedding) parsed.embedding = new Float32Array(parsed.embedding);

        const entry: MemoryEntry = parsed;
        this.entries.set(entry.id, entry);
        this.keyIndex.set(this.compositeKey(entry.namespace, entry.key), entry.id);
        if (entry.embedding && this.hnswIndex) await this.hnswIndex.add(entry.id, entry.embedding);
      }
    } catch (err) {
      if (this.config.verbose) {
        console.error('[RvfBackend] Error loading from disk:', err);
      }
    }
  }

  private persistQueue: Promise<void> = Promise.resolve();

  private async persistToDisk(): Promise<void> {
    if (this.config.databasePath === ':memory:') return;
    // Queue writes so concurrent callers wait instead of silently dropping
    this.persistQueue = this.persistQueue.then(() => this.doPersist()).catch(() => {});
    return this.persistQueue;
  }

  private async doPersist(): Promise<void> {
    if (!this.dirty) return;
    if (this.persisting) return;
    this.persisting = true;

    try {
    const dir = dirname(this.config.databasePath);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });

    const entries = Array.from(this.entries.values());

    // Compute min createdAt without spread operator (avoids stack overflow for large arrays)
    let minCreatedAt = Date.now();
    for (const e of entries) {
      if (e.createdAt < minCreatedAt) minCreatedAt = e.createdAt;
    }

    const header: RvfHeader = {
      magic: MAGIC,
      version: VERSION,
      dimensions: this.config.dimensions,
      metric: this.config.metric,
      quantization: this.config.quantization,
      entryCount: entries.length,
      createdAt: entries.length > 0 ? minCreatedAt : Date.now(),
      updatedAt: Date.now(),
    };

    const headerBuf = Buffer.from(JSON.stringify(header), 'utf-8');
    const entryBuffers: Buffer[] = [];

    for (const entry of entries) {
      const serialized = {
        ...entry,
        embedding: entry.embedding ? Array.from(entry.embedding) : undefined,
      };
      const buf = Buffer.from(JSON.stringify(serialized), 'utf-8');
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32LE(buf.length, 0);
      entryBuffers.push(lenBuf, buf);
    }

    const magicBuf = Buffer.from([0x52, 0x56, 0x46, 0x00]);
    const headerLenBuf = Buffer.alloc(4);
    headerLenBuf.writeUInt32LE(headerBuf.length, 0);

    const output = Buffer.concat([magicBuf, headerLenBuf, headerBuf, ...entryBuffers]);

    // Atomic write: write to temp file then rename (crash-safe)
    const tmpPath = this.config.databasePath + '.tmp';
    await writeFile(tmpPath, output);
    await rename(tmpPath, this.config.databasePath);
    this.dirty = false;
    } finally {
      this.persisting = false;
    }
  }
}
