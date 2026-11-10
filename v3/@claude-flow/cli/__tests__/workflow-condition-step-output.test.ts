import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ cwd: '', execute: vi.fn() }));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));
vi.mock('../src/mcp-tools/agent-execute-core.js', () => ({ executeAgentTask: state.execute }));
import { workflowTools } from '../src/mcp-tools/workflow-tools.js';
const call = (name: string, input: Record<string, unknown>) => workflowTools.find(t => t.name === name)!.handler(input) as Promise<any>;
const stepResults = (workflowId: string) => {
  const store = JSON.parse(readFileSync(join(state.cwd, '.claude-flow', 'workflows', 'store.json'), 'utf-8'));
  return store.workflows[workflowId].steps.map((s: { result?: unknown }) => s.result);
};
beforeEach(() => {
  state.cwd = mkdtempSync(join(tmpdir(), 'ruflo-workflow-condition-output-'));
  state.execute.mockReset().mockResolvedValue({ success: true, output: 'approved' });
});
afterEach(() => rmSync(state.cwd, { recursive: true, force: true }));

// A task step stores its output as `<stepId>.output`, and step ids default to
// `step-N`, so a condition must accept the same names `{{step-1.output}}` does.
it.each([
  ["step-1.output == 'approved'", true],
  ["step-1.output === 'rejected'", false],
])('evaluates a condition on a step output: %s', async (when, truthy) => {
  const created = await call('workflow_create', { name: 'review', steps: [
    { name: 'review', type: 'task', config: { agentId: 'reviewer', prompt: 'review it' } },
    { name: 'gate', type: 'condition', config: { when } },
  ] });
  expect(created).toMatchObject({ workflowId: expect.any(String) });
  expect(await call('workflow_execute', { workflowId: created.workflowId })).toMatchObject({ status: 'completed' });
  expect(stepResults(created.workflowId)[1]).toMatchObject({ conditionExpr: when, truthy });
});

it('still rejects a condition that is not a comparison', async () => {
  const created = await call('workflow_create', { name: 'gate', steps: [
    { name: 'gate', type: 'condition', config: { when: 'step-1.output' } },
  ] });
  expect(created).toMatchObject({ success: false, error: expect.stringContaining('config.when') });
});
