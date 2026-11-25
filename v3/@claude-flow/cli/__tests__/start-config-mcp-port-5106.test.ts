import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandContext } from '../src/types.js';
import { CommandParser } from '../src/parser.js';

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
  workspace = mkdtempSync(join(tmpdir(), 'start-config-mcp-port-'));
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
    if (name === 'mcp_start') {
      return {
        serverId: 'test-mcp',
        port: input.port,
        transport: input.transport,
        startedAt: new Date().toISOString(),
      };
    }
    if (name === 'swarm_health') return { status: 'healthy', checks: [] };
    throw new Error(`Unexpected MCP tool: ${name}`);
  });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function writeConfig(portLine = ''): void {
  const configPath = join(workspace, '.claude-flow', 'config.yaml');
  writeFileSync(configPath, `mcp:\n  autoStart: true\n${portLine}`);
  expect(existsSync(configPath)).toBe(true);
}

async function expectMcpPort(expected: number, flags: CommandContext['flags'] = { _: [] }) {
  const result = await startCommand.action!({
    args: [],
    flags,
    cwd: workspace,
    interactive: false,
  });

  expect(result.success).toBe(true);
  const mcpStartCalls = mocks.callMCPTool.mock.calls.filter(([name]) => name === 'mcp_start');
  expect(mcpStartCalls).toHaveLength(1);
  expect(mcpStartCalls[0][1]).toMatchObject({ port: expected });
}

describe('start config MCP port precedence', () => {
  it('uses the configured mcp.port when --port is omitted by the parser', async () => {
    writeConfig('  port: 3100\n');
    const parser = new CommandParser();
    parser.registerCommand(startCommand);
    const { flags } = parser.parse(['start']);

    await expectMcpPort(3100, flags);
    expect(flags.port).toBeUndefined();
  });

  it('lets an explicit --port override the configured mcp.port', async () => {
    writeConfig('  port: 3100\n');
    const parser = new CommandParser();
    parser.registerCommand(startCommand);
    const { flags } = parser.parse(['start', '--port', '3200']);

    await expectMcpPort(3200, flags);
  });

  it('prefers mcp.port over mcp.serverPort', async () => {
    writeConfig('  port: 3100\n  serverPort: 3300\n');

    await expectMcpPort(3100);
  });

  it('uses the default port when neither the flag nor config provides one', async () => {
    writeConfig();

    await expectMcpPort(3000);
  });

  it('ignores a non-numeric mcp.port value', async () => {
    writeConfig('  port:\n');

    await expectMcpPort(3000);
  });

  it('keeps mcp.serverPort as a fallback for existing configs', async () => {
    writeConfig('  serverPort: 3300\n');

    await expectMcpPort(3300);
  });
});
