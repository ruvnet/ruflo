/**
 * Beads MCP Tools Tests
 *
 * TDD London School tests for Beads issue tracking MCP tools.
 * Tests focus on behavior verification and mock interactions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getBeadsTools, setBeadsWrapper } from '../../src/mcp-tools/beads-tools.js';
import type { BeadsCliWrapper, BeadsCommandResult } from '../../src/beads/cli-wrapper.js';
import type { BeadsIssue, BeadsStats } from '../../src/beads/types.js';
import type { MCPTool, MCPToolResult } from '../../src/mcp-tools/types.js';

// Mock the CLI wrapper - London School approach
const createMockWrapper = (): BeadsCliWrapper => ({
  isInstalled: vi.fn(),
  isInitialized: vi.fn(),
  init: vi.fn(),
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
} as unknown as BeadsCliWrapper);

// Helper to create a mock issue
const createMockIssue = (overrides?: Partial<BeadsIssue>): BeadsIssue => ({
  id: 'bd-test123',
  title: 'Test Issue',
  description: 'Test description',
  status: 'open',
  priority: 2,
  type: 'task',
  labels: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  dependencies: [],
  ...overrides,
});

// Helper to extract text from MCPToolResult
const getResultText = (result: MCPToolResult | unknown): string => {
  const r = result as MCPToolResult;
  return r.content?.[0]?.text || '';
};

describe('Beads MCP Tools', () => {
  let tools: MCPTool[];
  let mockWrapper: BeadsCliWrapper;

  beforeEach(() => {
    mockWrapper = createMockWrapper();
    setBeadsWrapper(mockWrapper);
    tools = getBeadsTools();
  });

  afterEach(() => {
    vi.clearAllMocks();
    setBeadsWrapper(null);
  });

  describe('tool registration', () => {
    it('should register all 11 beads tools', () => {
      expect(tools).toHaveLength(11);
    });

    it('should have correct tool names', () => {
      const names = tools.map(t => t.name);
      expect(names).toContain('beads_create');
      expect(names).toContain('beads_list');
      expect(names).toContain('beads_ready');
      expect(names).toContain('beads_show');
      expect(names).toContain('beads_update');
      expect(names).toContain('beads_close');
      expect(names).toContain('beads_dep_add');
      expect(names).toContain('beads_dep_tree');
      expect(names).toContain('beads_blocked');
      expect(names).toContain('beads_stats');
      expect(names).toContain('beads_sync');
    });

    it('should have beads category for all tools', () => {
      tools.forEach(tool => {
        expect(tool.category).toBe('beads');
      });
    });

    it('should have descriptions for all tools', () => {
      tools.forEach(tool => {
        expect(tool.description).toBeTruthy();
        expect(typeof tool.description).toBe('string');
      });
    });
  });

  describe('beads_create', () => {
    let createTool: MCPTool;

    beforeEach(() => {
      createTool = tools.find(t => t.name === 'beads_create')!;
    });

    it('should have correct input schema', () => {
      expect(createTool.inputSchema.properties).toHaveProperty('title');
      expect(createTool.inputSchema.properties).toHaveProperty('description');
      expect(createTool.inputSchema.properties).toHaveProperty('priority');
      expect(createTool.inputSchema.properties).toHaveProperty('type');
      expect(createTool.inputSchema.properties).toHaveProperty('assignee');
      expect(createTool.inputSchema.properties).toHaveProperty('labels');
      expect(createTool.inputSchema.properties).toHaveProperty('parent_id');
      expect(createTool.inputSchema.required).toContain('title');
    });

    it('should call wrapper.create with correct parameters', async () => {
      const mockIssue = createMockIssue();
      const mockResult: BeadsCommandResult<BeadsIssue> = {
        success: true,
        data: mockIssue,
        exitCode: 0,
      };
      (mockWrapper.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const input = {
        title: 'Test Issue',
        description: 'A test issue',
        priority: 2,
        type: 'bug',
        assignee: 'developer',
        labels: ['urgent', 'frontend'],
      };

      await createTool.handler(input);

      expect(mockWrapper.create).toHaveBeenCalledWith(input);
      expect(mockWrapper.create).toHaveBeenCalledTimes(1);
    });

    it('should return success result on successful creation', async () => {
      const mockIssue = createMockIssue({ id: 'bd-new123', title: 'New Issue' });
      const mockResult: BeadsCommandResult<BeadsIssue> = {
        success: true,
        data: mockIssue,
        exitCode: 0,
      };
      (mockWrapper.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const result = await createTool.handler({ title: 'New Issue' });

      expect(result).toHaveProperty('content');
      expect(getResultText(result)).toContain('bd-new123');
      expect(getResultText(result)).toContain('New Issue');
    });

    it('should return error result on failed creation', async () => {
      const mockResult: BeadsCommandResult = {
        success: false,
        error: 'Failed to create issue',
        exitCode: 1,
      };
      (mockWrapper.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const result = await createTool.handler({ title: 'Test Issue' });

      expect(result).toHaveProperty('isError', true);
      expect(getResultText(result)).toContain('Failed to create issue');
    });
  });

  describe('beads_list', () => {
    let listTool: MCPTool;

    beforeEach(() => {
      listTool = tools.find(t => t.name === 'beads_list')!;
    });

    it('should have correct input schema', () => {
      expect(listTool.inputSchema.properties).toHaveProperty('status');
      expect(listTool.inputSchema.properties).toHaveProperty('assignee');
      expect(listTool.inputSchema.properties).toHaveProperty('labels');
      expect(listTool.inputSchema.properties).toHaveProperty('priority');
      expect(listTool.inputSchema.properties).toHaveProperty('limit');
    });

    it('should call wrapper.list with filters', async () => {
      const mockResult: BeadsCommandResult<BeadsIssue[]> = {
        success: true,
        data: [],
        exitCode: 0,
      };
      (mockWrapper.list as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const input = { status: 'open', assignee: 'dev' };
      await listTool.handler(input);

      expect(mockWrapper.list).toHaveBeenCalledWith(input);
    });

    it('should return list of issues on success', async () => {
      const mockIssues: BeadsIssue[] = [
        createMockIssue({ id: 'bd-1', title: 'Issue 1' }),
        createMockIssue({ id: 'bd-2', title: 'Issue 2' }),
      ];
      const mockResult: BeadsCommandResult<BeadsIssue[]> = {
        success: true,
        data: mockIssues,
        exitCode: 0,
      };
      (mockWrapper.list as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const result = await listTool.handler({});

      expect(result).toHaveProperty('content');
      const text = getResultText(result);
      expect(text).toContain('Issue 1');
      expect(text).toContain('Issue 2');
    });
  });

  describe('beads_ready', () => {
    let readyTool: MCPTool;

    beforeEach(() => {
      readyTool = tools.find(t => t.name === 'beads_ready')!;
    });

    it('should have correct input schema', () => {
      expect(readyTool.inputSchema.properties).toHaveProperty('limit');
    });

    it('should call wrapper.ready', async () => {
      const mockResult: BeadsCommandResult<BeadsIssue[]> = {
        success: true,
        data: [],
        exitCode: 0,
      };
      (mockWrapper.ready as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      await readyTool.handler({ limit: 5 });

      expect(mockWrapper.ready).toHaveBeenCalledWith({ limit: 5 });
    });

    it('should return issues with no blockers', async () => {
      const readyIssues: BeadsIssue[] = [
        createMockIssue({ id: 'bd-ready', title: 'Ready Issue' }),
      ];
      const mockResult: BeadsCommandResult<BeadsIssue[]> = {
        success: true,
        data: readyIssues,
        exitCode: 0,
      };
      (mockWrapper.ready as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const result = await readyTool.handler({});

      expect(result).toHaveProperty('content');
      expect(getResultText(result)).toContain('Ready Issue');
    });
  });

  describe('beads_show', () => {
    let showTool: MCPTool;

    beforeEach(() => {
      showTool = tools.find(t => t.name === 'beads_show')!;
    });

    it('should have correct input schema', () => {
      expect(showTool.inputSchema.properties).toHaveProperty('id');
      expect(showTool.inputSchema.required).toContain('id');
    });

    it('should call wrapper.show with issue id', async () => {
      const mockIssue = createMockIssue({ id: 'bd-123', description: 'Full description' });
      const mockResult: BeadsCommandResult<BeadsIssue> = {
        success: true,
        data: mockIssue,
        exitCode: 0,
      };
      (mockWrapper.show as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      await showTool.handler({ id: 'bd-123' });

      expect(mockWrapper.show).toHaveBeenCalledWith({ id: 'bd-123' });
    });

    it('should return detailed issue information', async () => {
      const mockIssue = createMockIssue({
        id: 'bd-detail',
        title: 'Detail Issue',
        description: 'Full description here',
      });
      const mockResult: BeadsCommandResult<BeadsIssue> = {
        success: true,
        data: mockIssue,
        exitCode: 0,
      };
      (mockWrapper.show as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const result = await showTool.handler({ id: 'bd-detail' });

      const text = getResultText(result);
      expect(text).toContain('bd-detail');
      expect(text).toContain('Detail Issue');
      expect(text).toContain('Full description here');
    });
  });

  describe('beads_update', () => {
    let updateTool: MCPTool;

    beforeEach(() => {
      updateTool = tools.find(t => t.name === 'beads_update')!;
    });

    it('should have correct input schema', () => {
      expect(updateTool.inputSchema.properties).toHaveProperty('id');
      expect(updateTool.inputSchema.properties).toHaveProperty('status');
      expect(updateTool.inputSchema.properties).toHaveProperty('priority');
      expect(updateTool.inputSchema.properties).toHaveProperty('assignee');
      expect(updateTool.inputSchema.required).toContain('id');
    });

    it('should call wrapper.update with id and updates', async () => {
      const mockIssue = createMockIssue({ id: 'bd-upd', status: 'in_progress' });
      const mockResult: BeadsCommandResult<BeadsIssue> = {
        success: true,
        data: mockIssue,
        exitCode: 0,
      };
      (mockWrapper.update as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const input = { id: 'bd-upd', status: 'in_progress', priority: 1 };
      await updateTool.handler(input);

      expect(mockWrapper.update).toHaveBeenCalledWith({
        id: 'bd-upd',
        status: 'in_progress',
        priority: 1,
      });
    });
  });

  describe('beads_close', () => {
    let closeTool: MCPTool;

    beforeEach(() => {
      closeTool = tools.find(t => t.name === 'beads_close')!;
    });

    it('should have correct input schema', () => {
      expect(closeTool.inputSchema.properties).toHaveProperty('id');
      expect(closeTool.inputSchema.properties).toHaveProperty('reason');
      expect(closeTool.inputSchema.required).toContain('id');
    });

    it('should call wrapper.close with id and reason', async () => {
      const mockIssue = createMockIssue({ id: 'bd-close', status: 'closed' });
      const mockResult: BeadsCommandResult<BeadsIssue> = {
        success: true,
        data: mockIssue,
        exitCode: 0,
      };
      (mockWrapper.close as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      await closeTool.handler({ id: 'bd-close', reason: 'Fixed in PR #42' });

      expect(mockWrapper.close).toHaveBeenCalledWith({
        id: 'bd-close',
        reason: 'Fixed in PR #42',
      });
    });
  });

  describe('beads_dep_add', () => {
    let depAddTool: MCPTool;

    beforeEach(() => {
      depAddTool = tools.find(t => t.name === 'beads_dep_add')!;
    });

    it('should have correct input schema', () => {
      expect(depAddTool.inputSchema.properties).toHaveProperty('from_id');
      expect(depAddTool.inputSchema.properties).toHaveProperty('to_id');
      expect(depAddTool.inputSchema.required).toContain('from_id');
      expect(depAddTool.inputSchema.required).toContain('to_id');
    });

    it('should call wrapper.depAdd with correct parameters', async () => {
      const mockResult: BeadsCommandResult = {
        success: true,
        exitCode: 0,
      };
      (mockWrapper.depAdd as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      await depAddTool.handler({ from_id: 'bd-child', to_id: 'bd-parent' });

      expect(mockWrapper.depAdd).toHaveBeenCalledWith({
        from_id: 'bd-child',
        to_id: 'bd-parent',
      });
    });
  });

  describe('beads_dep_tree', () => {
    let depTreeTool: MCPTool;

    beforeEach(() => {
      depTreeTool = tools.find(t => t.name === 'beads_dep_tree')!;
    });

    it('should have correct input schema', () => {
      expect(depTreeTool.inputSchema.properties).toHaveProperty('id');
    });

    it('should call wrapper.depTree with optional id', async () => {
      const mockResult: BeadsCommandResult = {
        success: true,
        data: {},
        exitCode: 0,
      };
      (mockWrapper.depTree as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      await depTreeTool.handler({ id: 'bd-root' });

      expect(mockWrapper.depTree).toHaveBeenCalledWith({ id: 'bd-root' });
    });

    it('should call wrapper.depTree without id for full tree', async () => {
      const mockResult: BeadsCommandResult = {
        success: true,
        data: {},
        exitCode: 0,
      };
      (mockWrapper.depTree as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      await depTreeTool.handler({});

      // When no id provided, wrapper receives empty id
      expect(mockWrapper.depTree).toHaveBeenCalled();
    });
  });

  describe('beads_blocked', () => {
    let blockedTool: MCPTool;

    beforeEach(() => {
      blockedTool = tools.find(t => t.name === 'beads_blocked')!;
    });

    it('should have correct input schema', () => {
      expect(blockedTool.inputSchema.properties).toBeDefined();
    });

    it('should call wrapper.blocked', async () => {
      const mockResult: BeadsCommandResult<BeadsIssue[]> = {
        success: true,
        data: [],
        exitCode: 0,
      };
      (mockWrapper.blocked as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      await blockedTool.handler({});

      expect(mockWrapper.blocked).toHaveBeenCalled();
    });

    it('should return list of blocked issues', async () => {
      const blockedIssues: BeadsIssue[] = [
        createMockIssue({ id: 'bd-blocked', title: 'Blocked Issue', status: 'open' }),
      ];
      const mockResult: BeadsCommandResult<BeadsIssue[]> = {
        success: true,
        data: blockedIssues,
        exitCode: 0,
      };
      (mockWrapper.blocked as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const result = await blockedTool.handler({});

      const text = getResultText(result);
      expect(text).toContain('Blocked Issue');
    });
  });

  describe('beads_stats', () => {
    let statsTool: MCPTool;

    beforeEach(() => {
      statsTool = tools.find(t => t.name === 'beads_stats')!;
    });

    it('should have correct input schema', () => {
      expect(statsTool.inputSchema.properties).toBeDefined();
    });

    it('should call wrapper.stats', async () => {
      const mockStats: BeadsStats = {
        total: 10,
        open: 5,
        in_progress: 3,
        closed: 2,
        by_priority: { 0: 1, 1: 2, 2: 4, 3: 2, 4: 1 },
        by_type: { bug: 3, feature: 5, task: 2 },
      };
      const mockResult: BeadsCommandResult<BeadsStats> = {
        success: true,
        data: mockStats,
        exitCode: 0,
      };
      (mockWrapper.stats as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      await statsTool.handler({});

      expect(mockWrapper.stats).toHaveBeenCalled();
    });

    it('should return statistics data', async () => {
      const mockStats: BeadsStats = {
        total: 10,
        open: 5,
        in_progress: 3,
        closed: 2,
        by_priority: {},
        by_type: {},
      };
      const mockResult: BeadsCommandResult<BeadsStats> = {
        success: true,
        data: mockStats,
        exitCode: 0,
      };
      (mockWrapper.stats as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const result = await statsTool.handler({});

      const text = getResultText(result);
      expect(text).toContain('10');
    });
  });

  describe('beads_sync', () => {
    let syncTool: MCPTool;

    beforeEach(() => {
      syncTool = tools.find(t => t.name === 'beads_sync')!;
    });

    it('should have correct input schema', () => {
      expect(syncTool.inputSchema.properties).toHaveProperty('force');
    });

    it('should call wrapper.sync with parameters', async () => {
      const mockResult: BeadsCommandResult = {
        success: true,
        exitCode: 0,
      };
      (mockWrapper.sync as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      await syncTool.handler({ force: true });

      expect(mockWrapper.sync).toHaveBeenCalledWith(true);
    });
  });

  describe('error handling', () => {
    it('should handle wrapper errors gracefully', async () => {
      const createTool = tools.find(t => t.name === 'beads_create')!;
      (mockWrapper.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

      const result = await createTool.handler({ title: 'Test' });

      expect(result).toHaveProperty('isError', true);
      const text = getResultText(result);
      expect(text).toContain('Network error');
    });

    it('should handle missing wrapper', async () => {
      setBeadsWrapper(null);
      const newTools = getBeadsTools();
      const createTool = newTools.find(t => t.name === 'beads_create')!;

      const result = await createTool.handler({ title: 'Test' });

      expect(result).toHaveProperty('isError', true);
    });
  });
});

describe('Beads Tool Integration Patterns', () => {
  let mockWrapper: BeadsCliWrapper;

  beforeEach(() => {
    mockWrapper = createMockWrapper();
    setBeadsWrapper(mockWrapper);
  });

  afterEach(() => {
    vi.clearAllMocks();
    setBeadsWrapper(null);
  });

  it('should support create -> show workflow', async () => {
    const tools = getBeadsTools();
    const createTool = tools.find(t => t.name === 'beads_create')!;
    const showTool = tools.find(t => t.name === 'beads_show')!;

    const mockIssue = createMockIssue({ id: 'bd-new', title: 'New Feature' });

    (mockWrapper.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: mockIssue,
      exitCode: 0,
    });
    (mockWrapper.show as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: mockIssue,
      exitCode: 0,
    });

    await createTool.handler({ title: 'New Feature' });
    await showTool.handler({ id: 'bd-new' });

    expect(mockWrapper.create).toHaveBeenCalledTimes(1);
    expect(mockWrapper.show).toHaveBeenCalledWith({ id: 'bd-new' });
  });

  it('should support create -> dep_add -> dep_tree workflow', async () => {
    const tools = getBeadsTools();
    const createTool = tools.find(t => t.name === 'beads_create')!;
    const depAddTool = tools.find(t => t.name === 'beads_dep_add')!;
    const depTreeTool = tools.find(t => t.name === 'beads_dep_tree')!;

    const parentIssue = createMockIssue({ id: 'bd-parent', title: 'Parent Task' });
    const childIssue = createMockIssue({ id: 'bd-child', title: 'Child Task' });

    (mockWrapper.create as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ success: true, data: parentIssue, exitCode: 0 })
      .mockResolvedValueOnce({ success: true, data: childIssue, exitCode: 0 });
    (mockWrapper.depAdd as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      exitCode: 0,
    });
    (mockWrapper.depTree as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { tree: 'bd-parent -> bd-child' },
      exitCode: 0,
    });

    await createTool.handler({ title: 'Parent Task' });
    await createTool.handler({ title: 'Child Task' });
    await depAddTool.handler({ from_id: 'bd-child', to_id: 'bd-parent' });
    await depTreeTool.handler({});

    expect(mockWrapper.create).toHaveBeenCalledTimes(2);
    expect(mockWrapper.depAdd).toHaveBeenCalledWith({ from_id: 'bd-child', to_id: 'bd-parent' });
    expect(mockWrapper.depTree).toHaveBeenCalled();
  });
});
