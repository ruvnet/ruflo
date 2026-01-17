/**
 * Memory Domain Layer - Public Exports
 *
 * Exports all domain entities, value objects, services, and interfaces.
 *
 * @module v3/memory/domain
 */

// Entities
export {
  MemoryEntry,
  type MemoryType,
  type MemoryStatus,
  type MemoryEntryProps,
} from './entities/memory-entry.js';

// Repository Interfaces
export {
  type IMemoryRepository,
  type MemoryQueryOptions,
  type VectorSearchOptions,
  type VectorSearchResult,
  type BulkOperationResult,
  type MemoryStatistics,
} from './repositories/memory-repository.interface.js';

// Domain Services
export {
  MemoryDomainService,
  type ConsolidationStrategy,
  type ConsolidationOptions,
  type ConsolidationResult,
  type DeduplicationResult,
  type NamespaceAnalysis,
} from './services/memory-domain-service.js';
