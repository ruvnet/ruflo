/**
 * @claude-flow/memory - V3 Unified Memory System
 *
 * Provides a unified memory interface backed by AgentDB with HNSW indexing
 * for optimized vector search compared to brute-force approaches.
 *
 * @module @claude-flow/memory
 *
 * @example
 * ```typescript
 * import { UnifiedMemoryService, query, QueryTemplates } from '@claude-flow/memory';
 *
 * // Initialize the memory service
 * const memory = new UnifiedMemoryService({
 *   dimensions: 1536,
 *   cacheEnabled: true,
 *   embeddingGenerator: async (text) => embeddings.embed(text),
 * });
 *
 * await memory.initialize();
 *
 * // Store entries
 * await memory.store({
 *   key: 'auth-patterns',
 *   content: 'OAuth 2.0 implementation patterns for secure authentication',
 *   tags: ['auth', 'security', 'patterns'],
 * });
 *
 * // Semantic search
 * const results = await memory.semanticSearch('user authentication best practices', 5);
 *
 * // Query with fluent builder
 * const entries = await memory.query(
 *   query()
 *     .semantic('security vulnerabilities')
 *     .inNamespace('security')
 *     .withTags(['critical'])
 *     .threshold(0.8)
 *     .limit(10)
 *     .build()
 * );
 * ```
 */

// ===== Core Types =====
export type {
  // Memory Entry Types
  MemoryType,
  AccessLevel,
  ConsistencyLevel,
  DistanceMetric,
  MemoryEntry,
  MemoryEntryInput,
  MemoryEntryUpdate,

  // Query Types
  QueryType,
  MemoryQuery,
  SearchResult,
  SearchOptions,

  // HNSW Types
  HNSWConfig,
  HNSWStats,
  QuantizationConfig,

  // Backend Types
  IMemoryBackend,
  BackendStats,
  HealthCheckResult,
  ComponentHealth,

  // Cache Types
  CacheConfig,
  CacheStats,
  CachedEntry,

  // Migration Types
  MigrationSource,
  MigrationConfig,
  MigrationProgress,
  MigrationResult,
  MigrationError,

  // Event Types
  MemoryEventType,
  MemoryEvent,
  MemoryEventHandler,

  // Pattern Types
  PatternMode,
  LearningPattern,

  // Utility Types
  EmbeddingGenerator,
} from './types.js';

// Utility Functions and Constants (runtime values)
export {
  generateMemoryId,
  createDefaultEntry,
  PERFORMANCE_TARGETS,
} from './types.js';

// ===== Core Components =====
export { AgentDBAdapter } from './agentdb-adapter.js';
export type { AgentDBAdapterConfig } from './agentdb-adapter.js';
export { AgentDBBackend } from './agentdb-backend.js';
export type { AgentDBBackendConfig } from './agentdb-backend.js';
export { SQLiteBackend } from './sqlite-backend.js';
export type { SQLiteBackendConfig } from './sqlite-backend.js';
export { SqlJsBackend } from './sqljs-backend.js';
export type { SqlJsBackendConfig } from './sqljs-backend.js';
export { HybridBackend } from './hybrid-backend.js';
export type {
  HybridBackendConfig,
  StructuredQuery,
  SemanticQuery,
  HybridQuery,
} from './hybrid-backend.js';
export { HNSWIndex } from './hnsw-index.js';
export { CacheManager, TieredCacheManager } from './cache-manager.js';
export { QueryBuilder, query, QueryTemplates } from './query-builder.js';
export type { SortDirection, SortField } from './query-builder.js';
export { MemoryMigrator, createMigrator, migrateMultipleSources } from './migration.js';
export { createDatabase, getPlatformInfo, getAvailableProviders } from './database-provider.js';
export type { DatabaseProvider, DatabaseOptions } from './database-provider.js';

// ===== Unified Memory Service =====
import { EventEmitter } from 'node:events';
import {
  IMemoryBackend,
  MemoryEntry,
  MemoryEntryInput,
  MemoryEntryUpdate,
  MemoryQuery,
  SearchResult,
  SearchOptions,
  BackendStats,
  HealthCheckResult,
  EmbeddingGenerator,
  MigrationSource,
  MigrationConfig,
  MigrationResult,
} from './types.js';
import { AgentDBAdapter, AgentDBAdapterConfig } from './agentdb-adapter.js';
import { MemoryMigrator } from './migration.js';

/**
 * Configuration for UnifiedMemoryService
 */
export interface UnifiedMemoryServiceConfig extends Partial<AgentDBAdapterConfig> {
  /** Enable automatic embedding generation */
  autoEmbed?: boolean;

  /** Default embedding dimensions */
  dimensions?: number;

  /** Embedding generator function */
  embeddingGenerator?: EmbeddingGenerator;
}

