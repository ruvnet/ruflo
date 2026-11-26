import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandContext } from '../src/types.js';

const mocks = vi.hoisted(() => ({
  callMCPTool: vi.fn(),
}));

vi.mock('../src/mcp-client.js', () => ({
  callMCPTool: mocks.callMCPTool,
  MCPClientError: class MCPClientError extends Error {},
}));

vi.mock('../src/output.js', () => ({
  output: new Proxy({}, {
    get: (_target, name) => name === 'createSpinner'
      ? () => ({ start() {}, succeed() {}, fail() {}, setText() {} })
      : (value: unknown) => value,
  }),
}));

import { startCommand } from '../src/commands/start.js';

let workspace: string;

beforeEach(() => {
  vi.clearAllMocks();
  workspace = mkdtempSync(join(tmpdir(), 'start-config-crlf-'));
  mkdirSync(join(workspace, '.claude-flow'));
  mocks.callMCPTool.mockImplementation(async (name: string, input: Record<string, unknown>) => {
    if (name === 'swarm_init') {
      return {
        swarmId: 'test-swarm',
        topology: input.topology,
        initializedAt: new Date().toISOString(),
        config: {},
      };
    }
    if (name === 'swarm_health') return { status: 'healthy', checks: [] };
    throw new Error(`Unexpected MCP tool: ${name}`);
  });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const config = `swarm:
  topology: mesh
  maxAgents: 6

mcp:
  autoStart: false
`;

describe.each([
  ['LF', config],
  ['CRLF', config.replace(/\n/g, '\r\n')],
])('start reads a %s config.yaml', (_name, content) => {
  it('uses its swarm settings', async () => {
    const configPath = join(workspace, '.claude-flow', 'config.yaml');
    writeFileSync(configPath, content);
    expect(existsSync(configPath)).toBe(true);

    const result = await startCommand.action!({
      args: [],
      flags: { _: [] },
      cwd: workspace,
      interactive: false,
    });

    expect(result.success).toBe(true);
    const swarmInitCalls = mocks.callMCPTool.mock.calls.filter(([name]) => name === 'swarm_init');
    expect(swarmInitCalls).toHaveLength(1);
    expect(swarmInitCalls[0][1]).toMatchObject({ topology: 'mesh', maxAgents: 6 });
  });
});
