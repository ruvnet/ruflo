/**
 * Memory Domain Service - Domain Layer
 *
 * Contains domain logic that doesn't naturally fit within a single entity.
 * Coordinates between multiple memory entries and enforces domain rules.
 *
 * @module v3/memory/domain/services
 */

import { MemoryEntry, MemoryType, MemoryEntryProps } from '../entities/memory-entry.js';
import { IMemoryRepository, VectorSearchResult } from '../repositories/memory-repository.interface.js';

/**
 * Memory consolidation strategy
 */
export type ConsolidationStrategy = 'merge' | 'dedupe' | 'prune' | 'summarize';

/**
 * Memory consolidation options
 */
export interface ConsolidationOptions {
  strategy: ConsolidationStrategy;
  namespace?: string;
  threshold?: number;
  maxAge?: number; // Maximum age in milliseconds
  keepHot?: boolean; // Keep frequently accessed memories
}

/**
 * Consolidation result
 */
export interface ConsolidationResult {
  processed: number;
  consolidated: number;
  removed: number;
  newEntries: MemoryEntry[];
}

/**
 * Memory deduplication result
 */
export interface DeduplicationResult {
  duplicatesFound: number;
  duplicatesRemoved: number;
  groupsProcessed: number;
}

/**
 * Memory namespace statistics
 */
export interface NamespaceAnalysis {
  namespace: string;
  totalEntries: number;
  activeEntries: number;
  totalSize: number;
  averageAccessCount: number;
  oldestEntry: Date;
  newestEntry: Date;
  typeDistribution: Record<MemoryType, number>;
}

/**
 * Memory Domain Service
 *
 * Provides domain-level operations that span multiple entities.
 * Implements business rules for memory management.
 */
export class MemoryDomainService {
  constructor(private readonly repository: IMemoryRepository) {}

  /**
   * Store a new memory with automatic type detection
   */
  async storeWithTypeDetection(
    namespace: string,
    key: string,
    value: unknown,
    vector?: Float32Array
  ): Promise<MemoryEntry> {
    const type = this.detectMemoryType(value);
    const entry = MemoryEntry.create({
      namespace,
      key,
      value,
      type,
      vector,
    });
    await this.repository.save(entry);
    return entry;
  }

  /**
   * Retrieve and record access
   */
  async retrieveWithAccessTracking(
    namespace: string,
    key: string
  ): Promise<MemoryEntry | null> {
    const entry = await this.repository.findByKey(namespace, key);
    if (entry && entry.isAccessible()) {
      entry.recordAccess();
      await this.repository.save(entry);
    }
    return entry;
  }

  /**
   * Search for similar memories and record access
   */
  async searchSimilarWithTracking(
    vector: Float32Array,
    namespace?: string,
    limit: number = 10
  ): Promise<VectorSearchResult[]> {
    const results = await this.repository.searchByVector({
      vector,
      namespace,
      limit,
    });

    // Record access for all returned entries
    await Promise.all(
      results.map(async (result) => {
        result.entry.recordAccess();
        await this.repository.save(result.entry);
      })
    );

    return results;
  }

  /**
   * Consolidate memories based on strategy
   */
  async consolidate(options: ConsolidationOptions): Promise<ConsolidationResult> {
    const entries = await this.repository.findByNamespace(
      options.namespace ?? 'default',
      { status: 'active' }
    );

    let result: ConsolidationResult = {
      processed: entries.length,
      consolidated: 0,
      removed: 0,
      newEntries: [],
    };

    switch (options.strategy) {
      case 'prune':
        result = await this.pruneOldMemories(entries, options);
        break;
      case 'dedupe':
        const dedupeResult = await this.deduplicateMemories(entries, options);
        result.removed = dedupeResult.duplicatesRemoved;
        break;
      case 'merge':
        result = await this.mergeRelatedMemories(entries, options);
        break;
      default:
        // No-op for unknown strategies
    }

    return result;
  }

  /**
   * Detect memory type based on value structure
   */
  private detectMemoryType(value: unknown): MemoryType {
    if (typeof value === 'string') {
      // Long text is likely semantic
      if (value.length > 500) return 'semantic';
      // Short instructions are procedural
      if (value.includes('->') || value.includes('then')) return 'procedural';
    }

    if (typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>;
      // Objects with timestamps are episodic
      if ('timestamp' in obj || 'when' in obj || 'date' in obj) return 'episodic';
      // Objects with steps are procedural
      if ('steps' in obj || 'actions' in obj) return 'procedural';
    }

    // Default to working memory for short-term storage
    return 'working';
  }

  /**
   * Prune old, rarely accessed memories
   */
  private async pruneOldMemories(
    entries: MemoryEntry[],
    options: ConsolidationOptions
  ): Promise<ConsolidationResult> {
    const maxAge = options.maxAge ?? 7 * 24 * 60 * 60 * 1000; // 7 days default
    const threshold = options.threshold ?? 5; // Minimum access count to keep
    const now = Date.now();
    const toRemove: string[] = [];

    for (const entry of entries) {
      const age = now - entry.createdAt.getTime();
      const isOld = age > maxAge;
      const isRarelyAccessed = entry.accessCount < threshold;

      // Keep hot memories if requested
      if (options.keepHot && entry.isHot()) continue;

      if (isOld && isRarelyAccessed) {
        entry.archive();
        toRemove.push(entry.id);
      }
    }

    if (toRemove.length > 0) {
      await this.repository.deleteMany(toRemove);
    }

    return {
      processed: entries.length,
      consolidated: 0,
      removed: toRemove.length,
      newEntries: [],
    };
  }

