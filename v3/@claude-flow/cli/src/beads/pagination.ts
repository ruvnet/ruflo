/**
 * Beads Pagination and Lazy Loading
 *
 * Provides efficient pagination and lazy loading for large datasets.
 * Implements cursor-based pagination for consistent results across pages.
 *
 * Performance targets:
 * - Task sync latency: <100ms
 * - Epic status query: <50ms
 * - Dependency resolution: <20ms
 *
 * @see https://github.com/steveyegge/beads
 */

import type {
  BeadsIssue,
  BeadsListParams,
  BeadsIssueStatus,
  BeadsIssuePriority,
} from './types.js';

// ============================================
// Types
// ============================================

/**
 * Cursor for pagination
 * Encodes position information for consistent pagination
 */
export interface PaginationCursor {
  /** ISO timestamp of the last item */
  timestamp: string;
  /** ID of the last item for tie-breaking */
  lastId: string;
  /** Original query parameters hash */
  queryHash: string;
}

/**
 * Paginated result with cursor information
 */
export interface PaginatedResult<T> {
  /** Items in this page */
  items: T[];
  /** Cursor for next page (null if no more pages) */
  nextCursor: string | null;
  /** Cursor for previous page (null if first page) */
  prevCursor: string | null;
  /** Total count if available */
  totalCount?: number;
  /** Whether there are more items */
  hasMore: boolean;
  /** Page number (1-indexed) */
  pageNumber: number;
  /** Items per page */
  pageSize: number;
}

/**
 * Options for paginated queries
 */
export interface PaginationOptions {
  /** Number of items per page (default: 20) */
  pageSize?: number;
  /** Cursor for fetching a specific page */
  cursor?: string;
  /** Sort field */
  sortBy?: 'created_at' | 'updated_at' | 'priority' | 'id';
  /** Sort direction */
  sortDirection?: 'asc' | 'desc';
}

/**
 * Default pagination options
 */
export const DEFAULT_PAGINATION: Required<PaginationOptions> = {
  pageSize: 20,
  cursor: '',
  sortBy: 'created_at',
  sortDirection: 'desc',
};

/**
 * Lazy loading state for epics
 */
export interface LazyLoadState<T> {
  /** Loaded items */
  items: T[];
  /** Whether all items are loaded */
  fullyLoaded: boolean;
  /** Loading in progress */
  loading: boolean;
  /** Error if any */
  error?: string;
  /** Last load timestamp */
  lastLoadedAt?: number;
}

/**
 * Epic with lazy-loaded children
 */
export interface LazyEpic extends BeadsIssue {
  /** Lazy-loaded child issues */
  children?: LazyLoadState<BeadsIssue>;
  /** Computed status based on children */
  computedStatus?: {
    totalChildren: number;
    completedChildren: number;
    percentComplete: number;
    blockedChildren: number;
  };
}

// ============================================
// Cursor Utilities
// ============================================

/**
 * Encode cursor to base64 string
 */
export function encodeCursor(cursor: PaginationCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/**
 * Decode cursor from base64 string
 */
export function decodeCursor(encoded: string): PaginationCursor | null {
  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf-8');
    return JSON.parse(decoded) as PaginationCursor;
  } catch {
    return null;
  }
}

/**
 * Generate hash for query parameters
 */
export function hashQueryParams(params?: BeadsListParams): string {
  if (!params) return 'default';

  const parts: string[] = [];
  if (params.status) parts.push(`s:${params.status}`);
  if (params.priority !== undefined) parts.push(`p:${params.priority}`);
  if (params.assignee) parts.push(`a:${params.assignee}`);
  if (params.labels?.length) parts.push(`l:${params.labels.sort().join(',')}`);

  return parts.length > 0 ? parts.join('|') : 'default';
}

// ============================================
// Paginator Class
// ============================================

/**
 * BeadsPaginator provides cursor-based pagination for Beads queries
 *
 * Features:
 * - Cursor-based pagination for consistent results
 * - Configurable page size
 * - Sort options
 * - Query hash validation
 */
