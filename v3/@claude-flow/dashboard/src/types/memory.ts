/**
 * Memory operation types for the Live Operations Dashboard
 * @module types/memory
 * Based on PRD: Claude Flow Live Operations Dashboard
 */

/**
 * Types of memory operations
 */
export type MemoryOperationType = 'store' | 'retrieve' | 'search' | 'delete' | 'update';

/**
 * Memory operation type as enum for stricter typing
 */
export enum OperationType {
  STORE = 'store',
  RETRIEVE = 'retrieve',
  SEARCH = 'search',
  DELETE = 'delete',
  UPDATE = 'update',
  BATCH_STORE = 'batch_store',
  BATCH_RETRIEVE = 'batch_retrieve',
  VECTOR_SEARCH = 'vector_search',
  LIST_KEYS = 'list_keys',
  CLEAR = 'clear',
}

/**
 * Extended memory operation types
 */
export type ExtendedMemoryOperationType =
  | MemoryOperationType
  | 'batch_store'
  | 'batch_retrieve'
  | 'vector_search'
  | 'list_keys'
  | 'clear';

/**
 * Memory namespaces
 */
export enum MemoryNamespace {
  AGENT = 'agent',
  TASK = 'task',
  COORDINATION = 'coordination',
  SESSION = 'session',
  PERSISTENT = 'persistent',
  CACHE = 'cache',
  VECTOR = 'vector',
  SYSTEM = 'system',
}

/**
 * Common namespace strings
 */
export type MemoryNamespaceString =
  | 'agent'
  | 'task'
  | 'coordination'
  | 'session'
  | 'persistent'
  | 'cache'
  | 'vector'
  | 'system'
  | string;

/**
 * Memory entry metadata
 */
export interface MemoryMetadata {
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
  /** Expiration timestamp (if set) */
  expiresAt?: number;
  /** Size in bytes */
  size: number;
  /** Content type */
  contentType?: string;
  /** Tags for categorization */
  tags?: string[];
  /** Source agent ID */
  sourceAgent?: string;
  /** Access count */
  accessCount?: number;
  /** Last access timestamp */
  lastAccessedAt?: number;
}

/**
 * Memory entry
 */
export interface MemoryEntry<T = unknown> {
  /** Unique key */
  key: string;
  /** Namespace */
  namespace: string;
  /** Stored value */
  value: T;
  /** Entry metadata */
  metadata?: MemoryMetadata;
  /** Vector embedding (if applicable) */
  embedding?: number[];
}

/**
 * Vector search result with similarity score
 */
export interface VectorSearchResult<T = unknown> {
  /** Result key */
  key: string;
  /** Namespace */
  namespace: string;
  /** Similarity score (0-1, higher is more similar) */
  similarity: number;
  /** Distance (inverse of similarity) */
  distance?: number;
  /** Rank in results */
  rank?: number;
  /** Result value */
  value?: T;
  /** Highlighted matching content */
  highlight?: string;
  /** Entry metadata */
  metadata?: MemoryMetadata;
}

/**
 * Memory operation record for dashboard
 */
export interface MemoryOperation {
  /** Operation ID */
  id: string;
  /** Operation type */
  operation: MemoryOperationType | ExtendedMemoryOperationType;
  /** Target namespace */
  namespace: string;
  /** Target key (if applicable) */
  key?: string;
  /** Search query (if applicable) */
  query?: string;
  /** Value being stored (if applicable) */
  value?: unknown;
  /** Number of results returned */
  resultCount?: number;
  /** Search results (if applicable) */
  results?: VectorSearchResult[];
  /** Whether it was a cache hit */
  cacheHit?: boolean;
  /** Operation latency in milliseconds */
  latency: number;
  /** Whether operation succeeded */
  success?: boolean;
  /** Error message if failed */
  error?: string;
  /** Agent that performed the operation */
  agentId?: string;
  /** Agent name */
  agentName?: string;
  /** Operation timestamp */
  timestamp: number;
}

/**
 * Memory operation event from WebSocket
 */
export interface MemoryOperationEvent {
  /** Event type discriminator */
  type: 'memory:operation';
  /** Operation type */
  operation: MemoryOperationType | ExtendedMemoryOperationType;
  /** Target namespace */
  namespace: string;
  /** Target key */
  key?: string;
  /** Search query */
  query?: string;
  /** Stored/retrieved value (may be truncated for large values) */
  value?: unknown;
  /** Number of results (for searches) */
  resultCount?: number;
  /** Search results */
  results?: VectorSearchResult[];
  /** Whether it was a cache hit */
  cacheHit?: boolean;
  /** Operation latency in milliseconds */
  latency: number;
  /** Whether operation succeeded */
  success?: boolean;
  /** Error message if failed */
  error?: string;
  /** Agent that performed the operation */
  agentId?: string;
  /** Agent name */
  agentName?: string;
  /** Event timestamp */
  timestamp: number;
}

