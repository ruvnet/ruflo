/**
 * SPARC Memory Bank - Memory Indexer
 * Fast indexing with vector search support
 */

import { MemoryItem, MemoryQuery, MemoryBackend, VectorSearchResult, IndexConfig } from '../types';
import { EventEmitter } from 'events';

interface Index {
  byCategory: Map<string, Set<string>>;
  byTag: Map<string, Set<string>>;
  byNamespace: Map<string, Set<string>>;
  byTimestamp: Array<{ id: string; timestamp: number }>;
  vectors?: VectorIndex;
}

interface VectorIndex {
  dimensions: number;
  vectors: Map<string, Float32Array>;
  metadata: Map<string, { category: string; key: string }>;
}

export class MemoryIndexer extends EventEmitter {
  private backend: MemoryBackend;
  private index: Index;
  private config: IndexConfig;
  private updateQueue: Set<string> = new Set();
  private updateInterval?: NodeJS.Timer;
  private isIndexing: boolean = false;

  constructor(config: IndexConfig) {
    super();
    this.config = config;
    this.backend = config.backend;
    
    this.index = {
      byCategory: new Map(),
      byTag: new Map(),
      byNamespace: new Map(),
      byTimestamp: []
    };

    if (config.enableVectorSearch) {
      this.index.vectors = {
        dimensions: config.vectorDimensions || 384,
        vectors: new Map(),
        metadata: new Map()
      };
    }
  }

  async initialize(): Promise<void> {
    // Build initial index
    await this.rebuildIndex();

    // Start update interval if configured
    if (this.config.indexUpdateInterval) {
      this.updateInterval = setInterval(
        () => this.processUpdateQueue(),
        this.config.indexUpdateInterval
      );
    }

    this.emit('initialized');
  }

  /**
   * Index a memory item
   */
  async index(item: MemoryItem): Promise<void> {
    const id = `${item.category}:${item.key}`;

    // Update category index
    if (!this.index.byCategory.has(item.category)) {
      this.index.byCategory.set(item.category, new Set());
    }
    this.index.byCategory.get(item.category)!.add(id);

    // Update tag index
    if (item.metadata?.tags) {
      for (const tag of item.metadata.tags) {
        if (!this.index.byTag.has(tag)) {
          this.index.byTag.set(tag, new Set());
        }
        this.index.byTag.get(tag)!.add(id);
      }
    }

    // Update namespace index
    const namespace = item.metadata?.namespace || 'default';
    if (!this.index.byNamespace.has(namespace)) {
      this.index.byNamespace.set(namespace, new Set());
    }
    this.index.byNamespace.get(namespace)!.add(id);

    // Update timestamp index
    if (item.metadata?.timestamp) {
      this.updateTimestampIndex(id, item.metadata.timestamp);
    }

    // Update vector index
    if (this.index.vectors && item.vectorEmbedding) {
      this.index.vectors.vectors.set(
        id,
        new Float32Array(item.vectorEmbedding)
      );
      this.index.vectors.metadata.set(id, {
        category: item.category,
        key: item.key
      });
    }

    // Queue for batch update if interval is set
    if (this.config.indexUpdateInterval) {
      this.updateQueue.add(id);
    }

    this.emit('indexed', item);
  }

  /**
   * Remove item from index
   */
  async remove(category: string, key: string): Promise<void> {
    const id = `${category}:${key}`;

    // Remove from category index
    const categorySet = this.index.byCategory.get(category);
    if (categorySet) {
      categorySet.delete(id);
      if (categorySet.size === 0) {
        this.index.byCategory.delete(category);
      }
    }

    // Remove from tag index
    for (const [tag, tagSet] of this.index.byTag) {
      tagSet.delete(id);
      if (tagSet.size === 0) {
        this.index.byTag.delete(tag);
      }
    }

    // Remove from namespace index
    for (const [ns, nsSet] of this.index.byNamespace) {
      nsSet.delete(id);
      if (nsSet.size === 0) {
        this.index.byNamespace.delete(ns);
      }
    }

    // Remove from timestamp index
    this.index.byTimestamp = this.index.byTimestamp.filter(
      entry => entry.id !== id
    );

    // Remove from vector index
    if (this.index.vectors) {
      this.index.vectors.vectors.delete(id);
      this.index.vectors.metadata.delete(id);
    }

    this.emit('removed', { category, key });
  }