export class BeadsPaginator {
  private options: Required<PaginationOptions>;

  constructor(options?: PaginationOptions) {
    this.options = { ...DEFAULT_PAGINATION, ...options };
  }

  /**
   * Paginate an array of issues
   * Useful for client-side pagination of cached results
   */
  paginate(
    issues: BeadsIssue[],
    params?: BeadsListParams
  ): PaginatedResult<BeadsIssue> {
    const queryHash = hashQueryParams(params);

    // Sort issues
    const sorted = this.sortIssues([...issues]);

    // Decode cursor if present
    let startIndex = 0;
    let pageNumber = 1;

    if (this.options.cursor) {
      const cursor = decodeCursor(this.options.cursor);
      if (cursor && cursor.queryHash === queryHash) {
        // Find position after cursor
        const cursorIndex = sorted.findIndex(
          (issue) =>
            issue.created_at === cursor.timestamp && issue.id === cursor.lastId
        );

        if (cursorIndex !== -1) {
          startIndex = cursorIndex + 1;
          pageNumber = Math.floor(startIndex / this.options.pageSize) + 1;
        }
      }
    }

    // Get page items
    const pageItems = sorted.slice(startIndex, startIndex + this.options.pageSize);
    const hasMore = startIndex + this.options.pageSize < sorted.length;

    // Create cursors
    let nextCursor: string | null = null;
    let prevCursor: string | null = null;

    if (hasMore && pageItems.length > 0) {
      const lastItem = pageItems[pageItems.length - 1];
      nextCursor = encodeCursor({
        timestamp: lastItem.created_at,
        lastId: lastItem.id,
        queryHash,
      });
    }

    if (startIndex > 0 && sorted.length > 0) {
      const prevIndex = Math.max(0, startIndex - this.options.pageSize);
      const prevItem = sorted[prevIndex];
      if (prevItem) {
        prevCursor = encodeCursor({
          timestamp: prevItem.created_at,
          lastId: prevItem.id,
          queryHash,
        });
      }
    }

    return {
      items: pageItems,
      nextCursor,
      prevCursor,
      totalCount: sorted.length,
      hasMore,
      pageNumber,
      pageSize: this.options.pageSize,
    };
  }

  /**
   * Create an async iterator for paginated results
   */
  async *paginateAsync(
    fetcher: (limit: number, cursor?: string) => Promise<{
      items: BeadsIssue[];
      hasMore: boolean;
    }>
  ): AsyncGenerator<BeadsIssue[], void, unknown> {
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const result = await fetcher(this.options.pageSize, cursor);
      yield result.items;

      hasMore = result.hasMore;
      if (hasMore && result.items.length > 0) {
        const lastItem = result.items[result.items.length - 1];
        cursor = encodeCursor({
          timestamp: lastItem.created_at,
          lastId: lastItem.id,
          queryHash: 'async',
        });
      }
    }
  }

  /**
   * Sort issues based on options
   */
  private sortIssues(issues: BeadsIssue[]): BeadsIssue[] {
    const { sortBy, sortDirection } = this.options;
    const multiplier = sortDirection === 'asc' ? 1 : -1;

    return issues.sort((a, b) => {
      let comparison: number;

      switch (sortBy) {
        case 'created_at':
          comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
        case 'updated_at':
          comparison = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
          break;
        case 'priority':
          comparison = a.priority - b.priority;
          break;
        case 'id':
          comparison = a.id.localeCompare(b.id);
          break;
        default:
          comparison = 0;
      }

      // Secondary sort by ID for stability
      if (comparison === 0) {
        comparison = a.id.localeCompare(b.id);
      }

      return comparison * multiplier;
    });
  }
}

// ============================================
// Lazy Loader Class
// ============================================

