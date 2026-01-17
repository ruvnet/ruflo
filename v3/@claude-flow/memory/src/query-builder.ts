/**
 * V3 Query Builder
 *
 * Fluent API for building memory queries with filter chaining,
 * sorting options, and pagination support.
 *
 * @module v3/memory/query-builder
 */

import {
  MemoryQuery,
  QueryType,
  MemoryType,
  AccessLevel,
  DistanceMetric,
} from './types.js';

/**
 * Sort direction
 */
export type SortDirection = 'asc' | 'desc';

/**
 * Sort field options
 */
export type SortField =
  | 'createdAt'
  | 'updatedAt'
  | 'lastAccessedAt'
  | 'accessCount'
  | 'key'
  | 'score';

/**
 * Query builder state
 */
interface QueryBuilderState {
  type: QueryType;
  content?: string;
  embedding?: Float32Array;
  key?: string;
  keyPrefix?: string;
  namespace?: string;
  tags: string[];
  memoryType?: MemoryType;
  accessLevel?: AccessLevel;
  ownerId?: string;
  metadata: Record<string, unknown>;
  createdAfter?: number;
  createdBefore?: number;
  updatedAfter?: number;
  updatedBefore?: number;
  limit: number;
  offset: number;
  threshold?: number;
  includeExpired: boolean;
  distanceMetric?: DistanceMetric;
  sortField?: SortField;
  sortDirection: SortDirection;
}

/**
 * Fluent query builder for constructing memory queries
 *
 * @example
 * ```typescript
 * const query = new QueryBuilder()
 *   .semantic('user authentication patterns')
 *   .inNamespace('security')
 *   .withTags(['auth', 'patterns'])
 *   .ofType('semantic')
 *   .limit(10)
 *   .threshold(0.8)
 *   .build();
 * ```
 */
export class QueryBuilder {
  private state: QueryBuilderState;

  constructor() {
    this.state = {
      type: 'hybrid',
      tags: [],
      metadata: {},
      limit: 10,
      offset: 0,
      includeExpired: false,
      sortDirection: 'desc',
    };
  }

  /**
   * Create a semantic (vector similarity) query
   */
  semantic(content: string): this {
    this.state.type = 'semantic';
    this.state.content = content;
    return this;
  }

  /**
   * Create a semantic query with pre-computed embedding
   */
  semanticWithEmbedding(embedding: Float32Array): this {
    this.state.type = 'semantic';
    this.state.embedding = embedding;
    return this;
  }

  /**
   * Create an exact key match query
   */
  exact(key: string): this {
    this.state.type = 'exact';
    this.state.key = key;
    return this;
  }

  /**
   * Create a key prefix match query
   */
  prefix(keyPrefix: string): this {
    this.state.type = 'prefix';
    this.state.keyPrefix = keyPrefix;
    return this;
  }

  /**
   * Create a tag-based query
   */
  byTags(tags: string[]): this {
    this.state.type = 'tag';
    this.state.tags = tags;
    return this;
  }

  /**
   * Create a hybrid query (semantic + filters)
   */
  hybrid(content: string): this {
    this.state.type = 'hybrid';
    this.state.content = content;
    return this;
  }

  /**
   * Filter by namespace
   */
  inNamespace(namespace: string): this {
    this.state.namespace = namespace;
    return this;
  }

  /**
   * Add tag filter (entries must have all specified tags)
   */
  withTags(tags: string[]): this {
    this.state.tags = [...this.state.tags, ...tags];
    return this;
  }

  /**
   * Add a single tag filter
   */
  withTag(tag: string): this {
    this.state.tags.push(tag);
    return this;
  }

  /**
   * Filter by memory type
   */
  ofType(type: MemoryType): this {
    this.state.memoryType = type;
    return this;
  }

  /**
   * Filter by access level
   */
  withAccessLevel(level: AccessLevel): this {
    this.state.accessLevel = level;
    return this;
  }

  /**
   * Filter by owner
   */
  ownedBy(ownerId: string): this {
    this.state.ownerId = ownerId;
    return this;
  }

