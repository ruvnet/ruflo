/**
 * task_assign accepted a completed or cancelled task (the agent stayed busy,
 * because task_complete and task_cancel will not release it) and accepted an
 * agent id that is not in either agent store (the task went in_progress with
 * a ghost owner). #4725.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The assign command is a thin wrapper. Mock the MCP client so loading it does
// not pull the full tool graph, and dispatch task tools to the real handlers.
vi.mock('../src/mcp-client.js', async () => {
  const { taskTools } = await import('../src/mcp-tools/task-tools.js');
  return {
    MCPClientError: class MCPClientError extends Error {},
    callMCPTool: async (name: string, input: Record<string, unknown>) => {
      const found = taskTools.find(t => t.name === name);
      if (!found) throw new Error(`MCP tool not registered: ${name}`);
      return found.handler(input);
    },
  };
});

import { taskTools } from '../src/mcp-tools/task-tools.js';
import { taskCommand } from '../src/commands/task.js';
import { output } from '../src/output.js';
import type { CommandContext } from '../src/types.js';

const tool = (name: string) => {
  const found = taskTools.find(t => t.name === name);
  if (!found) throw new Error(`MCP tool not registered: ${name}`);
  return found;
};

const assignCommand = taskCommand.subcommands!.find(c => c.name === 'assign')!;

type AssignResult = { success?: boolean; taskId?: string; status?: string; assignedTo?: string[]; error?: string };
type StatusResult = { status: string; assignedTo: string[]; result?: unknown; completedAt: string | null };

describe('task_assign validation', () => {
  let dir: string;
  let prevCwd: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-task-assign-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;
    vi.spyOn(output, 'writeln').mockImplementation(() => {});
    vi.spyOn(output, 'printSuccess').mockImplementation(() => {});
    vi.spyOn(output, 'printError').mockImplementation(() => {});
    vi.spyOn(output, 'printJson').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  const create = async () =>
    (await tool('task_create').handler({ type: 'feature', description: 'work' }) as { taskId: string }).taskId;

  const assign = (taskId: string, agentIds: string[]) =>
    tool('task_assign').handler({ taskId, agentIds }) as Promise<AssignResult>;

  const status = (taskId: string) =>
    tool('task_status').handler({ taskId }) as Promise<StatusResult>;

  const agentsPath = () => join(dir, '.claude-flow/agents/store.json');
  const hivePath = () => join(dir, '.claude-flow/agents.json');

  function writeAgents(agents: Record<string, Record<string, unknown>>, file: 'canonical' | 'hive' = 'canonical') {
    const path = file === 'canonical' ? agentsPath() : hivePath();
    mkdirSync(join(dir, '.claude-flow', file === 'canonical' ? 'agents' : ''), { recursive: true });
    writeFileSync(path, JSON.stringify({ agents, version: '3.0.0' }));
  }

  const storedAgent = (id: string, file: 'canonical' | 'hive' = 'canonical') => {
    const path = file === 'canonical' ? agentsPath() : hivePath();
    return JSON.parse(readFileSync(path, 'utf8')).agents[id] as Record<string, unknown>;
  };

  const idleWorker = { agentId: 'worker', status: 'idle', currentTask: null, taskCount: 0 };

  it('refuses a completed task and leaves the agent idle', async () => {
    const taskId = await create();
    writeAgents({ worker: { ...idleWorker } });
    await assign(taskId, ['worker']);
    await tool('task_complete').handler({ taskId, result: { answer: 42 } });
    const before = await status(taskId);

    const result = await assign(taskId, ['worker']);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Cannot assign a completed task');
    expect(storedAgent('worker')).toMatchObject({ status: 'idle', currentTask: null, taskCount: 1 });
    const after = await status(taskId);
    expect(after.status).toBe('completed');
    expect(after.assignedTo).toEqual(['worker']);
    expect(after.result).toEqual({ answer: 42 });
    expect(after.completedAt).toBe(before.completedAt);
  });

  it('refuses a cancelled task and does not mark the agent busy', async () => {
    const taskId = await create();
    writeAgents({ worker: { ...idleWorker } });
    await tool('task_cancel').handler({ taskId, reason: 'no longer needed' });

    const result = await assign(taskId, ['worker']);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Cannot assign a cancelled task');
    expect(storedAgent('worker')).toMatchObject({ status: 'idle', currentTask: null, taskCount: 0 });
    const after = await status(taskId);
    expect(after.status).toBe('cancelled');
    expect(after.assignedTo).toEqual([]);
  });

  it('refuses to unassign a completed task', async () => {
    const taskId = await create();
    writeAgents({ worker: { ...idleWorker } });
    await assign(taskId, ['worker']);
    await tool('task_complete').handler({ taskId });

    const result = await tool('task_assign').handler({ taskId, unassign: true }) as AssignResult;

    expect(result.success).toBe(false);
    expect(result.error).toBe('Cannot assign a completed task');
    expect((await status(taskId)).assignedTo).toEqual(['worker']);
  });

  it('refuses an agent id that is not in either agent store', async () => {
    const taskId = await create();
    writeAgents({ worker: { ...idleWorker } });

    const result = await assign(taskId, ['ghost-agent']);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Agent not found: ghost-agent');
    expect(storedAgent('worker')).toMatchObject({ status: 'idle', currentTask: null });
    expect(storedAgent('ghost-agent')).toBeUndefined();
    const after = await status(taskId);
    expect(after.status).toBe('pending');
    expect(after.assignedTo).toEqual([]);
  });

  it('does not assign anyone when one of the ids is unknown', async () => {
    const taskId = await create();
    writeAgents({ worker: { ...idleWorker } });
    await assign(taskId, ['worker']);

    const result = await assign(taskId, ['worker', 'ghost-agent']);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Agent not found: ghost-agent');
    expect(storedAgent('worker')).toMatchObject({ status: 'busy', currentTask: taskId });
    const after = await status(taskId);
    expect(after.status).toBe('in_progress');
    expect(after.assignedTo).toEqual(['worker']);
  });

  it('names every missing agent', async () => {
    const taskId = await create();
    const result = await assign(taskId, ['ghost-a', 'ghost-b']);
    expect(result).toMatchObject({
      success: false,
      error: 'Agents not found: ghost-a, ghost-b',
    });
    expect(existsSync(agentsPath())).toBe(false);
    expect((await status(taskId)).status).toBe('pending');
  });

  it('assigns a hive-mind worker recorded only in agents.json', async () => {
    const taskId = await create();
    writeAgents({
      'hive-worker-1': { agentId: 'hive-worker-1', status: 'idle', currentTask: null, taskCount: 0 },
    }, 'hive');

    const result = await assign(taskId, ['hive-worker-1']);

    expect(result.success).toBeUndefined();
    expect(result.status).toBe('in_progress');
    expect(result.assignedTo).toEqual(['hive-worker-1']);
    expect(storedAgent('hive-worker-1', 'hive')).toMatchObject({ status: 'busy', currentTask: taskId });
  });

  it('task assign exits 1 and prints the refusal', async () => {
    const taskId = await create();
    await tool('task_complete').handler({ taskId });
    const printError = vi.mocked(output.printError);
    const ctx = { args: [taskId], flags: { agent: 'worker' }, cwd: dir, interactive: false } as unknown as CommandContext;

    const result = await assignCommand.action!(ctx);

    expect(result?.success).toBe(false);
    expect(result?.exitCode).toBe(1);
    expect(printError).toHaveBeenCalledWith(`Failed to assign task ${taskId}: Cannot assign a completed task`);
    expect(output.printSuccess).not.toHaveBeenCalled();
  });
});
