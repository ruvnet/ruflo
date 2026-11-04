import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ cwd: '' }));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));
import { taskTools } from '../src/mcp-tools/task-tools.js';
const call = (name: string, input: any): Promise<any> => taskTools.find(t => t.name === name)!.handler(input) as Promise<any>;
const agentsPath = () => join(state.cwd, '.claude-flow/agents/store.json');
const hivePath = () => join(state.cwd, '.claude-flow/agents.json');
const agent = (path = agentsPath()) => JSON.parse(readFileSync(path, 'utf8')).agents.worker;
beforeEach(() => {
  state.cwd = mkdtempSync(join(tmpdir(), 'ruflo-task-create-sync-'));
  mkdirSync(join(state.cwd, '.claude-flow/agents'), { recursive: true });
  const worker = { agentId: 'worker', status: 'idle', currentTask: null, taskCount: 0 };
  writeFileSync(agentsPath(), JSON.stringify({ agents: { worker }, version: '3.0.0' }));
  writeFileSync(hivePath(), JSON.stringify({ agents: { worker } }));
});
afterEach(() => rmSync(state.cwd, { recursive: true, force: true }));

it('task_create with assignTo marks the worker busy in both agent stores', async () => {
  const task = await call('task_create', { type: 'test', description: 'task', assignTo: ['worker'] });
  expect(agent()).toMatchObject({ status: 'busy', currentTask: task.taskId });
  expect(agent(hivePath())).toMatchObject({ status: 'busy', currentTask: task.taskId });
});

it.each(['task_complete', 'task_cancel'])('%s frees a worker assigned at creation', async (name) => {
  const task = await call('task_create', { type: 'test', description: 'task', assignTo: ['worker'] });
  await call(name, { taskId: task.taskId });
  expect(agent()).toMatchObject({ status: 'idle', currentTask: null });
});

it('task_create without assignTo leaves workers alone', async () => {
  await call('task_create', { type: 'test', description: 'task' });
  expect(agent()).toMatchObject({ status: 'idle', currentTask: null });
});

it.each(['worker', [42], [{}]])('task_create refuses assignTo %j that is not an array of agent ids', async (assignTo) => {
  const result = await call('task_create', { type: 'test', description: 'task', assignTo });
  expect(result).toEqual({ success: false, error: 'assignTo must be an array of agent ids' });
  expect(existsSync(join(state.cwd, '.claude-flow/tasks/store.json'))).toBe(false);
  expect(agent()).toMatchObject({ status: 'idle', currentTask: null });
});
