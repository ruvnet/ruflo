/**
 * #4609: workflow_run stored its workflow as status 'running' (with startedAt)
 * and returned a fabricated `stages * 30s` estimate, but dispatched nothing.
 * workflow_execute then refused it ("Workflow already running") and
 * workflow_delete refused it ("Cannot delete running workflow").
 * It now creates a 'ready' workflow, as workflow_create does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ cwd: '' }));
vi.mock('../src/mcp-tools/types.js', async (orig) => ({ ...(await orig<object>()), getProjectCwd: () => state.cwd }));
const { executeAgentTask } = vi.hoisted(() => ({
  executeAgentTask: vi.fn(async ({ prompt }: { prompt: string }) => ({ success: true, output: `done: ${prompt}`, durationMs: 1 })),
}));
vi.mock('../src/mcp-tools/agent-execute-core.js', () => ({ executeAgentTask }));

import { workflowTools } from '../src/mcp-tools/workflow-tools.js';
const tool = (name: string, input: Record<string, unknown>) =>
  workflowTools.find((t) => t.name === name)!.handler(input) as Promise<Record<string, any>>;

beforeEach(() => {
  state.cwd = mkdtempSync(join(tmpdir(), 'ruflo-4609-'));
  executeAgentTask.mockClear();
});
afterEach(() => rmSync(state.cwd, { recursive: true, force: true }));

describe('workflow_run creates a ready workflow (#4609)', () => {
  it('does not report or store a run that never started', async () => {
    const run = await tool('workflow_run', { template: 'bugfix', task: 'fix login' });
    // Baseline: status 'running', estimatedDuration '120s', stored with startedAt.
    expect(run).toMatchObject({ status: 'ready', metrics: { totalStages: 4, agentsSpawned: 0, estimatedDuration: 'unknown' } });
    expect(run.nextStep).toMatch(/workflow_execute/);
    const status = await tool('workflow_status', { workflowId: run.workflowId });
    expect(status.status).toBe('ready');
    expect(status.startedAt).toBeUndefined();
    expect(executeAgentTask).not.toHaveBeenCalled();
  });

  it('can be deleted, instead of being refused as running', async () => {
    const run = await tool('workflow_run', { template: 'security' });
    const r = await tool('workflow_delete', { workflowId: run.workflowId });
    expect(r.error).toBeUndefined();
    expect((await tool('workflow_status', { workflowId: run.workflowId })).error).toMatch(/not found/i);
  });

  it('is executed by workflow_execute with a default agent', async () => {
    const run = await tool('workflow_run', { template: 'bugfix', task: 'fix login', options: { defaultAgentId: 'agent-1' } });
    const r = await tool('workflow_execute', { workflowId: run.workflowId });
    // Baseline: { error: 'Workflow already running' } and nothing executed.
    expect(r.error).toBeUndefined();
    expect(r.status).toBe('completed');
    expect(executeAgentTask).toHaveBeenCalledTimes(4);
    expect(executeAgentTask).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent-1' }));
  });

  it('keeps dryRun as a validation that stores nothing (control)', async () => {
    const run = await tool('workflow_run', { template: 'feature', options: { dryRun: true } });
    expect(run.status).toBe('validated');
    expect(run.nextStep).toBeUndefined();
    expect((await tool('workflow_status', { workflowId: run.workflowId })).error).toMatch(/not found/i);
  });
});
