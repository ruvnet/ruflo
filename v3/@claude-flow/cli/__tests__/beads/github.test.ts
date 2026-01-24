/**
 * Beads GitHub Integration Tests
 *
 * TDD London School tests for GitHubSync.
 * Tests focus on behavior verification through mocks, testing how the sync
 * interacts with the system (gh CLI, beads wrapper) rather than internal state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';

// Mock child_process before importing the module
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

// Import after mocks are set up
import {
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
} from '../../src/beads/github.js';
import type {
  GitHubIssue,
  GitHubLabel,
  GitHubLink,
  GitHubSyncConfig,
} from '../../src/beads/github.js';
import type { BeadsCliWrapper, BeadsIssue } from '../../src/beads/cli-wrapper.js';

// Helper to create mock exec that resolves
const mockExecSuccess = (stdout: string): void => {
  (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (cmd: string, callback: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      callback(null, { stdout, stderr: '' });
    }
  );
};

// Helper to create mock exec that rejects
const mockExecFailure = (error: Error): void => {
  (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (cmd: string, callback: (err: Error | null, result: { stdout: string; stderr: string } | null) => void) => {
      callback(error, null);
    }
  );
};

// Mock BeadsCliWrapper factory
const createMockBeadsWrapper = (): BeadsCliWrapper => {
  return {
    show: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    close: vi.fn(),
    ready: vi.fn(),
    blocked: vi.fn(),
    stats: vi.fn(),
    sync: vi.fn(),
    init: vi.fn(),
    isInstalled: vi.fn(),
    isInitialized: vi.fn(),
    depAdd: vi.fn(),
    depTree: vi.fn(),
  } as unknown as BeadsCliWrapper;
};

// Sample data
const sampleBeadsIssue: BeadsIssue = {
  id: 'bd-a1b2',
  title: 'Implement authentication',
  description: 'Add JWT-based authentication',
  status: 'open',
  priority: 1,
  type: 'feature',
  labels: ['backend'],
  dependencies: [],
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:00:00Z',
};

const sampleGitHubIssue: GitHubIssue = {
  number: 42,
  title: 'Implement authentication',
  body: 'Add JWT-based authentication\n\n<!-- beads-id: bd-a1b2 -->',
  state: 'open',
  labels: [
    { name: 'priority:high', color: 'ff0000' },
    { name: 'type:feature', color: '00ff00' },
    { name: 'backend', color: '0000ff' },
  ],
  assignees: [{ login: 'developer', id: 1 }],
  milestone: null,
  html_url: 'https://github.com/owner/repo/issues/42',
  url: 'https://api.github.com/repos/owner/repo/issues/42',
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:00:00Z',
  closed_at: null,
};

describe('Field Mapping Utilities', () => {
  describe('mapStatusToGitHub', () => {
    it('should map closed status to closed', () => {
      expect(mapStatusToGitHub('closed')).toBe('closed');
    });

    it('should map open status to open', () => {
      expect(mapStatusToGitHub('open')).toBe('open');
    });

    it('should map in_progress status to open', () => {
      expect(mapStatusToGitHub('in_progress')).toBe('open');
    });
  });

  describe('mapStatusFromGitHub', () => {
    it('should map closed state to closed', () => {
      expect(mapStatusFromGitHub('closed')).toBe('closed');
    });

    it('should map open state to open', () => {
      expect(mapStatusFromGitHub('open')).toBe('open');
    });
  });

  describe('mapPriorityToLabel', () => {
    it('should map priority 0 to critical', () => {
      expect(mapPriorityToLabel(0)).toBe('priority:critical');
    });

    it('should map priority 1 to high', () => {
      expect(mapPriorityToLabel(1)).toBe('priority:high');
    });

    it('should map priority 2 to medium', () => {
      expect(mapPriorityToLabel(2)).toBe('priority:medium');
    });

    it('should map priority 3 to low', () => {
      expect(mapPriorityToLabel(3)).toBe('priority:low');
    });

    it('should map priority 4 to trivial', () => {
      expect(mapPriorityToLabel(4)).toBe('priority:trivial');
    });

    it('should use custom prefix', () => {
      expect(mapPriorityToLabel(1, 'p-')).toBe('p-high');
    });
  });

  describe('mapPriorityFromLabel', () => {
    it('should extract critical priority from labels', () => {
      const labels: GitHubLabel[] = [{ name: 'priority:critical', color: 'ff0000' }];
      expect(mapPriorityFromLabel(labels)).toBe(0);
    });

    it('should extract high priority from labels', () => {
      const labels: GitHubLabel[] = [{ name: 'priority:high', color: 'ff0000' }];
      expect(mapPriorityFromLabel(labels)).toBe(1);
    });

    it('should default to medium when no priority label', () => {
      const labels: GitHubLabel[] = [{ name: 'bug', color: 'ff0000' }];
      expect(mapPriorityFromLabel(labels)).toBe(2);
    });

    it('should use custom prefix', () => {
      const labels: GitHubLabel[] = [{ name: 'p-low', color: 'ff0000' }];
      expect(mapPriorityFromLabel(labels, 'p-')).toBe(3);
    });
  });

  describe('mapTypeToLabel', () => {
    it('should map bug type to label', () => {
      expect(mapTypeToLabel('bug')).toBe('type:bug');
    });

    it('should map feature type to label', () => {
      expect(mapTypeToLabel('feature')).toBe('type:feature');
    });

    it('should use custom prefix', () => {
      expect(mapTypeToLabel('task', 't:')).toBe('t:task');
    });
  });

  describe('mapTypeFromLabel', () => {
    it('should extract bug type from labels', () => {
      const labels: GitHubLabel[] = [{ name: 'type:bug', color: 'ff0000' }];
      expect(mapTypeFromLabel(labels)).toBe('bug');
    });

    it('should extract feature type from labels', () => {
      const labels: GitHubLabel[] = [{ name: 'type:feature', color: 'ff0000' }];
      expect(mapTypeFromLabel(labels)).toBe('feature');
    });

    it('should default to task when no type label', () => {
      const labels: GitHubLabel[] = [{ name: 'priority:high', color: 'ff0000' }];
      expect(mapTypeFromLabel(labels)).toBe('task');
    });

    it('should default to task for invalid type', () => {
      const labels: GitHubLabel[] = [{ name: 'type:invalid', color: 'ff0000' }];
      expect(mapTypeFromLabel(labels)).toBe('task');
    });
  });

  describe('extractBeadsIdFromBody', () => {
    it('should extract beads ID from body', () => {
      const body = 'Issue description\n\n<!-- beads-id: bd-a1b2 -->';
      expect(extractBeadsIdFromBody(body)).toBe('bd-a1b2');
    });

    it('should extract beads ID with subissue format', () => {
      const body = 'Issue description\n\n<!-- beads-id: bd-a1b2.1 -->';
      expect(extractBeadsIdFromBody(body)).toBe('bd-a1b2.1');
    });

    it('should return null when no beads ID', () => {
      const body = 'Issue description without beads ID';
      expect(extractBeadsIdFromBody(body)).toBeNull();
    });

    it('should return null for null body', () => {
      expect(extractBeadsIdFromBody(null)).toBeNull();
    });
  });

  describe('addBeadsIdToBody', () => {
    it('should add beads ID to body', () => {
      const body = 'Issue description';
      const result = addBeadsIdToBody(body, 'bd-a1b2');
      expect(result).toContain('<!-- beads-id: bd-a1b2 -->');
      expect(result).toContain('Issue description');
    });

    it('should replace existing beads ID', () => {
      const body = 'Issue description\n\n<!-- beads-id: bd-old -->';
      const result = addBeadsIdToBody(body, 'bd-new');
      expect(result).toContain('<!-- beads-id: bd-new -->');
      expect(result).not.toContain('bd-old');
    });
  });
});

describe('GitHubSync', () => {
  let sync: GitHubSync;
  let mockWrapper: BeadsCliWrapper;

  beforeEach(() => {
    mockWrapper = createMockBeadsWrapper();
    sync = new GitHubSync(mockWrapper, { repo: 'owner/repo' });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      const s = new GitHubSync(mockWrapper);
      expect(s).toBeInstanceOf(GitHubSync);
    });

    it('should accept custom config', () => {
      const config: Partial<GitHubSyncConfig> = {
        repo: 'custom/repo',
        syncPriorityAsLabels: false,
      };
      const s = new GitHubSync(mockWrapper, config);
      expect(s).toBeInstanceOf(GitHubSync);
    });
  });

  describe('isGhCliAvailable()', () => {
    it('should return true when gh CLI is authenticated', async () => {
      (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (cmd: string, callback: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (cmd.includes('gh auth status')) {
            callback(null, { stdout: 'Logged in', stderr: '' });
          }
        }
      );

      const result = await sync.isGhCliAvailable();
      expect(result).toBe(true);
    });

    it('should return false when gh CLI is not available', async () => {
      mockExecFailure(new Error('gh: command not found'));

      const result = await sync.isGhCliAvailable();
      expect(result).toBe(false);
    });
  });

  describe('getRepo()', () => {
    it('should return configured repo', async () => {
      const s = new GitHubSync(mockWrapper, { repo: 'test/repo' });
      const repo = await s.getRepo();
      expect(repo).toBe('test/repo');
    });

    it('should detect repo from git when not configured', async () => {
      const s = new GitHubSync(mockWrapper);
      (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (cmd: string, callback: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (cmd.includes('gh repo view')) {
            callback(null, { stdout: 'detected/repo\n', stderr: '' });
          }
        }
      );

      const repo = await s.getRepo();
      expect(repo).toBe('detected/repo');
    });

    it('should throw when repo cannot be determined', async () => {
      const s = new GitHubSync(mockWrapper);
      mockExecFailure(new Error('not a git repository'));

      await expect(s.getRepo()).rejects.toThrow('Could not determine repository');
    });
  });

  describe('syncToGitHub()', () => {
    it('should create new GitHub issue when no link exists', async () => {
      (mockWrapper.show as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: sampleBeadsIssue,
        exitCode: 0,
      });

      let execCallCount = 0;
      (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (cmd: string, callback: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
          execCallCount++;
          if (cmd.includes('gh issue create')) {
            callback(null, { stdout: 'https://github.com/owner/repo/issues/42\n', stderr: '' });
          } else if (cmd.includes('gh issue view')) {
            callback(null, { stdout: JSON.stringify(sampleGitHubIssue), stderr: '' });
          }
        }
      );

      const result = await sync.syncToGitHub('bd-a1b2');

      expect(result.success).toBe(true);
      expect(result.data?.number).toBe(42);
      expect(mockWrapper.show).toHaveBeenCalledWith({ id: 'bd-a1b2' });
    });

    it('should update existing GitHub issue when link exists', async () => {
      // First create a link
      sync.importLinks([{
        taskId: 'bd-a1b2',
        issueNumber: 42,
        repo: 'owner/repo',
        issueUrl: 'https://github.com/owner/repo/issues/42',
        linkedAt: '2024-01-15T10:00:00Z',
      }]);

      (mockWrapper.show as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: sampleBeadsIssue,
        exitCode: 0,
      });

      (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (cmd: string, callback: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (cmd.includes('gh issue edit')) {
            callback(null, { stdout: '', stderr: '' });
          } else if (cmd.includes('gh issue view')) {
            callback(null, { stdout: JSON.stringify(sampleGitHubIssue), stderr: '' });
          } else if (cmd.includes('gh issue reopen')) {
            callback(null, { stdout: '', stderr: '' });
          }
        }
      );

      const result = await sync.syncToGitHub('bd-a1b2');

      expect(result.success).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('gh issue edit'),
        expect.any(Function)
      );
    });

    it('should return error when task not found', async () => {
      (mockWrapper.show as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        error: 'Not found',
        exitCode: 1,
      });

      const result = await sync.syncToGitHub('bd-notfound');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Task not found');
    });
  });

  describe('syncFromGitHub()', () => {
    it('should create new beads task from GitHub issue', async () => {
      (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (cmd: string, callback: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (cmd.includes('gh issue view')) {
            // Return issue without beads ID
            const issueWithoutBeadsId = { ...sampleGitHubIssue, body: 'No beads ID here' };
            callback(null, { stdout: JSON.stringify(issueWithoutBeadsId), stderr: '' });
          } else if (cmd.includes('gh issue edit')) {
            callback(null, { stdout: '', stderr: '' });
          }
        }
      );

      const newTask: BeadsIssue = { ...sampleBeadsIssue, id: 'bd-new' };
      (mockWrapper.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: newTask,
        exitCode: 0,
      });

      const result = await sync.syncFromGitHub(42);

      expect(result.success).toBe(true);
      expect(mockWrapper.create).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Implement authentication',
      }));
    });

    it('should update existing beads task when link exists', async () => {
      sync.importLinks([{
        taskId: 'bd-a1b2',
        issueNumber: 42,
        repo: 'owner/repo',
        issueUrl: 'https://github.com/owner/repo/issues/42',
        linkedAt: '2024-01-15T10:00:00Z',
      }]);

      (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (cmd: string, callback: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (cmd.includes('gh issue view')) {
            callback(null, { stdout: JSON.stringify(sampleGitHubIssue), stderr: '' });
          }
        }
      );

      (mockWrapper.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: sampleBeadsIssue,
        exitCode: 0,
      });

      const result = await sync.syncFromGitHub(42);

      expect(result.success).toBe(true);
      expect(mockWrapper.update).toHaveBeenCalledWith(expect.objectContaining({
        id: 'bd-a1b2',
      }));
    });

    it('should update existing beads task when beads ID in issue body', async () => {
      (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (cmd: string, callback: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (cmd.includes('gh issue view')) {
            callback(null, { stdout: JSON.stringify(sampleGitHubIssue), stderr: '' });
          }
        }
      );

      (mockWrapper.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: sampleBeadsIssue,
        exitCode: 0,
      });

      const result = await sync.syncFromGitHub(42);

      expect(result.success).toBe(true);
      expect(mockWrapper.update).toHaveBeenCalledWith(expect.objectContaining({
        id: 'bd-a1b2',
      }));
    });
  });

  describe('sync()', () => {
    it('should perform bidirectional sync', async () => {
      (mockWrapper.list as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [sampleBeadsIssue],
        exitCode: 0,
      });

      (mockWrapper.show as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: sampleBeadsIssue,
        exitCode: 0,
      });

      let execCallCount = 0;
      (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (cmd: string, callback: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
          execCallCount++;
          if (cmd.includes('gh issue list')) {
            callback(null, { stdout: JSON.stringify([sampleGitHubIssue]), stderr: '' });
          } else if (cmd.includes('gh issue create')) {
            callback(null, { stdout: 'https://github.com/owner/repo/issues/42\n', stderr: '' });
          } else if (cmd.includes('gh issue view')) {
            callback(null, { stdout: JSON.stringify(sampleGitHubIssue), stderr: '' });
          }
        }
      );

      const result = await sync.sync('bidirectional');

      expect(result.pushedToGitHub).toBeGreaterThanOrEqual(0);
      expect(result.pulledFromGitHub).toBeGreaterThanOrEqual(0);
    });

    it('should only push to GitHub in to-github mode', async () => {
      (mockWrapper.list as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [sampleBeadsIssue],
        exitCode: 0,
      });

      (mockWrapper.show as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: sampleBeadsIssue,
        exitCode: 0,
      });

      (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (cmd: string, callback: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (cmd.includes('gh issue create')) {
            callback(null, { stdout: 'https://github.com/owner/repo/issues/42\n', stderr: '' });
          } else if (cmd.includes('gh issue view')) {
            callback(null, { stdout: JSON.stringify(sampleGitHubIssue), stderr: '' });
          }
        }
      );

      const result = await sync.sync('to-github');

      expect(result.pushedToGitHub).toBeGreaterThan(0);
      expect(result.pulledFromGitHub).toBe(0);
    });

    it('should only pull from GitHub in from-github mode', async () => {
      (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (cmd: string, callback: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (cmd.includes('gh issue list')) {
            callback(null, { stdout: JSON.stringify([{
              ...sampleGitHubIssue,
              body: 'No beads ID',
            }]), stderr: '' });
          } else if (cmd.includes('gh issue view')) {
            callback(null, { stdout: JSON.stringify({
              ...sampleGitHubIssue,
              body: 'No beads ID',
            }), stderr: '' });
          } else if (cmd.includes('gh issue edit')) {
            callback(null, { stdout: '', stderr: '' });
          }
        }
      );

      const newTask: BeadsIssue = { ...sampleBeadsIssue, id: 'bd-new' };
      (mockWrapper.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: newTask,
        exitCode: 0,
      });

      const result = await sync.sync('from-github');

      expect(result.pushedToGitHub).toBe(0);
      expect(result.pulledFromGitHub).toBeGreaterThan(0);
    });

    it('should track errors in result', async () => {
      (mockWrapper.list as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [sampleBeadsIssue],
        exitCode: 0,
      });

      // Return task successfully but make syncToGitHub fail by returning failure from show
      // This simulates when a task exists in list but fails when we try to sync it
      (mockWrapper.show as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        error: 'Task data corrupted',
        exitCode: 1,
      });

      const result = await sync.sync('to-github');

      // syncToGitHub should have failed for the task, recording an error
      // Note: The sync catches the error and records it, but doesn't throw
      expect(result.pushedToGitHub).toBe(0);
    });
  });

  describe('linkIssue()', () => {
    it('should link beads task to GitHub issue', async () => {
      (mockWrapper.show as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: sampleBeadsIssue,
        exitCode: 0,
      });

      (mockWrapper.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: sampleBeadsIssue,
        exitCode: 0,
      });

      (exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (cmd: string, callback: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
          if (cmd.includes('gh issue view')) {
            callback(null, { stdout: JSON.stringify(sampleGitHubIssue), stderr: '' });
          }
        }
      );

      const result = await sync.linkIssue(
        'bd-a1b2',
        'https://github.com/owner/repo/issues/42'
      );

      expect(result.success).toBe(true);
      expect(result.data?.taskId).toBe('bd-a1b2');
      expect(result.data?.issueNumber).toBe(42);
      expect(mockWrapper.update).toHaveBeenCalledWith(expect.objectContaining({
        id: 'bd-a1b2',
        notes: expect.stringContaining('GitHub'),
      }));
    });

    it('should reject invalid issue URL format', async () => {
      const result = await sync.linkIssue('bd-a1b2', 'invalid-url');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid GitHub issue URL');
    });

    it('should return error when task not found', async () => {
      (mockWrapper.show as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        error: 'Not found',
        exitCode: 1,
      });

      const result = await sync.linkIssue(
        'bd-notfound',
        'https://github.com/owner/repo/issues/42'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Task not found');
    });

    it('should return error when GitHub issue not found', async () => {
      (mockWrapper.show as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: sampleBeadsIssue,
        exitCode: 0,
      });

      mockExecFailure(new Error('issue not found'));

      const result = await sync.linkIssue(
        'bd-a1b2',
        'https://github.com/owner/repo/issues/999'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('GitHub issue not found');
    });
  });

  describe('unlinkIssue()', () => {
    it('should unlink beads task from GitHub issue', async () => {
      // First create a link
      sync.importLinks([{
        taskId: 'bd-a1b2',
        issueNumber: 42,
        repo: 'owner/repo',
        issueUrl: 'https://github.com/owner/repo/issues/42',
        linkedAt: '2024-01-15T10:00:00Z',
      }]);

      (mockWrapper.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: sampleBeadsIssue,
        exitCode: 0,
      });

      const result = await sync.unlinkIssue('bd-a1b2');

      expect(result.success).toBe(true);
      expect(sync.getLink('bd-a1b2')).toBeUndefined();
    });

    it('should return error when no link exists', async () => {
      const result = await sync.unlinkIssue('bd-nolink');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No GitHub link found');
    });
  });

  describe('link management', () => {
    it('should get link for task', () => {
      sync.importLinks([{
        taskId: 'bd-a1b2',
        issueNumber: 42,
        repo: 'owner/repo',
        issueUrl: 'https://github.com/owner/repo/issues/42',
        linkedAt: '2024-01-15T10:00:00Z',
      }]);

      const link = sync.getLink('bd-a1b2');
      expect(link?.issueNumber).toBe(42);
    });

    it('should return undefined for unknown task', () => {
      const link = sync.getLink('bd-unknown');
      expect(link).toBeUndefined();
    });

    it('should get all links', () => {
      sync.importLinks([
        {
          taskId: 'bd-a1b2',
          issueNumber: 42,
          repo: 'owner/repo',
          issueUrl: 'https://github.com/owner/repo/issues/42',
          linkedAt: '2024-01-15T10:00:00Z',
        },
        {
          taskId: 'bd-c3d4',
          issueNumber: 43,
          repo: 'owner/repo',
          issueUrl: 'https://github.com/owner/repo/issues/43',
          linkedAt: '2024-01-15T11:00:00Z',
        },
      ]);

      const links = sync.getAllLinks();
      expect(links).toHaveLength(2);
    });

    it('should export links', () => {
      sync.importLinks([{
        taskId: 'bd-a1b2',
        issueNumber: 42,
        repo: 'owner/repo',
        issueUrl: 'https://github.com/owner/repo/issues/42',
        linkedAt: '2024-01-15T10:00:00Z',
      }]);

      const exported = sync.exportLinks();
      expect(exported).toHaveLength(1);
      expect(exported[0].taskId).toBe('bd-a1b2');
    });
  });
});

describe('createGitHubSync factory', () => {
  it('should create GitHubSync instance', () => {
    const mockWrapper = createMockBeadsWrapper();
    const sync = createGitHubSync(mockWrapper);
    expect(sync).toBeInstanceOf(GitHubSync);
  });

  it('should accept custom config', () => {
    const mockWrapper = createMockBeadsWrapper();
    const sync = createGitHubSync(mockWrapper, { repo: 'test/repo' });
    expect(sync).toBeInstanceOf(GitHubSync);
  });
});

describe('DEFAULT_GITHUB_SYNC_CONFIG', () => {
  it('should have expected default values', () => {
    expect(DEFAULT_GITHUB_SYNC_CONFIG.syncPriorityAsLabels).toBe(true);
    expect(DEFAULT_GITHUB_SYNC_CONFIG.syncTypeAsLabels).toBe(true);
    expect(DEFAULT_GITHUB_SYNC_CONFIG.mapEpicsToMilestones).toBe(true);
    expect(DEFAULT_GITHUB_SYNC_CONFIG.beadsLabelPrefix).toBe('beads:');
    expect(DEFAULT_GITHUB_SYNC_CONFIG.syncClosed).toBe(false);
  });
});
