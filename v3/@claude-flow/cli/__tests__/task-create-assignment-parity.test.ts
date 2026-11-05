import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveTargetCommand } from '../src/command-resolution.js';
import { CommandParser } from '../src/parser.js';
const state = vi.hoisted(() => ({ cwd: '' }));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));
vi.mock('../src/mcp-client.js', async () => {
  const { taskTools } = await import('../src/mcp-tools/task-tools.js');
  return { MCPClientError: class extends Error {}, callMCPTool: async (name: string, input: any) => taskTools.find(t => t.name === name)!.handler(input) };
});
import { taskCommand } from '../src/commands/task.js';
afterEach(() => { if (state.cwd) rmSync(state.cwd, { recursive: true, force: true }); });
describe('task create CLI/MCP assignment parity', () => {
  it.each(['agent-one', 'agent-one, agent-two', ''])('persists --assign %s', async (assign) => {
    state.cwd = mkdtempSync(join(tmpdir(), 'ruflo-task-create-'));
    const action = taskCommand.subcommands!.find(c => c.name === 'create')!.action!;
    const result = await action({ args: [], flags: { _: [], type: 'implementation', description: 'Implement feature', assign }, cwd: state.cwd, interactive: false });
    expect(result.success).toBe(true);
    const store = JSON.parse(readFileSync(join(state.cwd, '.claude-flow/tasks/store.json'), 'utf8'));
    expect(Object.values(store.tasks)).toEqual([expect.objectContaining({ assignedTo: assign.split(',').map(s => s.trim()).filter(Boolean) })]);
  });
});

import { taskTools } from '../src/mcp-tools/task-tools.js';

describe('task retry CLI/MCP state parity (#4723)', () => {
  it.each([
    { label: 'explicit retain', options: ['--no-reset-state'], reset: false },
    { label: 'CLI default', options: [], reset: false },
    { label: 'explicit reset', options: ['--reset-state'], reset: true },
    { label: 'MCP default', options: null, reset: true },
  ])('persists the new task and synchronizes assignees with $label', async ({ options, reset }) => {
    state.cwd = mkdtempSync(join(tmpdir(), 'ruflo-task-retry-'));
    const flowDir = join(state.cwd, '.claude-flow');
    mkdirSync(join(flowDir, 'agents'), { recursive: true });
    const agentPaths = [join(flowDir, 'agents', 'store.json'), join(flowDir, 'agents.json')];
    for (const path of agentPaths) {
      writeFileSync(path, JSON.stringify({ agents: { coder: { status: 'idle', currentTask: null } } }));
    }
    const readAgent = (path: string) => JSON.parse(readFileSync(path, 'utf8')).agents.coder;
    const readTasks = () => JSON.parse(readFileSync(join(flowDir, 'tasks', 'store.json'), 'utf8')).tasks;
    const call = async (name: string, input: Record<string, unknown>) => {
      const tool = taskTools.find(candidate => candidate.name === name)!;
      return await tool.handler(input) as { taskId: string; newTaskId: string };
    };
    const { taskId } = await call('task_create', {
      type: 'test', description: 'Persist retry state', assignTo: ['coder'], tags: ['fixture'],
    });
    const savedResult = { partial: 'fixture result' };
    await call('task_update', { taskId, status: 'failed', progress: 42, result: savedResult });
    const original = readTasks()[taskId];
    for (const path of agentPaths) expect(readAgent(path)).toMatchObject({ status: 'idle', currentTask: null });

    let newTaskId: string;
    if (options === null) {
      ({ newTaskId } = await call('task_retry', { taskId }));
    } else {
      const parser = new CommandParser();
      parser.registerCommand(taskCommand);
      const { command, flags, positional } = parser.parse(['task', 'retry', taskId, ...options]);
      const { target, args } = resolveTargetCommand(taskCommand, command, positional);
      expect(parser.validateFlags(flags, target)).toEqual([]);
      const result = await target.action!({ args, flags, cwd: state.cwd, interactive: false });
      expect(result).toMatchObject({ success: true });
      ({ newTaskId } = result.data as { newTaskId: string });
    }

    const tasks = readTasks();
    expect(newTaskId).not.toBe(taskId);
    expect(tasks[taskId]).toEqual(original);
    expect(tasks[newTaskId]).toMatchObject({
      status: 'pending', progress: reset ? 0 : 42, startedAt: null, completedAt: null,
      assignedTo: ['coder'], tags: ['fixture', 'retry-of:' + taskId],
    });
    expect(tasks[newTaskId].result).toEqual(reset ? undefined : savedResult);
    for (const path of agentPaths) {
      expect(readAgent(path)).toMatchObject({ status: 'busy', currentTask: newTaskId });
    }
    await call('task_cancel', { taskId: newTaskId });
    for (const path of agentPaths) expect(readAgent(path)).toMatchObject({ status: 'idle', currentTask: null });
  });
});

it('lists all, running and agent-filtered tasks using the persisted handler contract', async () => {
  state.cwd = mkdtempSync(join(tmpdir(), 'ruflo-task-list-'));
  const call = (name: string, input: any): Promise<any> => taskTools.find(t=>t.name===name)!.handler(input) as Promise<any>;
  const active=await call('task_create',{type:'test',description:'active',assignTo:['alice']});
  const done=await call('task_create',{type:'test',description:'done',assignTo:['bob']});
  await call('task_update',{taskId:active.taskId,status:'in_progress'});
  await call('task_complete',{taskId:done.taskId});
  const action=taskCommand.subcommands!.find(c=>c.name==='list')!.action!;
  const list=async(flags:any)=>{ const r=await action({args:[],flags:{_:[],format:'json',...flags},cwd:state.cwd,interactive:false});return (r.data as any).tasks; };
  expect(await list({})).toEqual([expect.objectContaining({taskId:active.taskId})]);
  expect(await list({status:'running'})).toHaveLength(1);
  expect(await list({all:true})).toHaveLength(2);
  expect(await list({all:true,agent:'bob'})).toEqual([expect.objectContaining({taskId:done.taskId})]);
});
