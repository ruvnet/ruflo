/**
 * AgentDB-backed VectorStore for the threat learning service.
 *
 * `agentdb` is an optional peer dependency. It is imported lazily on first use,
 * so `@claude-flow/aidefence` loads and runs without it. When the import or the
 * AgentDB initialisation fails, the store falls back to `InMemoryVectorStore`
 * and reports why through `onFallback` (default: one console.warn).
 *
 * An `AgentDB` instance is not itself a `VectorStore` (it has no
 * store/search/get/delete). Pass it here, or to `createAIDefence({ vectorStore })`,
 * which wraps it with this adapter.
 */

import {
  InMemoryVectorStore,
  type VectorStore,
} from '../domain/services/threat-learning-service.js';

/** The parts of an AgentDB vector backend this adapter uses. */
interface AgentDBVectorBackend {
  insert(id: string, embedding: Float32Array, metadata?: Record<string, unknown>): void;
  search(
    query: Float32Array,
    k: number,
    options?: { threshold?: number }
  ): Array<{ id: string; similarity: number }>;
  remove(id: string): boolean;
  insertAsync?(id: string, embedding: Float32Array, metadata?: Record<string, unknown>): Promise<void>;
  searchAsync?(
    query: Float32Array,
    k: number,
    options?: { threshold?: number }
  ): Promise<Array<{ id: string; similarity: number }>>;
  removeAsync?(id: string): Promise<boolean>;
}

/** The parts of an AgentDB instance this adapter uses. */
export interface AgentDBLike {
  initialize(): Promise<void>;
  vectorBackend?: unknown;
  getController?: unknown;
}

interface Embedder {
  embed(text: string): Promise<Float32Array>;
}

export interface AgentDBVectorStoreOptions {
  /** An existing AgentDB instance. If omitted, one is created with `dbPath`. */
  agentdb?: AgentDBLike;
  /** Database path for a new AgentDB instance (default ':memory:'). */
  dbPath?: string;
  /** Text embedder. Defaults to agentdb's EmbeddingService (all-MiniLM-L6-v2, 384 dims). */
  embedder?: Embedder;
  /** Called once if agentdb cannot be used and the in-memory store takes over. */
  onFallback?: (reason: string) => void;
  /** Test hook: replaces `import('agentdb')`. */
  importAgentDB?: () => Promise<unknown>;
}

interface Entry {
  value: unknown;
  indexed: boolean;
}

const SEP = '\u0000';

async function remove(backend: AgentDBVectorBackend, id: string): Promise<void> {
  if (backend.removeAsync) await backend.removeAsync(id);
  else backend.remove(id);
}

/** True for an object that looks like an AgentDB instance rather than a VectorStore. */
export function isAgentDBInstance(candidate: unknown): candidate is AgentDBLike {
  if (!candidate || typeof candidate !== 'object') return false;
  const c = candidate as Record<string, unknown>;
  return (
    typeof c.initialize === 'function' &&
    typeof c.getController === 'function' &&
    typeof c.store !== 'function'
  );
}

/** Text used to embed a stored value when the caller supplies no embedding. */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.pattern === 'string') return v.pattern;
    if (typeof v.threatType === 'string') {
      return [v.threatType, v.strategy].filter(s => typeof s === 'string').join(' ');
    }
  }
  return JSON.stringify(value) ?? '';
}

/**
 * VectorStore backed by AgentDB's HNSW vector backend and embedder.
 *
 * Values live in this process (the AgentDB backend indexes vectors only).
 * An empty string query lists the namespace, matching InMemoryVectorStore,
 * because the learning service counts entries that way.
 */
export class AgentDBVectorStore implements VectorStore {
  private readonly entries = new Map<string, Map<string, Entry>>();
  private ready?: Promise<{ backend: AgentDBVectorBackend; embedder: Embedder } | null>;
  private fallback?: InMemoryVectorStore;
  private fallbackReason?: string;
  private connected = false;

  constructor(private readonly options: AgentDBVectorStoreOptions = {}) {}

  /** 'agentdb' once initialised, 'memory' after a fallback, 'pending' before first use. */
  get mode(): 'agentdb' | 'memory' | 'pending' {
    if (this.fallback) return 'memory';
    return this.connected ? 'agentdb' : 'pending';
  }

  /** Why the store fell back to memory, if it did. */
  get fallbackCause(): string | undefined {
    return this.fallbackReason;
  }

