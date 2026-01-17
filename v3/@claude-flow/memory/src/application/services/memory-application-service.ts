/**
 * Memory Application Service - Application Layer
 *
 * Orchestrates use cases and coordinates between domain and infrastructure.
 * Provides a simplified interface for external consumers.
 *
 * @module v3/memory/application/services
 */

import { MemoryEntry, MemoryType } from '../../domain/entities/memory-entry.js';
import { IMemoryRepository, VectorSearchResult, MemoryStatistics } from '../../domain/repositories/memory-repository.interface.js';
import { MemoryDomainService, ConsolidationOptions, ConsolidationResult } from '../../domain/services/memory-domain-service.js';
import { StoreMemoryCommandHandler, StoreMemoryInput } from '../commands/store-memory.command.js';
import { DeleteMemoryCommandHandler, BulkDeleteMemoryCommandHandler } from '../commands/delete-memory.command.js';
import { SearchMemoryQueryHandler, SearchMemoryInput, GetMemoryByKeyQueryHandler } from '../queries/search-memory.query.js';

/**
 * Memory Application Service
 *
 * Main entry point for memory operations.
 * Coordinates commands and queries with domain services.
 */
export class MemoryApplicationService {
  private readonly domainService: MemoryDomainService;
  private readonly storeHandler: StoreMemoryCommandHandler;
  private readonly deleteHandler: DeleteMemoryCommandHandler;
  private readonly bulkDeleteHandler: BulkDeleteMemoryCommandHandler;
  private readonly searchHandler: SearchMemoryQueryHandler;
  private readonly getByKeyHandler: GetMemoryByKeyQueryHandler;

  constructor(private readonly repository: IMemoryRepository) {
    this.domainService = new MemoryDomainService(repository);
    this.storeHandler = new StoreMemoryCommandHandler(repository, this.domainService);
    this.deleteHandler = new DeleteMemoryCommandHandler(repository);
    this.bulkDeleteHandler = new BulkDeleteMemoryCommandHandler(repository);
    this.searchHandler = new SearchMemoryQueryHandler(repository);
    this.getByKeyHandler = new GetMemoryByKeyQueryHandler(repository);
  }

  // ============================================================================
  // Store Operations (Commands)
  // ============================================================================

  /**
   * Store a memory entry
   */
  async store(input: StoreMemoryInput): Promise<MemoryEntry> {
    const result = await this.storeHandler.execute(input);
    return result.entry;
  }

  /**
   * Store multiple memory entries
   */
  async storeMany(inputs: StoreMemoryInput[]): Promise<MemoryEntry[]> {
    const results = await Promise.all(inputs.map((input) => this.storeHandler.execute(input)));
    return results.map((r) => r.entry);
  }

  // ============================================================================
  // Retrieve Operations (Queries)
  // ============================================================================

  /**
   * Get a memory entry by namespace and key
   */
  async get(namespace: string, key: string): Promise<MemoryEntry | null> {
    const result = await this.getByKeyHandler.execute({ namespace, key, trackAccess: true });
    return result.entry ?? null;
  }

  /**
   * Get a memory entry by ID
   */
  async getById(id: string): Promise<MemoryEntry | null> {
    return this.repository.findById(id);
  }

  /**
   * Search memory entries
   */
  async search(input: SearchMemoryInput): Promise<{
    entries: MemoryEntry[];
    total: number;
    hasMore: boolean;
  }> {
    const result = await this.searchHandler.execute(input);
    return {
      entries: result.entries,
      total: result.total,
      hasMore: result.hasMore,
    };
  }

  /**
   * Search by vector similarity
   */
  async searchByVector(
    vector: Float32Array,
    options?: {
      namespace?: string;
      limit?: number;
      threshold?: number;
    }
  ): Promise<VectorSearchResult[]> {
    return this.domainService.searchSimilarWithTracking(
      vector,
      options?.namespace,
      options?.limit ?? 10
    );
  }

  /**
   * Get all entries in a namespace
   */
  async getNamespace(namespace: string): Promise<MemoryEntry[]> {
    return this.repository.findByNamespace(namespace, { status: 'active' });
  }

  /**
   * List all namespaces
   */
  async listNamespaces(): Promise<string[]> {
    return this.repository.listNamespaces();
  }

  // ============================================================================
  // Delete Operations (Commands)
  // ============================================================================

  /**
   * Delete a memory entry by namespace and key
   */
  async delete(namespace: string, key: string, hardDelete = false): Promise<boolean> {
    const result = await this.deleteHandler.execute({ namespace, key, hardDelete });
    return result.deleted;
  }

  /**
   * Delete a memory entry by ID
   */
  async deleteById(id: string, hardDelete = false): Promise<boolean> {
    const result = await this.deleteHandler.execute({ id, hardDelete });
    return result.deleted;
  }

  /**
   * Delete all entries in a namespace
   */
  async deleteNamespace(namespace: string, hardDelete = false): Promise<number> {
    const entries = await this.repository.findByNamespace(namespace);
    const result = await this.bulkDeleteHandler.execute({
      ids: entries.map((e) => e.id),
      hardDelete,
    });
    return result.deletedCount;
  }

  /**
   * Clear all memory entries
   */
  async clear(): Promise<void> {
    await this.repository.clear();
  }

  // ============================================================================
  // Maintenance Operations
  // ============================================================================

  /**
   * Consolidate memories using specified strategy
   */
  async consolidate(options: ConsolidationOptions): Promise<ConsolidationResult> {
    return this.domainService.consolidate(options);
  }

  /**
   * Clean up expired memories
   */
  async cleanupExpired(): Promise<number> {
    return this.repository.deleteExpired();
  }

  /**
   * Archive cold (rarely accessed) memories
   */
  async archiveCold(milliseconds: number = 86400000): Promise<number> {
    return this.repository.archiveCold(milliseconds);
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  /**
   * Get memory statistics
   */
  async getStatistics(): Promise<MemoryStatistics> {
    return this.repository.getStatistics();
  }

  /**
   * Count entries matching criteria
   */
  async count(options?: {
    namespace?: string;
    type?: MemoryType;
  }): Promise<number> {
    return this.repository.count(options);
  }

  /**
   * Analyze a namespace
   */
  async analyzeNamespace(namespace: string) {
    return this.domainService.analyzeNamespace(namespace);
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Initialize the memory service
   */
  async initialize(): Promise<void> {
    await this.repository.initialize();
  }

  /**
   * Shutdown the memory service
   */
  async shutdown(): Promise<void> {
    await this.repository.shutdown();
  }
}