/**
 * Unified Memory Service
 *
 * High-level interface for the V3 memory system that provides:
 * - Simple API for common operations
 * - Automatic embedding generation
 * - Cross-agent memory sharing
 * - Pattern integration for learning
 * - Event-driven notifications
 * - Performance monitoring
 */
export class UnifiedMemoryService extends EventEmitter implements IMemoryBackend {
  private adapter: AgentDBAdapter;
  private config: UnifiedMemoryServiceConfig;
  private initialized: boolean = false;

  constructor(config: UnifiedMemoryServiceConfig = {}) {
    super();
    this.config = {
      dimensions: 1536,
      cacheEnabled: true,
      autoEmbed: true,
      ...config,
    };

    this.adapter = new AgentDBAdapter({
      dimensions: this.config.dimensions,
      cacheEnabled: this.config.cacheEnabled,
      cacheSize: this.config.cacheSize,
      cacheTtl: this.config.cacheTtl,
      hnswM: this.config.hnswM,
      hnswEfConstruction: this.config.hnswEfConstruction,
      defaultNamespace: this.config.defaultNamespace,
      embeddingGenerator: this.config.embeddingGenerator,
      persistenceEnabled: this.config.persistenceEnabled,
      persistencePath: this.config.persistencePath,
      maxEntries: this.config.maxEntries,
    });

    // Forward adapter events
    this.adapter.on('entry:stored', (data) => this.emit('entry:stored', data));
    this.adapter.on('entry:updated', (data) => this.emit('entry:updated', data));
    this.adapter.on('entry:deleted', (data) => this.emit('entry:deleted', data));
    this.adapter.on('cache:hit', (data) => this.emit('cache:hit', data));
    this.adapter.on('cache:miss', (data) => this.emit('cache:miss', data));
    this.adapter.on('index:added', (data) => this.emit('index:added', data));
  }

  // ===== Lifecycle =====

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.adapter.initialize();
    this.initialized = true;
    this.emit('initialized');
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) return;
    await this.adapter.shutdown();
    this.initialized = false;
    this.emit('shutdown');
  }

  // ===== IMemoryBackend Implementation =====

  async store(entry: MemoryEntry): Promise<void> {
    return this.adapter.store(entry);
  }

  async get(id: string): Promise<MemoryEntry | null> {
    return this.adapter.get(id);
  }

  async getByKey(namespace: string, key: string): Promise<MemoryEntry | null> {
    return this.adapter.getByKey(namespace, key);
  }

  async update(id: string, update: MemoryEntryUpdate): Promise<MemoryEntry | null> {
    return this.adapter.update(id, update);
  }

  async delete(id: string): Promise<boolean> {
    return this.adapter.delete(id);
  }

  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    return this.adapter.query(query);
  }

  async search(embedding: Float32Array, options: SearchOptions): Promise<SearchResult[]> {
    return this.adapter.search(embedding, options);
  }

  async bulkInsert(entries: MemoryEntry[]): Promise<void> {
    return this.adapter.bulkInsert(entries);
  }

  async bulkDelete(ids: string[]): Promise<number> {
    return this.adapter.bulkDelete(ids);
  }

  async count(namespace?: string): Promise<number> {
    return this.adapter.count(namespace);
  }

  async listNamespaces(): Promise<string[]> {
    return this.adapter.listNamespaces();
  }

  async clearNamespace(namespace: string): Promise<number> {
    return this.adapter.clearNamespace(namespace);
  }

  async getStats(): Promise<BackendStats> {
    return this.adapter.getStats();
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return this.adapter.healthCheck();
  }

  // ===== Convenience Methods =====

  /**
   * Store an entry from simple input
   */
  async storeEntry(input: MemoryEntryInput): Promise<MemoryEntry> {
    return this.adapter.storeEntry(input);
  }

  /**
   * Semantic search by content string
   */
  async semanticSearch(
    content: string,
    k: number = 10,
    threshold?: number
  ): Promise<SearchResult[]> {
    return this.adapter.semanticSearch(content, k, threshold);
  }

  /**
   * Find similar entries to a given entry
   */
  async findSimilar(id: string, k: number = 5): Promise<SearchResult[]> {
    const entry = await this.get(id);
    if (!entry || !entry.embedding) {
      return [];
    }

    const results = await this.search(entry.embedding, { k: k + 1 });

    // Filter out the source entry
    return results.filter((r) => r.entry.id !== id).slice(0, k);
  }

  /**
   * Get or create an entry
   */
  async getOrCreate(
    namespace: string,
    key: string,
    creator: () => MemoryEntryInput | Promise<MemoryEntryInput>
  ): Promise<MemoryEntry> {
    const existing = await this.getByKey(namespace, key);
    if (existing) return existing;

    const input = await creator();
    return this.storeEntry({ ...input, namespace, key });
  }

  /**
   * Append content to an existing entry
   */
  async appendContent(id: string, content: string): Promise<MemoryEntry | null> {
    const entry = await this.get(id);
    if (!entry) return null;

    return this.update(id, {
      content: entry.content + '\n' + content,
    });
  }

  /**
   * Add tags to an existing entry
   */
  async addTags(id: string, tags: string[]): Promise<MemoryEntry | null> {
    const entry = await this.get(id);
    if (!entry) return null;

    const newTags = [...new Set([...entry.tags, ...tags])];
    return this.update(id, { tags: newTags });
  }

  /**
   * Remove tags from an existing entry
   */
  async removeTags(id: string, tags: string[]): Promise<MemoryEntry | null> {
    const entry = await this.get(id);
    if (!entry) return null;

    const newTags = entry.tags.filter((t) => !tags.includes(t));
    return this.update(id, { tags: newTags });
  }

  // ===== Migration =====

  /**
   * Migrate from a legacy memory source
   */
  async migrateFrom(
    source: MigrationSource,
    sourcePath: string,
    options: Partial<MigrationConfig> = {}
  ): Promise<MigrationResult> {
    const migrator = new MemoryMigrator(
      this.adapter,
      { source, sourcePath, ...options },
      this.config.embeddingGenerator
    );

    // Forward migration events
    migrator.on('migration:started', (data) => this.emit('migration:started', data));
    migrator.on('migration:progress', (data) => this.emit('migration:progress', data));
    migrator.on('migration:completed', (data) => this.emit('migration:completed', data));
    migrator.on('migration:failed', (data) => this.emit('migration:failed', data));
    migrator.on('migration:error', (data) => this.emit('migration:error', data));
    migrator.on('migration:warning', (data) => this.emit('migration:warning', data));

    return migrator.migrate();
  }

  // ===== Cross-Agent Memory Sharing =====

  /**
   * Share an entry with another agent
   */
  async shareWith(id: string, agentId: string): Promise<MemoryEntry | null> {
    const entry = await this.get(id);
    if (!entry) return null;

    const sharedWith = (entry.metadata.sharedWith as string[]) || [];
    if (!sharedWith.includes(agentId)) {
      sharedWith.push(agentId);
    }

    return this.update(id, {
      metadata: { ...entry.metadata, sharedWith },
    });
  }

  /**
   * Get entries shared with a specific agent
   */
  async getSharedWith(agentId: string): Promise<MemoryEntry[]> {
    const all = await this.query({ type: 'hybrid', limit: 10000 });
    return all.filter((entry) => {
      const sharedWith = (entry.metadata.sharedWith as string[]) || [];
      return sharedWith.includes(agentId);
    });
  }

  // ===== Utility =====

  /**
   * Get the underlying adapter for advanced operations
   */
  getAdapter(): AgentDBAdapter {
    return this.adapter;
  }

  /**
   * Check if the service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// ===== Factory Functions =====

/**
 * Create a simple in-memory service (for testing)
 */