/**
 * LazyLoader provides on-demand loading for large epics and dependency trees
 *
 * Features:
 * - Deferred loading of child issues
 * - Progress tracking
 * - Error handling
 * - Caching integration
 */
export class LazyLoader {
  private loadStates: Map<string, LazyLoadState<BeadsIssue>> = new Map();
  private loadPromises: Map<string, Promise<BeadsIssue[]>> = new Map();

  constructor(
    private fetcher: (parentId: string) => Promise<BeadsIssue[]>,
    private options: {
      /** Maximum items to load at once */
      batchSize?: number;
      /** Timeout for load operations in ms */
      timeoutMs?: number;
    } = {}
  ) {}

  /**
   * Get the load state for an epic
   */
  getState(epicId: string): LazyLoadState<BeadsIssue> {
    return (
      this.loadStates.get(epicId) || {
        items: [],
        fullyLoaded: false,
        loading: false,
      }
    );
  }

  /**
   * Load children for an epic
   * Returns immediately if already loaded
   */
  async loadChildren(epicId: string): Promise<BeadsIssue[]> {
    const state = this.getState(epicId);

    // Return cached if fully loaded
    if (state.fullyLoaded) {
      return state.items;
    }

    // Return in-progress promise if loading
    const existingPromise = this.loadPromises.get(epicId);
    if (existingPromise) {
      return existingPromise;
    }

    // Start new load
    const loadPromise = this.performLoad(epicId);
    this.loadPromises.set(epicId, loadPromise);

    try {
      const items = await loadPromise;
      return items;
    } finally {
      this.loadPromises.delete(epicId);
    }
  }

  /**
   * Preload children for multiple epics in parallel
   */
  async preloadMultiple(epicIds: string[]): Promise<void> {
    await Promise.all(epicIds.map((id) => this.loadChildren(id)));
  }

  /**
   * Check if an epic's children are loaded
   */
  isLoaded(epicId: string): boolean {
    return this.getState(epicId).fullyLoaded;
  }

  /**
   * Clear loaded state for an epic
   */
  invalidate(epicId: string): void {
    this.loadStates.delete(epicId);
    this.loadPromises.delete(epicId);
  }

  /**
   * Clear all loaded states
   */
  invalidateAll(): void {
    this.loadStates.clear();
    this.loadPromises.clear();
  }

  /**
   * Create a lazy epic from a regular issue
   */
  async createLazyEpic(issue: BeadsIssue): Promise<LazyEpic> {
    const lazyEpic: LazyEpic = {
      ...issue,
      children: this.getState(issue.id),
    };

    // Load children if epic
    if (issue.type === 'epic') {
      const children = await this.loadChildren(issue.id);
      lazyEpic.children = {
        items: children,
        fullyLoaded: true,
        loading: false,
        lastLoadedAt: Date.now(),
      };

      // Compute status
      const completed = children.filter((c) => c.status === 'closed').length;
      const blocked = children.filter((c) =>
        c.dependencies?.some((d) => d.type === 'blocks')
      ).length;

      lazyEpic.computedStatus = {
        totalChildren: children.length,
        completedChildren: completed,
        percentComplete: children.length > 0 ? (completed / children.length) * 100 : 0,
        blockedChildren: blocked,
      };
    }

    return lazyEpic;
  }

  /**
   * Perform the actual load operation
   */
  private async performLoad(epicId: string): Promise<BeadsIssue[]> {
    const state: LazyLoadState<BeadsIssue> = {
      items: [],
      fullyLoaded: false,
      loading: true,
    };
    this.loadStates.set(epicId, state);

    try {
      // Add timeout if configured
      const timeoutMs = this.options.timeoutMs ?? 30000;
      const loadPromise = this.fetcher(epicId);

      const items = await Promise.race([
        loadPromise,
        new Promise<BeadsIssue[]>((_, reject) =>
          setTimeout(() => reject(new Error('Load timeout')), timeoutMs)
        ),
      ]);

      state.items = items;
      state.fullyLoaded = true;
      state.loading = false;
      state.lastLoadedAt = Date.now();
      this.loadStates.set(epicId, state);

      return items;
    } catch (error) {
      state.loading = false;
      state.error = error instanceof Error ? error.message : 'Unknown error';
      this.loadStates.set(epicId, state);
      throw error;
    }
  }
}

