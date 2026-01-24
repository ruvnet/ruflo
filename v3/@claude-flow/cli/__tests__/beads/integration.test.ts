/**
 * Beads Integration Tests
 *
 * Integration tests for the Beads issue tracking module.
 * Tests module loading, end-to-end workflows, and hooks integration.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest';
import { getBeadsTools, setBeadsWrapper } from '../../src/mcp-tools/beads-tools.js';
import type { BeadsCliWrapper, BeadsIssue, BeadsResult } from '../../src/beads/cli-wrapper.js';

// Mock wrapper factory for testing
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

describe('Beads Integration', () => {
  describe('Module Loading', () => {
    it('should export BeadsCliWrapper', async () => {
      const module = await import('../../src/beads/index.js');
      expect(module.BeadsCliWrapper).toBeDefined();
    });

    it('should export BeadsHooks', async () => {
      const module = await import('../../src/beads/index.js');
      expect(module.BeadsHooks).toBeDefined();
    });

    it('should export BeadsMemoryLink', async () => {
      const module = await import('../../src/beads/index.js');
      expect(module.BeadsMemoryLink).toBeDefined();
    });

    it('should export BeadsSparc', async () => {
      const module = await import('../../src/beads/index.js');
      expect(module.BeadsSparc).toBeDefined();
    });

    it('should export all MCP tools', () => {
      const tools = getBeadsTools();
      expect(tools.length).toBe(11);
    });

    it('should export initializeBeads function', async () => {
      const module = await import('../../src/beads/index.js');
      expect(typeof module.initializeBeads).toBe('function');
    });
  });

  describe('End-to-End Workflow', () => {
    let mockWrapper: BeadsCliWrapper;

    beforeEach(() => {
      mockWrapper = createMockWrapper();
      setBeadsWrapper(mockWrapper);
    });

    afterEach(() => {
      vi.clearAllMocks();
      setBeadsWrapper(null);
    });

    it('should create, query, and close issue', async () => {
      const mockIssue: BeadsIssue = {
        id: 'bd-test1',
        title: 'Integration Test Issue',
        status: 'open',
        priority: 2,
        createdAt: new Date().toISOString(),
      };

      // Setup mocks
      (mockWrapper.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockIssue,
      });
      (mockWrapper.ready as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [mockIssue],
      });
      (mockWrapper.close as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: { ...mockIssue, status: 'closed' },
      });

      const tools = getBeadsTools();
      const createTool = tools.find(t => t.name === 'beads_create')!;
      const readyTool = tools.find(t => t.name === 'beads_ready')!;
      const closeTool = tools.find(t => t.name === 'beads_close')!;

      // Create
      const created = await createTool.handler({ title: 'Integration Test Issue' });
      expect(created).toHaveProperty('content');
      expect(mockWrapper.create).toHaveBeenCalledTimes(1);

      // Query ready
      const ready = await readyTool.handler({});
      expect(ready).toHaveProperty('content');
      expect(mockWrapper.ready).toHaveBeenCalledTimes(1);

      // Close
      const closed = await closeTool.handler({ id: 'bd-test1', reason: 'Test complete' });
      expect(closed).toHaveProperty('content');
      expect(mockWrapper.close).toHaveBeenCalledWith({ id: 'bd-test1', reason: 'Test complete' });
    });

    it('should handle dependency workflow', async () => {
      const parentIssue: BeadsIssue = {
        id: 'bd-parent',
        title: 'Parent Task',
        status: 'open',
        priority: 1,
        createdAt: new Date().toISOString(),
      };

      const childIssue: BeadsIssue = {
        id: 'bd-child',
        title: 'Child Task',
        status: 'open',
        priority: 2,
        dependsOn: ['bd-parent'],
        createdAt: new Date().toISOString(),
      };

      (mockWrapper.create as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ success: true, data: parentIssue })
        .mockResolvedValueOnce({ success: true, data: childIssue });

      (mockWrapper.depAdd as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: { id: 'bd-child', dependsOn: ['bd-parent'] },
      });

      (mockWrapper.depTree as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: {
          tree: [{
            id: 'bd-parent',
            title: 'Parent Task',
            status: 'open',
            children: [{
              id: 'bd-child',
              title: 'Child Task',
              status: 'open',
            }],
          }],
        },
      });

      const tools = getBeadsTools();
      const createTool = tools.find(t => t.name === 'beads_create')!;
      const depAddTool = tools.find(t => t.name === 'beads_dep_add')!;
      const depTreeTool = tools.find(t => t.name === 'beads_dep_tree')!;

      // Create parent and child
      await createTool.handler({ title: 'Parent Task' });
      await createTool.handler({ title: 'Child Task' });

      // Add dependency
      const depResult = await depAddTool.handler({ from_id: 'bd-child', to_id: 'bd-parent' });
      expect(depResult).toHaveProperty('content');
      expect(mockWrapper.depAdd).toHaveBeenCalledWith({ from_id: 'bd-child', to_id: 'bd-parent' });

      // View tree
      const treeResult = await depTreeTool.handler({});
      expect(treeResult).toHaveProperty('content');
      const treeText = (treeResult as { content: Array<{ text: string }> }).content[0].text;
      expect(treeText).toContain('bd-parent');
    });

    it('should handle blocked issues workflow', async () => {
      const blockedIssue: BeadsIssue = {
        id: 'bd-blocked',
        title: 'Blocked Issue',
        status: 'blocked',
        priority: 1,
        dependsOn: ['bd-blocker'],
        createdAt: new Date().toISOString(),
      };

      (mockWrapper.blocked as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [blockedIssue],
      });

      const tools = getBeadsTools();
      const blockedTool = tools.find(t => t.name === 'beads_blocked')!;

      const result = await blockedTool.handler({});
      expect(result).toHaveProperty('content');
      const text = (result as { content: Array<{ text: string }> }).content[0].text;
      expect(text).toContain('bd-blocked');
    });
  });

  describe('Hooks Integration', () => {
    let mockWrapper: BeadsCliWrapper;

    beforeEach(() => {
      mockWrapper = createMockWrapper();
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it('should provide session start context', async () => {
      (mockWrapper.ready as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [],
      });

      const { BeadsHooks } = await import('../../src/beads/index.js');
      const hooks = new BeadsHooks(mockWrapper);

      const startContext = await hooks.sessionStart();
      expect(startContext).toContain('No ready work');
    });

    it('should provide session end prompt', async () => {
      (mockWrapper.list as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [],
      });

      const { BeadsHooks } = await import('../../src/beads/index.js');
      const hooks = new BeadsHooks(mockWrapper);

      const endPrompt = await hooks.sessionEnd();
      expect(endPrompt).toContain('beads_create');
    });

    it('should inject context with ready issues', async () => {
      const readyIssues: BeadsIssue[] = [
        { id: 'bd-1', title: 'Task 1', status: 'open', priority: 0, createdAt: new Date().toISOString() },
        { id: 'bd-2', title: 'Task 2', status: 'open', priority: 1, createdAt: new Date().toISOString() },
      ];

      (mockWrapper.ready as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: readyIssues,
      });

      const { BeadsHooks } = await import('../../src/beads/index.js');
      const hooks = new BeadsHooks(mockWrapper);

      const context = await hooks.sessionStart();
      expect(context).toContain('bd-1');
      expect(context).toContain('bd-2');
    });
  });

  describe('Memory Link Integration', () => {
    it('should create memory links for issues', async () => {
      const { BeadsMemoryLink } = await import('../../src/beads/index.js');

      // Create mock dependencies
      const mockMemoryStore = {
        store: vi.fn().mockResolvedValue(undefined),
        retrieve: vi.fn().mockResolvedValue(null),
        query: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(undefined),
      };
      const mockBeadsWrapper = {
        update: vi.fn().mockResolvedValue({ success: true, exitCode: 0 }),
      };

      const memLink = new BeadsMemoryLink(mockMemoryStore, mockBeadsWrapper as any);

      await memLink.linkMemory('patterns/auth-flow', 'bd-auth-123', 'learned-from');

      expect(mockMemoryStore.store).toHaveBeenCalledWith(
        expect.objectContaining({
          namespace: 'beads/links',
          value: expect.objectContaining({
            memory_key: 'patterns/auth-flow',
            issue_id: 'bd-auth-123',
            link_type: 'learned-from',
          }),
        })
      );
    });

    it('should retrieve links by issue', async () => {
      const { BeadsMemoryLink } = await import('../../src/beads/index.js');

      // Create mock dependencies with stored links
      const mockMemoryStore = {
        store: vi.fn().mockResolvedValue(undefined),
        retrieve: vi.fn().mockResolvedValue(null),
        query: vi.fn().mockResolvedValue([
          { key: 'link-1', value: { memory_key: 'patterns/auth', issue_id: 'bd-1', link_type: 'learned-from', linked_at: new Date().toISOString() } },
          { key: 'link-2', value: { memory_key: 'patterns/validation', issue_id: 'bd-1', link_type: 'referenced', linked_at: new Date().toISOString() } },
        ]),
        update: vi.fn().mockResolvedValue(undefined),
      };
      const mockBeadsWrapper = {
        update: vi.fn().mockResolvedValue({ success: true, exitCode: 0 }),
      };

      const memLink = new BeadsMemoryLink(mockMemoryStore, mockBeadsWrapper as any);

      const links = await memLink.getLinksForIssue('bd-1');
      expect(links.length).toBe(2);
      expect(links.map(l => l.memory_key)).toContain('patterns/auth');
      expect(links.map(l => l.memory_key)).toContain('patterns/validation');
    });
  });

  describe('SPARC Integration', () => {
    it('should generate SPARC-style issue breakdown', async () => {
      const mockWrapper = createMockWrapper();
      let issueCounter = 0;

      (mockWrapper.create as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        issueCounter++;
        return {
          success: true,
          exitCode: 0,
          data: {
            id: `bd-sparc-${issueCounter}`,
            title: 'Test',
            status: 'open',
            priority: 2,
            type: 'task',
            labels: [],
            dependencies: [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        };
      });

      (mockWrapper.depAdd as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        exitCode: 0,
      });

      const { BeadsSparc } = await import('../../src/beads/index.js');
      const sparc = new BeadsSparc(mockWrapper as any);

      const workflow = await sparc.createSparcWorkflow({
        name: 'Implement user authentication',
        description: 'User auth feature',
      });

      // Epic + 5 phases = 6 create calls
      expect(mockWrapper.create).toHaveBeenCalledTimes(6);
      expect(workflow.phases).toHaveProperty('specification');
      expect(workflow.phases).toHaveProperty('pseudocode');
      expect(workflow.phases).toHaveProperty('architecture');
      expect(workflow.phases).toHaveProperty('refinement');
      expect(workflow.phases).toHaveProperty('completion');
    });

    it('should create issues for each SPARC phase', async () => {
      const mockWrapper = createMockWrapper();
      let issueCounter = 0;

      (mockWrapper.create as ReturnType<typeof vi.fn>).mockImplementation(async (params: any) => {
        issueCounter++;
        return {
          success: true,
          exitCode: 0,
          data: {
            id: `bd-sparc-${issueCounter}`,
            title: params.title,
            status: 'open',
            priority: params.priority || 2,
            type: params.type || 'task',
            labels: params.labels || [],
            dependencies: [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        };
      });

      (mockWrapper.depAdd as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        exitCode: 0,
      });

      const { BeadsSparc } = await import('../../src/beads/index.js');
      const sparc = new BeadsSparc(mockWrapper as any);

      // Use onSpecificationComplete which creates epic + tasks
      const spec = {
        name: 'Build user dashboard',
        summary: 'Dashboard feature',
        requirements: [
          { name: 'Task 1', acceptance_criteria: 'AC 1' },
          { name: 'Task 2', acceptance_criteria: 'AC 2' },
        ],
      };

      const epic = await sparc.onSpecificationComplete(spec);
      expect(epic).toBeDefined();
      // Epic + 2 tasks = 3 create calls
      expect(mockWrapper.create).toHaveBeenCalledTimes(3);
      // Dependencies: 2 tasks linked to epic
      expect(mockWrapper.depAdd).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Handling', () => {
    let mockWrapper: BeadsCliWrapper;

    beforeEach(() => {
      mockWrapper = createMockWrapper();
      setBeadsWrapper(mockWrapper);
    });

    afterEach(() => {
      vi.clearAllMocks();
      setBeadsWrapper(null);
    });

    it('should handle wrapper errors gracefully', async () => {
      (mockWrapper.create as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Connection failed')
      );

      const tools = getBeadsTools();
      const createTool = tools.find(t => t.name === 'beads_create')!;

      const result = await createTool.handler({ title: 'Test' });
      expect(result).toHaveProperty('isError', true);
      const text = (result as { content: Array<{ text: string }> }).content[0].text;
      expect(text).toContain('Connection failed');
    });

    it('should handle operation failures', async () => {
      (mockWrapper.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        error: 'Issue not found: bd-nonexistent',
      });

      const tools = getBeadsTools();
      const updateTool = tools.find(t => t.name === 'beads_update')!;

      const result = await updateTool.handler({ id: 'bd-nonexistent', status: 'in_progress' });
      expect(result).toHaveProperty('isError', true);
      const text = (result as { content: Array<{ text: string }> }).content[0].text;
      expect(text).toContain('Issue not found');
    });

    it('should handle sync failures', async () => {
      (mockWrapper.sync as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        error: 'Sync failed: network error',
      });

      const tools = getBeadsTools();
      const syncTool = tools.find(t => t.name === 'beads_sync')!;

      const result = await syncTool.handler({ direction: 'push' });
      expect(result).toHaveProperty('isError', true);
    });
  });

  describe('Tool Schema Validation', () => {
    it('should have valid JSON schemas for all tools', () => {
      const tools = getBeadsTools();

      for (const tool of tools) {
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.inputSchema.properties).toBeDefined();
        expect(typeof tool.inputSchema.properties).toBe('object');
      }
    });

    it('should have required fields properly defined', () => {
      const tools = getBeadsTools();

      const createTool = tools.find(t => t.name === 'beads_create')!;
      expect(createTool.inputSchema.required).toContain('title');

      const showTool = tools.find(t => t.name === 'beads_show')!;
      expect(showTool.inputSchema.required).toContain('id');

      const depAddTool = tools.find(t => t.name === 'beads_dep_add')!;
      expect(depAddTool.inputSchema.required).toContain('from_id');
      expect(depAddTool.inputSchema.required).toContain('to_id');
    });
  });
});