/**
 * Vector search query
 */
export interface VectorSearchQuery {
  /** Text query to embed and search */
  query: string;
  /** Pre-computed embedding vector */
  embedding?: number[];
  /** Target namespace */
  namespace?: string;
  /** Maximum results to return */
  limit?: number;
  /** Minimum similarity threshold (0-1) */
  minSimilarity?: number;
  /** Filter by tags */
  tags?: string[];
  /** Filter by metadata */
  metadataFilter?: Record<string, unknown>;
}

/**
 * Namespace statistics
 */
export interface NamespaceStats {
  /** Namespace name */
  namespace: string;
  /** Total operation count */
  operationCount: number;
  /** Store operation count */
  storeCount: number;
  /** Retrieve operation count */
  retrieveCount: number;
  /** Search operation count */
  searchCount: number;
  /** Delete operation count */
  deleteCount: number;
  /** Entry count in namespace */
  entryCount?: number;
  /** Total size in bytes */
  totalSize?: number;
  /** Average entry size */
  avgEntrySize?: number;
  /** Cache hit rate */
  cacheHitRate?: number;
  /** Average latency */
  avgLatency?: number;
  /** Most accessed keys */
  topKeys?: Array<{
    key: string;
    accessCount: number;
  }>;
}

/**
 * Memory statistics
 */
export interface MemoryStats {
  /** Total entries */
  totalEntries: number;
  /** Total size in bytes */
  totalSize: number;
  /** Entries by namespace */
  byNamespace: Record<string, {
    count: number;
    size: number;
  }>;
  /** Operation counts */
  operations: {
    stores: number;
    retrieves: number;
    searches: number;
    deletes: number;
    updates: number;
  };
  /** Cache statistics */
  cache: {
    hits: number;
    misses: number;
    hitRate: number;
    size: number;
    maxSize: number;
  };
  /** Vector index statistics */
  vectorIndex?: {
    totalVectors: number;
    dimensions: number;
    indexSize: number;
    avgSearchLatency: number;
  };
  /** Average operation latencies */
  avgLatency: {
    store: number;
    retrieve: number;
    search: number;
    vectorSearch?: number;
  };
}

/**
 * Memory configuration
 */
export interface MemoryConfig {
  /** Backend type */
  backend: 'sqlite' | 'redis' | 'hybrid';
  /** Maximum cache size */
  maxCacheSize: number;
  /** Default TTL in milliseconds */
  defaultTTL: number;
  /** Enable vector indexing */
  vectorIndexEnabled: boolean;
  /** HNSW index parameters */
  hnswParams?: {
    m: number;
    efConstruction: number;
    efSearch: number;
  };
  /** Compression enabled */
  compressionEnabled: boolean;
  /** Persistence path */
  persistencePath: string;
}

/**
 * Memory filters for the dashboard
 */
export interface MemoryFilters {
  /** Filter by namespaces */
  namespaces: string[];
  /** Filter by operations */
  operations: MemoryOperationType[];
  /** Show values in display */
  showValues: boolean;
  /** Filter by time range */
  timeRange?: {
    start: number;
    end: number;
  };
  /** Filter by agent */
  agentIds?: string[];
  /** Minimum latency threshold */
  minLatency?: number;
  /** Show only cache hits/misses */
  cacheHitFilter?: 'all' | 'hits' | 'misses';
}

/**
 * Operation type colors for visualization
 */
export const OPERATION_TYPE_COLORS: Record<MemoryOperationType, string> = {
  store: '#22c55e',    // Green
  retrieve: '#3b82f6', // Blue
  search: '#f59e0b',   // Amber
  delete: '#ef4444',   // Red
  update: '#8b5cf6',   // Purple
};

/**
 * Operation type CSS classes
 */
export const OPERATION_TYPE_CSS_COLORS: Record<MemoryOperationType, string> = {
  store: 'text-green-500 bg-green-500/10',
  retrieve: 'text-blue-500 bg-blue-500/10',
  search: 'text-amber-500 bg-amber-500/10',
  delete: 'text-red-500 bg-red-500/10',
  update: 'text-purple-500 bg-purple-500/10',
};

/**
 * Operation type labels
 */
export const OPERATION_TYPE_LABELS: Record<MemoryOperationType, string> = {
  store: 'Store',
  retrieve: 'Retrieve',
  search: 'Search',
  delete: 'Delete',
  update: 'Update',
};

/**
 * All memory operation types
 */
export const ALL_MEMORY_OPERATIONS: MemoryOperationType[] = [
  'store',
  'retrieve',
  'search',
  'delete',
  'update',
];

/**
 * Default memory filters
 */
export const DEFAULT_MEMORY_FILTERS: MemoryFilters = {
  namespaces: [],
  operations: [],
  showValues: true,
};
