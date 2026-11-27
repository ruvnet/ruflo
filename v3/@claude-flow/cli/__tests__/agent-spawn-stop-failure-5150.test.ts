import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mcp = vi.hoisted(() => ({ callMCPTool: vi.fn() }));

vi.mock('../src/mcp-client.js', () => ({
  callMCPTool: mcp.callMCPTool,
  MCPClientError: class extends Error {},
}));

vi.mock('../src/funnel/activation.js', () => ({
  noteFirstAgentRun: vi.fn(),
}));

import { agentCommand } from '../src/commands/agent.js';
import { output } from '../src/output.js';
import type { CommandContext } from '../src/types.js';

const spawnCommand = agentCommand.subcommands!.find((command) => command.name === 'spawn')!;
const stopCommand = agentCommand.subcommands!.find((command) => command.name === 'stop')!;

describe('agent spawn and stop tool-reported failures', () => {
  let projectRoot: string;
  let previousCwd: string;
  let activityPath: string;

  beforeEach(() => {
    previousCwd = process.cwd();
    projectRoot = mkdtempSync(join(tmpdir(), 'ruflo-agent-failure-'));
    process.chdir(projectRoot);

    const metricsDir = join(projectRoot, '.claude-flow', 'metrics');
    mkdirSync(metricsDir, { recursive: true });
    activityPath = join(metricsDir, 'swarm-activity.json');
    writeFileSync(activityPath, JSON.stringify({ swarm: { agent_count: 2 } }));

    vi.spyOn(output, 'writeln').mockImplementation(() => {});
    vi.spyOn(output, 'printInfo').mockImplementation(() => {});
    vi.spyOn(output, 'printSuccess').mockImplementation(() => {});
    vi.spyOn(output, 'printError').mockImplementation(() => {});
    vi.spyOn(output, 'printJson').mockImplementation(() => {});
    vi.spyOn(output, 'printTable').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(previousCwd);
    rmSync(projectRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
    mcp.callMCPTool.mockReset();
  });

  const stopContext = (
    agentId: string,
    flags: Record<string, unknown> = { force: true, _: [] },
  ): CommandContext => ({
    args: [agentId],
    flags,
    cwd: process.cwd(),
    interactive: false,
  });

  const spawnContext = (): CommandContext => ({
    args: [],
    flags: { type: 'coder', name: 'coder-1', _: [] },
    cwd: process.cwd(),
    interactive: false,
  });

  const readAgentCount = (): number => {
    expect(existsSync(activityPath), `Expected metrics file at ${activityPath}`).toBe(true);
    const activity = JSON.parse(readFileSync(activityPath, 'utf-8')) as {
      swarm: { agent_count: number };
    };
    return activity.swarm.agent_count;
  };

  it('returns exit 1 for a forced stop failure without reporting success or decrementing metrics', async () => {
    const agentId = 'missing-agent';
    mcp.callMCPTool.mockResolvedValue({ success: false, agentId, error: 'Agent not found' });

    const result = await stopCommand.action!(stopContext(agentId));

    expect(result).toMatchObject({ success: false, exitCode: 1 });
    expect(readAgentCount()).toBe(2);
    expect(output.printError).toHaveBeenCalledWith('Failed to stop agent: Agent not found');
    expect(output.printSuccess).not.toHaveBeenCalledWith(expect.stringContaining('stopped successfully'));
  });

  it('does not write graceful-shutdown progress for a non-forced stop failure', async () => {
    const agentId = 'missing-agent';
    mcp.callMCPTool.mockResolvedValue({ success: false, agentId, error: 'Agent not found' });

    const result = await stopCommand.action!(stopContext(agentId, { force: false, _: [] }));

    expect(result).toMatchObject({ success: false, exitCode: 1 });
    expect(output.writeln).not.toHaveBeenCalledWith(expect.stringContaining('Completing current task'));
    expect(output.writeln).not.toHaveBeenCalledWith(expect.stringContaining('Saving state'));
    expect(output.writeln).not.toHaveBeenCalledWith(expect.stringContaining('Releasing resources'));
  });

  it('prints the stop failure result in JSON format', async () => {
    const failure = { success: false, agentId: 'missing-agent', error: 'Agent not found' };
    mcp.callMCPTool.mockResolvedValue(failure);

    const result = await stopCommand.action!(
      stopContext(failure.agentId, { force: true, format: 'json', _: [] }),
    );

    expect(result).toMatchObject({ success: false, exitCode: 1 });
    expect(output.printJson).toHaveBeenCalledWith(failure);
  });

  it('keeps the successful stop path and decrements metrics from 2 to 1', async () => {
    const agentId = 'active-agent';
    mcp.callMCPTool.mockResolvedValue({
      success: true,
      agentId,
      terminated: true,
      terminatedAt: '2026-11-27T00:00:00.000Z',
    });

    const result = await stopCommand.action!(stopContext(agentId));

    expect(result).toMatchObject({ success: true });
    expect(readAgentCount()).toBe(1);
  });

  it('returns exit 1 for a spawn failure without rendering success or incrementing metrics', async () => {
    mcp.callMCPTool.mockResolvedValue({
      success: false,
      error: 'Swarm swarm-x is full (1/1 agents)',
    });

    const result = await spawnCommand.action!(spawnContext());

    expect(result).toMatchObject({ success: false, exitCode: 1 });
    expect(readAgentCount()).toBe(2);
    expect(output.printError).toHaveBeenCalledWith(
      'Failed to spawn agent: Swarm swarm-x is full (1/1 agents)',
    );
    expect(output.printSuccess).not.toHaveBeenCalledWith(expect.stringContaining('spawned successfully'));
    expect(output.printTable).not.toHaveBeenCalled();
  });

  it('keeps the successful spawn path and increments metrics from 2 to 3', async () => {
    mcp.callMCPTool.mockResolvedValue({
      success: true,
      agentId: 'coder-1',
      agentType: 'coder',
      status: 'active',
      createdAt: '2026-11-27T00:00:00.000Z',
    });

    const result = await spawnCommand.action!(spawnContext());

    expect(result).toMatchObject({ success: true });
    expect(readAgentCount()).toBe(3);
  });
});