  /**
   * Filter by metadata field
   */
  whereMetadata(key: string, value: unknown): this {
    this.state.metadata[key] = value;
    return this;
  }

  /**
   * Filter by creation date range
   */
  createdBetween(after: Date | number, before?: Date | number): this {
    this.state.createdAfter = after instanceof Date ? after.getTime() : after;
    if (before !== undefined) {
      this.state.createdBefore = before instanceof Date ? before.getTime() : before;
    }
    return this;
  }

  /**
   * Filter entries created after a date
   */
  createdAfter(date: Date | number): this {
    this.state.createdAfter = date instanceof Date ? date.getTime() : date;
    return this;
  }

  /**
   * Filter entries created before a date
   */
  createdBefore(date: Date | number): this {
    this.state.createdBefore = date instanceof Date ? date.getTime() : date;
    return this;
  }

  /**
   * Filter by update date range
   */
  updatedBetween(after: Date | number, before?: Date | number): this {
    this.state.updatedAfter = after instanceof Date ? after.getTime() : after;
    if (before !== undefined) {
      this.state.updatedBefore = before instanceof Date ? before.getTime() : before;
    }
    return this;
  }

  /**
   * Filter entries updated in the last N milliseconds
   */
  updatedWithin(milliseconds: number): this {
    this.state.updatedAfter = Date.now() - milliseconds;
    return this;
  }

  /**
   * Set maximum number of results
   */
  limit(count: number): this {
    this.state.limit = Math.max(1, count);
    return this;
  }

  /**
   * Set pagination offset
   */
  offset(count: number): this {
    this.state.offset = Math.max(0, count);
    return this;
  }

  /**
   * Set pagination with page number and size
   */
  page(pageNumber: number, pageSize: number): this {
    this.state.limit = Math.max(1, pageSize);
    this.state.offset = Math.max(0, (pageNumber - 1) * pageSize);
    return this;
  }

  /**
   * Set minimum similarity threshold for semantic search
   */
  threshold(minScore: number): this {
    this.state.threshold = Math.max(0, Math.min(1, minScore));
    return this;
  }

  /**
   * Include expired entries in results
   */
  includeExpired(include: boolean = true): this {
    this.state.includeExpired = include;
    return this;
  }

  /**
   * Set distance metric for semantic search
   */
  withMetric(metric: DistanceMetric): this {
    this.state.distanceMetric = metric;
    return this;
  }

  /**
   * Sort results by field
   */
  sortBy(field: SortField, direction: SortDirection = 'desc'): this {
    this.state.sortField = field;
    this.state.sortDirection = direction;
    return this;
  }

  /**
   * Sort by creation date (newest first)
   */
  newestFirst(): this {
    return this.sortBy('createdAt', 'desc');
  }

  /**
   * Sort by creation date (oldest first)
   */
  oldestFirst(): this {
    return this.sortBy('createdAt', 'asc');
  }

  /**
   * Sort by relevance score (highest first)
   */
  mostRelevant(): this {
    return this.sortBy('score', 'desc');
  }

  /**
   * Sort by access count (most accessed first)
   */
  mostAccessed(): this {
    return this.sortBy('accessCount', 'desc');
  }

  /**
   * Sort by last accessed time (most recent first)
   */
  recentlyAccessed(): this {
    return this.sortBy('lastAccessedAt', 'desc');
  }

  /**
   * Build the final query object
   */
  build(): MemoryQuery {
    const query: MemoryQuery = {
      type: this.state.type,
      limit: this.state.limit,
    };

    // Add optional fields
    if (this.state.content) query.content = this.state.content;
    if (this.state.embedding) query.embedding = this.state.embedding;
    if (this.state.key) query.key = this.state.key;
    if (this.state.keyPrefix) query.keyPrefix = this.state.keyPrefix;
    if (this.state.namespace) query.namespace = this.state.namespace;
    if (this.state.tags.length > 0) query.tags = this.state.tags;
    if (this.state.memoryType) query.memoryType = this.state.memoryType;
    if (this.state.accessLevel) query.accessLevel = this.state.accessLevel;
    if (this.state.ownerId) query.ownerId = this.state.ownerId;
    if (Object.keys(this.state.metadata).length > 0) {
      query.metadata = this.state.metadata;
    }
    if (this.state.createdAfter) query.createdAfter = this.state.createdAfter;
    if (this.state.createdBefore) query.createdBefore = this.state.createdBefore;
    if (this.state.updatedAfter) query.updatedAfter = this.state.updatedAfter;
    if (this.state.updatedBefore) query.updatedBefore = this.state.updatedBefore;
    if (this.state.offset > 0) query.offset = this.state.offset;
    if (this.state.threshold !== undefined) query.threshold = this.state.threshold;
    if (this.state.includeExpired) query.includeExpired = this.state.includeExpired;
    if (this.state.distanceMetric) query.distanceMetric = this.state.distanceMetric;

    return query;
  }