// ============================================
// Batch Operations
// ============================================

/**
 * Batch operation result
 */
export interface BatchResult<T> {
  /** Successfully processed items */
  succeeded: T[];
  /** Failed items with errors */
  failed: Array<{ item: unknown; error: string }>;
  /** Total processing time in ms */
  durationMs: number;
}

/**
 * BatchProcessor handles bulk operations efficiently
 *
 * Features:
 * - Parallel processing with concurrency control
 * - Error isolation (one failure doesn't stop others)
 * - Progress tracking
 * - Rate limiting
 */
export class BatchProcessor {
  constructor(
    private options: {
      /** Maximum concurrent operations */
      concurrency?: number;
      /** Delay between batches in ms */
      batchDelayMs?: number;
      /** Continue on error */
      continueOnError?: boolean;
    } = {}
  ) {}

  /**
   * Process items in batches
   */
  async processBatch<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>
  ): Promise<BatchResult<R>> {
    const startTime = Date.now();
    const concurrency = this.options.concurrency ?? 5;
    const batchDelayMs = this.options.batchDelayMs ?? 0;
    const continueOnError = this.options.continueOnError ?? true;

    const succeeded: R[] = [];
    const failed: Array<{ item: unknown; error: string }> = [];

    // Process in chunks for concurrency control
    for (let i = 0; i < items.length; i += concurrency) {
      const chunk = items.slice(i, i + concurrency);

      const results = await Promise.allSettled(
        chunk.map((item) => processor(item))
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.status === 'fulfilled') {
          succeeded.push(result.value);
        } else {
          const error = result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
          failed.push({ item: chunk[j], error });

          if (!continueOnError) {
            return {
              succeeded,
              failed,
              durationMs: Date.now() - startTime,
            };
          }
        }
      }

      // Add delay between batches if configured
      if (batchDelayMs > 0 && i + concurrency < items.length) {
        await new Promise((resolve) => setTimeout(resolve, batchDelayMs));
      }
    }

    return {
      succeeded,
      failed,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Batch update issues
   */
  async batchUpdate(
    updates: Array<{ id: string; changes: Partial<BeadsIssue> }>,
    updater: (id: string, changes: Partial<BeadsIssue>) => Promise<BeadsIssue>
  ): Promise<BatchResult<BeadsIssue>> {
    return this.processBatch(updates, ({ id, changes }) => updater(id, changes));
  }

  /**
   * Batch close issues
   */
  async batchClose(
    issueIds: string[],
    closer: (id: string, reason?: string) => Promise<BeadsIssue>,
    reason?: string
  ): Promise<BatchResult<BeadsIssue>> {
    return this.processBatch(issueIds, (id) => closer(id, reason));
  }

  /**
   * Batch assign issues
   */
  async batchAssign(
    assignments: Array<{ issueId: string; assignee: string }>,
    assigner: (id: string, assignee: string) => Promise<BeadsIssue>
  ): Promise<BatchResult<BeadsIssue>> {
    return this.processBatch(assignments, ({ issueId, assignee }) =>
      assigner(issueId, assignee)
    );
  }
}

// ============================================
// Dependency Resolution Optimizer
// ============================================

/**
 * Optimized dependency resolution with caching
 *
 * Target: <20ms for dependency resolution
 */
export class DependencyResolver {
  private resolutionCache: Map<string, {
    dependencies: string[];
    dependents: string[];
    isBlocked: boolean;
    resolvedAt: number;
  }> = new Map();

  private readonly cacheTtlMs = 5000; // 5 seconds

