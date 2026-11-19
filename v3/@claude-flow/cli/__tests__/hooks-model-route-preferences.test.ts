import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const route = vi.hoisted(() => vi.fn());
vi.mock('../src/ruvector/model-router.js', () => ({
  getModelRouter: () => ({ route }),
}));
vi.mock('../src/mcp-client.js', () => ({
  callMCPTool: vi.fn(),
  MCPClientError: class extends Error {},
}));

import { hooksModelRoute } from '../src/mcp-tools/hooks-tools.js';
import { hooksCommand } from '../src/commands/hooks.js';
import { callMCPTool } from '../src/mcp-client.js';
import { CommandParser } from '../src/parser.js';
import { output } from '../src/output.js';

beforeEach(() => {
  route.mockReset().mockResolvedValue({ model: 'sonnet', complexity: 0.3, confidence: 0.8 });
  vi.mocked(callMCPTool).mockReset().mockResolvedValue({ model: 'sonnet' });
  vi.spyOn(output, 'printInfo').mockImplementation(() => {});
  vi.spyOn(output, 'printJson').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('hooks model-route preferences through MCP and CLI (#4722)', () => {
  it('forwards boolean MCP preferences per request without changing singleton defaults', async () => {
    await hooksModelRoute.handler({ task: 'add extra feature', preferCost: true, preferSpeed: false });
    await hooksModelRoute.handler({ task: 'refactor module', preferCost: false, preferSpeed: true });
    await hooksModelRoute.handler({ task: 'fix a typo' });
    expect(route.mock.calls).toEqual([
      ['add extra feature', undefined, { preferCost: true, preferSpeed: false }],
      ['refactor module', undefined, { preferCost: false, preferSpeed: true }],
      ['fix a typo', undefined, { preferCost: undefined, preferSpeed: undefined }],
    ]);
  });

  it.each([
    [['--prefer-cost', '--prefer-speed'], true, true],
    [['--no-prefer-cost', '--no-prefer-speed'], false, false],
  ])('forwards normalized CLI flags %j using MCP preference names', async (flags, preferCost, preferSpeed) => {
    const parser = new CommandParser();
    parser.registerCommand(hooksCommand);
    const parsed = parser.parse(['hooks', 'model-route', '--task', 'add extra feature', '--format', 'json', ...flags]);
    const command = hooksCommand.subcommands!.find(command => command.name === 'model-route')!;
    const result = await command.action!({ args: [], flags: parsed.flags, cwd: process.cwd(), interactive: false });
    expect(result?.success).toBe(true);
    expect(callMCPTool).toHaveBeenCalledWith('hooks_model-route', {
      task: 'add extra feature', context: undefined, preferCost, preferSpeed,
    });
  });
});
