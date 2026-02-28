import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
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
import { HnswLite, cosineSimilarity } from './hnsw-lite.js';

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

export class RvfBackend implements IMemoryBackend {
  private entries = new Map<string, MemoryEntry>();
  private keyIndex = new Map<string, string>();
  private hnswIndex: HnswLite | null = null;
  private nativeDb: any = null;
  private config: Required<RvfBackendConfig>;
  private initialized = false;
  private dirty = false;
  private persistTimer: ReturnType<typeof setInterval> | null = null;
  private queryTimes: number[] = [];
  private searchTimes: number[] = [];

  constructor(config: RvfBackendConfig) {
    this.config = {
      databasePath: config.databasePath,
      dimensions: config.dimensions ?? DEFAULT_DIMENSIONS,
      metric: config.metric ?? 'cosine',
      quantization: config.quantization ?? 'fp32',
      hnswM: config.hnswM ?? DEFAULT_M,
      hnswEfConstruction: config.hnswEfConstruction ?? DEFAULT_EF_CONSTRUCTION,
      maxElements: config.maxElements ?? DEFAULT_MAX_ELEMENTS,
      verbose: config.verbose ?? false,
      defaultNamespace: config.defaultNamespace ?? 'default',
      autoPersistInterval: config.autoPersistInterval ?? DEFAULT_PERSIST_INTERVAL,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const useNative = await this.tryNativeInit();
    if (!useNative) {
      this.hnswIndex = new HnswLite(
        this.config.dimensions,
        this.config.hnswM,
        this.config.hnswEfConstruction,
        this.config.metric,
      );
      await this.loadFromDisk();
    }

    if (this.config.autoPersistInterval > 0 && this.config.databasePath !== ':memory:') {
      this.persistTimer = setInterval(() => {
        if (this.dirty) this.persistToDisk().catch(() => {});
      }, this.config.autoPersistInterval);
    }

    this.initialized = true;
    if (this.config.verbose) {
      const mode = this.nativeDb ? 'native @ruvector/rvf' : 'pure-TS fallback';
      console.log(`[RvfBackend] Initialized (${mode}), ${this.entries.size} entries loaded`);
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

    if (this.nativeDb) {
      try { await this.nativeDb.close(); } catch {}
      this.nativeDb = null;
    }

    this.entries.clear();
    this.keyIndex.clear();
    this.hnswIndex = null;
    this.initialized = false;
  }

  async store(entry: MemoryEntry): Promise<void> {
    this.entries.set(entry.id, entry);
    this.keyIndex.set(this.compositeKey(entry.namespace, entry.key), entry.id);
    if (entry.embedding && this.hnswIndex) {
      this.hnswIndex.add(entry.id, entry.embedding);
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
    this.dirty = true;
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.entries.delete(id);
    this.keyIndex.delete(this.compositeKey(entry.namespace, entry.key));
    if (this.hnswIndex) this.hnswIndex.remove(id);
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
      const searchResults = this.hnswIndex.search(q.embedding, q.limit, q.threshold);
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
      const raw = this.hnswIndex.search(embedding, options.k * 2, options.threshold);
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
      if (entry.embedding && this.hnswIndex) this.hnswIndex.add(entry.id, entry.embedding);
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
        if (this.hnswIndex) this.hnswIndex.remove(id);
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
    let count = 0;
    for (const [id, entry] of this.entries.entries()) {
      if (entry.namespace === namespace) {
        this.entries.delete(id);
        this.keyIndex.delete(this.compositeKey(entry.namespace, entry.key));
        if (this.hnswIndex) this.hnswIndex.remove(id);
        count++;
      }
    }
    this.dirty = true;
    return count;
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
    if (!this.hnswIndex && !this.nativeDb) {
      issues.push('No vector index available');
      recommendations.push('Install @ruvector/rvf for native HNSW performance');
    }

    const status = issues.length === 0
      ? 'healthy'
      : issues.some(i => i.includes('not initialized')) ? 'unhealthy' : 'degraded';

    return {
      status,
      components: {
        storage: { status: this.initialized ? 'healthy' : 'unhealthy', latency: 0 },
        index: { status: this.hnswIndex || this.nativeDb ? 'healthy' : 'degraded', latency: 0 },
        cache: { status: 'healthy', latency: 0 },
      },
      timestamp: Date.now(),
      issues,
      recommendations,
    };
  }

  private async tryNativeInit(): Promise<boolean> {
    try {
      const rvf = await import('@ruvector/rvf' as string);
      this.nativeDb = new rvf.RvfDatabase({
        path: this.config.databasePath,
        dimensions: this.config.dimensions,
        metric: this.config.metric,
        quantization: this.config.quantization,
        hnswM: this.config.hnswM,
        hnswEfConstruction: this.config.hnswEfConstruction,
        maxElements: this.config.maxElements,
      });
      await this.nativeDb.open();
      if (this.config.verbose) {
        console.log('[RvfBackend] Native @ruvector/rvf loaded successfully');
      }
      return true;
    } catch {
      if (this.config.verbose) {
        console.log('[RvfBackend] @ruvector/rvf not available, using pure-TS fallback');
      }
      return false;
    }
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
      const headerJson = raw.subarray(8, 8 + headerLen).toString('utf-8');
      const header: RvfHeader = JSON.parse(headerJson);

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
        if (entry.embedding && this.hnswIndex) this.hnswIndex.add(entry.id, entry.embedding);
      }
    } catch (err) {
      if (this.config.verbose) {
        console.error('[RvfBackend] Error loading from disk:', err);
      }
    }
  }

  private async persistToDisk(): Promise<void> {
    if (this.config.databasePath === ':memory:') return;

    const dir = dirname(this.config.databasePath);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });

    const entries = Array.from(this.entries.values());
    const header: RvfHeader = {
      magic: MAGIC,
      version: VERSION,
      dimensions: this.config.dimensions,
      metric: this.config.metric,
      quantization: this.config.quantization,
      entryCount: entries.length,
      createdAt: entries.length > 0 ? Math.min(...entries.map(e => e.createdAt)) : Date.now(),
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
    await writeFile(this.config.databasePath, output);
    this.dirty = false;
  }
}
