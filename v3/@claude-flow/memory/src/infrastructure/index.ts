/**
 * Memory Infrastructure Layer - Public Exports
 *
 * Exports all infrastructure implementations including repositories,
 * adapters, and external service integrations.
 *
 * @module v3/memory/infrastructure
 */

// Repositories
export {
  HybridMemoryRepository,
  type HybridRepositoryConfig,
} from './repositories/hybrid-memory-repository.js';

// Re-export existing adapters
export { AgentDBAdapter } from '../agentdb-adapter.js';
export type { AgentDBAdapterConfig } from '../agentdb-adapter.js';
export { HNSWIndex } from '../hnsw-index.js';
export type { HNSWConfig } from '../types.js';
export { CacheManager } from '../cache-manager.js';
export type { CacheConfig } from '../types.js';
export { MemoryMigrator } from '../migration.js';
