import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ cwd: '' }));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));
import { taskTools } from '../src/mcp-tools/task-tools.js';
const call = (name: string, input: any): Promise<any> => taskTools.find(t => t.name === name)!.handler(input) as Promise<any>;
const agentsPath = () => join(state.cwd, '.claude-flow/agents/store.json');
const agent = (id: string) => JSON.parse(readFileSync(agentsPath(), 'utf8')).agents[id];
beforeEach(() => {
  state.cwd = mkdtempSync(join(tmpdir(), 'ruflo-task-credit-'));
  mkdirSync(join(state.cwd, '.claude-flow/agents'), { recursive: true });
  writeFileSync(agentsPath(), JSON.stringify({ agents: {
    a1: { agentId: 'a1', status: 'idle', currentTask: null, taskCount: 0 },
  } }));
});
afterEach(() => rmSync(state.cwd, { recursive: true, force: true }));

it('task_complete credits the worker holding the task', async () => {
  const { taskId } = await call('task_create', { type: 'test', description: 'task', assignTo: ['a1'] });
  await call('task_complete', { taskId });
  expect(agent('a1')).toMatchObject({ status: 'idle', currentTask: null, taskCount: 1 });
});

it('completing a reopened task again does not count the same work twice', async () => {
  const { taskId } = await call('task_create', { type: 'test', description: 'task', assignTo: ['a1'] });
  await call('task_complete', { taskId });
  await call('task_update', { taskId, status: 'pending' });
  await call('task_complete', { taskId });
  expect(agent('a1').taskCount).toBe(1);
});

