/**
 * daa_workflow_create declares `steps` as an array of objects, but it kept a
 * name only for string steps, so every object step became "Step N" and the
 * names given by the caller were lost.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../src/memory/memory-bridge.js', () => ({ bridgeStoreEntry: vi.fn(async () => undefined) }));

const originalProjectCwd = process.env.CLAUDE_FLOW_CWD;

async function tools() {
  const { daaTools } = await import('../src/mcp-tools/daa-tools.js');
  const get = (name: string) => daaTools.find((t) => t.name === name)!;
  return {
    create: (input: Record<string, unknown>) => get('daa_workflow_create').handler(input) as Promise<Record<string, any>>,
    execute: (workflowId: string) => get('daa_workflow_execute').handler({ workflowId }) as Promise<Record<string, any>>,
  };
}

beforeEach(() => {
  process.env.CLAUDE_FLOW_CWD = mkdtempSync(join(tmpdir(), 'ruflo-daa-steps-'));
});
afterEach(() => {
  if (originalProjectCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
  else process.env.CLAUDE_FLOW_CWD = originalProjectCwd;
});

describe('daa_workflow_create step names', () => {
  it('keeps the name of object steps', async () => {
    const t = await tools();
    const created = await t.create({ id: 'wf1', name: 'Release', steps: [{ name: 'build' }, { name: 'test', agent: 'qa' }] });
    expect(created).toMatchObject({ success: true, steps: 2 });
    const run = await t.execute('wf1');
    // Before the fix: [{ name: 'Step 1' }, { name: 'Step 2' }].
    expect(run.steps.map((s: { name: string }) => s.name)).toEqual(['build', 'test']);
  });

  it('still accepts string steps and numbers unnamed ones', async () => {
    const t = await tools();
    await t.create({ id: 'wf2', name: 'Mixed', steps: ['lint', {}, { name: '' }, null, { name: 7 }] });
    const run = await t.execute('wf2');
    expect(run.steps.map((s: { name: string }) => s.name)).toEqual(['lint', 'Step 2', 'Step 3', 'Step 4', 'Step 5']);
  });
});
