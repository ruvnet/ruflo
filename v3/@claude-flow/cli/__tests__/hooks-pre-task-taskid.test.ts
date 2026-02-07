import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hooksCommand } from '../src/commands/hooks.js';
import { callMCPTool } from '../src/mcp-client.js';
import type { CommandContext } from '../src/types.js';

vi.mock('../src/mcp-client.js', () => ({
  callMCPTool: vi.fn(),
  MCPClientError: class MCPClientError extends Error {
    constructor(message: string, public toolName: string, public cause?: Error) {
      super(message);
      this.name = 'MCPClientError';
    }
  },
}));

vi.mock('../src/output.js', () => ({
  output: {
    writeln: vi.fn(),
    printInfo: vi.fn(),
    printSuccess: vi.fn(),
    printError: vi.fn(),
    printWarning: vi.fn(),
    printTable: vi.fn(),
    printJson: vi.fn(),
    printList: vi.fn(),
    printBox: vi.fn(),
    createSpinner: vi.fn(() => ({
      start: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
      stop: vi.fn(),
      setText: vi.fn(),
    })),
    highlight: (str: string) => str,
    bold: (str: string) => str,
    dim: (str: string) => str,
    success: (str: string) => str,
    error: (str: string) => str,
    warning: (str: string) => str,
    info: (str: string) => str,
    progressBar: () => '[=====>    ]',
    setColorEnabled: vi.fn(),
  },
}));

vi.mock('../src/prompt.js', () => ({
  select: vi.fn(),
  confirm: vi.fn(),
  input: vi.fn(),
  multiSelect: vi.fn(),
}));

describe('hooks pre-task task-id behavior', () => {
  const mockedCallMCPTool = vi.mocked(callMCPTool);

  beforeEach(() => {
    mockedCallMCPTool.mockReset();
    mockedCallMCPTool.mockImplementation(async (toolName: string, input: Record<string, unknown>) => {
      if (toolName !== 'hooks_pre-task') {
        return {};
      }

      return {
        taskId: input.taskId,
        description: input.description,
        suggestedAgents: [],
        complexity: 'low',
        estimatedDuration: '5m',
        risks: [],
        recommendations: [],
      };
    });
  });

  it('auto-generates task-id when omitted', async () => {
    const preTask = hooksCommand.subcommands?.find(cmd => cmd.name === 'pre-task');
    expect(preTask).toBeDefined();

    const ctx: CommandContext = {
      args: [],
      flags: {
        _: [],
        description: 'Implement feature X',
        format: 'json',
      },
      cwd: process.cwd(),
      interactive: false,
    };

    const result = await preTask!.action!(ctx);
    expect(result.success).toBe(true);

    const callArgs = mockedCallMCPTool.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(callArgs.taskId).toEqual(expect.stringMatching(/^task_\d+_[a-z0-9]{6}$/));
  });

  it('preserves explicit task-id when provided', async () => {
    const preTask = hooksCommand.subcommands?.find(cmd => cmd.name === 'pre-task');
    expect(preTask).toBeDefined();

    const ctx: CommandContext = {
      args: [],
      flags: {
        _: [],
        taskId: 'task-explicit-123',
        description: 'Fix auth bug',
        format: 'json',
      },
      cwd: process.cwd(),
      interactive: false,
    };

    const result = await preTask!.action!(ctx);
    expect(result.success).toBe(true);
    expect(mockedCallMCPTool).toHaveBeenCalledWith(
      'hooks_pre-task',
      expect.objectContaining({
        taskId: 'task-explicit-123',
        description: 'Fix auth bug',
      })
    );
  });
});