  private init(): Promise<{ backend: AgentDBVectorBackend; embedder: Embedder } | null> {
    if (!this.ready) {
      this.ready = this.connect().then(r => {
        this.connected = true;
        return r;
      }).catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        this.fallbackReason = reason;
        this.fallback = new InMemoryVectorStore();
        (this.options.onFallback ??
          (r => console.warn(`[aidefence] agentdb unavailable, using in-memory store: ${r}`)))(reason);
        return null;
      });
    }
    return this.ready;
  }

  private async connect(): Promise<{ backend: AgentDBVectorBackend; embedder: Embedder }> {
    // A variable specifier keeps agentdb out of the type graph: it is optional.
    const specifier = 'agentdb';
    const load = this.options.importAgentDB ?? (() => import(specifier));
    let db = this.options.agentdb;
    let embedder = this.options.embedder;

    if (!db || !embedder) {
      const mod = (await load()) as Record<string, any>;
      if (!db) {
        if (typeof mod.AgentDB !== 'function') throw new Error('agentdb does not export AgentDB');
        db = new mod.AgentDB({ dbPath: this.options.dbPath ?? ':memory:' }) as AgentDBLike;
      }
      if (!embedder) {
        if (typeof mod.EmbeddingService !== 'function') {
          throw new Error('agentdb does not export EmbeddingService');
        }
        const service = new mod.EmbeddingService({
          model: 'Xenova/all-MiniLM-L6-v2',
          dimension: 384,
          provider: 'transformers',
        });
        await service.initialize();
        embedder = service as Embedder;
      }
    }

    await db.initialize();
    const backend = db.vectorBackend as AgentDBVectorBackend | undefined;
    if (!backend || typeof backend.insert !== 'function' || typeof backend.search !== 'function') {
      throw new Error('AgentDB has no vector backend after initialize()');
    }
    return { backend, embedder: embedder! };
  }

  private namespace(name: string): Map<string, Entry> {
    let ns = this.entries.get(name);
    if (!ns) {
      ns = new Map();
      this.entries.set(name, ns);
    }
    return ns;
  }

  async store(params: {
    namespace: string;
    key: string;
    value: unknown;
    embedding?: number[];
    ttl?: number;
  }): Promise<void> {
    const ready = await this.init();
    if (!ready) return this.fallback!.store(params);

    const id = params.namespace + SEP + params.key;
    const vector = params.embedding
      ? Float32Array.from(params.embedding)
      : await ready.embedder.embed(textOf(params.value));
    const ns = this.namespace(params.namespace);
    if (ns.get(params.key)?.indexed) await remove(ready.backend, id);
    const meta = { namespace: params.namespace, key: params.key };
    // Some backends (RuVector) are async-only and throw from the sync methods.
    if (ready.backend.insertAsync) await ready.backend.insertAsync(id, vector, meta);
    else ready.backend.insert(id, vector, meta);
    ns.set(params.key, { value: params.value, indexed: true });
  }

  async search(params: {
    namespace: string;
    query: string | number[];
    k?: number;
    minSimilarity?: number;
  }): Promise<Array<{ key: string; value: unknown; similarity: number }>> {
    const ready = await this.init();
    if (!ready) return this.fallback!.search(params);

    const ns = this.entries.get(params.namespace);
    if (!ns || ns.size === 0) return [];
    const k = params.k ?? 10;

    if (typeof params.query === 'string' && params.query.trim() === '') {
      return [...ns].slice(0, k).map(([key, e]) => ({ key, value: e.value, similarity: 1 }));
    }

    const vector =
      typeof params.query === 'string'
        ? await ready.embedder.embed(params.query)
        : Float32Array.from(params.query);
    const prefix = params.namespace + SEP;
    const min = params.minSimilarity ?? 0;
    const out: Array<{ key: string; value: unknown; similarity: number }> = [];
    // The backend index is shared across namespaces: over-fetch, then filter.
    const fetchK = Math.max(k * 4, k + 16);
    const hits = ready.backend.searchAsync
      ? await ready.backend.searchAsync(vector, fetchK)
      : ready.backend.search(vector, fetchK);
    for (const hit of hits) {
      if (!hit.id.startsWith(prefix) || hit.similarity < min) continue;
      const key = hit.id.slice(prefix.length);
      const entry = ns.get(key);
      if (!entry) continue;
      out.push({ key, value: entry.value, similarity: hit.similarity });
      if (out.length >= k) break;
    }
    return out;
  }

  async get(namespace: string, key: string): Promise<unknown | null> {
    const ready = await this.init();
    if (!ready) return this.fallback!.get(namespace, key);
    return this.entries.get(namespace)?.get(key)?.value ?? null;
  }

  async delete(namespace: string, key: string): Promise<void> {
    const ready = await this.init();
    if (!ready) return this.fallback!.delete(namespace, key);
    const ns = this.entries.get(namespace);
    if (ns?.get(key)?.indexed) await remove(ready.backend, namespace + SEP + key);
    ns?.delete(key);
  }
}

/**
 * Create a VectorStore backed by AgentDB, falling back to memory when agentdb
 * is not installed. Synchronous: agentdb is loaded on the first store call.
 */
export function createAgentDBVectorStore(options: AgentDBVectorStoreOptions = {}): AgentDBVectorStore {
  return new AgentDBVectorStore(options);
}
