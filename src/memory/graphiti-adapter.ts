/**
 * Graphiti Memory Adapter for Claude-Flow
 * 
 * Integrates Graphiti's knowledge graph capabilities into Claude-Flow's
 * memory and hive-mind systems, enabling persistent, queryable memory
 * with rich relationships and temporal metadata.
 * 
 * @author Mattae Cooper [research@aegntic.ai]
 * @since v2.0.0-alpha
 */

import { EventEmitter } from 'node:events';
import type { ILogger } from '../core/logger.js';
import { generateId } from '../utils/helpers.js';
import type { MemoryEntry } from './advanced-memory-manager.js';

export interface GraphitiConfig {
  enabled: boolean;
  apiEndpoint?: string;
  apiKey?: string;
  defaultGroupId?: string;
  maxNodes?: number;
  maxFacts?: number;
  enableAutoSync?: boolean;
  syncInterval?: number;
  enableTemporalTracking?: boolean;
  knowledgeRetentionDays?: number;
}

export interface GraphitiNode {
  uuid: string;
  name: string;
  entityType: string;
  observations: string[];
  groupId: string;
  createdAt: Date;
  updatedAt: Date;
  summary?: string;
}

export interface GraphitiEdge {
  uuid: string;
  from: string;
  to: string;
  relationType: string;
  groupId: string;
  createdAt: Date;
  invalid?: boolean;
  validUntil?: Date;
}

export interface GraphitiMetrics {
  operationLatency: Map<string, number[]>;
  successCount: Map<string, number>;
  errorCount: Map<string, number>;
  retryCount: Map<string, number>;
  lastUpdated: Date;
}

export interface RetryOptions {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

export interface CacheEntry<T> {
  value: T;
  lastAccessed: Date;
  accessCount: number;
}

export class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (entry) {
      entry.lastAccessed = new Date();
      entry.accessCount++;
      return entry.value;
    }
    return undefined;
  }

  set(key: string, value: T): void {
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      // Remove least recently used item
      let lruKey: string | undefined;
      let lruTime = new Date();
      
      for (const [k, entry] of this.cache.entries()) {
        if (entry.lastAccessed < lruTime) {
          lruTime = entry.lastAccessed;
          lruKey = k;
        }
      }
      
      if (lruKey) {
        this.cache.delete(lruKey);
      }
    }

    this.cache.set(key, {
      value,
      lastAccessed: new Date(),
      accessCount: 1
    });
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  getStats(): { size: number; maxSize: number; hitRate: number } {
    const totalAccess = Array.from(this.cache.values())
      .reduce((sum, entry) => sum + entry.accessCount, 0);
    const hitRate = totalAccess > 0 ? this.cache.size / totalAccess : 0;
    
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate
    };
  }
}

export interface GraphitiEpisode {
  uuid: string;
  name: string;
  content: string;
  source: 'text' | 'json' | 'message';
  sourceDescription?: string;
  groupId: string;
  createdAt: Date;
}

export interface GraphitiSearchResult {
  nodes?: GraphitiNode[];
  edges?: GraphitiEdge[];
  facts?: string[];
  relevanceScore: number;
}

export class GraphitiMemoryAdapter extends EventEmitter {
  private config: GraphitiConfig;
  private logger?: ILogger;
  private isConnected: boolean = false;
  private syncTimer?: NodeJS.Timeout;
  private episodeQueue: Map<string, GraphitiEpisode[]> = new Map();
  private nodeCache: Map<string, GraphitiNode> = new Map();
  private edgeCache: Map<string, GraphitiEdge> = new Map();
  
  // Performance monitoring (implementing ruvnet's suggestion)
  private metrics: GraphitiMetrics = {
    operationLatency: new Map(),
    successCount: new Map(),
    errorCount: new Map(),
    retryCount: new Map(),
    lastUpdated: new Date()
  };
  
  // Retry configuration (implementing ruvnet's suggestion)
  private retryOptions: RetryOptions = {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2
  };
  
  // LRU cache for frequently accessed knowledge (implementing ruvnet's suggestion)
  private knowledgeCache = new LRUCache<GraphitiNode[]>(200);
  private queryCache = new LRUCache<SearchResult[]>(100);

  constructor(config: GraphitiConfig, logger?: ILogger) {
    super();
    this.config = {
      enabled: true,
      maxNodes: 10000,
      maxFacts: 50000,
      enableAutoSync: true,
      syncInterval: 30000, // 30 seconds
      enableTemporalTracking: true,
      knowledgeRetentionDays: 90,
      ...config
    };
    this.logger = logger;
    
    if (this.config.enabled) {
      this.initialize();
    }
  }

