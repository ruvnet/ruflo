import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  mcp: vi.fn(),
  checkUpdates: vi.fn(async () => ({ results: [] })),
  router: { initialize: vi.fn(), update: vi.fn(() => 0.1), saveModel: vi.fn(async () => true) },
  wasmCreate: vi.fn(async () => ({ id: 'created' })),
  wasmPrompt: vi.fn(async () => 'response'),
  table: vi.fn(),
}));
vi.mock('../src/mcp-client.js', () => ({ callMCPTool: mocks.mcp, MCPClientError: class extends Error {} }));
vi.mock('../src/output.js', () => ({ output: new Proxy({}, {
  get: (_target, name) => name === 'printTable' ? mocks.table
    : name === 'createSpinner' ? () => ({ start() {}, stop() {}, succeed() {}, fail() {}, setText() {} })
    : (value: unknown) => value,
}) }));
vi.mock('../src/ruvector/index.js', () => ({ createQLearningRouter: () => mocks.router }));
vi.mock('../src/ruvector/agent-wasm.js', () => ({
  isAgentWasmAvailable: async () => true,
  createWasmAgent: mocks.wasmCreate,
  promptWasmAgent: mocks.wasmPrompt,
}));
vi.mock('../src/update/checker.js', () => ({
  DEFAULT_CONFIG: {}, checkForUpdates: mocks.checkUpdates,
}));
vi.mock('../src/ruvector/graph-analyzer.js', () => ({
  analyzeGraph: async () => ({
    statistics: {},
    communities: [{ id: 'small', members: ['a', 'b'] }, { id: 'large', members: ['c', 'd', 'e'] }],
  }),
}));
vi.mock('../src/services/worker-daemon.js', () => ({
  getDaemon: () => ({ getStatus: () => ({
    running: false, workers: new Map(), config: {
      workers: [], ttlMs: 0, resourceThresholds: { maxCpuLoad: 2, minFreeMemoryPercent: 5 },
    },
  }) }),
}));

import { CommandParser } from '../src/parser.js';
import { statusCommand } from '../src/commands/status.js';
import { startCommand } from '../src/commands/start.js';
import { routeCommand } from '../src/commands/route.js';
import updateCommand from '../src/commands/update.js';
import { analyzeCommand } from '../src/commands/analyze.js';
import { daemonCommand } from '../src/commands/daemon.js';
import { wasmCreateCommand, wasmPromptCommand } from '../src/commands/agent-wasm.js';
import type { Command } from '../src/types.js';

let workspace: string;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CLAUDE_FLOW_FORCE_UPDATE', undefined);
  workspace = mkdtempSync(join(tmpdir(), 'single-command-flags-'));
  mkdirSync(join(workspace, '.claude-flow'));
  writeFileSync(join(workspace, '.claude-flow', 'config.yaml'), 'mcp:\n  autoStart: true\n');
  mocks.mcp.mockImplementation(async (name: string) => {
    if (name === 'swarm_init') return { swarmId: 'test' };
    if (name === 'swarm_health') return { status: 'healthy', checks: [] };
    if (name === 'mcp_start') return { success: true };
    throw new Error('not running');
  });
});
afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function run(command: Command, path: string[], argv: string[]) {
  const parser = new CommandParser();
  parser.registerCommand(command);
  const parsed = parser.parse([command.name, ...path, ...argv, '--format', 'json']);
  const target = path.reduce((parent, name) => parent.subcommands!.find(sub => sub.name === name)!, command);
  return target.action!({ args: parsed.positional, flags: parsed.flags, cwd: workspace, interactive: false });
}

describe('single command flags through the real parser', () => {
  it('status --health-check returns failed checks for a stopped system', async () => {
    expect(await run(statusCommand, [], ['--health-check'])).toMatchObject({
      success: false, data: { summary: { failed: 1 } },
    });
    expect(await run(statusCommand, [], [])).toMatchObject({ success: true });
  });

  it('start --skip-mcp avoids starting MCP', async () => {
    expect(await run(startCommand, [], ['--skip-mcp'])).toMatchObject({ success: true, data: { mcp: null } });
    expect(mocks.mcp.mock.calls.map(call => call[0])).not.toContain('mcp_start');
    await run(startCommand, [], []);
    expect(mocks.mcp.mock.calls.map(call => call[0])).toContain('mcp_start');
  });

  it('route feedback passes --next-task to the learner', async () => {
    await run(routeCommand, ['feedback'], ['--task', 'first', '--agent', 'coder', '--reward', '0.5', '--next-task', 'second']);
    expect(mocks.router.update).toHaveBeenCalledWith('first', 'coder', 0.5, 'second');
  });

  it('update all includes major updates only when requested', async () => {
    await run(updateCommand, ['all'], ['--include-major']);
    expect(mocks.checkUpdates).toHaveBeenLastCalledWith(expect.objectContaining({ autoUpdate: { patch: true, minor: true, major: true } }));
    await run(updateCommand, ['all'], []);
    expect(mocks.checkUpdates).toHaveBeenLastCalledWith(expect.objectContaining({ autoUpdate: { patch: true, minor: true, major: false } }));
  });

  it('analyze modules applies --min-size', async () => {
    expect(await run(analyzeCommand, ['modules'], ['--min-size', '3'])).toMatchObject({
      success: true, data: { communities: [{ id: 'large' }] },
    });
  });

  it('daemon status includes execution-mode columns for --show-modes', async () => {
    await run(daemonCommand, ['status'], ['--show-modes']);
    expect(mocks.table).toHaveBeenCalledWith(expect.objectContaining({
      columns: expect.arrayContaining([expect.objectContaining({ key: 'mode' }), expect.objectContaining({ key: 'sandbox' })]),
    }));
  });

  it('wasm-create passes --max-turns to the agent', async () => {
    await run(wasmCreateCommand, [], ['--max-turns', '7']);
    expect(mocks.wasmCreate).toHaveBeenCalledWith(expect.objectContaining({ maxTurns: 7 }));
  });

  it.each(['--agent-id', '-a'])('wasm-prompt reads %s', async flag => {
    await run(wasmPromptCommand, [], [flag, 'agent-123', '--input', 'hello']);
    expect(mocks.wasmPrompt).toHaveBeenCalledWith('agent-123', 'hello');
  });
});