  /**
   * Build dependency index from issues for fast lookups
   */
  buildIndex(issues: BeadsIssue[]): void {
    const now = Date.now();

    for (const issue of issues) {
      const dependencies: string[] = [];
      const dependents: string[] = [];

      // Extract blocking dependencies
      for (const dep of issue.dependencies || []) {
        if (dep.type === 'blocks') {
          dependencies.push(dep.to_id);
        }
      }

      // Find issues that depend on this one
      for (const other of issues) {
        for (const dep of other.dependencies || []) {
          if (dep.type === 'blocks' && dep.to_id === issue.id) {
            dependents.push(other.id);
          }
        }
      }

      // Check if blocked
      const isBlocked = dependencies.some((depId) => {
        const depIssue = issues.find((i) => i.id === depId);
        return depIssue && depIssue.status !== 'closed';
      });

      this.resolutionCache.set(issue.id, {
        dependencies,
        dependents,
        isBlocked,
        resolvedAt: now,
      });
    }
  }

  /**
   * Get blocking dependencies for an issue
   */
  getBlockingDependencies(issueId: string): string[] {
    const cached = this.resolutionCache.get(issueId);
    if (cached && Date.now() - cached.resolvedAt < this.cacheTtlMs) {
      return cached.dependencies;
    }
    return [];
  }

  /**
   * Get issues that depend on this issue
   */
  getDependents(issueId: string): string[] {
    const cached = this.resolutionCache.get(issueId);
    if (cached && Date.now() - cached.resolvedAt < this.cacheTtlMs) {
      return cached.dependents;
    }
    return [];
  }

  /**
   * Check if an issue is blocked
   */
  isBlocked(issueId: string): boolean {
    const cached = this.resolutionCache.get(issueId);
    if (cached && Date.now() - cached.resolvedAt < this.cacheTtlMs) {
      return cached.isBlocked;
    }
    return false;
  }

  /**
   * Get all issues that would be unblocked if this issue is closed
   */
  getWouldUnblock(issueId: string, issues: BeadsIssue[]): string[] {
    const dependents = this.getDependents(issueId);

    return dependents.filter((depId) => {
      const depIssue = issues.find((i) => i.id === depId);
      if (!depIssue) return false;

      // Check if this issue is the only blocker
      const dependencies = this.getBlockingDependencies(depId);
      const openDeps = dependencies.filter((d) => {
        if (d === issueId) return false; // Exclude the issue being closed
        const issue = issues.find((i) => i.id === d);
        return issue && issue.status !== 'closed';
      });

      return openDeps.length === 0;
    });
  }

  /**
   * Clear the resolution cache
   */
  clearCache(): void {
    this.resolutionCache.clear();
  }

  /**
   * Invalidate cache for a specific issue
   */
  invalidate(issueId: string): void {
    this.resolutionCache.delete(issueId);

    // Also invalidate dependents and dependencies
    for (const [id, entry] of this.resolutionCache.entries()) {
      if (entry.dependencies.includes(issueId) || entry.dependents.includes(issueId)) {
        this.resolutionCache.delete(id);
      }
    }
  }
}

// ============================================
// Factory Functions
// ============================================

/**
 * Create a paginator instance
 */
export function createPaginator(options?: PaginationOptions): BeadsPaginator {
  return new BeadsPaginator(options);
}

/**
 * Create a lazy loader instance
 */
export function createLazyLoader(
  fetcher: (parentId: string) => Promise<BeadsIssue[]>,
  options?: {
    batchSize?: number;
    timeoutMs?: number;
  }
): LazyLoader {
  return new LazyLoader(fetcher, options);
}

/**
 * Create a batch processor instance
 */
export function createBatchProcessor(options?: {
  concurrency?: number;
  batchDelayMs?: number;
  continueOnError?: boolean;
}): BatchProcessor {
  return new BatchProcessor(options);
}

/**
 * Create a dependency resolver instance
 */
export function createDependencyResolver(): DependencyResolver {
  return new DependencyResolver();
}
