/**
 * V3 CLI Task Commands Tests
 *
 * Tests for task management commands (create, list, status, cancel, etc.)
 * Addresses issue #958: Tasks should work without errors
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { taskCommand } from '../src/commands/task.js';
import type { CommandContext } from '../src/types.js';

// Mock MCP client
vi.mock('../src/mcp-client.js', () => ({
  callMCPTool: vi.fn(async (toolName: string, input: Record<string, unknown>) => {
    // Mock responses for task tools

    if (toolName === 'task_create') {
      return {
        taskId: `task-${Date.now()}-abc123`,
        type: input.type,
        description: input.description,
        priority: input.priority || 'normal',
        status: 'pending',
        createdAt: new Date().toISOString(),
        assignedTo: input.assignedTo || [],
        tags: input.tags || [],
      };
    }

    if (toolName === 'task_list') {
      return {
        tasks: [
          {
            id: 'task-123',
            taskId: 'task-123',
            type: 'bug-fix',
            description: 'Fix authentication bug',
            priority: 'high',
            status: 'pending',
            assignedTo: [],
            progress: 0,
            createdAt: '2024-01-01T00:00:00Z',
          },
          {
            id: 'task-456',
            taskId: 'task-456',
            type: 'implementation',
            description: 'Add user profile page',
            priority: 'normal',
            status: 'in_progress',
            assignedTo: ['coder-1'],
            progress: 50,
            createdAt: '2024-01-01T00:01:00Z',
          },
        ],
        total: 2,
      };
    }

    if (toolName === 'task_status') {
      return {
        id: input.taskId,
        taskId: input.taskId,
        type: 'bug-fix',
        description: 'Fix authentication bug in login module',
        status: 'in_progress',
        progress: 50,
        priority: 'high',
        assignedTo: ['coder-1'],
        tags: ['auth', 'security'],
        dependencies: [],
        dependents: [],
        parentId: undefined,
        createdAt: '2024-01-01T00:00:00Z',
        startedAt: '2024-01-01T00:05:00Z',
        completedAt: null,
      };
    }

    if (toolName === 'task_cancel') {
      return {
        taskId: input.taskId,
        cancelled: true,
        previousStatus: 'pending',
        cancelledAt: new Date().toISOString(),
      };
    }

    if (toolName === 'task_assign') {
      return {
        taskId: input.taskId,
        assignedTo: input.agentIds || [],
        previouslyAssigned: [],
      };
    }

    if (toolName === 'task_retry') {
      return {
        taskId: input.taskId,
        newTaskId: `task-retry-${Date.now()}`,
        previousStatus: 'failed',
        status: 'pending',
      };
    }

    // Default empty response
    return {};
  }),
  MCPClientError: class MCPClientError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'MCPClientError';
    }
  },
}));

// Mock output module
vi.mock('../src/output.js', () => ({
  output: {
    writeln: vi.fn(),
    printInfo: vi.fn(),
    printSuccess: vi.fn(),
    printError: vi.fn(),
    printWarning: vi.fn(),
    printTable: vi.fn(),
    printBox: vi.fn(),
    printList: vi.fn(),
    printJson: vi.fn(),
    bold: (s: string) => s,
    dim: (s: string) => s,
    success: (s: string) => s,
    error: (s: string) => s,
    warning: (s: string) => s,
    info: (s: string) => s,
    highlight: (s: string) => s,
  },
}));

// Mock prompt module
vi.mock('../src/prompt.js', () => ({
  select: vi.fn(),
  confirm: vi.fn(),
  input: vi.fn(),
  multiSelect: vi.fn(),
}));

// Helper to create CommandContext
function createContext(
  args: string[] = [],
  flags: Record<string, unknown> = {}
): CommandContext {
  return {
    args,
    flags: { ...flags },
    interactive: false,
    verbose: false,
    debug: false,
    quiet: false,
    command: 'task',
    rawArgs: [],
    env: {},
    cwd: process.cwd(),
  };
}

describe('Task Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('task create', () => {
    it('should create a task with type and description', async () => {
      const createCmd = taskCommand.subcommands?.find(c => c.name === 'create');
      expect(createCmd).toBeDefined();

      const ctx = createContext([], {
        type: 'bug-fix',
        description: 'Fix authentication bug',
        priority: 'high',
      });

      const result = await createCmd!.action(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.taskId).toBeDefined();
      expect(result.data.type).toBe('bug-fix');
    });

    it('should fail without required parameters', async () => {
      const createCmd = taskCommand.subcommands?.find(c => c.name === 'create');
      expect(createCmd).toBeDefined();

      const ctx = createContext([], {});

      const result = await createCmd!.action(ctx);

      expect(result.success).toBe(false);
    });
  });

  describe('task list', () => {
    it('should list all tasks', async () => {
      const listCmd = taskCommand.subcommands?.find(c => c.name === 'list');
      expect(listCmd).toBeDefined();

      const ctx = createContext([], { all: true });

      const result = await listCmd!.action(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.tasks).toHaveLength(2);
    });

    it('should handle both id and taskId fields in list response', async () => {
      const { callMCPTool } = await import('../src/mcp-client.js');
      (callMCPTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        tasks: [
          {
            taskId: 'task-no-id-123',
            type: 'bug-fix',
            description: 'A task without id field',
            priority: 'normal',
            status: 'pending',
            progress: 0,
            createdAt: '2024-01-01T00:00:00Z',
          },
        ],
        total: 1,
      });

      const listCmd = taskCommand.subcommands?.find(c => c.name === 'list');
      expect(listCmd).toBeDefined();

      const ctx = createContext([], { all: true });

      // Should not throw
      const result = await listCmd!.action(ctx);

      expect(result.success).toBe(true);
    });
  });

  describe('task status', () => {
    it('should get task details by ID', async () => {
      const statusCmd = taskCommand.subcommands?.find(c => c.name === 'status');
      expect(statusCmd).toBeDefined();

      const ctx = createContext(['task-123'], {});

      const result = await statusCmd!.action(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should fail without task ID', async () => {
      const statusCmd = taskCommand.subcommands?.find(c => c.name === 'status');
      expect(statusCmd).toBeDefined();

      const ctx = createContext([], {});

      const result = await statusCmd!.action(ctx);

      expect(result.success).toBe(false);
    });
  });

  describe('task cancel', () => {
    it('should cancel a task', async () => {
      const cancelCmd = taskCommand.subcommands?.find(c => c.name === 'cancel');
      expect(cancelCmd).toBeDefined();

      const ctx = createContext(['task-123'], { force: true });

      const result = await cancelCmd!.action(ctx);

      expect(result.success).toBe(true);
    });
  });

  describe('task assign', () => {
    it('should assign task to agent', async () => {
      const assignCmd = taskCommand.subcommands?.find(c => c.name === 'assign');
      expect(assignCmd).toBeDefined();

      const ctx = createContext(['task-123'], { agent: 'coder-1' });

      const result = await assignCmd!.action(ctx);

      expect(result.success).toBe(true);
    });

    it('should handle assignedTo being undefined', async () => {
      const { callMCPTool } = await import('../src/mcp-client.js');
      (callMCPTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        taskId: 'task-123',
        // assignedTo is undefined
        previouslyAssigned: [],
      });

      const assignCmd = taskCommand.subcommands?.find(c => c.name === 'assign');
      expect(assignCmd).toBeDefined();

      const ctx = createContext(['task-123'], { agent: 'coder-1' });

      // Should not throw
      const result = await assignCmd!.action(ctx);

      expect(result.success).toBe(true);
    });
  });
});

describe('Edge Cases - Issue #958', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not error when tags is undefined', async () => {
    const { callMCPTool } = await import('../src/mcp-client.js');

    // Simulate response with no tags field
    (callMCPTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      taskId: 'task-no-tags',
      type: 'bug-fix',
      description: 'Task without tags',
      priority: 'normal',
      status: 'pending',
      createdAt: new Date().toISOString(),
      assignedTo: [],
      // tags is missing
    });

    const createCmd = taskCommand.subcommands?.find(c => c.name === 'create');
    const ctx = createContext([], {
      type: 'bug-fix',
      description: 'Task without tags',
    });

    // Should not throw
    const result = await createCmd!.action(ctx);
    expect(result.success).toBe(true);
  });

  it('should not error when dependencies/dependents are undefined in status', async () => {
    const { callMCPTool } = await import('../src/mcp-client.js');

    // Simulate response with no dependencies/dependents
    (callMCPTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'task-no-deps',
      taskId: 'task-no-deps',
      type: 'bug-fix',
      description: 'Task without deps',
      status: 'pending',
      progress: 0,
      priority: 'normal',
      assignedTo: [],
      createdAt: '2024-01-01T00:00:00Z',
      startedAt: null,
      completedAt: null,
      // dependencies, dependents, tags, parentId are all missing
    });

    const statusCmd = taskCommand.subcommands?.find(c => c.name === 'status');
    const ctx = createContext(['task-no-deps'], {});

    // Should not throw "Cannot read properties of undefined (reading 'join')"
    const result = await statusCmd!.action(ctx);
    expect(result.success).toBe(true);
  });
});
