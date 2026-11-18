import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ cwd: '' }));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));
import { taskTools } from '../src/mcp-tools/task-tools.js';
const call = (name: string, input: any): Promise<any> => taskTools.find(t => t.name === name)!.handler(input) as Promise<any>;
const stored = (id: string) => JSON.parse(readFileSync(join(state.cwd, '.claude-flow/tasks/store.json'), 'utf8')).tasks[id];
beforeEach(() => { state.cwd = mkdtempSync(join(tmpdir(), 'ruflo-task-reopen-')); });
afterEach(() => rmSync(state.cwd, { recursive: true, force: true }));

it.each([
  ['completed', 'pending'],
  ['completed', 'in_progress'],
  ['failed', 'in_progress'],
  ['cancelled', 'pending'],
])('reopening a %s task as %s clears completedAt', async (finished, reopened) => {
  const { taskId } = await call('task_create', { type: 'test', description: 'task' });
  await call('task_update', { taskId, status: finished });
  expect(stored(taskId).completedAt).toEqual(expect.any(String));

  await call('task_update', { taskId, status: reopened });
  expect(stored(taskId)).toMatchObject({ status: reopened, completedAt: null });
  expect((await call('task_status', { taskId })).completedAt).toBeNull();
});

it('finishing the reopened task records a new completedAt', async () => {
  const { taskId } = await call('task_create', { type: 'test', description: 'task' });
  await call('task_update', { taskId, status: 'completed' });
  await call('task_update', { taskId, status: 'pending' });
  await call('task_update', { taskId, status: 'completed' });
  expect(stored(taskId)).toMatchObject({ status: 'completed', progress: 100 });
  expect(stored(taskId).completedAt).toEqual(expect.any(String));
});

it('a progress-only update leaves a finished task completedAt alone', async () => {
  const { taskId } = await call('task_create', { type: 'test', description: 'task' });
  await call('task_update', { taskId, status: 'failed' });
  const { completedAt } = stored(taskId);
  await call('task_update', { taskId, progress: 30 });
  expect(stored(taskId).completedAt).toBe(completedAt);
});
