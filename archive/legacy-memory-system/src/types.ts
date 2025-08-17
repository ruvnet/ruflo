/**
 * SPARC Memory Bank - Type Definitions
 */

export interface MemoryItem {
  id: string;
  category: string;
  key: string;
  value: any;
  metadata?: MemoryMetadata;
  vectorEmbedding?: number[];
  ttl?: number;
}

export interface MemoryMetadata {
  timestamp?: number;
  nodeId?: string;
  version?: string;
  namespace?: string;
  tags?: string[];
  source?: string;
  confidence?: number;
  mergedFrom?: string[];
  mergedAt?: number;
  [key: string]: any;
}

export interface MemoryQuery {
  categories?: string[];
  keys?: string[];
  tags?: string[];
  namespace?: string;
  startTime?: number;
  endTime?: number;
  asOf?: number; // Time-travel query
  limit?: number;
  offset?: number;
  orderBy?: 'timestamp' | 'key' | 'category';
  orderDirection?: 'asc' | 'desc';
  vectorSearch?: {
    embedding: number[];
    threshold?: number;
    topK?: number;
  };
  filter?: (item: MemoryItem) => boolean;
}

export interface MemoryBackend {
  initialize(): Promise<void>;
  store(item: MemoryItem): Promise<void>;
  get(category: string, key: string): Promise<MemoryItem | null>;
  query(query: MemoryQuery): Promise<MemoryItem[]>;
  delete(category: string, key: string): Promise<boolean>;
  update(category: string, key: string, updates: Partial<MemoryItem>): Promise<boolean>;
  getStats(): Promise<BackendStats>;
  close(): Promise<void>;
}

export interface BackendStats {
  totalItems: number;
  categories: number;
  sizeBytes: number;
  oldestItem?: number;
  newestItem?: number;
}

export interface ConflictResolution {
  resolve(existing: MemoryItem, incoming: MemoryItem): Promise<MemoryItem>;
}

export interface CacheConfig {
  maxSize: number;
  ttl: number;
  strategy: 'lru' | 'lfu' | 'fifo';
  onEvict?: (key: string, value: any) => void;
}

export interface ReplicationConfig {
  mode: 'master-slave' | 'peer-to-peer';
  nodes: ReplicationNode[];
  syncInterval?: number;
  conflictResolution?: 'last-write-wins' | 'vector-clock' | 'custom';
  retryAttempts?: number;
  retryDelay?: number;
}

export interface ReplicationNode {
  id: string;
  url: string;
  role?: 'master' | 'slave' | 'peer';
  priority?: number;
}

export interface MemoryNamespace {
  id: string;
  name: string;
  description?: string;
  permissions?: NamespacePermissions;
  metadata?: Record<string, any>;
}

export interface NamespacePermissions {
  read: string[];
  write: string[];
  delete: string[];
  admin: string[];
}

export interface IndexConfig {
  backend: MemoryBackend;
  enableVectorSearch?: boolean;
  vectorDimensions?: number;
  indexUpdateInterval?: number;
}

export interface VectorSearchResult {
  item: MemoryItem;
  score: number;
  distance: number;
}

export interface ImportExportOptions {
  format: 'json' | 'markdown' | 'csv';
  includeMetadata?: boolean;
  compress?: boolean;
  encryption?: {
    algorithm: string;
    key: string;
  };
}

export interface MemorySnapshot {
  version: string;
  timestamp: number;
  nodeId: string;
  items: MemoryItem[];
  metadata?: Record<string, any>;
}

export interface MemoryEvent {
  type: 'stored' | 'updated' | 'deleted' | 'imported' | 'exported' | 'replicated';
  timestamp: number;
  data: any;
}

export interface TimeTravelQuery {
  asOf: number;
  includeDeleted?: boolean;
  reconstructState?: boolean;
}