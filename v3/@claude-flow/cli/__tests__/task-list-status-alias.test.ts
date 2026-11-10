/**
 * task_update accepts the status spellings agents write ("done", "canceled",
 * "running", any case), but task_list compared the filter literally, so
 * `task_list {status: "done"}` returned no tasks even when completed ones
 * existed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { taskTools } from '../src/mcp-tools/task-tools.js';

const tool = (name: string) => {
  const t = taskTools.find(t => t.name === name);
  if (!t) throw new Error(`MCP tool not registered: ${name}`);
  return t;
};

type ListResult = { tasks: Array<{ taskId: string; status: string }>; total: number };

describe('task_list status filter aliases', () => {
  let dir: string;
  let prevCwd: string | undefined;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-task-list-status-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;
    const create = tool('task_create').handler;
    const update = tool('task_update').handler;
    const statuses = ['pending', 'in_progress', 'completed', 'cancelled'];
    for (const status of statuses) {
      const created = await create({ type: 'feature', description: `task ${status}` }) as { taskId: string };
      if (status !== 'pending') await update({ taskId: created.taskId, status });
    }
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  const list = async (status: string) =>
    (await tool('task_list').handler({ status })) as ListResult;

  it.each([
    ['done', 'completed'],
    ['complete', 'completed'],
    ['Completed', 'completed'],
    ['canceled', 'cancelled'],
    ['running', 'in_progress'],
    ['in-progress', 'in_progress'],
  ])('status "%s" lists the %s tasks', async (written, canonical) => {
    const result = await list(written);
    expect(result.tasks.map(t => t.status)).toEqual([canonical]);
    expect(result.total).toBe(1);
  });

  it('resolves each entry of a comma-separated filter', async () => {
    const result = await list('pending, running');
    expect(result.tasks.map(t => t.status).sort()).toEqual(['in_progress', 'pending']);
  });

  it('keeps canonical filters and "all" working as before', async () => {
    expect((await list('completed')).tasks.map(t => t.status)).toEqual(['completed']);
    expect((await list('all')).total).toBe(4);
    expect((await list('bogus')).total).toBe(0);
  });
});