  /**
   * Find and remove duplicate memories
   */
  private async deduplicateMemories(
    entries: MemoryEntry[],
    options: ConsolidationOptions
  ): Promise<DeduplicationResult> {
    const threshold = options.threshold ?? 0.95; // Similarity threshold
    const duplicates: string[] = [];
    const processed = new Set<string>();

    for (let i = 0; i < entries.length; i++) {
      if (processed.has(entries[i].id)) continue;

      const entry = entries[i];
      if (!entry.vector) continue;

      // Find similar entries
      const similar = await this.repository.searchByVector({
        vector: entry.vector,
        namespace: entry.namespace,
        limit: 10,
        threshold,
      });

      // Mark duplicates (keep the one with highest access count)
      const group = similar
        .filter((s) => s.entry.id !== entry.id && s.similarity >= threshold)
        .sort((a, b) => b.entry.accessCount - a.entry.accessCount);

      for (const dup of group.slice(1)) {
        duplicates.push(dup.entry.id);
        processed.add(dup.entry.id);
      }

      processed.add(entry.id);
    }

    if (duplicates.length > 0) {
      await this.repository.deleteMany(duplicates);
    }

    return {
      duplicatesFound: duplicates.length,
      duplicatesRemoved: duplicates.length,
      groupsProcessed: processed.size,
    };
  }

  /**
   * Merge related memories into consolidated entries
   */
  private async mergeRelatedMemories(
    entries: MemoryEntry[],
    options: ConsolidationOptions
  ): Promise<ConsolidationResult> {
    const threshold = options.threshold ?? 0.8;
    const newEntries: MemoryEntry[] = [];
    const toRemove: string[] = [];
    const processed = new Set<string>();

    for (const entry of entries) {
      if (processed.has(entry.id)) continue;
      if (!entry.vector) {
        processed.add(entry.id);
        continue;
      }

      // Find related entries
      const related = await this.repository.searchByVector({
        vector: entry.vector,
        namespace: entry.namespace,
        limit: 5,
        threshold,
      });

      if (related.length > 1) {
        // Merge related entries
        const merged = this.mergeEntries(related.map((r) => r.entry));
        newEntries.push(merged);

        for (const r of related) {
          toRemove.push(r.entry.id);
          processed.add(r.entry.id);
        }
      } else {
        processed.add(entry.id);
      }
    }

    // Remove old entries and save merged ones
    if (toRemove.length > 0) {
      await this.repository.deleteMany(toRemove);
    }
    if (newEntries.length > 0) {
      await this.repository.saveMany(newEntries);
    }

    return {
      processed: entries.length,
      consolidated: newEntries.length,
      removed: toRemove.length,
      newEntries,
    };
  }

  /**
   * Merge multiple entries into one
   */
  private mergeEntries(entries: MemoryEntry[]): MemoryEntry {
    // Sort by access count to prioritize most accessed
    const sorted = [...entries].sort((a, b) => b.accessCount - a.accessCount);
    const primary = sorted[0];

    // Combine metadata
    const combinedMetadata: Record<string, unknown> = {};
    for (const entry of entries) {
      Object.assign(combinedMetadata, entry.metadata);
    }
    combinedMetadata.mergedFrom = entries.map((e) => e.id);
    combinedMetadata.mergedAt = new Date().toISOString();

    // Create merged entry
    return MemoryEntry.create({
      namespace: primary.namespace,
      key: `merged_${Date.now()}`,
      value: {
        primary: primary.value,
        related: sorted.slice(1).map((e) => e.value),
      },
      type: primary.type,
      vector: primary.vector,
      metadata: combinedMetadata,
      accessCount: entries.reduce((sum, e) => sum + e.accessCount, 0),
    });
  }

  /**
   * Analyze a namespace
   */
  async analyzeNamespace(namespace: string): Promise<NamespaceAnalysis> {
    const entries = await this.repository.findByNamespace(namespace);
    const active = entries.filter((e) => e.status === 'active');

    const typeDistribution: Record<MemoryType, number> = {
      semantic: 0,
      episodic: 0,
      procedural: 0,
      working: 0,
    };

    let totalAccessCount = 0;
    let totalSize = 0;
    let oldestDate = new Date();
    let newestDate = new Date(0);

    for (const entry of entries) {
      typeDistribution[entry.type]++;
      totalAccessCount += entry.accessCount;
      totalSize += JSON.stringify(entry.value).length;

      if (entry.createdAt < oldestDate) oldestDate = entry.createdAt;
      if (entry.createdAt > newestDate) newestDate = entry.createdAt;
    }

    return {
      namespace,
      totalEntries: entries.length,
      activeEntries: active.length,
      totalSize,
      averageAccessCount: entries.length > 0 ? totalAccessCount / entries.length : 0,
      oldestEntry: oldestDate,
      newestEntry: newestDate,
      typeDistribution,
    };
  }
}
