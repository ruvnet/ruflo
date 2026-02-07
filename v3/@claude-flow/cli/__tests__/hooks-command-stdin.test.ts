import { describe, it, expect, beforeEach, vi } from 'vitest';
import { hooksCommand } from '../src/commands/hooks.js';
import type { CommandContext } from '../src/types.js';
import { callMCPTool } from '../src/mcp-client.js';

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
}));

describe('hooks command hook-input fallback', () => {
  const mockedCallMCPTool = vi.mocked(callMCPTool);

  beforeEach(() => {
    mockedCallMCPTool.mockReset();
    mockedCallMCPTool.mockImplementation(async (toolName: string) => {
      if (toolName === 'hooks_pre-edit') {
        return {
          filePath: 'src/new.ts',
          operation: 'create',
          context: {
            fileExists: false,
            fileType: '.ts',
            relatedFiles: [],
            suggestedAgents: [],
            patterns: [],
            risks: [],
          },
          recommendations: [],
        };
      }

      if (toolName === 'hooks_post-edit') {
        return {
          filePath: 'src/edit.ts',
          success: false,
          recorded: true,
          learningUpdates: {
            patternsUpdated: 1,
            confidenceAdjusted: 1,
            newPatterns: 0,
          },
        };
      }

      return {};
    });
  });

  it('uses hook payload json for pre-edit when file flag is empty', async () => {
    const preEdit = hooksCommand.subcommands?.find(cmd => cmd.name === 'pre-edit');
    expect(preEdit).toBeDefined();

    const ctx: CommandContext = {
      args: [],
      flags: {
        _: [],
        format: 'json',
        hookInputJson: JSON.stringify({
          tool_name: 'Write',
          tool_input: { file_path: 'src/new.ts' },
        }),
      },
      cwd: process.cwd(),
      interactive: false,
    };

    const result = await preEdit!.action!(ctx);

    expect(result?.success).toBe(true);
    expect(mockedCallMCPTool).toHaveBeenCalledWith(
      'hooks_pre-edit',
      expect.objectContaining({
        filePath: 'src/new.ts',
        operation: 'create',
      })
    );
  });

  it('uses hook payload json for post-edit success and file when flags are empty', async () => {
    const postEdit = hooksCommand.subcommands?.find(cmd => cmd.name === 'post-edit');
    expect(postEdit).toBeDefined();

    const ctx: CommandContext = {
      args: [],
      flags: {
        _: [],
        format: 'json',
        hookInputJson: JSON.stringify({
          tool_input: { file_path: 'src/edit.ts' },
          tool_success: false,
        }),
      },
      cwd: process.cwd(),
      interactive: false,
    };

    const result = await postEdit!.action!(ctx);

    expect(result?.success).toBe(true);
    expect(mockedCallMCPTool).toHaveBeenCalledWith(
      'hooks_post-edit',
      expect.objectContaining({
        filePath: 'src/edit.ts',
        success: false,
      })
    );
  });
});
