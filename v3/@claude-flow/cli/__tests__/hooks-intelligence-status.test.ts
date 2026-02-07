import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hooksCommand } from '../src/commands/hooks.js';
import { callMCPTool } from '../src/mcp-client.js';
import { output } from '../src/output.js';
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

describe('hooks intelligence status', () => {
  const mockedCallMCPTool = vi.mocked(callMCPTool);
  const mockedOutput = vi.mocked(output);

  beforeEach(() => {
    mockedCallMCPTool.mockReset();
    mockedOutput.printTable.mockClear();
    mockedOutput.printError.mockClear();

    mockedCallMCPTool.mockImplementation(async (toolName: string) => {
      if (toolName !== 'hooks_intelligence') {
        return {};
      }

      return {
        mode: 'balanced',
        status: 'active',
        components: {
          sona: {
            enabled: true,
            status: 'active',
            learningTimeMs: undefined,
            adaptationTimeMs: undefined,
            trajectoriesRecorded: undefined,
            patternsLearned: undefined,
            avgQuality: undefined,
          },
          moe: {
            enabled: true,
            status: 'active',
            expertsActive: undefined,
            routingAccuracy: undefined,
            loadBalance: undefined,
          },
          hnsw: {
            enabled: false,
            status: 'idle',
            indexSize: undefined,
            searchSpeedup: undefined,
            memoryUsage: undefined,
            dimension: undefined,
          },
          embeddings: {
            provider: 'mock',
            model: 'mock-model',
            dimension: undefined,
            cacheHitRate: undefined,
          },
        },
        performance: {
          flashAttention: '2.8x',
          memoryReduction: '67%',
          searchImprovement: '150x',
          tokenReduction: '32%',
          sweBenchScore: '84.8%',
        },
        lastTrainingMs: undefined,
      };
    });
  });

  it('does not crash and formats undefined component metrics with safe defaults', async () => {
    const intelligenceCommand = hooksCommand.subcommands?.find(cmd => cmd.name === 'intelligence');
    expect(intelligenceCommand).toBeDefined();

    const ctx: CommandContext = {
      args: [],
      flags: {
        _: [],
        status: true,
      },
      cwd: process.cwd(),
      interactive: false,
    };

    const result = await intelligenceCommand!.action!(ctx);

    expect(result.success).toBe(true);
    expect(mockedOutput.printError).not.toHaveBeenCalled();

    const tableCalls = mockedOutput.printTable.mock.calls.map(([arg]) => arg as {
      data?: Array<{ metric: string; value: string }>;
    });

    const sonaTable = tableCalls.find(call => call.data?.some(row => row.metric === 'Learning Time'));
    expect(sonaTable?.data).toEqual(
      expect.arrayContaining([
        { metric: 'Learning Time', value: '0.000ms' },
        { metric: 'Adaptation Time', value: '0.000ms' },
        { metric: 'Avg Quality', value: '0.0%' },
      ])
    );

    const moeTable = tableCalls.find(call => call.data?.some(row => row.metric === 'Routing Accuracy'));
    expect(moeTable?.data).toEqual(
      expect.arrayContaining([
        { metric: 'Active Experts', value: '0' },
        { metric: 'Routing Accuracy', value: '0.0%' },
        { metric: 'Load Balance', value: '0.0%' },
      ])
    );
  });
});
