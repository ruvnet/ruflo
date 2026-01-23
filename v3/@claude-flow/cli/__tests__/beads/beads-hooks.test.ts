/**
 * Beads Hooks Integration Tests
 *
 * TDD London School tests for Beads lifecycle hooks.
 * Tests focus on behavior verification and mock interactions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BeadsHooks } from '../../src/beads/hooks.js';
import type { BeadsCliWrapper, BeadsIssue } from '../../src/beads/cli-wrapper.js';

// Mock the CLI wrapper - London School approach
const createMockWrapper = (): BeadsCliWrapper => ({
  create: vi.fn(),
  list: vi.fn(),
  ready: vi.fn(),
  show: vi.fn(),
  update: vi.fn(),
  close: vi.fn(),
  depAdd: vi.fn(),
  depTree: vi.fn(),
  blocked: vi.fn(),
  stats: vi.fn(),
  sync: vi.fn(),
});

describe('BeadsHooks', () => {
  let hooks: BeadsHooks;
  let mockWrapper: BeadsCliWrapper;

  beforeEach(() => {
    mockWrapper = createMockWrapper();
    hooks = new BeadsHooks(mockWrapper);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('sessionStart', () => {
    it('should inject ready work context', async () => {
      const mockIssues: BeadsIssue[] = [
        {
          id: 'bd-a1b2',
          title: 'Ready Task',
          status: 'open',
          priority: 1,
          createdAt: new Date().toISOString(),
        },
      ];
      (mockWrapper.ready as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockIssues,
      });

      const context = await hooks.sessionStart();

      expect(mockWrapper.ready).toHaveBeenCalledWith({ limit: 5 });
      expect(context).toContain('Ready Work');
      expect(context).toContain('bd-a1b2');
    });

    it('should handle empty ready list gracefully', async () => {
      (mockWrapper.ready as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [],
      });

      const context = await hooks.sessionStart();

      expect(context).toContain('No ready work');
    });

    it('should handle wrapper failure gracefully', async () => {
      (mockWrapper.ready as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        error: 'Connection failed',
      });

      const context = await hooks.sessionStart();

      expect(context).toContain('No ready work');
    });

    it('should format multiple ready issues with priorities', async () => {
      const mockIssues: BeadsIssue[] = [
        { id: 'bd-001', title: 'Critical Bug', status: 'open', priority: 0, createdAt: new Date().toISOString() },
        { id: 'bd-002', title: 'Feature Request', status: 'open', priority: 2, createdAt: new Date().toISOString() },
        { id: 'bd-003', title: 'Nice to Have', status: 'open', priority: 4, createdAt: new Date().toISOString() },
      ];
      (mockWrapper.ready as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockIssues,
      });

      const context = await hooks.sessionStart();

      expect(context).toContain('3 unblocked');
      expect(context).toContain('[bd-001] P0');
      expect(context).toContain('[bd-002] P2');
      expect(context).toContain('[bd-003] P4');
    });
  });

  describe('sessionEnd', () => {
    it('should return prompt for issue management', async () => {
      const prompt = await hooks.sessionEnd();

      expect(prompt).toContain('beads_create');
      expect(prompt).toContain('beads_close');
      expect(prompt).toContain('beads_update');
      expect(prompt).toContain('beads_sync');
    });

    it('should include session cleanup guidance', async () => {
      const prompt = await hooks.sessionEnd();

      expect(prompt).toContain('Before ending session');
      expect(prompt).toContain('File any discovered issues');
      expect(prompt).toContain('Close completed issues');
    });
  });

  describe('preTask', () => {
    it('should inject related issues context when keywords provided', async () => {
      const mockIssues: BeadsIssue[] = [
        { id: 'bd-a1b2', title: 'Related Auth Issue', status: 'open', priority: 1, createdAt: new Date().toISOString() },
      ];
      (mockWrapper.list as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockIssues,
      });

      const context = await hooks.preTask({ keywords: 'auth' });

      expect(mockWrapper.list).toHaveBeenCalledWith({
        status: 'open',
        limit: 5,
      });
      expect(context).toContain('Related Beads issues');
      expect(context).toContain('bd-a1b2');
    });

    it('should return empty string when no keywords provided', async () => {
      const context = await hooks.preTask({});

      expect(mockWrapper.list).not.toHaveBeenCalled();
      expect(context).toBe('');
    });

    it('should return empty string when no related issues found', async () => {
      (mockWrapper.list as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [],
      });

      const context = await hooks.preTask({ keywords: 'nonexistent' });

      expect(context).toBe('');
    });

    it('should handle wrapper failure gracefully', async () => {
      (mockWrapper.list as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        error: 'Search failed',
      });

      const context = await hooks.preTask({ keywords: 'auth' });

      expect(context).toBe('');
    });

    it('should format multiple related issues', async () => {
      const mockIssues: BeadsIssue[] = [
        { id: 'bd-001', title: 'Auth Login Bug', status: 'open', priority: 1, createdAt: new Date().toISOString() },
        { id: 'bd-002', title: 'Auth Token Refresh', status: 'open', priority: 2, createdAt: new Date().toISOString() },
      ];
      (mockWrapper.list as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockIssues,
      });

      const context = await hooks.preTask({ keywords: 'auth' });

      expect(context).toContain('[bd-001]');
      expect(context).toContain('[bd-002]');
      expect(context).toContain('Auth Login Bug');
      expect(context).toContain('Auth Token Refresh');
    });
  });

  describe('postTask', () => {
    it('should close issue on task completion', async () => {
      (mockWrapper.close as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: { id: 'bd-a1b2', status: 'closed' },
      });

      await hooks.postTask(
        { status: 'completed', beads_issue_id: 'bd-a1b2' },
        { summary: 'Implemented feature' }
      );

      expect(mockWrapper.close).toHaveBeenCalledWith({ id: 'bd-a1b2', reason: 'Implemented feature' });
    });

    it('should not close if task failed', async () => {
      await hooks.postTask(
        { status: 'failed', beads_issue_id: 'bd-a1b2' },
        { summary: 'Failed to complete' }
      );

      expect(mockWrapper.close).not.toHaveBeenCalled();
    });

    it('should not close if no issue id provided', async () => {
      await hooks.postTask(
        { status: 'completed' },
        { summary: 'Completed successfully' }
      );

      expect(mockWrapper.close).not.toHaveBeenCalled();
    });

    it('should close without summary if none provided', async () => {
      (mockWrapper.close as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: { id: 'bd-a1b2', status: 'closed' },
      });

      await hooks.postTask(
        { status: 'completed', beads_issue_id: 'bd-a1b2' },
        {}
      );

      expect(mockWrapper.close).toHaveBeenCalledWith({ id: 'bd-a1b2', reason: undefined });
    });

    it('should handle close failure gracefully', async () => {
      (mockWrapper.close as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        error: 'Issue not found',
      });

      // Should not throw
      await expect(
        hooks.postTask(
          { status: 'completed', beads_issue_id: 'bd-invalid' },
          { summary: 'Done' }
        )
      ).resolves.toBeUndefined();
    });
  });

  describe('postTaskWithPatterns', () => {
    it('should include patterns learned in close reason', async () => {
      (mockWrapper.close as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: { id: 'bd-a1b2', status: 'closed' },
      });

      await hooks.postTask(
        { status: 'completed', beads_issue_id: 'bd-a1b2' },
        {
          summary: 'Fixed auth bug',
          patterns_learned: ['JWT validation pattern', 'Error boundary pattern'],
        }
      );

      expect(mockWrapper.close).toHaveBeenCalledWith({
        id: 'bd-a1b2',
        reason: 'Fixed auth bug\n\nPatterns learned:\n- JWT validation pattern\n- Error boundary pattern'
      });
    });

    it('should handle empty patterns array', async () => {
      (mockWrapper.close as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: { id: 'bd-a1b2', status: 'closed' },
      });

      await hooks.postTask(
        { status: 'completed', beads_issue_id: 'bd-a1b2' },
        {
          summary: 'Fixed bug',
          patterns_learned: [],
        }
      );

      expect(mockWrapper.close).toHaveBeenCalledWith({ id: 'bd-a1b2', reason: 'Fixed bug' });
    });
  });
});

describe('BeadsHooks Integration Patterns', () => {
  let hooks: BeadsHooks;
  let mockWrapper: BeadsCliWrapper;

  beforeEach(() => {
    mockWrapper = createMockWrapper();
    hooks = new BeadsHooks(mockWrapper);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should support session start -> pre-task -> post-task -> session end workflow', async () => {
    // Session start
    (mockWrapper.ready as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: [{ id: 'bd-001', title: 'Task 1', status: 'open', priority: 1, createdAt: new Date().toISOString() }],
    });

    // Pre-task
    (mockWrapper.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: [{ id: 'bd-001', title: 'Related Task', status: 'open', priority: 1, createdAt: new Date().toISOString() }],
    });

    // Post-task
    (mockWrapper.close as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { id: 'bd-001', status: 'closed' },
    });

    // Execute workflow
    const startContext = await hooks.sessionStart();
    const preTaskContext = await hooks.preTask({ keywords: 'task' });
    await hooks.postTask({ status: 'completed', beads_issue_id: 'bd-001' }, { summary: 'Done' });
    const endPrompt = await hooks.sessionEnd();

    // Verify interactions
    expect(mockWrapper.ready).toHaveBeenCalledTimes(1);
    expect(mockWrapper.list).toHaveBeenCalledTimes(1);
    expect(mockWrapper.close).toHaveBeenCalledTimes(1);

    // Verify output
    expect(startContext).toContain('bd-001');
    expect(preTaskContext).toContain('Related Beads issues');
    expect(endPrompt).toContain('beads_sync');
  });

  it('should handle complete failed task workflow without closing issue', async () => {
    (mockWrapper.ready as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: [{ id: 'bd-fail', title: 'Failing Task', status: 'open', priority: 1, createdAt: new Date().toISOString() }],
    });

    // Execute workflow with failure
    await hooks.sessionStart();
    await hooks.postTask({ status: 'failed', beads_issue_id: 'bd-fail' }, { summary: 'Failed' });
    await hooks.sessionEnd();

    // Issue should NOT be closed on failure
    expect(mockWrapper.close).not.toHaveBeenCalled();
  });
});
