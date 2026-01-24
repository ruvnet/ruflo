/**
 * Beads Module Index
 *
 * Issue tracking integration for Claude Flow.
 * Provides a unified API for integrating Steve Yegge's Beads system
 * with Claude Flow V3.
 *
 * @see https://github.com/steveyegge/beads
 */

// Core CLI wrapper exports
export {
  BeadsCliWrapper,
  createBeadsWrapper,
  type BeadsResult,
} from './cli-wrapper.js';

// Non-duplicate type exports from cli-wrapper
export type {
  BeadsIssue,
  BeadsCreateParams,
  BeadsListParams,
  BeadsUpdateParams,
  BeadsStats,
} from './cli-wrapper.js';

// Hooks integration
export {
  BeadsHooks,
  type TaskContext,
  type TaskResult,
} from './hooks.js';

// Memory link integration
export {
  BeadsMemoryLink,
  createBeadsMemoryLink,
  type MemoryStore,
  type Pattern,
  type LinkType,
} from './memory-link.js';

// SPARC methodology integration
export {
  BeadsSparc,
  createBeadsSparc,
  type Specification,
  type Pseudocode,
  type Architecture,
  type RefinementResult,
  type TddResult,
  type CompletionResult,
  type SparcWorkflowConfig,
  type SparcWorkflow,
} from './sparc.js';

// Dependency graph visualization
export {
  DependencyGraph,
  createDependencyGraph,
  generateASCIIGraph,
  generateMermaidGraph,
  generateDOTGraph,
  type GraphNode,
  type GraphEdge,
  type GraphOptions,
  type GraphStats,
} from './graph.js';

// GitHub integration
export {
  GitHubSync,
  createGitHubSync,
  mapStatusToGitHub,
  mapStatusFromGitHub,
  mapPriorityToLabel,
  mapPriorityFromLabel,
  mapTypeToLabel,
  mapTypeFromLabel,
  extractBeadsIdFromBody,
  addBeadsIdToBody,
  DEFAULT_GITHUB_SYNC_CONFIG,
  type GitHubIssue,
  type GitHubIssueState,
  type GitHubLabel,
  type GitHubUser,
  type GitHubMilestone,
  type GitHubCreateParams,
  type GitHubUpdateParams,
  type GitHubLink,
  type GitHubSyncConfig,
  type SyncDirection,
  type SyncResult,
} from './github.js';

// Markdown plan import integration
export {
  MarkdownPlanImporter,
  createMarkdownImporter,
  parseMarkdownPlan,
  parseMarkdownFile,
  convertToBeadsIssue,
  type MarkdownFrontmatter,
  type ParsedTask,
  type ParsedEpic,
  type ParsedMarkdownPlan,
  type ImportOptions,
  type ImportedItem,
  type ImportResult,
} from './import.js';

// Cache layer for performance optimization
export {
  BeadsCache,
  CachedBeadsWrapper,
  createCachedWrapper,
  generateCacheKey,
  listCacheKey,
  readyCacheKey,
  issueCacheKey,
  dependencyCacheKey,
  epicCacheKey,
  DEFAULT_CACHE_CONFIG,
  TTL_PRESETS,
  type CacheStats,
  type CacheConfig,
} from './cache.js';

// Pagination and lazy loading
export {
  BeadsPaginator,
  LazyLoader,
  BatchProcessor,
  DependencyResolver,
  createPaginator,
  createLazyLoader,
  createBatchProcessor,
  createDependencyResolver,
  encodeCursor,
  decodeCursor,
  hashQueryParams,
  DEFAULT_PAGINATION,
  type PaginationCursor,
  type PaginatedResult,
  type PaginationOptions,
  type LazyLoadState,
  type LazyEpic,
  type BatchResult,
} from './pagination.js';

// Two-way sync manager for beads-ui integration
export {
  BeadsSyncManager,
  createBeadsSyncManager,
  DEFAULT_SYNC_CONFIG,
  isSyncEvent,
  isChangeRecord,
  isConflictRecord,
  type SyncEventType,
  type SyncEvent,
  type ChangeRecord,
  type ConflictRecord,
  type ConflictResolution,
  type SyncConfig,
  type SyncState,
} from './sync.js';

// Type exports from types.ts
export type {
  BeadsIssueStatus,
  BeadsIssuePriority,
  BeadsIssueType,
  BeadsDependencyType,
  BeadsDependency,
  BeadsConfig,
  BeadsReadyParams,
  BeadsShowParams,
  BeadsCloseParams,
  BeadsDepAddParams,
  BeadsDepTreeParams,
  BeadsBlockedParams,
  BeadsCommandResult,
  BeadsHookContext,
  BeadsMemoryLink as BeadsMemoryLinkType,
  BeadsMCPTool,
  BeadsMCPToolResult,
  BeadsEventType,
  BeadsEvent,
  BeadsWorkAssignment,
  BeadsWorkCompletion,
  BeadsErrorCode,
} from './types.js';

export { DEFAULT_BEADS_CONFIG, BeadsError, BeadsErrorCodes } from './types.js';

/**
 * Initialize Beads integration
 *
 * Checks if Beads is available and initialized in the current directory.
 * Returns true if ready to use, false otherwise.
 */
export async function initializeBeads(): Promise<boolean> {
  const { createBeadsWrapper: create } = await import('./cli-wrapper.js');
  const wrapper = create();

  // Try to list issues as a health check
  try {
    const result = await wrapper.list({ limit: 1 });
    return result.success;
  } catch {
    // File-based fallback is always available
    return true;
  }
}