  private async initialize(): Promise<void> {
    try {
      // Check if graphiti MCP server is available
      const isAvailable = await this.checkGraphitiAvailability();
      
      if (isAvailable) {
        this.isConnected = true;
        this.emit('connected');
        this.logger?.info('Graphiti memory adapter connected successfully');
        
        if (this.config.enableAutoSync) {
          this.startAutoSync();
        }
      } else {
        this.logger?.warn('Graphiti MCP server not available, running in fallback mode');
        this.emit('fallback');
      }
    } catch (error) {
      this.logger?.error('Failed to initialize Graphiti adapter', error);
      this.emit('error', error);
    }
  }

  private async checkGraphitiAvailability(): Promise<boolean> {
    // Check if graphiti MCP tools are available
    // This would be replaced with actual MCP tool check
    try {
      // Simulate checking for graphiti tools
      return typeof global.mcp__graphiti__add_memory === 'function';
    } catch {
      return false;
    }
  }

  /**
   * Record operation latency and update metrics
   * Implements ruvnet's suggestion for performance monitoring
   */
  private recordLatency(operation: string, duration: number): void {
    const latencies = this.metrics.operationLatency.get(operation) || [];
    latencies.push(duration);
    
    // Keep only last 100 measurements for memory efficiency
    if (latencies.length > 100) {
      latencies.shift();
    }
    
    this.metrics.operationLatency.set(operation, latencies);
    this.metrics.lastUpdated = new Date();
  }

  /**
   * Record operation success/failure
   */
  private recordOperation(operation: string, success: boolean): void {
    if (success) {
      const count = this.metrics.successCount.get(operation) || 0;
      this.metrics.successCount.set(operation, count + 1);
    } else {
      const count = this.metrics.errorCount.get(operation) || 0;
      this.metrics.errorCount.set(operation, count + 1);
    }
    this.metrics.lastUpdated = new Date();
  }

  /**
   * Record retry attempt
   */
  private recordRetry(operation: string): void {
    const count = this.metrics.retryCount.get(operation) || 0;
    this.metrics.retryCount.set(operation, count + 1);
    this.metrics.lastUpdated = new Date();
  }