  /**
   * Clone this builder
   */
  clone(): QueryBuilder {
    const cloned = new QueryBuilder();
    cloned.state = {
      ...this.state,
      tags: [...this.state.tags],
      metadata: { ...this.state.metadata },
    };
    return cloned;
  }

  /**
   * Reset the builder to initial state
   */
  reset(): this {
    this.state = {
      type: 'hybrid',
      tags: [],
      metadata: {},
      limit: 10,
      offset: 0,
      includeExpired: false,
      sortDirection: 'desc',
    };
    return this;
  }
}

/**
 * Convenience function to create a new query builder
 */
export function query(): QueryBuilder {
  return new QueryBuilder();
}

/**
 * Predefined query templates for common use cases
 */
export const QueryTemplates = {
  /**
   * Find recent entries in a namespace
   */
  recentInNamespace(namespace: string, limit: number = 10): MemoryQuery {
    return query()
      .inNamespace(namespace)
      .newestFirst()
      .limit(limit)
      .build();
  },

  /**
   * Find entries by exact key
   */
  byKey(namespace: string, key: string): MemoryQuery {
    return query()
      .exact(key)
      .inNamespace(namespace)
      .limit(1)
      .build();
  },

  /**
   * Semantic search with threshold
   */
  semanticSearch(
    content: string,
    namespace?: string,
    threshold: number = 0.7,
    limit: number = 10
  ): MemoryQuery {
    const builder = query()
      .semantic(content)
      .threshold(threshold)
      .limit(limit);

    if (namespace) {
      builder.inNamespace(namespace);
    }

    return builder.build();
  },

  /**
   * Find entries with specific tags
   */
  withTags(tags: string[], namespace?: string, limit: number = 10): MemoryQuery {
    const builder = query()
      .byTags(tags)
      .limit(limit);

    if (namespace) {
      builder.inNamespace(namespace);
    }

    return builder.build();
  },

  /**
   * Find entries owned by a specific agent
   */
  ownedBy(ownerId: string, namespace?: string, limit: number = 10): MemoryQuery {
    const builder = query()
      .ownedBy(ownerId)
      .newestFirst()
      .limit(limit);

    if (namespace) {
      builder.inNamespace(namespace);
    }

    return builder.build();
  },

  /**
   * Find episodic memories within a time range
   */
  episodicInRange(
    after: Date | number,
    before: Date | number,
    limit: number = 100
  ): MemoryQuery {
    return query()
      .ofType('episodic')
      .createdBetween(after, before)
      .oldestFirst()
      .limit(limit)
      .build();
  },

  /**
   * Find hot entries (frequently accessed)
   */
  hotEntries(namespace?: string, limit: number = 10): MemoryQuery {
    const builder = query()
      .mostAccessed()
      .limit(limit);

    if (namespace) {
      builder.inNamespace(namespace);
    }

    return builder.build();
  },

  /**
   * Find stale entries (not accessed recently)
   */
  staleEntries(
    staleThresholdMs: number,
    namespace?: string,
    limit: number = 100
  ): MemoryQuery {
    const builder = query()
      .updatedBetween(0, Date.now() - staleThresholdMs)
      .sortBy('lastAccessedAt', 'asc')
      .limit(limit);

    if (namespace) {
      builder.inNamespace(namespace);
    }

    return builder.build();
  },
};

export default QueryBuilder;
