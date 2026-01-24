/**
 * Beads Pagination and Lazy Loading Tests
 *
 * TDD London School tests for pagination and lazy loading utilities.
 * Tests focus on behavior verification including:
 * - Cursor-based pagination
 * - Lazy loading for epics
 * - Batch processing
 * - Dependency resolution
 * - Performance benchmarks
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
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
} from '../../src/beads/pagination.js';
import type { BeadsIssue, BeadsListParams } from '../../src/beads/types.js';

// Mock issue factory
function createMockIssue(
  id: string,
  title: string = 'Test Issue',
  options: Partial<BeadsIssue> = {}
): BeadsIssue {
  return {
    id,
    title,
    status: options.status ?? 'open',
    priority: options.priority ?? 2,
    type: options.type ?? 'task',
    labels: options.labels ?? [],
    dependencies: options.dependencies ?? [],
    created_at: options.created_at ?? new Date(Date.now() - Math.random() * 86400000).toISOString(),
    updated_at: options.updated_at ?? new Date().toISOString(),
    ...options,
  };
}

describe('Cursor Encoding/Decoding', () => {
  describe('encodeCursor', () => {
    it('should encode cursor to base64url string', () => {
      const cursor: PaginationCursor = {
        timestamp: '2024-01-15T10:00:00Z',
        lastId: 'bd-a1b2',
        queryHash: 's:open',
      };

      const encoded = encodeCursor(cursor);

      expect(typeof encoded).toBe('string');
      expect(encoded.length).toBeGreaterThan(0);
      // base64url should not contain + / =
      expect(encoded).not.toMatch(/[+/=]/);
    });
  });

  describe('decodeCursor', () => {
    it('should decode valid cursor', () => {
      const original: PaginationCursor = {
        timestamp: '2024-01-15T10:00:00Z',
        lastId: 'bd-a1b2',
        queryHash: 's:open',
      };

      const encoded = encodeCursor(original);
      const decoded = decodeCursor(encoded);

      expect(decoded).toEqual(original);
    });

    it('should return null for invalid cursor', () => {
      expect(decodeCursor('invalid-base64!')).toBeNull();
      expect(decodeCursor('')).toBeNull();
    });

    it('should return null for malformed JSON', () => {
      const encoded = Buffer.from('not json').toString('base64url');
      expect(decodeCursor(encoded)).toBeNull();
    });
  });

  describe('hashQueryParams', () => {
    it('should return default for empty params', () => {
      expect(hashQueryParams()).toBe('default');
      expect(hashQueryParams({})).toBe('default');
    });

    it('should include status in hash', () => {
      const hash = hashQueryParams({ status: 'open' });
      expect(hash).toContain('s:open');
    });

    it('should include priority in hash', () => {
      const hash = hashQueryParams({ priority: 1 });
      expect(hash).toContain('p:1');
    });

    it('should include assignee in hash', () => {
      const hash = hashQueryParams({ assignee: 'user1' });
      expect(hash).toContain('a:user1');
    });

    it('should include sorted labels in hash', () => {
      const hash = hashQueryParams({ labels: ['z-label', 'a-label'] });
      expect(hash).toContain('l:a-label,z-label');
    });

    it('should produce consistent hash regardless of param order', () => {
      const hash1 = hashQueryParams({ status: 'open', priority: 1 });
      const hash2 = hashQueryParams({ priority: 1, status: 'open' });
      expect(hash1).toBe(hash2);
    });
  });
});

describe('BeadsPaginator', () => {
  let paginator: BeadsPaginator;
  let mockIssues: BeadsIssue[];

  beforeEach(() => {
    paginator = new BeadsPaginator({ pageSize: 3 });
    mockIssues = [
      createMockIssue('bd-1', 'Issue 1', { created_at: '2024-01-15T10:00:00Z' }),
      createMockIssue('bd-2', 'Issue 2', { created_at: '2024-01-15T11:00:00Z' }),
      createMockIssue('bd-3', 'Issue 3', { created_at: '2024-01-15T12:00:00Z' }),
      createMockIssue('bd-4', 'Issue 4', { created_at: '2024-01-15T13:00:00Z' }),
      createMockIssue('bd-5', 'Issue 5', { created_at: '2024-01-15T14:00:00Z' }),
    ];
  });

  describe('paginate', () => {
    it('should return first page of results', () => {
      const result = paginator.paginate(mockIssues);

      expect(result.items).toHaveLength(3);
      expect(result.pageNumber).toBe(1);
      expect(result.hasMore).toBe(true);
    });

    it('should return correct page size', () => {
      const customPaginator = new BeadsPaginator({ pageSize: 2 });
      const result = customPaginator.paginate(mockIssues);

      expect(result.items).toHaveLength(2);
      expect(result.pageSize).toBe(2);
    });

    it('should include total count', () => {
      const result = paginator.paginate(mockIssues);
      expect(result.totalCount).toBe(5);
    });

    it('should provide next cursor when more pages exist', () => {
      const result = paginator.paginate(mockIssues);

      expect(result.nextCursor).not.toBeNull();
      expect(result.hasMore).toBe(true);
    });

    it('should not provide next cursor on last page', () => {
      const customPaginator = new BeadsPaginator({ pageSize: 10 });
      const result = customPaginator.paginate(mockIssues);

      expect(result.nextCursor).toBeNull();
      expect(result.hasMore).toBe(false);
    });

    it('should not provide prev cursor on first page', () => {
      const result = paginator.paginate(mockIssues);
      expect(result.prevCursor).toBeNull();
    });

    it('should navigate to next page using cursor', () => {
      const page1 = paginator.paginate(mockIssues);

      const nextPaginator = new BeadsPaginator({
        pageSize: 3,
        cursor: page1.nextCursor!,
      });
      const page2 = nextPaginator.paginate(mockIssues);

      expect(page2.pageNumber).toBe(2);
      expect(page2.items).toHaveLength(2); // Last 2 items
      expect(page2.prevCursor).not.toBeNull();
    });

    it('should invalidate cursor when query changes', () => {
      // Get cursor with status=open filter
      const page1 = paginator.paginate(mockIssues, { status: 'open' });

      // Try to use cursor with different filter
      const nextPaginator = new BeadsPaginator({
        pageSize: 3,
        cursor: page1.nextCursor!,
      });
      // Different params = different queryHash = cursor ignored
      const page2 = nextPaginator.paginate(mockIssues, { status: 'closed' });

      // Should start from beginning since cursor is for different query
      expect(page2.pageNumber).toBe(1);
    });
  });

  describe('sorting', () => {
    it('should sort by created_at descending by default', () => {
      const result = paginator.paginate(mockIssues);

      // Most recent first
      expect(result.items[0].id).toBe('bd-5');
      expect(result.items[1].id).toBe('bd-4');
      expect(result.items[2].id).toBe('bd-3');
    });

    it('should sort by created_at ascending', () => {
      const ascPaginator = new BeadsPaginator({
        pageSize: 3,
        sortBy: 'created_at',
        sortDirection: 'asc',
      });
      const result = ascPaginator.paginate(mockIssues);

      expect(result.items[0].id).toBe('bd-1');
      expect(result.items[1].id).toBe('bd-2');
    });

    it('should sort by priority', () => {
      const prioritizedIssues = [
        createMockIssue('bd-low', 'Low', { priority: 4 }),
        createMockIssue('bd-high', 'High', { priority: 0 }),
        createMockIssue('bd-med', 'Medium', { priority: 2 }),
      ];

      const priorityPaginator = new BeadsPaginator({
        pageSize: 10,
        sortBy: 'priority',
        sortDirection: 'asc',
      });
      const result = priorityPaginator.paginate(prioritizedIssues);

      expect(result.items[0].id).toBe('bd-high');
      expect(result.items[2].id).toBe('bd-low');
    });
  });

  describe('paginateAsync', () => {
    it('should iterate through pages asynchronously', async () => {
      const mockFetcher = vi
        .fn()
        .mockResolvedValueOnce({ items: mockIssues.slice(0, 3), hasMore: true })
        .mockResolvedValueOnce({ items: mockIssues.slice(3, 5), hasMore: false });

      const allItems: BeadsIssue[] = [];
      for await (const page of paginator.paginateAsync(mockFetcher)) {
        allItems.push(...page);
      }

      expect(allItems).toHaveLength(5);
      expect(mockFetcher).toHaveBeenCalledTimes(2);
    });

    it('should stop when no more pages', async () => {
      const mockFetcher = vi.fn().mockResolvedValue({ items: [], hasMore: false });

      const pages: BeadsIssue[][] = [];
      for await (const page of paginator.paginateAsync(mockFetcher)) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(pages[0]).toHaveLength(0);
    });
  });
});

describe('LazyLoader', () => {
  let loader: LazyLoader;
  let mockFetcher: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetcher = vi.fn().mockImplementation((parentId: string) =>
      Promise.resolve([
        createMockIssue(`${parentId}-child-1`),
        createMockIssue(`${parentId}-child-2`),
      ])
    );
    loader = new LazyLoader(mockFetcher);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadChildren', () => {
    it('should fetch children on first load', async () => {
      const children = await loader.loadChildren('bd-epic');

      expect(mockFetcher).toHaveBeenCalledWith('bd-epic');
      expect(children).toHaveLength(2);
    });

    it('should return cached children on subsequent loads', async () => {
      await loader.loadChildren('bd-epic');
      await loader.loadChildren('bd-epic');

      expect(mockFetcher).toHaveBeenCalledTimes(1);
    });

    it('should deduplicate concurrent requests', async () => {
      const promise1 = loader.loadChildren('bd-epic');
      const promise2 = loader.loadChildren('bd-epic');

      await Promise.all([promise1, promise2]);

      expect(mockFetcher).toHaveBeenCalledTimes(1);
    });

    it('should load different epics independently', async () => {
      await loader.loadChildren('bd-epic-1');
      await loader.loadChildren('bd-epic-2');

      expect(mockFetcher).toHaveBeenCalledTimes(2);
    });
  });

  describe('getState', () => {
    it('should return empty state for unloaded epic', () => {
      const state = loader.getState('bd-new-epic');

      expect(state.items).toHaveLength(0);
      expect(state.fullyLoaded).toBe(false);
      expect(state.loading).toBe(false);
    });

    it('should return loaded state after loading', async () => {
      await loader.loadChildren('bd-epic');
      const state = loader.getState('bd-epic');

      expect(state.fullyLoaded).toBe(true);
      expect(state.items).toHaveLength(2);
      expect(state.lastLoadedAt).toBeDefined();
    });

    it('should capture errors in state', async () => {
      mockFetcher.mockRejectedValueOnce(new Error('Network error'));

      await expect(loader.loadChildren('bd-epic')).rejects.toThrow('Network error');

      const state = loader.getState('bd-epic');
      expect(state.error).toBe('Network error');
      expect(state.loading).toBe(false);
    });
  });

  describe('isLoaded', () => {
    it('should return false for unloaded epic', () => {
      expect(loader.isLoaded('bd-epic')).toBe(false);
    });

    it('should return true after loading', async () => {
      await loader.loadChildren('bd-epic');
      expect(loader.isLoaded('bd-epic')).toBe(true);
    });
  });

  describe('invalidate', () => {
    it('should clear loaded state', async () => {
      await loader.loadChildren('bd-epic');
      loader.invalidate('bd-epic');

      expect(loader.isLoaded('bd-epic')).toBe(false);
    });

    it('should allow reloading after invalidation', async () => {
      await loader.loadChildren('bd-epic');
      loader.invalidate('bd-epic');
      await loader.loadChildren('bd-epic');

      expect(mockFetcher).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalidateAll', () => {
    it('should clear all loaded states', async () => {
      await loader.loadChildren('bd-epic-1');
      await loader.loadChildren('bd-epic-2');
      loader.invalidateAll();

      expect(loader.isLoaded('bd-epic-1')).toBe(false);
      expect(loader.isLoaded('bd-epic-2')).toBe(false);
    });
  });

  describe('preloadMultiple', () => {
    it('should load multiple epics in parallel', async () => {
      await loader.preloadMultiple(['bd-epic-1', 'bd-epic-2', 'bd-epic-3']);

      expect(loader.isLoaded('bd-epic-1')).toBe(true);
      expect(loader.isLoaded('bd-epic-2')).toBe(true);
      expect(loader.isLoaded('bd-epic-3')).toBe(true);
    });
  });

  describe('createLazyEpic', () => {
    it('should create lazy epic with computed status', async () => {
      const children = [
        createMockIssue('bd-child-1', 'Child 1', { status: 'closed' }),
        createMockIssue('bd-child-2', 'Child 2', { status: 'open' }),
        createMockIssue('bd-child-3', 'Child 3', { status: 'closed' }),
      ];
      mockFetcher.mockResolvedValue(children);

      const epic = createMockIssue('bd-epic', 'Epic', { type: 'epic' });
      const lazyEpic = await loader.createLazyEpic(epic);

      expect(lazyEpic.children?.items).toHaveLength(3);
      expect(lazyEpic.computedStatus?.totalChildren).toBe(3);
      expect(lazyEpic.computedStatus?.completedChildren).toBe(2);
      expect(lazyEpic.computedStatus?.percentComplete).toBeCloseTo(66.67, 1);
    });

    it('should not load children for non-epic issues', async () => {
      const task = createMockIssue('bd-task', 'Task', { type: 'task' });
      const lazyTask = await loader.createLazyEpic(task);

      expect(mockFetcher).not.toHaveBeenCalled();
      expect(lazyTask.computedStatus).toBeUndefined();
    });
  });

  describe('timeout handling', () => {
    it('should timeout if load takes too long', async () => {
      const slowLoader = new LazyLoader(
        () => new Promise((resolve) => setTimeout(resolve, 100)),
        { timeoutMs: 50 }
      );

      await expect(slowLoader.loadChildren('bd-epic')).rejects.toThrow('Load timeout');
    });
  });
});

describe('BatchProcessor', () => {
  let processor: BatchProcessor;

  beforeEach(() => {
    processor = new BatchProcessor({ concurrency: 2 });
  });

  describe('processBatch', () => {
    it('should process all items', async () => {
      const items = [1, 2, 3, 4, 5];
      const processedFn = vi.fn().mockImplementation((n) => Promise.resolve(n * 2));

      const result = await processor.processBatch(items, processedFn);

      expect(result.succeeded).toHaveLength(5);
      expect(result.succeeded).toEqual([2, 4, 6, 8, 10]);
      expect(result.failed).toHaveLength(0);
    });

    it('should respect concurrency limit', async () => {
      const items = [1, 2, 3, 4];
      let concurrent = 0;
      let maxConcurrent = 0;

      const processFn = vi.fn().mockImplementation(async (n) => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 10));
        concurrent--;
        return n;
      });

      await processor.processBatch(items, processFn);

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it('should continue on error by default', async () => {
      const items = [1, 2, 3];
      const processFn = vi.fn().mockImplementation(async (n) => {
        if (n === 2) throw new Error('Item 2 failed');
        return n;
      });

      const result = await processor.processBatch(items, processFn);

      expect(result.succeeded).toHaveLength(2);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].error).toBe('Item 2 failed');
    });

    it('should stop on error when configured', async () => {
      const strictProcessor = new BatchProcessor({
        concurrency: 1,
        continueOnError: false,
      });

      const items = [1, 2, 3];
      const processFn = vi.fn().mockImplementation(async (n) => {
        if (n === 2) throw new Error('Item 2 failed');
        return n;
      });

      const result = await strictProcessor.processBatch(items, processFn);

      expect(result.succeeded).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
    });

    it('should track duration', async () => {
      const items = [1, 2, 3];
      const processFn = vi.fn().mockImplementation(async (n) => {
        await new Promise((r) => setTimeout(r, 10));
        return n;
      });

      const result = await processor.processBatch(items, processFn);

      expect(result.durationMs).toBeGreaterThan(0);
    });
  });

  describe('batchUpdate', () => {
    it('should update multiple issues', async () => {
      const updates = [
        { id: 'bd-1', changes: { status: 'closed' } },
        { id: 'bd-2', changes: { priority: 1 } },
      ];
      const updater = vi.fn().mockImplementation((id, changes) =>
        Promise.resolve(createMockIssue(id, 'Updated', changes))
      );

      const result = await processor.batchUpdate(updates, updater);

      expect(result.succeeded).toHaveLength(2);
      expect(updater).toHaveBeenCalledTimes(2);
    });
  });

  describe('batchClose', () => {
    it('should close multiple issues', async () => {
      const ids = ['bd-1', 'bd-2', 'bd-3'];
      const closer = vi.fn().mockImplementation((id) =>
        Promise.resolve(createMockIssue(id, 'Closed', { status: 'closed' }))
      );

      const result = await processor.batchClose(ids, closer, 'Done');

      expect(result.succeeded).toHaveLength(3);
      expect(closer).toHaveBeenCalledWith('bd-1', 'Done');
    });
  });

  describe('batchAssign', () => {
    it('should assign multiple issues', async () => {
      const assignments = [
        { issueId: 'bd-1', assignee: 'user1' },
        { issueId: 'bd-2', assignee: 'user2' },
      ];
      const assigner = vi.fn().mockImplementation((id, assignee) =>
        Promise.resolve(createMockIssue(id, 'Assigned', { assignee }))
      );

      const result = await processor.batchAssign(assignments, assigner);

      expect(result.succeeded).toHaveLength(2);
      expect(assigner).toHaveBeenCalledWith('bd-1', 'user1');
    });
  });
});

describe('DependencyResolver', () => {
  let resolver: DependencyResolver;
  let mockIssues: BeadsIssue[];

  beforeEach(() => {
    resolver = new DependencyResolver();
    mockIssues = [
      createMockIssue('bd-1', 'Issue 1', { status: 'closed', dependencies: [] }),
      createMockIssue('bd-2', 'Issue 2', {
        status: 'open',
        dependencies: [{ from_id: 'bd-2', to_id: 'bd-1', type: 'blocks', created_at: '' }],
      }),
      createMockIssue('bd-3', 'Issue 3', {
        status: 'open',
        dependencies: [{ from_id: 'bd-3', to_id: 'bd-2', type: 'blocks', created_at: '' }],
      }),
      createMockIssue('bd-4', 'Issue 4', {
        status: 'open',
        dependencies: [
          { from_id: 'bd-4', to_id: 'bd-2', type: 'blocks', created_at: '' },
          { from_id: 'bd-4', to_id: 'bd-3', type: 'blocks', created_at: '' },
        ],
      }),
    ];

    resolver.buildIndex(mockIssues);
  });

  describe('buildIndex', () => {
    it('should build dependency index from issues', () => {
      const deps = resolver.getBlockingDependencies('bd-2');
      expect(deps).toContain('bd-1');
    });
  });

  describe('getBlockingDependencies', () => {
    it('should return blocking dependencies', () => {
      const deps = resolver.getBlockingDependencies('bd-4');
      expect(deps).toContain('bd-2');
      expect(deps).toContain('bd-3');
    });

    it('should return empty array for issues with no dependencies', () => {
      const deps = resolver.getBlockingDependencies('bd-1');
      expect(deps).toHaveLength(0);
    });
  });

  describe('getDependents', () => {
    it('should return issues that depend on this issue', () => {
      const dependents = resolver.getDependents('bd-2');
      expect(dependents).toContain('bd-3');
      expect(dependents).toContain('bd-4');
    });

    it('should return empty array for leaf issues', () => {
      const dependents = resolver.getDependents('bd-4');
      expect(dependents).toHaveLength(0);
    });
  });

  describe('isBlocked', () => {
    it('should return true for blocked issues', () => {
      // bd-2 depends on bd-1 which is closed, so not blocked
      expect(resolver.isBlocked('bd-2')).toBe(false);

      // bd-3 depends on bd-2 which is open, so blocked
      expect(resolver.isBlocked('bd-3')).toBe(true);
    });

    it('should return false for unblocked issues', () => {
      expect(resolver.isBlocked('bd-1')).toBe(false);
    });
  });

  describe('getWouldUnblock', () => {
    it('should return issues that would be unblocked', () => {
      // Close bd-2, would unblock bd-3 (since bd-3's only blocker is bd-2)
      // bd-4 would still be blocked by bd-3
      const wouldUnblock = resolver.getWouldUnblock('bd-2', mockIssues);

      // This depends on the current state - bd-3 would be unblocked
      // because its only dependency is bd-2
      expect(wouldUnblock).toContain('bd-3');
    });
  });

  describe('cache invalidation', () => {
    it('should clear cache', () => {
      resolver.clearCache();
      // After clear, getBlockingDependencies should return empty (cache miss)
      const deps = resolver.getBlockingDependencies('bd-2');
      expect(deps).toHaveLength(0);
    });

    it('should invalidate specific issue and related issues', () => {
      resolver.invalidate('bd-2');
      // bd-2 and issues depending on it should be invalidated
      const deps = resolver.getBlockingDependencies('bd-2');
      expect(deps).toHaveLength(0);
    });
  });
});

describe('Performance Benchmarks', () => {
  describe('pagination performance', () => {
    it('should paginate 10000 issues efficiently', () => {
      const issues = Array.from({ length: 10000 }, (_, i) =>
        createMockIssue(`bd-${i}`, `Issue ${i}`)
      );
      const paginator = new BeadsPaginator({ pageSize: 100 });

      const start = performance.now();
      const result = paginator.paginate(issues);
      const duration = performance.now() - start;

      // Allow 500ms for CI environments which may be slower
      expect(duration).toBeLessThan(500);
      expect(result.items).toHaveLength(100);
    });
  });

  describe('dependency resolution performance', () => {
    it('should build index for 1000 issues efficiently', () => {
      const issues = Array.from({ length: 1000 }, (_, i) => {
        const deps = i > 0 ? [{ from_id: `bd-${i}`, to_id: `bd-${i - 1}`, type: 'blocks' as const, created_at: '' }] : [];
        return createMockIssue(`bd-${i}`, `Issue ${i}`, { dependencies: deps });
      });
      const resolver = new DependencyResolver();

      const start = performance.now();
      resolver.buildIndex(issues);
      const duration = performance.now() - start;

      // Allow 500ms for CI environments which may be slower
      expect(duration).toBeLessThan(500);
    });

    it('should resolve dependencies in <1ms after indexing', () => {
      const issues = Array.from({ length: 1000 }, (_, i) => {
        const deps = i > 0 ? [{ from_id: `bd-${i}`, to_id: `bd-${i - 1}`, type: 'blocks' as const, created_at: '' }] : [];
        return createMockIssue(`bd-${i}`, `Issue ${i}`, { dependencies: deps });
      });
      const resolver = new DependencyResolver();
      resolver.buildIndex(issues);

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        resolver.getBlockingDependencies(`bd-${Math.floor(Math.random() * 1000)}`);
      }
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(10); // 100 lookups in <10ms
    });
  });

  describe('batch processing performance', () => {
    it('should process 100 items in parallel efficiently', async () => {
      const processor = new BatchProcessor({ concurrency: 10 });
      const items = Array.from({ length: 100 }, (_, i) => i);

      const start = performance.now();
      const result = await processor.processBatch(items, async (n) => {
        await new Promise((r) => setTimeout(r, 1));
        return n;
      });
      const duration = performance.now() - start;

      expect(result.succeeded).toHaveLength(100);
      // With concurrency=10 and 1ms per item, should be ~10ms + overhead
      // Much faster than sequential (100ms)
      expect(duration).toBeLessThan(50);
    });
  });
});

describe('Factory Functions', () => {
  it('should create paginator with options', () => {
    const paginator = createPaginator({ pageSize: 50 });
    expect(paginator).toBeInstanceOf(BeadsPaginator);
  });

  it('should create lazy loader with fetcher', () => {
    const loader = createLazyLoader(() => Promise.resolve([]));
    expect(loader).toBeInstanceOf(LazyLoader);
  });

  it('should create batch processor with options', () => {
    const processor = createBatchProcessor({ concurrency: 5 });
    expect(processor).toBeInstanceOf(BatchProcessor);
  });

  it('should create dependency resolver', () => {
    const resolver = createDependencyResolver();
    expect(resolver).toBeInstanceOf(DependencyResolver);
  });
});

describe('DEFAULT_PAGINATION', () => {
  it('should have sensible defaults', () => {
    expect(DEFAULT_PAGINATION.pageSize).toBe(20);
    expect(DEFAULT_PAGINATION.cursor).toBe('');
    expect(DEFAULT_PAGINATION.sortBy).toBe('created_at');
    expect(DEFAULT_PAGINATION.sortDirection).toBe('desc');
  });
});