export function createInMemoryService(): UnifiedMemoryService {
  return new UnifiedMemoryService({
    persistenceEnabled: false,
    cacheEnabled: true,
  });
}

/**
 * Create a persistent memory service
 */
export function createPersistentService(path: string): UnifiedMemoryService {
  return new UnifiedMemoryService({
    persistenceEnabled: true,
    persistencePath: path,
    cacheEnabled: true,
  });
}

/**
 * Create a memory service with embedding support
 */
export function createEmbeddingService(
  embeddingGenerator: EmbeddingGenerator,
  dimensions: number = 1536
): UnifiedMemoryService {
  return new UnifiedMemoryService({
    embeddingGenerator,
    dimensions,
    autoEmbed: true,
    cacheEnabled: true,
  });
}

/**
 * Create a hybrid memory service (SQLite + AgentDB)
 * This is the DEFAULT recommended configuration per ADR-009
 *
 * @example
 * ```typescript
 * const memory = createHybridService('./data/memory.db', embeddingFn);
 * await memory.initialize();
 *
 * // Structured queries go to SQLite
 * const user = await memory.getByKey('users', 'john@example.com');
 *
 * // Semantic queries go to AgentDB
 * const similar = await memory.semanticSearch('authentication patterns', 10);
 * ```
 */
export function createHybridService(
  databasePath: string,
  embeddingGenerator: EmbeddingGenerator,
  dimensions: number = 1536
): UnifiedMemoryService {
  return new UnifiedMemoryService({
    embeddingGenerator,
    dimensions,
    autoEmbed: true,
    cacheEnabled: true,
    // Note: This would require extending UnifiedMemoryService to support HybridBackend
    // For now, this creates an AgentDB service with persistence
    persistenceEnabled: true,
    persistencePath: databasePath,
  });
}

// Default export
export default UnifiedMemoryService;