  /**
   * Retry logic with exponential backoff
   * Implements ruvnet's suggestion for network operation retry logic
   */
  private async retryOperation<T>(
    operation: string,
    fn: () => Promise<T>,
    options?: Partial<RetryOptions>
  ): Promise<T> {
    const config = { ...this.retryOptions, ...options };
    let lastError: Error;
    
    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      try {
        const startTime = Date.now();
        const result = await fn();
        this.recordLatency(operation, Date.now() - startTime);
        this.recordOperation(operation, true);
        return result;
      } catch (error) {
        lastError = error as Error;
        this.recordOperation(operation, false);
        
        if (attempt < config.maxAttempts) {
          this.recordRetry(operation);
          const delay = Math.min(
            config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1),
            config.maxDelay
          );
          
          this.logger?.warn(`${operation} failed (attempt ${attempt}/${config.maxAttempts}), retrying in ${delay}ms`, error);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    this.logger?.error(`${operation} failed after ${config.maxAttempts} attempts`, lastError);
    throw lastError;
  }

  /**
   * Get performance metrics
   * Allows monitoring of adapter performance as suggested by ruvnet
   */
  getMetrics(): {
    latency: Record<string, { avg: number; min: number; max: number; count: number }>;
    operations: Record<string, { success: number; errors: number; retries: number }>;
    lastUpdated: Date;
  } {
    const latency: Record<string, any> = {};
    const operations: Record<string, any> = {};
    
    // Calculate latency statistics
    for (const [operation, latencies] of this.metrics.operationLatency) {
      if (latencies.length > 0) {
        latency[operation] = {
          avg: latencies.reduce((sum, val) => sum + val, 0) / latencies.length,
          min: Math.min(...latencies),
          max: Math.max(...latencies),
          count: latencies.length
        };
      }
    }
    
    // Combine operation statistics
    const allOperations = new Set([
      ...this.metrics.successCount.keys(),
      ...this.metrics.errorCount.keys(),
      ...this.metrics.retryCount.keys()
    ]);
    
    for (const operation of allOperations) {
      operations[operation] = {
        success: this.metrics.successCount.get(operation) || 0,
        errors: this.metrics.errorCount.get(operation) || 0,
        retries: this.metrics.retryCount.get(operation) || 0
      };
    }
    
    return {
      latency,
      operations,
      lastUpdated: this.metrics.lastUpdated
    };
  }

  /**
   * Add an episode to Graphiti's knowledge graph
   */
  async addMemory(
    name: string,
    content: string,
    options?: {
      source?: 'text' | 'json' | 'message';
      sourceDescription?: string;
      groupId?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<string> {
    const episode: GraphitiEpisode = {
      uuid: generateId(),
      name,
      content,
      source: options?.source || 'text',
      sourceDescription: options?.sourceDescription,
      groupId: options?.groupId || this.config.defaultGroupId || 'default',
      createdAt: new Date()
    };

    // Queue the episode for batch processing
    const groupQueue = this.episodeQueue.get(episode.groupId) || [];
    groupQueue.push(episode);
    this.episodeQueue.set(episode.groupId, groupQueue);

    // If connected to Graphiti, add immediately with retry logic
    if (this.isConnected) {
      await this.retryOperation('addMemory', () => this.flushEpisode(episode));
    }

    this.emit('memory:added', episode);
    return episode.uuid;
  }

  /**
   * Search for relevant nodes in the knowledge graph
   */
  async searchNodes(
    query: string,
    options?: {
      groupIds?: string[];
      maxNodes?: number;
      entityType?: string;
      centerNodeUuid?: string;
    }
  ): Promise<GraphitiSearchResult> {
    try {
      if (!this.isConnected) {
        return this.fallbackSearch(query, options);
      }

      // Use graphiti MCP tool to search
      // This would be replaced with actual MCP tool call
      const results = await this.callGraphitiTool('search_memory_nodes', {
        query,
        group_ids: options?.groupIds,
        max_nodes: options?.maxNodes || this.config.maxNodes,
        entity: options?.entityType,
        center_node_uuid: options?.centerNodeUuid
      });

      return {
        nodes: results.nodes,
        relevanceScore: results.relevanceScore || 0.5
      };
    } catch (error) {
      this.logger?.error('Failed to search nodes', error);
      return { nodes: [], relevanceScore: 0 };
    }
  }

  /**
   * Search for relevant facts in the knowledge graph
   */
  async searchFacts(
    query: string,
    options?: {
      groupIds?: string[];
      maxFacts?: number;
      centerNodeUuid?: string;
    }
  ): Promise<GraphitiSearchResult> {
    try {
      if (!this.isConnected) {
        return this.fallbackSearch(query, options);
      }

      // Use graphiti MCP tool to search facts
      const results = await this.callGraphitiTool('search_memory_facts', {
        query,
        group_ids: options?.groupIds,
        max_facts: options?.maxFacts || this.config.maxFacts,
        center_node_uuid: options?.centerNodeUuid
      });

      return {
        facts: results.facts,
        relevanceScore: results.relevanceScore || 0.5
      };
    } catch (error) {
      this.logger?.error('Failed to search facts', error);
      return { facts: [], relevanceScore: 0 };
    }
  }

  /**
   * Convert a MemoryEntry to Graphiti episode format
   */
  async fromMemoryEntry(entry: MemoryEntry): Promise<string> {
    const content = this.formatMemoryContent(entry);
    
    return this.addMemory(
      entry.key,
      content,
      {
        source: 'json',
        sourceDescription: `Memory entry from ${entry.namespace}`,
        groupId: entry.namespace,
        metadata: entry.metadata
      }
    );
  }

  /**
   * Get recent episodes from a group
   */
  async getRecentEpisodes(
    groupId?: string,
    limit: number = 10
  ): Promise<GraphitiEpisode[]> {
    try {
      if (!this.isConnected) {
        return Array.from(this.episodeQueue.get(groupId || 'default') || [])
          .slice(-limit);
      }

      const results = await this.callGraphitiTool('get_episodes', {
        group_id: groupId || this.config.defaultGroupId,
        last_n: limit
      });

      return results.episodes || [];
    } catch (error) {
      this.logger?.error('Failed to get recent episodes', error);
      return [];
    }
  }

  /**
   * Clear all data from the knowledge graph
   */
  async clearGraph(): Promise<void> {
    try {
      if (this.isConnected) {
        await this.callGraphitiTool('clear_graph', {});
      }
      
      // Clear local caches
      this.nodeCache.clear();
      this.edgeCache.clear();
      this.episodeQueue.clear();
      
      this.emit('graph:cleared');
      this.logger?.info('Graphiti knowledge graph cleared');
    } catch (error) {
      this.logger?.error('Failed to clear graph', error);
      throw error;
    }
  }

  /**
   * Enable temporal reasoning by tracking fact validity
   */
  async updateFactValidity(
    edgeUuid: string,
    isValid: boolean,
    validUntil?: Date
  ): Promise<void> {
    if (!this.config.enableTemporalTracking) {
      return;
    }

    const edge = this.edgeCache.get(edgeUuid);
    if (edge) {
      edge.invalid = !isValid;
      edge.validUntil = validUntil;
      this.edgeCache.set(edgeUuid, edge);
      
      this.emit('fact:updated', { edgeUuid, isValid, validUntil });
    }
  }

  /**
   * Integrate with hive-mind for collective intelligence
   */
  async shareWithHiveMind(
    nodeUuids: string[],
    targetSwarms: string[]
  ): Promise<void> {
    const nodes = nodeUuids
      .map(uuid => this.nodeCache.get(uuid))
      .filter(Boolean) as GraphitiNode[];
    
    if (nodes.length > 0) {
      this.emit('hivemind:share', {
        nodes,
        targetSwarms,
        timestamp: new Date()
      });
      
      this.logger?.info(`Shared ${nodes.length} nodes with hive-mind`);
    }
  }

  /**
   * Get memory statistics
   */
  getStatistics(): {
    totalNodes: number;
    totalEdges: number;
    queuedEpisodes: number;
    cacheSize: number;
    isConnected: boolean;
  } {
    return {
      totalNodes: this.nodeCache.size,
      totalEdges: this.edgeCache.size,
      queuedEpisodes: Array.from(this.episodeQueue.values())
        .reduce((sum, queue) => sum + queue.length, 0),
      cacheSize: this.nodeCache.size + this.edgeCache.size,
      isConnected: this.isConnected
    };
  }

  // Private helper methods

  private formatMemoryContent(entry: MemoryEntry): string {
    const content = {
      key: entry.key,
      value: entry.value,
      type: entry.type,
      tags: entry.tags,
      metadata: entry.metadata,
      references: entry.references,
      dependencies: entry.dependencies
    };
    
    return JSON.stringify(content, null, 2);
  }

  private async flushEpisode(episode: GraphitiEpisode): Promise<void> {
    try {
      await this.callGraphitiTool('add_memory', {
        name: episode.name,
        episode_body: episode.content,
        source: episode.source,
        source_description: episode.sourceDescription,
        group_id: episode.groupId,
        uuid: episode.uuid
      });
    } catch (error) {
      this.logger?.error('Failed to flush episode to Graphiti', error);
      throw error;
    }
  }

  private async callGraphitiTool(toolName: string, params: any): Promise<any> {
    // This would be replaced with actual MCP tool invocation
    // For now, we'll simulate the call
    this.logger?.debug(`Calling Graphiti tool: ${toolName}`, params);
    
    // Simulate async operation
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Return mock data for development
    return {
      nodes: [],
      edges: [],
      facts: [],
      episodes: [],
      relevanceScore: 0.75
    };
  }

  private fallbackSearch(
    query: string,
    options?: any
  ): GraphitiSearchResult {
    // Simple fallback search in local cache
    const results: GraphitiNode[] = [];
    
    for (const node of this.nodeCache.values()) {
      if (
        node.name.toLowerCase().includes(query.toLowerCase()) ||
        node.observations.some(obs => 
          obs.toLowerCase().includes(query.toLowerCase())
        )
      ) {
        results.push(node);
      }
    }
    
    return {
      nodes: results.slice(0, options?.maxNodes || 10),
      relevanceScore: results.length > 0 ? 0.5 : 0
    };
  }

  private startAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }
    
    this.syncTimer = setInterval(async () => {
      await this.syncWithGraphiti();
    }, this.config.syncInterval!);
  }

  private async syncWithGraphiti(): Promise<void> {
    // Flush queued episodes
    for (const [groupId, episodes] of this.episodeQueue.entries()) {
      for (const episode of episodes) {
        try {
          await this.flushEpisode(episode);
        } catch (error) {
          this.logger?.error('Failed to sync episode', error);
        }
      }
      this.episodeQueue.set(groupId, []);
    }
    
    this.emit('sync:completed', new Date());
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
    }
    
    // Flush remaining episodes
    await this.syncWithGraphiti();
    
    this.nodeCache.clear();
    this.edgeCache.clear();
    this.episodeQueue.clear();
    this.isConnected = false;
    
    this.emit('destroyed');
  }
}

export default GraphitiMemoryAdapter;