/**
 * task_summary counted cancelled tasks in `total` but had no field for them,
 * so the per-status counts (and the `status` Tasks table) did not add up.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { taskTools } from '../src/mcp-tools/task-tools.js';
import { systemTools } from '../src/mcp-tools/system-tools.js';

const tool = (name: string) => {
  const t = [...taskTools, ...systemTools].find(t => t.name === name);
  if (!t) throw new Error(`MCP tool not registered: ${name}`);
  return t;
};

type Summary = {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
};

describe('task_summary', () => {
  let dir: string;
  let prevCwd: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-task-summary-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  const create = async () =>
    (await tool('task_create').handler({ type: 'feature', description: 'work' }) as { taskId: string }).taskId;

  it('counts cancelled tasks so the per-status counts add up to total', async () => {
    await create();
    const cancelled = await create();
    const completed = await create();
    await tool('task_cancel').handler({ taskId: cancelled });
    await tool('task_complete').handler({ taskId: completed, result: {} });

    const summary = await tool('task_summary').handler({}) as Summary;
    expect(summary).toMatchObject({ total: 3, pending: 1, completed: 1, cancelled: 1 });
    const { total, ...byStatus } = summary;
    expect(Object.values(byStatus).reduce((a, b) => a + b, 0)).toBe(total);
  });
});
