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
  workspace = mkdtempSync(join(tmpdir(), 'start-config-topology-'));
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

function writeConfig(topology?: string): void {
  const configPath = join(workspace, '.claude-flow', 'config.yaml');
  const topologyLine = topology === undefined ? '' : `  topology: ${topology}\n`;
  writeFileSync(configPath, `swarm:
${topologyLine}  maxAgents: 15
  autoScale: true
  coordinationStrategy: consensus

mcp:
  autoStart: false
  port: 3000
`);
  expect(existsSync(configPath)).toBe(true);
}

async function expectSwarmTopology(expected: string, flags: CommandContext['flags'] = { _: [] }) {
  const result = await startCommand.action!({
    args: [],
    flags,
    cwd: workspace,
    interactive: false,
  });

  expect(result.success).toBe(true);
  const swarmInitCalls = mocks.callMCPTool.mock.calls.filter(([name]) => name === 'swarm_init');
  expect(swarmInitCalls).toHaveLength(1);
  expect(swarmInitCalls[0][1]).toMatchObject({ topology: expected });
}

describe('start config topology precedence', () => {
  it('uses the configured swarm topology when --topology is omitted', async () => {
    writeConfig('mesh');

    await expectSwarmTopology('mesh');
  });

  it('lets an explicit --topology override the configured swarm topology', async () => {
    writeConfig('mesh');

    await expectSwarmTopology('ring', { _: [], topology: 'ring' });
  });

  it('uses the default topology when neither the flag nor config provides one', async () => {
    writeConfig();

    await expectSwarmTopology('hierarchical-mesh');
  });
});
