/**
 * Coverage for MCP tools that had no tests (ruvnet/ruflo#4767).
 *
 * Store-backed tools run against a throwaway project directory (set through
 * CLAUDE_FLOW_CWD) so nothing touches the real .claude-flow state.
 * `swarm_exists` is not a registered MCP tool: it is a check name inside
 * `swarm_health`, so it is covered through that tool.
 * `progress_sync` is left out: it scans the whole repo and writes to the real
 * repo root (PROJECT_ROOT is not read from CLAUDE_FLOW_CWD), so it cannot run
 * hermetically in a unit test.
 * `memory_compress` is left out: it needs an initialized memory database.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { taskTools } from '../src/mcp-tools/task-tools.js';
import { sessionTools } from '../src/mcp-tools/session-tools.js';
import { systemTools } from '../src/mcp-tools/system-tools.js';
import { policyTools } from '../src/mcp-tools/policy-tools.js';
import { guidanceTools } from '../src/mcp-tools/guidance-tools.js';
import { securityTools } from '../src/mcp-tools/security-tools.js';
import { swarmTools } from '../src/mcp-tools/swarm-tools.js';
import { memoryTools } from '../src/mcp-tools/memory-tools.js';

type AnyTool = { name: string; handler: (input: any, context?: any) => Promise<any> };

function tool(tools: AnyTool[], name: string): AnyTool {
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`tool not registered: ${name}`);
  return found;
}

let projectDir: string;
let previousCwd: string | undefined;
let previousDbPath: string | undefined;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'ruflo-4767-'));
  previousCwd = process.env.CLAUDE_FLOW_CWD;
  previousDbPath = process.env.CLAUDE_FLOW_DB_PATH;
  process.env.CLAUDE_FLOW_CWD = projectDir;
  process.env.CLAUDE_FLOW_DB_PATH = join(projectDir, 'memory.db');
});

afterEach(() => {
  if (previousCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
  else process.env.CLAUDE_FLOW_CWD = previousCwd;
  if (previousDbPath === undefined) delete process.env.CLAUDE_FLOW_DB_PATH;
  else process.env.CLAUDE_FLOW_DB_PATH = previousDbPath;
  rmSync(projectDir, { recursive: true, force: true });
});

function seed(relativePath: string, data: unknown): void {
  const full = join(projectDir, relativePath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, JSON.stringify(data, null, 2), 'utf-8');
}

describe('task_retry', () => {
  it('rejects a missing taskId', async () => {
    const result = await tool(taskTools, 'task_retry').handler({});
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('reports not found for an unknown task', async () => {
    const result = await tool(taskTools, 'task_retry').handler({ taskId: 'missing-task' });
    expect(result).toEqual({ success: false, taskId: 'missing-task', error: 'Task not found' });
  });

  it('clones a failed task into a new pending task and keeps the original', async () => {
    seed('.claude-flow/tasks/store.json', {
      version: '3.0.0',
      tasks: {
        t1: {
          taskId: 't1',
          type: 'coding',
          description: 'build feature',
          priority: 'high',
          status: 'failed',
          progress: 50,
          assignedTo: ['agent-1'],
          tags: ['x'],
          createdAt: '2026-01-01T00:00:00.000Z',
          startedAt: null,
          completedAt: null,
        },
      },
    });

    const result = await tool(taskTools, 'task_retry').handler({ taskId: 't1' });
    expect(result.taskId).toBe('t1');
    expect(result.previousStatus).toBe('failed');
    expect(result.status).toBe('pending');
    expect(result.newTaskId).toMatch(/^task-/);

    const store = JSON.parse(readFileSync(join(projectDir, '.claude-flow/tasks/store.json'), 'utf-8'));
    expect(store.tasks.t1.status).toBe('failed');
    expect(store.tasks[result.newTaskId]).toMatchObject({
      status: 'pending',
      progress: 0,
      description: 'build feature',
      tags: ['x', 'retry-of:t1'],
    });
  });
});

describe('session_delete', () => {
  it('rejects a missing sessionId', async () => {
    const result = await tool(sessionTools, 'session_delete').handler({});
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('reports deleted false for an unknown session', async () => {
    const result = await tool(sessionTools, 'session_delete').handler({ sessionId: 'nope' });
    expect(result.deleted).toBe(false);
    expect(result.error).toBe('Session not found');
  });

  it('deletes a saved session file', async () => {
    seed('.claude-flow/sessions/s1.json', { id: 's1' });
    const result = await tool(sessionTools, 'session_delete').handler({ sessionId: 's1' });
    expect(result.deleted).toBe(true);
    expect(existsSync(join(projectDir, '.claude-flow/sessions/s1.json'))).toBe(false);
  });
});

describe('system_reset', () => {
  it('refuses to reset without confirm', async () => {
    const result = await tool(systemTools, 'system_reset').handler({ confirm: false });
    expect(result).toEqual({ success: false, error: 'Reset requires confirmation' });
  });

  it('resets the default metrics component when confirmed', async () => {
    const result = await tool(systemTools, 'system_reset').handler({ confirm: true });
    expect(result.success).toBe(true);
    expect(result.component).toBe('metrics');
    expect(result.message).toBe('System metrics has been reset');
  });
});

describe('policy administration tools', () => {
  it.each(['policy_approve', 'policy_revoke', 'policy_budget_set'])(
    '%s requires an authenticated user context',
    async (name) => {
      const run = tool(policyTools, name).handler({}, undefined);
      await expect(run).rejects.toThrow('policy administration requires an authenticated user context');
    },
  );

  it('policy_approve rejects a non-user principal', async () => {
    const run = tool(policyTools, 'policy_approve').handler(
      { approval: {} },
      { principalType: 'agent', principalId: 'agent-1' },
    );
    await expect(run).rejects.toThrow('policy administration requires an authenticated user context');
  });

  it('policy_revoke rejects a context that has no principalId', async () => {
    const run = tool(policyTools, 'policy_revoke').handler(
      { approvalId: 'approval-1' },
      { principalType: 'user' },
    );
    await expect(run).rejects.toThrow('policy administration requires an authenticated user context');
  });
});

describe('guidance_quickref', () => {
  it('returns a structured error for a missing domain', async () => {
    const result = await tool(guidanceTools, 'guidance_quickref').handler({});
    const body = JSON.parse(result.content[0].text);
    expect(body.error).toBeTruthy();
  });

  it('returns the getting-started card', async () => {
    const result = await tool(guidanceTools, 'guidance_quickref').handler({ domain: 'getting-started' });
    expect(result.content[0].text).toContain('Getting Started');
  });
});

describe('aidefence_has_pii', () => {
  it('returns a structured error when input is missing', async () => {
    const result = await tool(securityTools, 'aidefence_has_pii').handler({});
    const body = JSON.parse(result.content[0].text);
    expect(body.error).toBeTruthy();
  });
});

describe('swarm_exists (check inside swarm_health)', () => {
  it('reports the swarm as not found when the id is unknown', async () => {
    const result = await tool(swarmTools, 'swarm_health').handler({ swarmId: 'swarm-missing' });
    expect(result.status).toBe('not_found');
    expect(result.healthy).toBe(false);
    expect(result.checks).toEqual([
      expect.objectContaining({ name: 'swarm_exists', status: 'fail' }),
    ]);
  });
});

describe('memory_compress', () => {
  it('reports the sql.js store size with no compression', async () => {
    const result = await tool(memoryTools, 'memory_compress').handler({});
    expect(result.compression).toEqual({ ratio: 1, savedBytes: 0, method: 'none' });
    expect(result.before.totalSize).toMatch(/^\d+B$/);
    expect(result.after).toEqual(result.before);
  });
});

describe('aidefence_stats', () => {
  it('returns parseable detection statistics', async () => {
    const result = await tool(securityTools, 'aidefence_stats').handler({});
    const body = JSON.parse(result.content[0].text);
    expect(body).toBeTypeOf('object');
  });
});
