/**
 * SPARC Memory Bank - Core Memory Manager
 * Implements CRDT-based conflict resolution for distributed memory synchronization
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { 
  MemoryItem, 
  MemoryQuery, 
  MemoryBackend, 
  ConflictResolution,
  MemoryNamespace,
  ReplicationConfig,
  CacheConfig
} from '../types';
import { SqliteBackend } from '../backends/sqlite-backend';
import { MarkdownBackend } from '../backends/markdown-backend';
import { MemoryCache } from '../cache/memory-cache';
import { MemoryIndexer } from '../indexer/memory-indexer';
import { ReplicationManager } from '../replication/replication-manager';
import { NamespaceManager } from '../namespaces/namespace-manager';

export interface MemoryManagerConfig {
  backend: 'sqlite' | 'markdown';
  backendConfig: any;
  cacheConfig?: CacheConfig;
  replicationConfig?: ReplicationConfig;
  enableIndexing?: boolean;
  enableNamespaces?: boolean;
}

export class MemoryManager extends EventEmitter {
  private backend: MemoryBackend;
  private cache: MemoryCache;
  private indexer: MemoryIndexer;
  private replicationManager?: ReplicationManager;
  private namespaceManager?: NamespaceManager;
  private conflictResolution: ConflictResolution;
  private localNodeId: string;

  constructor(config: MemoryManagerConfig) {
    super();
    
    this.localNodeId = uuidv4();
    
    // Initialize backend
    if (config.backend === 'sqlite') {
      this.backend = new SqliteBackend(config.backendConfig);
    } else {
      this.backend = new MarkdownBackend(config.backendConfig);
    }
    
    // Initialize cache
    this.cache = new MemoryCache(config.cacheConfig || {
      maxSize: 1000,
      ttl: 3600000, // 1 hour
      strategy: 'lru'
    });
    
    // Initialize indexer
    this.indexer = new MemoryIndexer({
      backend: this.backend,
      enableVectorSearch: config.enableIndexing || false
    });
    
    // Initialize replication if configured
    if (config.replicationConfig) {
      this.replicationManager = new ReplicationManager({
        localNodeId: this.localNodeId,
        backend: this.backend,
        config: config.replicationConfig
      });
    }
    
    // Initialize namespace manager if enabled
    if (config.enableNamespaces) {
      this.namespaceManager = new NamespaceManager({
        backend: this.backend
      });
    }
    
    // Initialize CRDT conflict resolution
    this.conflictResolution = new CRDTConflictResolution();
  }

  /**
   * Initialize the memory manager
   */
  async initialize(): Promise<void> {
    await this.backend.initialize();
    await this.indexer.initialize();
    
    if (this.replicationManager) {
      await this.replicationManager.initialize();
    }
    
    if (this.namespaceManager) {
      await this.namespaceManager.initialize();
    }
    
    this.emit('initialized');
  }

  /**
   * Store a memory item with CRDT conflict resolution
   */
  async store(item: Partial<MemoryItem>, namespace?: string): Promise<MemoryItem> {
    const fullItem: MemoryItem = {
      id: item.id || uuidv4(),
      category: item.category || 'general',
      key: item.key || uuidv4(),
      value: item.value,
      metadata: {
        ...item.metadata,
        nodeId: this.localNodeId,
        version: await this.generateVersion(item.id),
        timestamp: Date.now(),
        namespace: namespace || 'default'
      },
      vectorEmbedding: item.vectorEmbedding,
      ttl: item.ttl
    };

    // Apply namespace if manager is enabled
    if (this.namespaceManager && namespace) {
      fullItem.metadata.namespace = namespace;
    }

    // Check for conflicts
    const existingItem = await this.backend.get(fullItem.category, fullItem.key);
    if (existingItem) {
      const resolved = await this.conflictResolution.resolve(existingItem, fullItem);
      fullItem.value = resolved.value;
      fullItem.metadata = resolved.metadata;
    }

    // Store in backend
    await this.backend.store(fullItem);
    
    // Update cache
    this.cache.set(this.getCacheKey(fullItem), fullItem);
    
    // Update index
    await this.indexer.index(fullItem);
    
    // Replicate if enabled
    if (this.replicationManager) {
      await this.replicationManager.replicate(fullItem);
    }
    
    this.emit('stored', fullItem);
    return fullItem;
  }

  /**
   * Retrieve a memory item
   */
  async get(category: string, key: string, namespace?: string): Promise<MemoryItem | null> {
    const cacheKey = `${namespace || 'default'}:${category}:${key}`;
    
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.emit('cache-hit', cacheKey);
      return cached;
    }
    
    // Retrieve from backend
    const item = await this.backend.get(category, key);
    
    // Filter by namespace if specified
    if (item && namespace && item.metadata?.namespace !== namespace) {
      return null;
    }
    
    if (item) {
      this.cache.set(cacheKey, item);
    }
    
    return item;
  }

  /**
   * Query memory items with advanced filtering
   */
  async query(query: MemoryQuery): Promise<MemoryItem[]> {
    // Use indexer for optimized queries
    if (query.vectorSearch && this.indexer.supportsVectorSearch()) {
      return await this.indexer.vectorSearch(query);
    }
    
    // Regular query through backend
    let results = await this.backend.query(query);
    
    // Apply namespace filtering
    if (query.namespace && this.namespaceManager) {
      results = results.filter(item => 
        item.metadata?.namespace === query.namespace
      );
    }
    
    // Apply time-travel queries
    if (query.asOf) {
      results = results.filter(item => 
        item.metadata?.timestamp && item.metadata.timestamp <= query.asOf!
      );
    }
    
    return results;
  }

  /**
   * Delete a memory item
   */
  async delete(category: string, key: string, namespace?: string): Promise<boolean> {
    const cacheKey = `${namespace || 'default'}:${category}:${key}`;
    
    // Remove from cache
    this.cache.delete(cacheKey);
    
    // Remove from backend
    const deleted = await this.backend.delete(category, key);
    
    // Remove from index
    if (deleted) {
      await this.indexer.remove(category, key);
    }
    
    // Replicate deletion
    if (this.replicationManager && deleted) {
      await this.replicationManager.replicateDeletion(category, key);
    }
    
    this.emit('deleted', { category, key, namespace });
    return deleted;
  }

  /**
   * Export memory snapshot
   */
  async export(options?: {
    namespace?: string;
    categories?: string[];
    format?: 'json' | 'markdown';
  }): Promise<any> {
    const query: MemoryQuery = {
      namespace: options?.namespace,
      categories: options?.categories
    };
    
    const items = await this.query(query);
    
    if (options?.format === 'markdown') {
      return this.exportToMarkdown(items);
    }
    
    return {
      version: '1.0',
      nodeId: this.localNodeId,
      timestamp: Date.now(),
      items: items
    };
  }

  /**
   * Import memory snapshot
   */
  async import(snapshot: any, options?: {
    namespace?: string;
    merge?: boolean;
  }): Promise<number> {
    let imported = 0;
    
    for (const item of snapshot.items) {
      if (options?.namespace) {
        item.metadata = item.metadata || {};
        item.metadata.namespace = options.namespace;
      }
      
      if (options?.merge) {
        // Merge with existing items using CRDT
        await this.store(item, options?.namespace);
      } else {
        // Direct import without conflict resolution
        await this.backend.store(item);
        await this.indexer.index(item);
      }
      
      imported++;
    }
    
    this.emit('imported', { count: imported });
    return imported;
  }

  /**
   * Get memory statistics
   */
  async getStats(): Promise<any> {
    const stats = await this.backend.getStats();
    const cacheStats = this.cache.getStats();
    
    return {
      backend: stats,
      cache: cacheStats,
      nodeId: this.localNodeId,
      replication: this.replicationManager ? 
        await this.replicationManager.getStats() : null
    };
  }

  /**
   * Cleanup and close resources
   */
  async close(): Promise<void> {
    await this.backend.close();
    await this.indexer.close();
    
    if (this.replicationManager) {
      await this.replicationManager.close();
    }
    
    this.cache.clear();
    this.emit('closed');
  }

  /**
   * Generate version for CRDT
   */
  private async generateVersion(itemId?: string): Promise<string> {
    const timestamp = Date.now();
    const counter = await this.getVersionCounter(itemId);
    return `${timestamp}.${counter}.${this.localNodeId}`;
  }

  /**
   * Get version counter for an item
   */
  private async getVersionCounter(itemId?: string): Promise<number> {
    // Simple counter implementation
    // In production, this would be persisted
    return Math.floor(Math.random() * 1000);
  }

  /**
   * Get cache key for an item
   */
  private getCacheKey(item: MemoryItem): string {
    const namespace = item.metadata?.namespace || 'default';
    return `${namespace}:${item.category}:${item.key}`;
  }

  /**
   * Export items to markdown format
   */
  private exportToMarkdown(items: MemoryItem[]): string {
    let markdown = '# Memory Bank Export\n\n';
    markdown += `Generated: ${new Date().toISOString()}\n\n`;
    
    const byCategory = items.reduce((acc, item) => {
      if (!acc[item.category]) acc[item.category] = [];
      acc[item.category].push(item);
      return acc;
    }, {} as Record<string, MemoryItem[]>);
    
    for (const [category, categoryItems] of Object.entries(byCategory)) {
      markdown += `## ${category}\n\n`;
      
      for (const item of categoryItems) {
        markdown += `### ${item.key}\n`;
        markdown += `- ID: ${item.id}\n`;
        markdown += `- Timestamp: ${new Date(item.metadata?.timestamp || 0).toISOString()}\n`;
        markdown += `- Value:\n\`\`\`json\n${JSON.stringify(item.value, null, 2)}\n\`\`\`\n\n`;
      }
    }
    
    return markdown;
  }
}

