/**
 * Tests for Agent-Scoped Memory
 *
 * TDD London School (mock-first) tests for the 3-scope agent memory system.
 * Uses vi.mock for ESM-compatible fs mocking.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';

// ESM-compatible mock: vi.mock is hoisted above imports automatically
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    readdirSync: vi.fn(actual.readdirSync),
    statSync: vi.fn(actual.statSync),
  };
});

import { existsSync, readdirSync, statSync } from 'node:fs';
import type * as fsTypes from 'node:fs';

import {
  resolveAgentMemoryDir,
  createAgentBridge,
  transferKnowledge,
  listAgentScopes,
} from './agent-memory-scope.js';
import type { AgentMemoryScope, TransferOptions } from './agent-memory-scope.js';
import type { IMemoryBackend, MemoryEntry } from './types.js';
import { createDefaultEntry } from './types.js';
import { AutoMemoryBridge } from './auto-memory-bridge.js';

// Cast mocked fs functions for test control
const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockReaddirSync = readdirSync as ReturnType<typeof vi.fn>;
const mockStatSync = statSync as ReturnType<typeof vi.fn>;

// ===== Mock Backend =====

function createMockBackend(entries: MemoryEntry[] = []): IMemoryBackend {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    store: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    getByKey: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(true),
    query: vi.fn().mockResolvedValue(entries),
    search: vi.fn().mockResolvedValue([]),
    bulkInsert: vi.fn().mockResolvedValue(undefined),
    bulkDelete: vi.fn().mockResolvedValue(0),
    count: vi.fn().mockResolvedValue(0),
    listNamespaces: vi.fn().mockResolvedValue([]),
    clearNamespace: vi.fn().mockResolvedValue(0),
    getStats: vi.fn().mockResolvedValue({
      totalEntries: 0,
      entriesByNamespace: {},
      entriesByType: {},
      memoryUsage: 0,
      avgQueryTime: 0,
      avgSearchTime: 0,
    }),
    healthCheck: vi.fn().mockResolvedValue({
      status: 'healthy',
      components: {
        storage: { status: 'healthy', latency: 0 },
        index: { status: 'healthy', latency: 0 },
        cache: { status: 'healthy', latency: 0 },
      },
      timestamp: Date.now(),
      issues: [],
      recommendations: [],
    }),
  };
}

// ===== Test Fixtures =====

function createTestEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  const base = createDefaultEntry({
    key: 'test-key',
    content: 'Test content for knowledge transfer',
    namespace: 'learnings',
    tags: ['insight', 'architecture'],
    metadata: {
      confidence: 0.95,
      category: 'architecture',
      summary: 'Use event sourcing for state changes',
    },
  });
  // When overrides.metadata is provided, use it directly (don't merge with base metadata)
  const metadata = overrides.metadata !== undefined ? overrides.metadata : base.metadata;
  return { ...base, ...overrides, metadata };
}

// ===== resolveAgentMemoryDir =====

describe('resolveAgentMemoryDir', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  beforeEach(() => {
    mockExistsSync.mockReset();
    // Default: no .git found anywhere
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
  });

  it('should resolve project scope to gitRoot/.claude/agent-memory/name/', () => {
    mockExistsSync.mockImplementation((p: string) => {
      return String(p) === path.join('/workspaces/my-project', '.git');
    });

    const result = resolveAgentMemoryDir('coder', 'project', '/workspaces/my-project/src');
    expect(result).toBe(
      path.join('/workspaces/my-project', '.claude', 'agent-memory', 'coder'),
    );
  });

  it('should resolve local scope to gitRoot/.claude/agent-memory-local/name/', () => {
    mockExistsSync.mockImplementation((p: string) => {
      return String(p) === path.join('/workspaces/my-project', '.git');
    });

    const result = resolveAgentMemoryDir('researcher', 'local', '/workspaces/my-project/src');
    expect(result).toBe(
      path.join('/workspaces/my-project', '.claude', 'agent-memory-local', 'researcher'),
    );
  });

  it('should resolve user scope to ~/.claude/agent-memory/name/', () => {
    process.env.HOME = '/home/testuser';

    const result = resolveAgentMemoryDir('planner', 'user');
    expect(result).toBe(
      path.join('/home/testuser', '.claude', 'agent-memory', 'planner'),
    );
  });

  it('should sanitize agent name by replacing special characters', () => {
    process.env.HOME = '/home/testuser';

    const result = resolveAgentMemoryDir('my agent!@#name', 'user');
    expect(result).toBe(
      path.join('/home/testuser', '.claude', 'agent-memory', 'my_agent___name'),
    );
  });

  it('should handle path traversal attempts in agent name', () => {
    process.env.HOME = '/home/testuser';

    const result = resolveAgentMemoryDir('../../../etc/passwd', 'user');
    expect(result).toContain('______etc_passwd');
    expect(result).not.toContain('..');
  });

  it('should handle dots and slashes in agent name', () => {
    process.env.HOME = '/home/testuser';

    const result = resolveAgentMemoryDir('agent/with.dots', 'user');
    expect(result).toBe(
      path.join('/home/testuser', '.claude', 'agent-memory', 'agent_with_dots'),
    );
  });

  it('should fall back to workingDir when no git root is found', () => {
    mockExistsSync.mockReturnValue(false);

    const result = resolveAgentMemoryDir('coder', 'project', '/some/dir');
    expect(result).toBe(
      path.join('/some/dir', '.claude', 'agent-memory', 'coder'),
    );
  });

  it('should fall back to USERPROFILE when HOME is not set', () => {
    delete process.env.HOME;
    process.env.USERPROFILE = '/Users/testuser';

    const result = resolveAgentMemoryDir('coder', 'user');
    expect(result).toBe(
      path.join('/Users/testuser', '.claude', 'agent-memory', 'coder'),
    );
  });

  it('should use cwd as fallback for project scope when workingDir is omitted', () => {
    mockExistsSync.mockReturnValue(false);
    const cwd = process.cwd();

    const result = resolveAgentMemoryDir('coder', 'project');
    expect(result).toBe(
      path.join(cwd, '.claude', 'agent-memory', 'coder'),
    );
  });

  it('should preserve hyphens and underscores in agent name', () => {
    process.env.HOME = '/home/testuser';

    const result = resolveAgentMemoryDir('my-agent_01', 'user');
    expect(result).toBe(
      path.join('/home/testuser', '.claude', 'agent-memory', 'my-agent_01'),
    );
  });
});

// ===== createAgentBridge =====

describe('createAgentBridge', () => {
  beforeEach(() => {
    mockExistsSync.mockReset();
    mockExistsSync.mockReturnValue(false);
  });

  it('should create a bridge with correct memoryDir for project scope', () => {
    mockExistsSync.mockImplementation((p: string) => {
      return String(p) === path.join('/workspaces/project', '.git');
    });

    const backend = createMockBackend();
    const bridge = createAgentBridge(backend, {
      agentName: 'coder',
      scope: 'project',
      workingDir: '/workspaces/project',
    });

    expect(bridge).toBeInstanceOf(AutoMemoryBridge);
    expect(bridge.getMemoryDir()).toBe(
      path.join('/workspaces/project', '.claude', 'agent-memory', 'coder'),
    );
    bridge.destroy();
  });

  it('should create a bridge with correct memoryDir for user scope', () => {
    const originalHome = process.env.HOME;
    process.env.HOME = '/home/testuser';

    const backend = createMockBackend();
    const bridge = createAgentBridge(backend, {
      agentName: 'reviewer',
      scope: 'user',
    });

    expect(bridge).toBeInstanceOf(AutoMemoryBridge);
    expect(bridge.getMemoryDir()).toBe(
      path.join('/home/testuser', '.claude', 'agent-memory', 'reviewer'),
    );

    bridge.destroy();
    process.env.HOME = originalHome;
  });

  it('should create a bridge with correct memoryDir for local scope', () => {
    mockExistsSync.mockImplementation((p: string) => {
      return String(p) === path.join('/workspaces/project', '.git');
    });

    const backend = createMockBackend();
    const bridge = createAgentBridge(backend, {
      agentName: 'tester',
      scope: 'local',
      workingDir: '/workspaces/project',
    });

    expect(bridge).toBeInstanceOf(AutoMemoryBridge);
    expect(bridge.getMemoryDir()).toBe(
      path.join('/workspaces/project', '.claude', 'agent-memory-local', 'tester'),
    );
    bridge.destroy();
  });

  it('should pass through other config options to AutoMemoryBridge', () => {
    const backend = createMockBackend();
    const bridge = createAgentBridge(backend, {
      agentName: 'coder',
      scope: 'project',
      workingDir: '/tmp/test',
      syncMode: 'on-session-end',
      maxIndexLines: 100,
      minConfidence: 0.9,
    });

    expect(bridge).toBeInstanceOf(AutoMemoryBridge);
    bridge.destroy();
  });
});

// ===== transferKnowledge =====

describe('transferKnowledge', () => {
  let targetBridge: AutoMemoryBridge;
  let targetBackend: IMemoryBackend;

  beforeEach(() => {
    mockExistsSync.mockReset();
    mockExistsSync.mockReturnValue(false);

    targetBackend = createMockBackend();
    targetBridge = new AutoMemoryBridge(targetBackend, {
      memoryDir: '/tmp/test-agent-memory',
      syncMode: 'on-session-end',
    });
  });

  afterEach(() => {
    targetBridge.destroy();
  });

  it('should transfer high-confidence entries', async () => {
    const entry = createTestEntry({
      metadata: { confidence: 0.95, category: 'architecture', summary: 'Use event sourcing' },
    });
    const sourceBackend = createMockBackend([entry]);

    const result = await transferKnowledge(sourceBackend, targetBridge, {
      sourceNamespace: 'learnings',
      minConfidence: 0.8,
    });

    expect(result.transferred).toBe(1);
    expect(result.skipped).toBe(0);
    expect(targetBackend.store).toHaveBeenCalled();
  });

  it('should skip entries below minConfidence', async () => {
    const lowConfEntry = createTestEntry({
      metadata: { confidence: 0.3, category: 'debugging', summary: 'Low conf item' },
    });
    const sourceBackend = createMockBackend([lowConfEntry]);

    const result = await transferKnowledge(sourceBackend, targetBridge, {
      sourceNamespace: 'learnings',
      minConfidence: 0.8,
    });

    expect(result.transferred).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('should filter by categories when specified', async () => {
    const archEntry = createTestEntry({
      metadata: { confidence: 0.95, category: 'architecture', summary: 'Arch pattern' },
    });
    const secEntry = createTestEntry({
      metadata: { confidence: 0.95, category: 'security', summary: 'Security pattern' },
    });
    const sourceBackend = createMockBackend([archEntry, secEntry]);

    const result = await transferKnowledge(sourceBackend, targetBridge, {
      sourceNamespace: 'learnings',
      categories: ['architecture'],
    });

    expect(result.transferred).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('should respect maxEntries limit', async () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      createTestEntry({
        key: `entry-${i}`,
        metadata: { confidence: 0.95, category: 'architecture', summary: `Pattern ${i}` },
      }),
    );
    const sourceBackend = createMockBackend(entries);

    const result = await transferKnowledge(sourceBackend, targetBridge, {
      sourceNamespace: 'learnings',
      maxEntries: 3,
    });

    expect(result.transferred).toBe(3);
  });

  it('should handle empty source', async () => {
    const sourceBackend = createMockBackend([]);

    const result = await transferKnowledge(sourceBackend, targetBridge, {
      sourceNamespace: 'learnings',
    });

    expect(result.transferred).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('should set transfer source metadata on insights', async () => {
    const entry = createTestEntry({
      metadata: { confidence: 0.95, category: 'architecture', summary: 'Test pattern' },
    });
    const sourceBackend = createMockBackend([entry]);

    const recordSpy = vi.spyOn(targetBridge, 'recordInsight');

    await transferKnowledge(sourceBackend, targetBridge, {
      sourceNamespace: 'my-namespace',
    });

    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'transfer:my-namespace',
      }),
    );
  });

  it('should use default category when entry has no category metadata', async () => {
    const entry = createTestEntry({
      metadata: { confidence: 0.95, summary: 'No category' },
    });
    const sourceBackend = createMockBackend([entry]);

    const recordSpy = vi.spyOn(targetBridge, 'recordInsight');

    await transferKnowledge(sourceBackend, targetBridge, {
      sourceNamespace: 'learnings',
    });

    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'project-patterns',
      }),
    );
  });

  it('should use first line of content as summary when metadata.summary is missing', async () => {
    const entry = createTestEntry({
      content: 'First line summary\nSecond line detail',
      metadata: { confidence: 0.9 },
    });
    const sourceBackend = createMockBackend([entry]);

    const recordSpy = vi.spyOn(targetBridge, 'recordInsight');

    await transferKnowledge(sourceBackend, targetBridge, {
      sourceNamespace: 'learnings',
    });

    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: 'First line summary',
      }),
    );
  });

  it('should include entries without category when no category filter is set', async () => {
    const entry = createTestEntry({
      metadata: { confidence: 0.95 },
    });
    const sourceBackend = createMockBackend([entry]);

    const result = await transferKnowledge(sourceBackend, targetBridge, {
      sourceNamespace: 'learnings',
    });

    expect(result.transferred).toBe(1);
  });

  it('should default minConfidence to 0.8 when not specified', async () => {
    const borderline = createTestEntry({
      key: 'border',
      metadata: { confidence: 0.79, summary: 'Borderline' },
    });
    const passing = createTestEntry({
      key: 'passing',
      metadata: { confidence: 0.81, summary: 'Passing' },
    });
    const sourceBackend = createMockBackend([borderline, passing]);

    const result = await transferKnowledge(sourceBackend, targetBridge, {
      sourceNamespace: 'learnings',
    });

    expect(result.transferred).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('should default maxEntries to 20 when not specified', async () => {
    const entries = Array.from({ length: 30 }, (_, i) =>
      createTestEntry({
        key: `entry-${i}`,
        metadata: { confidence: 0.95, summary: `Pattern ${i}` },
      }),
    );
    const sourceBackend = createMockBackend(entries);

    const result = await transferKnowledge(sourceBackend, targetBridge, {
      sourceNamespace: 'learnings',
    });

    expect(result.transferred).toBe(20);
  });
});

// ===== listAgentScopes =====

describe('listAgentScopes', () => {
  const originalHome = process.env.HOME;

  beforeEach(() => {
    mockExistsSync.mockReset();
    mockReaddirSync.mockReset();
    mockStatSync.mockReset();
    // Default: nothing exists
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it('should return empty agents when dirs do not exist', () => {
    process.env.HOME = '/home/testuser';
    mockExistsSync.mockReturnValue(false);

    const scopes = listAgentScopes('/workspaces/project');

    expect(scopes).toHaveLength(3);
    expect(scopes[0]).toEqual({ scope: 'project', agents: [] });
    expect(scopes[1]).toEqual({ scope: 'local', agents: [] });
    expect(scopes[2]).toEqual({ scope: 'user', agents: [] });
  });

  it('should list agents from existing directories', () => {
    process.env.HOME = '/home/testuser';

    // Compute the expected directories (no git root, falls back to workingDir)
    const projectDir = path.join('/workspaces/project', '.claude', 'agent-memory');
    const localDir = path.join('/workspaces/project', '.claude', 'agent-memory-local');
    const userDir = path.join('/home/testuser', '.claude', 'agent-memory');

    mockExistsSync.mockImplementation((p: string) => {
      const s = String(p);
      if (s === projectDir) return true;
      if (s === localDir) return true;
      if (s === userDir) return true;
      // No .git found
      return false;
    });

    mockReaddirSync.mockImplementation((p: string) => {
      const s = String(p);
      if (s === projectDir) return ['coder', 'tester'];
      if (s === localDir) return ['researcher'];
      if (s === userDir) return ['planner'];
      return [];
    });

    mockStatSync.mockReturnValue({ isDirectory: () => true });

    const scopes = listAgentScopes('/workspaces/project');

    expect(scopes[0]).toEqual({ scope: 'project', agents: ['coder', 'tester'] });
    expect(scopes[1]).toEqual({ scope: 'local', agents: ['researcher'] });
    expect(scopes[2]).toEqual({ scope: 'user', agents: ['planner'] });
  });

  it('should return all three scopes in order: project, local, user', () => {
    mockExistsSync.mockReturnValue(false);

    const scopes = listAgentScopes('/tmp/test');

    expect(scopes.map((s) => s.scope)).toEqual(['project', 'local', 'user']);
  });

  it('should handle readdir errors gracefully', () => {
    process.env.HOME = '/home/testuser';
    const projectDir = path.join('/workspaces/project', '.claude', 'agent-memory');

    mockExistsSync.mockImplementation((p: string) => {
      return String(p) === projectDir;
    });

    mockReaddirSync.mockImplementation(() => {
      throw new Error('Permission denied');
    });

    const scopes = listAgentScopes('/workspaces/project');

    expect(scopes[0]).toEqual({ scope: 'project', agents: [] });
  });

  it('should skip non-directory entries', () => {
    process.env.HOME = '/home/testuser';
    const projectDir = path.join('/workspaces/project', '.claude', 'agent-memory');

    mockExistsSync.mockImplementation((p: string) => {
      return String(p) === projectDir;
    });

    mockReaddirSync.mockImplementation((p: string) => {
      if (String(p) === projectDir) return ['coder', 'readme.md'];
      return [];
    });

    let callCount = 0;
    mockStatSync.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return { isDirectory: () => true };
      }
      return { isDirectory: () => false };
    });

    const scopes = listAgentScopes('/workspaces/project');

    expect(scopes[0].agents).toEqual(['coder']);
  });
});
