/**
 * Beads Memory Link Tests
 *
 * TDD London School tests for BeadsMemoryLink.
 * Tests focus on behavior verification through mocks, testing how the memory link
 * interacts with memory stores and beads wrapper rather than internal state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BeadsMemoryLink, type MemoryStore, type Pattern } from '../../src/beads/memory-link.js';
import type { BeadsCliWrapper } from '../../src/beads/cli-wrapper.js';
import type { BeadsHookContext } from '../../src/beads/types.js';

describe('BeadsMemoryLink', () => {
  let memoryLink: BeadsMemoryLink;
  let mockMemoryStore: MemoryStore;
  let mockBeadsWrapper: Partial<BeadsCliWrapper>;

  beforeEach(() => {
    mockMemoryStore = {
      store: vi.fn().mockResolvedValue(undefined),
      retrieve: vi.fn().mockResolvedValue(null),
      query: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(undefined),
    };
    mockBeadsWrapper = {
      update: vi.fn().mockResolvedValue({ success: true, exitCode: 0 }),
      show: vi.fn().mockResolvedValue({
        success: true,
        exitCode: 0,
        data: { id: 'bd-a1b2', title: 'Test', status: 'open', priority: 2, type: 'task', labels: [], dependencies: [], created_at: '', updated_at: '' }
      }),
    };
    memoryLink = new BeadsMemoryLink(mockMemoryStore, mockBeadsWrapper as BeadsCliWrapper);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('linkMemory', () => {
    it('should store link in memory with correct namespace', async () => {
      await memoryLink.linkMemory('pattern-123', 'bd-a1b2');

      expect(mockMemoryStore.store).toHaveBeenCalledWith(
        expect.objectContaining({
          namespace: 'beads/links',
          key: expect.any(String),
        })
      );
    });

    it('should store link with memory key and issue id', async () => {
      await memoryLink.linkMemory('pattern-123', 'bd-a1b2');

      expect(mockMemoryStore.store).toHaveBeenCalledWith(
        expect.objectContaining({
          value: expect.objectContaining({
            memory_key: 'pattern-123',
            issue_id: 'bd-a1b2',
          }),
        })
      );
    });

    it('should include timestamp in stored link', async () => {
      const beforeTime = new Date().toISOString();
      await memoryLink.linkMemory('pattern-123', 'bd-a1b2');
      const afterTime = new Date().toISOString();

      expect(mockMemoryStore.store).toHaveBeenCalledWith(
        expect.objectContaining({
          value: expect.objectContaining({
            linked_at: expect.any(String),
          }),
        })
      );

      const storeCall = (mockMemoryStore.store as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const linkedAt = storeCall.value.linked_at;
      expect(linkedAt >= beforeTime).toBe(true);
      expect(linkedAt <= afterTime).toBe(true);
    });

    it('should update beads issue with note about linked memory', async () => {
      await memoryLink.linkMemory('pattern-123', 'bd-a1b2');

      expect(mockBeadsWrapper.update).toHaveBeenCalledWith({
        id: 'bd-a1b2',
        notes: expect.stringContaining('pattern-123'),
      });
    });

    it('should include link type in note', async () => {
      await memoryLink.linkMemory('pattern-123', 'bd-a1b2', 'learned-from');

      expect(mockBeadsWrapper.update).toHaveBeenCalledWith({
        id: 'bd-a1b2',
        notes: expect.stringContaining('learned-from'),
      });
    });

    it('should default to auto link type', async () => {
      await memoryLink.linkMemory('pattern-123', 'bd-a1b2');

      expect(mockMemoryStore.store).toHaveBeenCalledWith(
        expect.objectContaining({
          value: expect.objectContaining({
            link_type: 'auto',
          }),
        })
      );
    });

    it('should support different link types', async () => {
      await memoryLink.linkMemory('pattern-123', 'bd-a1b2', 'learned-from');

      expect(mockMemoryStore.store).toHaveBeenCalledWith(
        expect.objectContaining({
          value: expect.objectContaining({
            link_type: 'learned-from',
          }),
        })
      );
    });

    it('should generate unique link key', async () => {
      await memoryLink.linkMemory('pattern-123', 'bd-a1b2');
      await memoryLink.linkMemory('pattern-456', 'bd-c3d4');

      const calls = (mockMemoryStore.store as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0][0].key).not.toBe(calls[1][0].key);
    });
  });

  describe('queryByIssue', () => {
    it('should return linked memory keys for an issue', async () => {
      (mockMemoryStore.query as ReturnType<typeof vi.fn>).mockResolvedValue([
        { key: 'link-1', value: { memory_key: 'pattern-123', issue_id: 'bd-a1b2' } },
        { key: 'link-2', value: { memory_key: 'pattern-456', issue_id: 'bd-a1b2' } },
      ]);

      const result = await memoryLink.queryByIssue('bd-a1b2');

      expect(result).toContain('pattern-123');
      expect(result).toContain('pattern-456');
    });

    it('should query memory store with issue id filter', async () => {
      await memoryLink.queryByIssue('bd-a1b2');

      expect(mockMemoryStore.query).toHaveBeenCalledWith({
        filter: expect.objectContaining({
          issue_id: 'bd-a1b2',
        }),
      });
    });

    it('should query beads/links namespace', async () => {
      await memoryLink.queryByIssue('bd-a1b2');

      expect(mockMemoryStore.query).toHaveBeenCalledWith({
        filter: expect.objectContaining({
          namespace: 'beads/links',
        }),
      });
    });

    it('should return empty array when no links found', async () => {
      (mockMemoryStore.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await memoryLink.queryByIssue('bd-no-links');

      expect(result).toEqual([]);
    });

    it('should filter out null or undefined memory keys', async () => {
      (mockMemoryStore.query as ReturnType<typeof vi.fn>).mockResolvedValue([
        { key: 'link-1', value: { memory_key: 'pattern-123', issue_id: 'bd-a1b2' } },
        { key: 'link-2', value: { memory_key: null, issue_id: 'bd-a1b2' } },
        { key: 'link-3', value: { issue_id: 'bd-a1b2' } },
      ]);

      const result = await memoryLink.queryByIssue('bd-a1b2');

      expect(result).toEqual(['pattern-123']);
    });
  });

  describe('queryByMemory', () => {
    it('should return linked issue ids for a memory key', async () => {
      (mockMemoryStore.query as ReturnType<typeof vi.fn>).mockResolvedValue([
        { key: 'link-1', value: { memory_key: 'pattern-123', issue_id: 'bd-a1b2' } },
        { key: 'link-2', value: { memory_key: 'pattern-123', issue_id: 'bd-c3d4' } },
      ]);

      const result = await memoryLink.queryByMemory('pattern-123');

      expect(result).toContain('bd-a1b2');
      expect(result).toContain('bd-c3d4');
    });

    it('should query memory store with memory key filter', async () => {
      await memoryLink.queryByMemory('pattern-123');

      expect(mockMemoryStore.query).toHaveBeenCalledWith({
        filter: expect.objectContaining({
          memory_key: 'pattern-123',
        }),
      });
    });
  });

  describe('autoLink', () => {
    it('should link pattern when active issue exists in context', async () => {
      const pattern: Pattern = { id: 'p1', data: 'test', metadata: {} };
      const context: BeadsHookContext = { active_issue: 'bd-a1b2' };

      const result = await memoryLink.autoLink(pattern, context);

      expect(result.metadata.beads_issue).toBe('bd-a1b2');
    });

    it('should store link in memory when auto-linking', async () => {
      const pattern: Pattern = { id: 'p1', data: 'test', metadata: {} };
      const context: BeadsHookContext = { active_issue: 'bd-a1b2' };

      await memoryLink.autoLink(pattern, context);

      expect(mockMemoryStore.store).toHaveBeenCalledWith(
        expect.objectContaining({
          namespace: 'beads/links',
          value: expect.objectContaining({
            memory_key: 'p1',
            issue_id: 'bd-a1b2',
            link_type: 'auto',
          }),
        })
      );
    });

    it('should not modify pattern when no active issue', async () => {
      const pattern: Pattern = { id: 'p1', data: 'test', metadata: { existing: 'value' } };
      const context: BeadsHookContext = {};

      const result = await memoryLink.autoLink(pattern, context);

      expect(result.metadata).not.toHaveProperty('beads_issue');
      expect(result.metadata.existing).toBe('value');
    });

    it('should not store link when no active issue', async () => {
      const pattern: Pattern = { id: 'p1', data: 'test', metadata: {} };
      const context: BeadsHookContext = {};

      await memoryLink.autoLink(pattern, context);

      expect(mockMemoryStore.store).not.toHaveBeenCalled();
    });

    it('should preserve existing metadata', async () => {
      const pattern: Pattern = {
        id: 'p1',
        data: 'test',
        metadata: { existing: 'value', another: 123 }
      };
      const context: BeadsHookContext = { active_issue: 'bd-a1b2' };

      const result = await memoryLink.autoLink(pattern, context);

      expect(result.metadata.existing).toBe('value');
      expect(result.metadata.another).toBe(123);
      expect(result.metadata.beads_issue).toBe('bd-a1b2');
    });

    it('should return original pattern reference if not linked', async () => {
      const pattern: Pattern = { id: 'p1', data: 'test', metadata: {} };
      const context: BeadsHookContext = {};

      const result = await memoryLink.autoLink(pattern, context);

      expect(result).toBe(pattern);
    });

    it('should include session id in link if available', async () => {
      const pattern: Pattern = { id: 'p1', data: 'test', metadata: {} };
      const context: BeadsHookContext = {
        active_issue: 'bd-a1b2',
        session_id: 'session-xyz'
      };

      await memoryLink.autoLink(pattern, context);

      expect(mockMemoryStore.store).toHaveBeenCalledWith(
        expect.objectContaining({
          value: expect.objectContaining({
            session_id: 'session-xyz',
          }),
        })
      );
    });
  });

  describe('unlinkMemory', () => {
    it('should remove link from memory store', async () => {
      (mockMemoryStore.query as ReturnType<typeof vi.fn>).mockResolvedValue([
        { key: 'link-key-123', value: { memory_key: 'pattern-123', issue_id: 'bd-a1b2' } },
      ]);

      await memoryLink.unlinkMemory('pattern-123', 'bd-a1b2');

      expect(mockMemoryStore.update).toHaveBeenCalledWith(
        'link-key-123',
        expect.objectContaining({ deleted: true })
      );
    });

    it('should handle case when link does not exist', async () => {
      (mockMemoryStore.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await expect(memoryLink.unlinkMemory('pattern-123', 'bd-a1b2')).resolves.not.toThrow();
    });
  });

  describe('getLinksForIssue', () => {
    it('should return full link objects for an issue', async () => {
      const mockLinks = [
        { key: 'link-1', value: { memory_key: 'pattern-123', issue_id: 'bd-a1b2', link_type: 'auto', linked_at: '2024-01-15T10:00:00Z' } },
        { key: 'link-2', value: { memory_key: 'pattern-456', issue_id: 'bd-a1b2', link_type: 'learned-from', linked_at: '2024-01-15T11:00:00Z' } },
      ];
      (mockMemoryStore.query as ReturnType<typeof vi.fn>).mockResolvedValue(mockLinks);

      const result = await memoryLink.getLinksForIssue('bd-a1b2');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(expect.objectContaining({
        memory_key: 'pattern-123',
        issue_id: 'bd-a1b2',
        link_type: 'auto',
      }));
    });
  });

  describe('bulkLink', () => {
    it('should link multiple memory keys to an issue', async () => {
      const memoryKeys = ['pattern-1', 'pattern-2', 'pattern-3'];

      await memoryLink.bulkLink(memoryKeys, 'bd-a1b2');

      expect(mockMemoryStore.store).toHaveBeenCalledTimes(3);
    });

    it('should update beads issue once with all linked patterns', async () => {
      const memoryKeys = ['pattern-1', 'pattern-2', 'pattern-3'];

      await memoryLink.bulkLink(memoryKeys, 'bd-a1b2');

      expect(mockBeadsWrapper.update).toHaveBeenCalledTimes(1);
      expect(mockBeadsWrapper.update).toHaveBeenCalledWith({
        id: 'bd-a1b2',
        notes: expect.stringContaining('pattern-1'),
      });
    });
  });
});

describe('BeadsMemoryLink Integration Patterns', () => {
  let memoryLink: BeadsMemoryLink;
  let mockMemoryStore: MemoryStore;
  let mockBeadsWrapper: Partial<BeadsCliWrapper>;

  beforeEach(() => {
    mockMemoryStore = {
      store: vi.fn().mockResolvedValue(undefined),
      retrieve: vi.fn().mockResolvedValue(null),
      query: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(undefined),
    };
    mockBeadsWrapper = {
      update: vi.fn().mockResolvedValue({ success: true, exitCode: 0 }),
      show: vi.fn().mockResolvedValue({ success: true, exitCode: 0, data: {} }),
    };
    memoryLink = new BeadsMemoryLink(mockMemoryStore, mockBeadsWrapper as BeadsCliWrapper);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should support link -> query workflow', async () => {
    // Link a pattern
    await memoryLink.linkMemory('pattern-auth', 'bd-auth-issue');

    // Mock the query to return the link we just created
    (mockMemoryStore.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { key: 'link-1', value: { memory_key: 'pattern-auth', issue_id: 'bd-auth-issue' } },
    ]);

    // Query by issue
    const result = await memoryLink.queryByIssue('bd-auth-issue');

    expect(result).toContain('pattern-auth');
  });

  it('should support autoLink -> queryByMemory workflow', async () => {
    const pattern: Pattern = { id: 'learned-pattern', data: { code: 'example' }, metadata: {} };
    const context: BeadsHookContext = { active_issue: 'bd-feature' };

    // Auto-link during learning
    const linkedPattern = await memoryLink.autoLink(pattern, context);

    // Mock the query result
    (mockMemoryStore.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { key: 'link-1', value: { memory_key: 'learned-pattern', issue_id: 'bd-feature' } },
    ]);

    // Query by memory to find related issues
    const issues = await memoryLink.queryByMemory('learned-pattern');

    expect(linkedPattern.metadata.beads_issue).toBe('bd-feature');
    expect(issues).toContain('bd-feature');
  });
});
