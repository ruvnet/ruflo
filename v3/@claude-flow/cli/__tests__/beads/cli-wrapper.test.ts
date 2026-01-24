/**
 * Beads CLI Wrapper Tests
 *
 * TDD London School tests for BeadsCliWrapper.
 * Tests focus on behavior verification through mocks, testing how the wrapper
 * interacts with the system (exec, fs) rather than internal state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Mock child_process and fs before importing the module
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  promises: {
    access: vi.fn(),
  },
}));

// Import after mocks are set up
import { BeadsCliWrapper } from '../../src/beads/cli-wrapper.js';
import type {
  BeadsConfig,
  BeadsIssue,
  BeadsCreateParams,
  BeadsListParams,
  BeadsReadyParams,
  BeadsUpdateParams,
  BeadsCloseParams,
  BeadsDepAddParams,
  BeadsStats,
} from '../../src/beads/types.js';

// Helper to create a mock exec function that resolves
const mockExecSuccess = (stdout: string, stderr = ''): void => {
  (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (cmd: string, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
      callback(null, stdout, stderr);
    }
  );
};

// Helper to create a mock exec function that rejects
const mockExecFailure = (error: Error): void => {
  (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (cmd: string, callback: (err: Error | null, stdout: string | null, stderr: string | null) => void) => {
      callback(error, null, null);
    }
  );
};

describe('BeadsCliWrapper', () => {
  let wrapper: BeadsCliWrapper;

  beforeEach(() => {
    wrapper = new BeadsCliWrapper();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      const w = new BeadsCliWrapper();
      expect(w).toBeInstanceOf(BeadsCliWrapper);
    });

    it('should accept custom config', () => {
      const customConfig: Partial<BeadsConfig> = {
        binary: '/usr/local/bin/bd',
        autoInit: false,
        syncInterval: 10000,
      };
      const w = new BeadsCliWrapper(customConfig);
      expect(w).toBeInstanceOf(BeadsCliWrapper);
    });
  });

  describe('isInstalled()', () => {
    it('should return true when bd is in PATH', async () => {
      mockExecSuccess('bd version 0.1.0');

      const result = await wrapper.isInstalled();

      expect(result).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('bd'),
        expect.any(Function)
      );
    });

    it('should return false when bd is not found', async () => {
      mockExecFailure(new Error('command not found: bd'));

      const result = await wrapper.isInstalled();

      expect(result).toBe(false);
    });

    it('should check for custom binary path when configured', async () => {
      const customWrapper = new BeadsCliWrapper({ binary: '/custom/path/bd' });
      mockExecSuccess('bd version 0.1.0');

      await customWrapper.isInstalled();

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('/custom/path/bd'),
        expect.any(Function)
      );
    });
  });

  describe('isInitialized()', () => {
    it('should return true when .beads/beads.jsonl exists', async () => {
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);

      const result = await wrapper.isInitialized();

      expect(result).toBe(true);
      expect(fs.existsSync).toHaveBeenCalledWith(
        expect.stringContaining('.beads')
      );
    });

    it('should return false when .beads directory does not exist', async () => {
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const result = await wrapper.isInitialized();

      expect(result).toBe(false);
    });

    it('should check custom directory when provided', async () => {
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);

      await wrapper.isInitialized('/custom/project');

      expect(fs.existsSync).toHaveBeenCalledWith(
        expect.stringContaining('/custom/project')
      );
    });
  });

  describe('init()', () => {
    it('should initialize beads in current directory', async () => {
      mockExecSuccess('Initialized beads in .beads/');

      const result = await wrapper.init();

      expect(result.success).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        expect.stringMatching(/bd\s+init/),
        expect.any(Function)
      );
    });

    it('should pass quiet flag when specified', async () => {
      mockExecSuccess('');

      await wrapper.init(true);

      expect(exec).toHaveBeenCalledWith(
        expect.stringMatching(/--quiet/),
        expect.any(Function)
      );
    });

    it('should pass stealth flag when specified', async () => {
      mockExecSuccess('');

      await wrapper.init(false, true);

      expect(exec).toHaveBeenCalledWith(
        expect.stringMatching(/--stealth/),
        expect.any(Function)
      );
    });

    it('should return error on init failure', async () => {
      mockExecFailure(new Error('Permission denied'));

      const result = await wrapper.init();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Permission denied');
    });
  });

  describe('create()', () => {
    const mockIssue: BeadsIssue = {
      id: 'bd-a1b2',
      title: 'Test Issue',
      status: 'open',
      priority: 2,
      type: 'task',
      labels: [],
      dependencies: [],
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-15T10:00:00Z',
    };

    it('should create issue with all parameters', async () => {
      mockExecSuccess(JSON.stringify(mockIssue));

      const params: BeadsCreateParams = {
        title: 'Test Issue',
        description: 'A detailed description',
        priority: 1,
        type: 'bug',
        assignee: 'developer',
        labels: ['urgent', 'frontend'],
      };

      const result = await wrapper.create(params);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockIssue);
      expect(exec).toHaveBeenCalledWith(
        expect.stringMatching(/bd\s+create/),
        expect.any(Function)
      );
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--title'),
        expect.any(Function)
      );
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--description'),
        expect.any(Function)
      );
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--priority 1'),
        expect.any(Function)
      );
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--type bug'),
        expect.any(Function)
      );
    });

    it('should handle minimum parameters (title only)', async () => {
      mockExecSuccess(JSON.stringify(mockIssue));

      const params: BeadsCreateParams = {
        title: 'Simple Issue',
      };

      const result = await wrapper.create(params);

      expect(result.success).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--title'),
        expect.any(Function)
      );
      // Should not include optional flags
      expect(exec).not.toHaveBeenCalledWith(
        expect.stringContaining('--description'),
        expect.any(Function)
      );
    });

    it('should handle labels as comma-separated list', async () => {
      mockExecSuccess(JSON.stringify(mockIssue));

      const params: BeadsCreateParams = {
        title: 'Labeled Issue',
        labels: ['bug', 'urgent', 'frontend'],
      };

      await wrapper.create(params);

      expect(exec).toHaveBeenCalledWith(
        expect.stringMatching(/--labels\s+["']?bug,urgent,frontend["']?/),
        expect.any(Function)
      );
    });

    it('should handle parent_id for sub-issues', async () => {
      mockExecSuccess(JSON.stringify({ ...mockIssue, id: 'bd-a1b2.1' }));

      const params: BeadsCreateParams = {
        title: 'Sub Issue',
        parent_id: 'bd-a1b2',
      };

      await wrapper.create(params);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--parent'),
        expect.any(Function)
      );
    });

    it('should return error on creation failure', async () => {
      mockExecFailure(new Error('Database error'));

      const result = await wrapper.create({ title: 'Test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Database error');
    });
  });

  describe('ready()', () => {
    const mockReadyIssues: BeadsIssue[] = [
      {
        id: 'bd-c3d4',
        title: 'Ready Issue 1',
        status: 'open',
        priority: 1,
        type: 'task',
        labels: [],
        dependencies: [],
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
      },
      {
        id: 'bd-e5f6',
        title: 'Ready Issue 2',
        status: 'open',
        priority: 2,
        type: 'feature',
        labels: [],
        dependencies: [],
        created_at: '2024-01-15T11:00:00Z',
        updated_at: '2024-01-15T11:00:00Z',
      },
    ];

    it('should return unblocked issues', async () => {
      mockExecSuccess(JSON.stringify(mockReadyIssues));

      const result = await wrapper.ready();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(exec).toHaveBeenCalledWith(
        expect.stringMatching(/bd\s+ready/),
        expect.any(Function)
      );
    });

    it('should apply limit filter', async () => {
      mockExecSuccess(JSON.stringify([mockReadyIssues[0]]));

      const params: BeadsReadyParams = { limit: 1 };
      await wrapper.ready(params);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--limit 1'),
        expect.any(Function)
      );
    });

    it('should apply priority filter', async () => {
      mockExecSuccess(JSON.stringify(mockReadyIssues));

      const params: BeadsReadyParams = { priority: 1 };
      await wrapper.ready(params);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--priority 1'),
        expect.any(Function)
      );
    });

    it('should apply assignee filter', async () => {
      mockExecSuccess(JSON.stringify(mockReadyIssues));

      const params: BeadsReadyParams = { assignee: 'dev1' };
      await wrapper.ready(params);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--assignee dev1'),
        expect.any(Function)
      );
    });

    it('should apply sort option', async () => {
      mockExecSuccess(JSON.stringify(mockReadyIssues));

      const params: BeadsReadyParams = { sort: 'priority' };
      await wrapper.ready(params);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--sort priority'),
        expect.any(Function)
      );
    });

    it('should always use --json flag', async () => {
      mockExecSuccess(JSON.stringify(mockReadyIssues));

      await wrapper.ready();

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--json'),
        expect.any(Function)
      );
    });
  });

  describe('list()', () => {
    const mockIssues: BeadsIssue[] = [
      {
        id: 'bd-1111',
        title: 'Issue 1',
        status: 'open',
        priority: 2,
        type: 'task',
        labels: ['backend'],
        dependencies: [],
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
      },
    ];

    it('should list all issues with no filters', async () => {
      mockExecSuccess(JSON.stringify(mockIssues));

      const result = await wrapper.list();

      expect(result.success).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        expect.stringMatching(/bd\s+list/),
        expect.any(Function)
      );
    });

    it('should filter by status', async () => {
      mockExecSuccess(JSON.stringify(mockIssues));

      const params: BeadsListParams = { status: 'open' };
      await wrapper.list(params);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--status open'),
        expect.any(Function)
      );
    });

    it('should filter by priority', async () => {
      mockExecSuccess(JSON.stringify(mockIssues));

      const params: BeadsListParams = { priority: 1 };
      await wrapper.list(params);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--priority 1'),
        expect.any(Function)
      );
    });

    it('should filter by assignee', async () => {
      mockExecSuccess(JSON.stringify(mockIssues));

      const params: BeadsListParams = { assignee: 'developer' };
      await wrapper.list(params);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--assignee developer'),
        expect.any(Function)
      );
    });

    it('should filter by labels', async () => {
      mockExecSuccess(JSON.stringify(mockIssues));

      const params: BeadsListParams = { labels: ['backend', 'urgent'] };
      await wrapper.list(params);

      expect(exec).toHaveBeenCalledWith(
        expect.stringMatching(/--labels\s+["']?backend,urgent["']?/),
        expect.any(Function)
      );
    });

    it('should filter by title_contains', async () => {
      mockExecSuccess(JSON.stringify(mockIssues));

      const params: BeadsListParams = { title_contains: 'auth' };
      await wrapper.list(params);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--title-contains'),
        expect.any(Function)
      );
    });

    it('should apply limit', async () => {
      mockExecSuccess(JSON.stringify(mockIssues));

      const params: BeadsListParams = { limit: 10 };
      await wrapper.list(params);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--limit 10'),
        expect.any(Function)
      );
    });
  });

  describe('show()', () => {
    const mockIssue: BeadsIssue = {
      id: 'bd-a1b2',
      title: 'Detailed Issue',
      description: 'Full description here',
      status: 'in_progress',
      priority: 1,
      type: 'bug',
      assignee: 'developer',
      labels: ['urgent'],
      dependencies: [],
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-15T12:00:00Z',
    };

    it('should show issue details by id', async () => {
      mockExecSuccess(JSON.stringify(mockIssue));

      const result = await wrapper.show({ id: 'bd-a1b2' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockIssue);
      expect(exec).toHaveBeenCalledWith(
        expect.stringMatching(/bd\s+show\s+bd-a1b2/),
        expect.any(Function)
      );
    });

    it('should return error for non-existent issue', async () => {
      mockExecFailure(new Error('Issue not found: bd-xxxx'));

      const result = await wrapper.show({ id: 'bd-xxxx' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should use --json flag', async () => {
      mockExecSuccess(JSON.stringify(mockIssue));

      await wrapper.show({ id: 'bd-a1b2' });

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--json'),
        expect.any(Function)
      );
    });
  });

  describe('update()', () => {
    const mockUpdatedIssue: BeadsIssue = {
      id: 'bd-a1b2',
      title: 'Updated Issue',
      status: 'in_progress',
      priority: 1,
      type: 'task',
      labels: ['updated'],
      dependencies: [],
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-15T14:00:00Z',
    };

    it('should update issue status', async () => {
      mockExecSuccess(JSON.stringify(mockUpdatedIssue));

      const params: BeadsUpdateParams = {
        id: 'bd-a1b2',
        status: 'in_progress',
      };

      const result = await wrapper.update(params);

      expect(result.success).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        expect.stringMatching(/bd\s+update\s+bd-a1b2/),
        expect.any(Function)
      );
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--status in_progress'),
        expect.any(Function)
      );
    });

    it('should update issue priority', async () => {
      mockExecSuccess(JSON.stringify(mockUpdatedIssue));

      const params: BeadsUpdateParams = {
        id: 'bd-a1b2',
        priority: 0,
      };

      await wrapper.update(params);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--priority 0'),
        expect.any(Function)
      );
    });

    it('should update issue assignee', async () => {
      mockExecSuccess(JSON.stringify(mockUpdatedIssue));

      const params: BeadsUpdateParams = {
        id: 'bd-a1b2',
        assignee: 'new-developer',
      };

      await wrapper.update(params);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--assignee new-developer'),
        expect.any(Function)
      );
    });

    it('should update issue labels', async () => {
      mockExecSuccess(JSON.stringify(mockUpdatedIssue));

      const params: BeadsUpdateParams = {
        id: 'bd-a1b2',
        labels: ['new-label', 'another'],
      };

      await wrapper.update(params);

      expect(exec).toHaveBeenCalledWith(
        expect.stringMatching(/--labels\s+["']?new-label,another["']?/),
        expect.any(Function)
      );
    });

    it('should append notes to issue', async () => {
      mockExecSuccess(JSON.stringify(mockUpdatedIssue));

      const params: BeadsUpdateParams = {
        id: 'bd-a1b2',
        notes: 'Added implementation details',
      };

      await wrapper.update(params);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--notes'),
        expect.any(Function)
      );
    });

    it('should handle multiple updates in one call', async () => {
      mockExecSuccess(JSON.stringify(mockUpdatedIssue));

      const params: BeadsUpdateParams = {
        id: 'bd-a1b2',
        status: 'in_progress',
        priority: 1,
        assignee: 'developer',
      };

      await wrapper.update(params);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--status'),
        expect.any(Function)
      );
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--priority'),
        expect.any(Function)
      );
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--assignee'),
        expect.any(Function)
      );
    });
  });

  describe('close()', () => {
    const mockClosedIssue: BeadsIssue = {
      id: 'bd-a1b2',
      title: 'Closed Issue',
      status: 'closed',
      priority: 2,
      type: 'task',
      labels: [],
      dependencies: [],
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-15T16:00:00Z',
      closed_at: '2024-01-15T16:00:00Z',
      close_reason: 'fixed',
    };

    it('should close issue with reason', async () => {
      mockExecSuccess(JSON.stringify(mockClosedIssue));

      const params: BeadsCloseParams = {
        id: 'bd-a1b2',
        reason: 'fixed',
      };

      const result = await wrapper.close(params);

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('closed');
      expect(exec).toHaveBeenCalledWith(
        expect.stringMatching(/bd\s+close\s+bd-a1b2/),
        expect.any(Function)
      );
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--reason fixed'),
        expect.any(Function)
      );
    });

    it('should close issue without reason', async () => {
      mockExecSuccess(JSON.stringify({ ...mockClosedIssue, close_reason: undefined }));

      const params: BeadsCloseParams = {
        id: 'bd-a1b2',
      };

      await wrapper.close(params);

      expect(exec).not.toHaveBeenCalledWith(
        expect.stringContaining('--reason'),
        expect.any(Function)
      );
    });
  });

  describe('depAdd()', () => {
    it('should add dependency between issues', async () => {
      mockExecSuccess(JSON.stringify({ success: true }));

      const params: BeadsDepAddParams = {
        from_id: 'bd-c3d4',
        to_id: 'bd-a1b2',
      };

      const result = await wrapper.depAdd(params);

      expect(result.success).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        expect.stringMatching(/bd\s+dep\s+add/),
        expect.any(Function)
      );
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('bd-c3d4'),
        expect.any(Function)
      );
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('bd-a1b2'),
        expect.any(Function)
      );
    });

    it('should specify dependency type', async () => {
      mockExecSuccess(JSON.stringify({ success: true }));

      const params: BeadsDepAddParams = {
        from_id: 'bd-c3d4',
        to_id: 'bd-a1b2',
        type: 'blocks',
      };

      await wrapper.depAdd(params);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--type blocks'),
        expect.any(Function)
      );
    });

    it('should detect dependency cycles', async () => {
      mockExecFailure(new Error('Dependency cycle detected'));

      const params: BeadsDepAddParams = {
        from_id: 'bd-a1b2',
        to_id: 'bd-c3d4',
      };

      const result = await wrapper.depAdd(params);

      expect(result.success).toBe(false);
      expect(result.error).toContain('cycle');
    });
  });

  describe('depTree()', () => {
    it('should show dependency tree for specific issue', async () => {
      const mockTree = {
        id: 'bd-a1b2',
        title: 'Root Issue',
        dependencies: [
          { id: 'bd-c3d4', title: 'Child 1' },
          { id: 'bd-e5f6', title: 'Child 2' },
        ],
      };
      mockExecSuccess(JSON.stringify(mockTree));

      const result = await wrapper.depTree({ id: 'bd-a1b2' });

      expect(result.success).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        expect.stringMatching(/bd\s+dep\s+tree\s+bd-a1b2/),
        expect.any(Function)
      );
    });

    it('should show full dependency tree without id', async () => {
      const mockTree = [
        { id: 'bd-a1b2', dependencies: [] },
        { id: 'bd-c3d4', dependencies: [] },
      ];
      mockExecSuccess(JSON.stringify(mockTree));

      await wrapper.depTree({ id: '' });

      expect(exec).toHaveBeenCalledWith(
        expect.stringMatching(/bd\s+dep\s+tree/),
        expect.any(Function)
      );
    });
  });

  describe('blocked()', () => {
    const mockBlockedIssues: BeadsIssue[] = [
      {
        id: 'bd-blocked1',
        title: 'Blocked Issue',
        status: 'open',
        priority: 1,
        type: 'task',
        labels: [],
        dependencies: [
          { from_id: 'bd-blocked1', to_id: 'bd-blocker1', type: 'blocks', created_at: '2024-01-15T10:00:00Z' },
        ],
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
      },
    ];

    it('should return blocked issues', async () => {
      mockExecSuccess(JSON.stringify(mockBlockedIssues));

      const result = await wrapper.blocked();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(exec).toHaveBeenCalledWith(
        expect.stringMatching(/bd\s+blocked/),
        expect.any(Function)
      );
    });

    it('should apply limit to blocked issues', async () => {
      mockExecSuccess(JSON.stringify(mockBlockedIssues));

      await wrapper.blocked({ limit: 5 });

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--limit 5'),
        expect.any(Function)
      );
    });
  });

  describe('stats()', () => {
    const mockStats: BeadsStats = {
      total: 25,
      open: 15,
      in_progress: 5,
      closed: 5,
      by_priority: { 0: 2, 1: 5, 2: 10, 3: 5, 4: 3 },
      by_type: { bug: 8, feature: 10, task: 5, chore: 2 },
    };

    it('should return statistics', async () => {
      mockExecSuccess(JSON.stringify(mockStats));

      const result = await wrapper.stats();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockStats);
      expect(exec).toHaveBeenCalledWith(
        expect.stringMatching(/bd\s+stats/),
        expect.any(Function)
      );
    });

    it('should include --json flag', async () => {
      mockExecSuccess(JSON.stringify(mockStats));

      await wrapper.stats();

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--json'),
        expect.any(Function)
      );
    });
  });

  describe('sync()', () => {
    it('should sync with git', async () => {
      mockExecSuccess(JSON.stringify({ synced: true, changes: 3 }));

      const result = await wrapper.sync();

      expect(result.success).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        expect.stringMatching(/bd\s+sync/),
        expect.any(Function)
      );
    });

    it('should force sync when specified', async () => {
      mockExecSuccess(JSON.stringify({ synced: true, changes: 0 }));

      await wrapper.sync(true);

      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('--force'),
        expect.any(Function)
      );
    });
  });

  describe('error handling', () => {
    it('should handle JSON parse errors gracefully', async () => {
      mockExecSuccess('invalid json {');

      const result = await wrapper.list();

      expect(result.success).toBe(false);
      expect(result.error).toContain('parse');
    });

    it('should include exit code in result', async () => {
      const error = new Error('Command failed') as Error & { code: number };
      error.code = 1;
      mockExecFailure(error);

      const result = await wrapper.list();

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('should sanitize command arguments', async () => {
      mockExecSuccess(JSON.stringify({ id: 'bd-test' }));

      await wrapper.create({
        title: 'Test; rm -rf /',
        description: '$(whoami)',
      });

      // Command should be properly escaped
      expect(exec).toHaveBeenCalledWith(
        expect.not.stringContaining('; rm'),
        expect.any(Function)
      );
    });
  });

  describe('working directory', () => {
    it('should use configured working directory', async () => {
      const customWrapper = new BeadsCliWrapper({ workingDir: '/project/dir' });
      mockExecSuccess(JSON.stringify([]));

      await customWrapper.list();

      // The exec should be called with the working directory context
      expect(exec).toHaveBeenCalled();
    });
  });
});

describe('BeadsCliWrapper Integration Patterns', () => {
  let wrapper: BeadsCliWrapper;

  beforeEach(() => {
    wrapper = new BeadsCliWrapper();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should support create -> ready workflow', async () => {
    const mockIssue: BeadsIssue = {
      id: 'bd-new1',
      title: 'New Task',
      status: 'open',
      priority: 1,
      type: 'task',
      labels: [],
      dependencies: [],
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-15T10:00:00Z',
    };

    // First call creates
    (exec as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (cmd: string, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
        callback(null, JSON.stringify(mockIssue), '');
      }
    );

    // Second call gets ready issues
    (exec as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (cmd: string, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
        callback(null, JSON.stringify([mockIssue]), '');
      }
    );

    const createResult = await wrapper.create({ title: 'New Task' });
    const readyResult = await wrapper.ready();

    expect(createResult.success).toBe(true);
    expect(readyResult.success).toBe(true);
    expect(readyResult.data).toContainEqual(expect.objectContaining({ id: 'bd-new1' }));
  });

  it('should support create -> depAdd -> blocked workflow', async () => {
    const parent: BeadsIssue = {
      id: 'bd-parent',
      title: 'Parent Task',
      status: 'open',
      priority: 1,
      type: 'task',
      labels: [],
      dependencies: [],
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-15T10:00:00Z',
    };

    const child: BeadsIssue = {
      id: 'bd-child',
      title: 'Child Task',
      status: 'open',
      priority: 2,
      type: 'task',
      labels: [],
      dependencies: [{ from_id: 'bd-child', to_id: 'bd-parent', type: 'blocks', created_at: '2024-01-15T10:00:00Z' }],
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-15T10:00:00Z',
    };

    // Mock sequence of calls
    let callCount = 0;
    (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (cmd: string, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
        callCount++;
        if (callCount === 1) {
          callback(null, JSON.stringify(parent), '');
        } else if (callCount === 2) {
          callback(null, JSON.stringify(child), '');
        } else if (callCount === 3) {
          callback(null, JSON.stringify({ success: true }), '');
        } else {
          callback(null, JSON.stringify([child]), '');
        }
      }
    );

    await wrapper.create({ title: 'Parent Task' });
    await wrapper.create({ title: 'Child Task' });
    await wrapper.depAdd({ from_id: 'bd-child', to_id: 'bd-parent' });
    const blockedResult = await wrapper.blocked();

    expect(blockedResult.success).toBe(true);
    expect(blockedResult.data).toHaveLength(1);
  });
});
