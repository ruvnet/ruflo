/**
 * SECURITY: the DAA, workflow and claims stores are plain JSON objects keyed by
 * ids from MCP tool input. validateIdentifier accepts `__proto__` and
 * `constructor`, so a lookup by such an id resolved to Object.prototype (or a
 * built-in) and the handler wrote into it, corrupting every object in the
 * long-running MCP server process. The stores now load as null-prototype maps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../src/memory/memory-bridge.js', () => ({ bridgeStoreEntry: vi.fn(async () => undefined) }));

const originalProjectCwd = process.env.CLAUDE_FLOW_CWD;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ruflo-proto-safety-'));
  process.env.CLAUDE_FLOW_CWD = dir;
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
});
afterEach(() => {
  vi.restoreAllMocks();
  if (originalProjectCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
  else process.env.CLAUDE_FLOW_CWD = originalProjectCwd;
  for (const k of ['status', 'error']) delete (Object.prototype as Record<string, unknown>)[k];
  rmSync(dir, { recursive: true, force: true });
});

const clean = () => {
  const probe: Record<string, unknown> = {};
  expect(probe.status).toBeUndefined();
  expect(probe.error).toBeUndefined();
};

describe('daa_workflow_execute', () => {
  it.each(['__proto__', 'constructor', 'toString'])('treats %s as an unknown workflow', async (id) => {
    const { daaTools } = await import('../src/mcp-tools/daa-tools.js');
    const exec = daaTools.find((t) => t.name === 'daa_workflow_execute')!;
    const result = (await exec.handler({ workflowId: id })) as Record<string, unknown>;
    expect(result).toMatchObject({ success: false, error: 'Workflow not found' });
    clean();
  });

  it('still runs a real workflow', async () => {
    const { daaTools } = await import('../src/mcp-tools/daa-tools.js');
    const get = (n: string) => daaTools.find((t) => t.name === n)!;
    await get('daa_workflow_create').handler({ id: 'wf-ok', name: 'ok', steps: ['a'] });
    const result = (await get('daa_workflow_execute').handler({ workflowId: 'wf-ok' })) as Record<string, unknown>;
    expect(result.success).not.toBe(false);
  });
});

describe('workflow_cancel / workflow_stop', () => {
  it.each(['workflow_cancel', 'workflow_stop'])('%s does not write onto Object.prototype', async (name) => {
    const { workflowTools } = await import('../src/mcp-tools/workflow-tools.js');
    const tool = workflowTools.find((t) => t.name === name)!;
    for (const id of ['__proto__', 'constructor']) {
      const result = (await tool.handler({ workflowId: id, reason: 'x' })) as Record<string, unknown>;
      expect(result.error).toBe('Workflow not found');
    }
    clean();
  });
});

describe('claims_steal', () => {
  it('refuses a reserved-name claim that was never marked stealable', async () => {
    const { claimsTools } = await import('../src/mcp-tools/claims-tools.js');
    const tool = (n: string) => claimsTools.find((t) => t.name === n)!;
    const claimed = (await tool('claims_claim').handler({ issueId: 'constructor', claimant: 'agent:a1:coder' })) as Record<string, unknown>;
    expect(claimed.success).toBe(true);
    const stolen = (await tool('claims_steal').handler({ issueId: 'constructor', stealer: 'agent:a2:coder' })) as Record<string, unknown>;
    expect(stolen).toMatchObject({ success: false, error: 'Issue is not stealable' });
  });
});
