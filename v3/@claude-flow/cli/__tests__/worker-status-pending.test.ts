/**
 * hooks_worker-status counted pending workers in `summary.total` but had no
 * field for them, so the per-status counts did not add up. A dispatched
 * worker stays `pending` in-process when no daemon is running or when it is
 * queued for the daemon.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hooksTools } from '../src/mcp-tools/hooks-tools.js';

const tool = (name: string) => {
  const t = hooksTools.find(t => t.name === name);
  if (!t) throw new Error(`MCP tool not registered: ${name}`);
  return t;
};

type Summary = { total: number; pending: number; running: number; completed: number; failed: number };

describe('hooks_worker-status', () => {
  let dir: string;
  let prevCwd: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-worker-status-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  it('counts pending workers so the per-status counts add up to total', async () => {
    const before = (await tool('hooks_worker-status').handler({}) as { summary: Summary }).summary;
    // No daemon runs in the temp project, so each dispatch is recorded as pending.
    await tool('hooks_worker-dispatch').handler({ trigger: 'map', context: 'src' });
    const cancelled = await tool('hooks_worker-dispatch').handler({ trigger: 'audit', context: 'src' }) as { workerId: string };
    await tool('hooks_worker-cancel').handler({ workerId: cancelled.workerId });

    const { summary } = await tool('hooks_worker-status').handler({}) as { summary: Summary };
    expect(summary.total).toBe(before.total + 2);
    expect(summary.pending).toBe((before.pending ?? 0) + 1);
    expect(summary.failed).toBe(before.failed + 1);
    expect(summary.pending + summary.running + summary.completed + summary.failed).toBe(summary.total);
  });
});