/**
 * CRDT-based conflict resolution
 */
class CRDTConflictResolution implements ConflictResolution {
  async resolve(existing: MemoryItem, incoming: MemoryItem): Promise<MemoryItem> {
    // Last-write-wins with vector clock comparison
    const existingVersion = this.parseVersion(existing.metadata?.version || '');
    const incomingVersion = this.parseVersion(incoming.metadata?.version || '');
    
    if (this.compareVersions(existingVersion, incomingVersion) < 0) {
      // Incoming is newer
      return incoming;
    } else if (this.compareVersions(existingVersion, incomingVersion) > 0) {
      // Existing is newer
      return existing;
    } else {
      // Concurrent updates - merge values
      return this.mergeItems(existing, incoming);
    }
  }

  private parseVersion(version: string): {
    timestamp: number;
    counter: number;
    nodeId: string;
  } {
    const parts = version.split('.');
    return {
      timestamp: parseInt(parts[0] || '0'),
      counter: parseInt(parts[1] || '0'),
      nodeId: parts[2] || ''
    };
  }

  private compareVersions(v1: any, v2: any): number {
    // Compare timestamps first
    if (v1.timestamp !== v2.timestamp) {
      return v1.timestamp - v2.timestamp;
    }
    
    // Compare counters if timestamps are equal
    if (v1.counter !== v2.counter) {
      return v1.counter - v2.counter;
    }
    
    // Use node ID as tiebreaker
    return v1.nodeId.localeCompare(v2.nodeId);
  }

  private mergeItems(existing: MemoryItem, incoming: MemoryItem): MemoryItem {
    // Deep merge strategy
    const merged = { ...existing };
    
    // Merge values
    if (typeof existing.value === 'object' && typeof incoming.value === 'object') {
      merged.value = this.deepMerge(existing.value, incoming.value);
    } else {
      // For non-objects, use incoming value
      merged.value = incoming.value;
    }
    
    // Merge metadata
    merged.metadata = {
      ...existing.metadata,
      ...incoming.metadata,
      mergedAt: Date.now(),
      mergedFrom: [existing.metadata?.nodeId, incoming.metadata?.nodeId]
    };
    
    return merged;
  }

  private deepMerge(obj1: any, obj2: any): any {
    const result = { ...obj1 };
    
    for (const key in obj2) {
      if (obj2.hasOwnProperty(key)) {
        if (typeof obj2[key] === 'object' && typeof obj1[key] === 'object') {
          result[key] = this.deepMerge(obj1[key], obj2[key]);
        } else {
          result[key] = obj2[key];
        }
      }
    }
    
    return result;
  }
}