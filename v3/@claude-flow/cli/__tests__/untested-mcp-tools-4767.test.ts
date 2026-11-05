/**
 * Success and missing-argument tests for MCP tools that had no tests (#4767).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// The tools under test are the MCP wrappers, not the detector. Without a built
// @claude-flow/aidefence (the root CI job) the wrapper would try an npm install.
vi.mock('@claude-flow/aidefence', () => ({
  createAIDefence: () => ({
    hasPII: (input: string) => /[\w.+-]+@[\w-]+\.[\w.]+/.test(input),
    getStats: async () => ({}),
  }),
}));

import { taskTools } from '../src/mcp-tools/task-tools.js';
import { sessionTools } from '../src/mcp-tools/session-tools.js';
import { systemTools } from '../src/mcp-tools/system-tools.js';
import { policyTools } from '../src/mcp-tools/policy-tools.js';
import { guidanceTools } from '../src/mcp-tools/guidance-tools.js';
import { securityTools } from '../src/mcp-tools/security-tools.js';
import { progressTools } from '../src/mcp-tools/progress-tools.js';
import { memoryTools } from '../src/mcp-tools/memory-tools.js';

type Tool = {
  name: string;
  handler: (input: Record<string, unknown>, context?: Record<string, unknown>) => Promise<unknown>;
};

// MCP-style tools return their JSON payload as text content.
type ContentResult = { content: Array<{ type: string; text: string }>; isError?: boolean };
const parse = (r: unknown) => JSON.parse((r as ContentResult).content[0].text);

const findTool = (tools: Tool[], name: string) => {
  const t = tools.find(t => t.name === name);
  if (!t) throw new Error(`MCP tool not registered: ${name}`);
  return t;
};

let dir: string;
let prevCwd: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ruflo-untested-tools-'));
  prevCwd = process.env.CLAUDE_FLOW_CWD;
  process.env.CLAUDE_FLOW_CWD = dir;
});

afterEach(() => {
  if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
  else process.env.CLAUDE_FLOW_CWD = prevCwd;
  rmSync(dir, { recursive: true, force: true });
});

describe('task_retry', () => {
  const tool = (name: string) => findTool(taskTools as Tool[], name);

  it('re-queues an existing task as a new pending task', async () => {
    const created = await tool('task_create').handler({ type: 'feature', description: 'first try' }) as { taskId: string };

    const result = await tool('task_retry').handler({ taskId: created.taskId }) as {
      taskId: string; newTaskId: string; status: string;
    };

    expect(result.taskId).toBe(created.taskId);
    expect(result.newTaskId).toBeTruthy();
    expect(result.newTaskId).not.toBe(created.taskId);
    expect(result.status).toBe('pending');
  });

  it('fails when taskId is missing', async () => {
    const result = await tool('task_retry').handler({}) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('session_delete', () => {
  const tool = (name: string) => findTool(sessionTools as Tool[], name);

  it('deletes a saved session', async () => {
    const saved = await tool('session_save').handler({ name: 'to-delete' }) as { sessionId: string };

    const result = await tool('session_delete').handler({ sessionId: saved.sessionId }) as {
      sessionId: string; deleted: boolean;
    };

    expect(result.sessionId).toBe(saved.sessionId);
    expect(result.deleted).toBe(true);
  });

  it('fails when sessionId is missing', async () => {
    const result = await tool('session_delete').handler({}) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('system_reset', () => {
  const tool = (name: string) => findTool(systemTools as Tool[], name);

  it('resets metrics when confirmed', async () => {
    const result = await tool('system_reset').handler({ confirm: true }) as { success: boolean; component: string };

    expect(result.success).toBe(true);
    expect(result.component).toBe('metrics');
  });

  it('refuses to reset without confirm', async () => {
    const result = await tool('system_reset').handler({}) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('policy administration tools', () => {
  const tool = (name: string) => findTool(policyTools as Tool[], name);
  const admin = () => ({ principalType: 'user', principalId: 'user:alice', projectRoot: dir });
  const approval = () => ({
    id: 'release-approval',
    principal: 'agent:release',
    actions: ['deployment.promote'],
    expiresAt: Date.now() + 60_000,
    maxUses: 1,
  });

  it('policy_budget_set stores a budget', async () => {
    const budget = { id: 'model-window', principal: 'agent:*', action: 'model.call', maxCostUsd: 1, periodMs: 60_000 };

    const result = await tool('policy_budget_set').handler({ budget }, admin()) as { success: boolean; budgetId: string };

    expect(result).toEqual({ success: true, budgetId: 'model-window' });
  });

  it('policy_budget_set fails when budget is missing', async () => {
    await expect(tool('policy_budget_set').handler({}, admin())).rejects.toThrow();
  });

  it('policy_approve issues an approval', async () => {
    const result = await tool('policy_approve').handler({ approval: approval() }, admin()) as {
      id: string; issuedBy: string;
    };

    expect(result.id).toBe('release-approval');
    expect(result.issuedBy).toBe('user:alice');
  });

  it('policy_approve fails when approval is missing', async () => {
    await expect(tool('policy_approve').handler({}, admin())).rejects.toThrow();
  });

  it('policy_revoke revokes an issued approval', async () => {
    await tool('policy_approve').handler({ approval: approval() }, admin());

    const result = await tool('policy_revoke').handler({ approvalId: 'release-approval' }, admin());

    expect(result).toEqual({ success: true });
  });

  it('policy_revoke reports no change when approvalId is missing', async () => {
    const result = await tool('policy_revoke').handler({}, admin());

    expect(result).toEqual({ success: false });
  });
});

describe('guidance_quickref', () => {
  const tool = (name: string) => findTool(guidanceTools as Tool[], name);

  it('returns the reference for a domain', async () => {
    const result = await tool('guidance_quickref').handler({ domain: 'getting-started' }) as ContentResult;

    expect(result.isError).toBeFalsy();
    expect(parse(result).title).toBe('Getting Started');
  });

  it('fails when domain is missing', async () => {
    const result = await tool('guidance_quickref').handler({}) as ContentResult;

    expect(result.isError).toBe(true);
  });
});

describe('aidefence_has_pii', () => {
  const tool = (name: string) => findTool(securityTools as Tool[], name);

  it('detects PII in the input', async () => {
    const result = await tool('aidefence_has_pii').handler({ input: 'Contact me at alice@example.com' }) as ContentResult;

    expect(result.isError).toBeFalsy();
    expect(parse(result).hasPII).toBe(true);
  });

  it('fails when input is missing', async () => {
    const result = await tool('aidefence_has_pii').handler({}) as ContentResult;

    expect(result.isError).toBe(true);
  });
});

// The next three tools take no arguments, so there is no missing-argument case to test.

describe('aidefence_stats', () => {
  const tool = (name: string) => findTool(securityTools as Tool[], name);

  it('reports wrapper-level counters', async () => {
    const result = await tool('aidefence_stats').handler({}) as ContentResult;

    expect(result.isError).toBeFalsy();
    expect(typeof parse(result).wrapper.hasPiiCalls).toBe('number');
  });
});

describe('progress_sync', () => {
  const tool = (name: string) => findTool(progressTools as Tool[], name);

  it('syncs and persists progress', async () => {
    const result = await tool('progress_sync').handler({}) as { progress: number; persisted: boolean };

    expect(typeof result.progress).toBe('number');
    expect(result.persisted).toBe(true);
  });
});

describe('memory_compress', () => {
  const tool = (name: string) => findTool(memoryTools as Tool[], name);

  it('reports that the sql.js backend has nothing to compress', async () => {
    const result = await tool('memory_compress').handler({}) as {
      compression: { ratio: number; savedBytes: number; method: string };
    };

    expect(result.compression).toEqual({ ratio: 1, savedBytes: 0, method: 'none' });
  });
});