  /**
   * Perform vector search
   */
  async vectorSearch(query: MemoryQuery): Promise<MemoryItem[]> {
    if (!query.vectorSearch || !this.index.vectors) {
      return [];
    }

    const queryVector = new Float32Array(query.vectorSearch.embedding);
    const results: VectorSearchResult[] = [];

    // Calculate similarity scores
    for (const [id, vector] of this.index.vectors.vectors) {
      const score = this.cosineSimilarity(queryVector, vector);
      
      if (query.vectorSearch.threshold && score < query.vectorSearch.threshold) {
        continue;
      }

      const metadata = this.index.vectors.metadata.get(id);
      if (metadata) {
        results.push({
          item: null as any, // Will be populated below
          score,
          distance: 1 - score
        });

        // Store metadata for retrieval
        (results[results.length - 1] as any).metadata = metadata;
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    // Apply topK limit
    const topK = query.vectorSearch.topK || 10;
    const topResults = results.slice(0, topK);

    // Retrieve full items
    const items: MemoryItem[] = [];
    for (const result of topResults) {
      const metadata = (result as any).metadata;
      const item = await this.backend.get(metadata.category, metadata.key);
      if (item) {
        items.push(item);
      }
    }

    return items;
  }

  /**
   * Query using indexes
   */
  async query(query: MemoryQuery): Promise<Set<string>> {
    let candidates = new Set<string>();
    let initialized = false;

    // Filter by category
    if (query.categories && query.categories.length > 0) {
      for (const category of query.categories) {
        const categoryIds = this.index.byCategory.get(category);
        if (categoryIds) {
          if (!initialized) {
            candidates = new Set(categoryIds);
            initialized = true;
          } else {
            // Intersection
            candidates = new Set(
              [...candidates].filter(id => categoryIds.has(id))
            );
          }
        }
      }
    }

    // Filter by tags
    if (query.tags && query.tags.length > 0) {
      const tagSets: Set<string>[] = [];
      for (const tag of query.tags) {
        const tagIds = this.index.byTag.get(tag);
        if (tagIds) {
          tagSets.push(tagIds);
        }
      }

      if (tagSets.length > 0) {
        const tagCandidates = this.unionSets(tagSets);
        if (!initialized) {
          candidates = tagCandidates;
          initialized = true;
        } else {
          candidates = new Set(
            [...candidates].filter(id => tagCandidates.has(id))
          );
        }
      }
    }

    // Filter by namespace
    if (query.namespace) {
      const namespaceIds = this.index.byNamespace.get(query.namespace);
      if (namespaceIds) {
        if (!initialized) {
          candidates = new Set(namespaceIds);
          initialized = true;
        } else {
          candidates = new Set(
            [...candidates].filter(id => namespaceIds.has(id))
          );
        }
      }
    }

    // If no filters applied, use all items
    if (!initialized) {
      for (const categoryIds of this.index.byCategory.values()) {
        for (const id of categoryIds) {
          candidates.add(id);
        }
      }
    }

    return candidates;
  }

  /**
   * Check if vector search is supported
   */
  supportsVectorSearch(): boolean {
    return !!this.index.vectors;
  }

  /**
   * Get index statistics
   */
  getStats(): any {
    return {
      categories: this.index.byCategory.size,
      tags: this.index.byTag.size,
      namespaces: this.index.byNamespace.size,
      timestamps: this.index.byTimestamp.length,
      vectors: this.index.vectors ? this.index.vectors.vectors.size : 0,
      updateQueueSize: this.updateQueue.size
    };
  }

  /**
   * Close and cleanup
   */
  async close(): Promise<void> {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    // Process any remaining updates
    if (this.updateQueue.size > 0) {
      await this.processUpdateQueue();
    }

    this.emit('closed');
  }

  /**
   * Rebuild entire index
   */
  private async rebuildIndex(): Promise<void> {
    this.isIndexing = true;
    this.emit('rebuild-start');

    // Clear existing indexes
    this.index.byCategory.clear();
    this.index.byTag.clear();
    this.index.byNamespace.clear();
    this.index.byTimestamp = [];
    
    if (this.index.vectors) {
      this.index.vectors.vectors.clear();
      this.index.vectors.metadata.clear();
    }

    // Query all items from backend
    const items = await this.backend.query({});

    // Index each item
    for (const item of items) {
      await this.index(item);
    }

    this.isIndexing = false;
    this.emit('rebuild-complete', { itemCount: items.length });
  }

  /**
   * Process queued updates
   */
  private async processUpdateQueue(): Promise<void> {
    if (this.updateQueue.size === 0 || this.isIndexing) {
      return;
    }

    const updates = Array.from(this.updateQueue);
    this.updateQueue.clear();

    // Process updates in batches
    const batchSize = 100;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (id) => {
          const [category, key] = id.split(':');
          const item = await this.backend.get(category, key);
          if (item) {
            await this.index(item);
          }
        })
      );
    }
  }

  /**
   * Update timestamp index
   */
  private updateTimestampIndex(id: string, timestamp: number): void {
    // Remove existing entry
    this.index.byTimestamp = this.index.byTimestamp.filter(
      entry => entry.id !== id
    );

    // Add new entry
    this.index.byTimestamp.push({ id, timestamp });

    // Keep sorted by timestamp
    this.index.byTimestamp.sort((a, b) => a.timestamp - b.timestamp);

    // Limit size to prevent unbounded growth
    const maxSize = 10000;
    if (this.index.byTimestamp.length > maxSize) {
      this.index.byTimestamp = this.index.byTimestamp.slice(-maxSize);
    }
  }

  /**
   * Calculate cosine similarity between vectors
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have same dimensions');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  /**
   * Union multiple sets
   */
  private unionSets(sets: Set<string>[]): Set<string> {
    const result = new Set<string>();
    for (const set of sets) {
      for (const item of set) {
        result.add(item);
      }
    }
    return result;
  }

  /**
   * Generate text embeddings (placeholder - would use real model in production)
   */
  async generateEmbedding(text: string): Promise<number[]> {
    // This is a placeholder - in production, you would use a real embedding model
    // like OpenAI's text-embedding-ada-002 or a local model
    
    const dimensions = this.index.vectors?.dimensions || 384;
    const embedding = new Array(dimensions);
    
    // Simple hash-based pseudo-embedding for demonstration
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash = hash & hash;
    }
    
    for (let i = 0; i < dimensions; i++) {
      embedding[i] = Math.sin(hash * (i + 1)) * 0.5 + 0.5;
    }
    
    return embedding;
  }
}