import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execute = vi.hoisted(() => vi.fn());
vi.mock('../src/mcp-tools/agent-execute-core.js', () => ({ executeAgentTask: execute }));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => process.env.CLAUDE_FLOW_CWD || process.cwd() }));

import { missionTools } from '../src/mcp-tools/mission-tools.js';

const call = async (name: string, input: Record<string, unknown> = {}) => {
  const tool = missionTools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`missing MCP tool ${name}`);
  return await tool.handler(input) as Record<string, any>;
};

describe('durable missions', () => {
  let project: string;
  const previousCwd = process.env.CLAUDE_FLOW_CWD;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'ruflo-mission-'));
    process.env.CLAUDE_FLOW_CWD = project;
    execute.mockReset().mockResolvedValue({ success: true, output: 'report', durationMs: 1 });
  });

  afterEach(() => {
    if (previousCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = previousCwd;
    rmSync(project, { recursive: true, force: true });
  });

  it('persists a DAG, waits for a typed approval, and resumes without repeating completed work', async () => {
    const created = await call('mission_create', {
      name: 'Publish report',
      steps: [
        { stepId: 'draft', kind: 'agent', agentId: 'writer', prompt: 'Draft report' },
        { stepId: 'review', kind: 'signal', signalName: 'approval', valueType: 'approval', dependsOn: ['draft'] },
        { stepId: 'publish', kind: 'agent', agentId: 'writer', prompt: 'Publish approved report', dependsOn: ['review'] },
      ],
    });
    expect(created.success).toBe(true);
    const id = created.missionId;
    const stateFile = join(project, '.claude-flow', 'missions', `${id}.json`);
    if (process.platform !== 'win32') {
      expect(statSync(stateFile).mode & 0o777).toBe(0o600);
      expect(statSync(join(project, '.claude-flow', 'missions')).mode & 0o077).toBe(0);
    }
    const waiting = await call('mission_advance', { missionId: id });
    expect(waiting.status).toBe('waiting');
    expect(waiting.pendingSignals).toEqual([{ stepId: 'review', signalName: 'approval', valueType: 'approval' }]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await call('mission_signal', { missionId: id, stepId: 'review', value: 'yes' })).success).toBe(false);
    expect((await call('mission_signal', { missionId: id, stepId: 'review', value: true })).success).toBe(true);
    const done = await call('mission_advance', { missionId: id });
    expect(done.status).toBe('completed');
    expect(execute).toHaveBeenCalledTimes(2);
    expect((await call('mission_advance', { missionId: id })).status).toBe('completed');
    expect(execute).toHaveBeenCalledTimes(2);
    const status = await call('mission_status', { missionId: id });
    expect(status.steps.map((step: any) => step.status)).toEqual(['completed', 'completed', 'completed']);
    expect(status.events.map((event: any) => event.type)).toContain('signal_received');
  });

  it('issues an action once with a stable key, then requires an external receipt', async () => {
    const { missionId } = await call('mission_create', {
      name: 'Invoice and report',
      steps: [
        { stepId: 'charge', kind: 'action', actionName: 'charge_customer', request: { amount: 7 } },
        { stepId: 'report', kind: 'agent', agentId: 'writer', prompt: 'Report result', dependsOn: ['charge'] },
      ],
    });
    const first = await call('mission_advance', { missionId });
    expect(first.status).toBe('waiting');
    expect(first.pendingActions).toHaveLength(1);
    expect(first.pendingActions[0]).toMatchObject({ stepId: 'charge', actionName: 'charge_customer', request: { amount: 7 } });
    const key = first.pendingActions[0].idempotencyKey;
    const again = await call('mission_advance', { missionId });
    expect(again.pendingActions[0].idempotencyKey).toBe(key);
    expect(execute).not.toHaveBeenCalled();
    expect((await call('mission_reconcile', { missionId, stepId: 'charge', outcome: 'completed' })).success).toBe(false);
    expect((await call('mission_reconcile', { missionId, stepId: 'charge', outcome: 'completed', receipt: 'provider-42', idempotencyKey: key })).success).toBe(true);
    expect((await call('mission_advance', { missionId })).status).toBe('completed');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('holds an uncertain provider call for reconciliation instead of retrying it', async () => {
    execute.mockRejectedValueOnce(new Error('connection reset after request'));
    const { missionId } = await call('mission_create', {
      name: 'One call', steps: [{ stepId: 'send', kind: 'agent', agentId: 'writer', prompt: 'Send' }],
    });
    expect((await call('mission_advance', { missionId })).status).toBe('ambiguous');
    expect((await call('mission_advance', { missionId })).status).toBe('ambiguous');
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await call('mission_reconcile', { missionId, stepId: 'send', outcome: 'completed', receipt: 'operator-confirmed' })).success).toBe(true);
    expect((await call('mission_advance', { missionId })).status).toBe('completed');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('recognizes a dead runner after restart and does not replay its running step', async () => {
    const { missionId } = await call('mission_create', {
      name: 'Crash recovery', steps: [{ stepId: 'send', kind: 'agent', agentId: 'writer', prompt: 'Send' }],
    });
    const path = join(project, '.claude-flow', 'missions', `${missionId}.json`);
    const record = JSON.parse(readFileSync(path, 'utf8'));
    record.steps[0].status = 'running';
    record.steps[0].ownerPid = 99999999;
    record.steps[0].ownerRunId = 'previous-process-run';
    record.status = 'running';
    writeFileSync(path, JSON.stringify(record));
    const recovered = await call('mission_advance', { missionId });
    expect(recovered.status).toBe('ambiguous');
    expect(execute).not.toHaveBeenCalled();
    expect(recovered.events.at(-1).type).toBe('execution_uncertain');
  });

  it('rejects cycles, duplicate IDs, and denied approvals', async () => {
    expect((await call('mission_create', { name: 'cycle', steps: [
      { stepId: 'a', kind: 'signal', signalName: 'a', valueType: 'string', dependsOn: ['b'] },
      { stepId: 'b', kind: 'signal', signalName: 'b', valueType: 'string', dependsOn: ['a'] },
    ] })).success).toBe(false);
    const { missionId } = await call('mission_create', {
      name: 'approval', steps: [{ stepId: 'yes', kind: 'signal', signalName: 'approval', valueType: 'approval' }],
    });
    await call('mission_advance', { missionId });
    const denied = await call('mission_signal', { missionId, stepId: 'yes', value: false });
    expect(denied.status).toBe('failed');
    expect((await call('mission_advance', { missionId })).status).toBe('failed');
  });

  it('admits one runner for a pending provider call', async () => {
    let finish!: (result: Record<string, unknown>) => void;
    execute.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { missionId } = await call('mission_create', {
      name: 'One runner', steps: [{ stepId: 'call', kind: 'agent', agentId: 'writer', prompt: 'Write' }],
    });
    const first = call('mission_advance', { missionId });
    expect(execute).toHaveBeenCalledTimes(1);
    const second = await call('mission_advance', { missionId });
    expect(second.status).toBe('running');
    expect(execute).toHaveBeenCalledTimes(1);
    finish({ success: true, output: 'done' });
    expect((await first).status).toBe('completed');
  });

  it('fails closed on a corrupt persisted record', async () => {
    const { missionId } = await call('mission_create', {
      name: 'Corrupt', steps: [{ stepId: 'call', kind: 'agent', agentId: 'writer', prompt: 'Write' }],
    });
    const path = join(project, '.claude-flow', 'missions', `${missionId}.json`);
    const record = JSON.parse(readFileSync(path, 'utf8'));
    record.steps[0].kind = 'unknown';
    writeFileSync(path, JSON.stringify(record));
    expect((await call('mission_advance', { missionId })).success).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it('requires explicit evidence when a recycled PID appears live', async () => {
    const { missionId } = await call('mission_create', {
      name: 'Recycled PID', steps: [{ stepId: 'call', kind: 'agent', agentId: 'writer', prompt: 'Write' }],
    });
    const path = join(project, '.claude-flow', 'missions', `${missionId}.json`);
    const record = JSON.parse(readFileSync(path, 'utf8'));
    record.steps[0].status = 'running';
    record.steps[0].ownerPid = process.ppid; // live PID, but not the original mission worker
    record.steps[0].ownerRunId = 'previous-run';
    record.status = 'running';
    writeFileSync(path, JSON.stringify(record));
    const running = await call('mission_advance', { missionId });
    expect(running.status).toBe('running');
    expect(running.steps[0]).toMatchObject({ ownerPid: process.ppid, ownerRunId: 'previous-run' });
    expect(execute).not.toHaveBeenCalled();
    expect((await call('mission_recover', { missionId, stepId: 'call', ownerPid: 2, evidence: 'worker exited' })).success).toBe(false);
    const recovered = await call('mission_recover', { missionId, stepId: 'call', ownerPid: running.steps[0].ownerPid, evidence: 'verified original worker exited' });
    expect(recovered.status).toBe('ambiguous');
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects oversized signal data and never replays an oversized agent response', async () => {
    const signal = await call('mission_create', {
      name: 'Payload limit', steps: [{ stepId: 'input', kind: 'signal', signalName: 'data', valueType: 'string' }],
    });
    await call('mission_advance', { missionId: signal.missionId });
    expect((await call('mission_signal', { missionId: signal.missionId, stepId: 'input', value: 'x'.repeat(300_000) })).success).toBe(false);
    expect((await call('mission_status', { missionId: signal.missionId })).status).toBe('waiting');

    execute.mockResolvedValueOnce({ success: true, output: 'x'.repeat(300_000) });
    const agent = await call('mission_create', {
      name: 'Large response', steps: [{ stepId: 'call', kind: 'agent', agentId: 'writer', prompt: 'Write' }],
    });
    expect((await call('mission_advance', { missionId: agent.missionId })).status).toBe('failed');
    expect((await call('mission_advance', { missionId: agent.missionId })).status).toBe('failed');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(statSync(join(project, '.claude-flow', 'missions', `${agent.missionId}.json`)).size).toBeLessThan(20_000);
  });

  it('bounds an oversized provider failure and its audit event', async () => {
    execute.mockRejectedValueOnce(new Error('x'.repeat(300_000)));
    const { missionId } = await call('mission_create', {
      name: 'Failure size', steps: [{ stepId: 'call', kind: 'agent', agentId: 'writer', prompt: 'Write' }],
    });
    const status = await call('mission_advance', { missionId });
    expect(status.status).toBe('ambiguous');
    expect(status.steps[0].error.length).toBeLessThanOrEqual(2000);
    expect(status.events.at(-1).detail.length).toBeLessThanOrEqual(2000);
    expect(statSync(join(project, '.claude-flow', 'missions', `${missionId}.json`)).size).toBeLessThan(10_000);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('recovers an old mutation lock even when its PID was recycled', async () => {
    const { missionId } = await call('mission_create', {
      name: 'Old lock', steps: [{ stepId: 'approval', kind: 'signal', signalName: 'approval', valueType: 'approval' }],
    });
    const lock = join(project, '.claude-flow', 'missions', `${missionId}.json.lock`);
    writeFileSync(lock, String(process.ppid));
    const old = new Date(Date.now() - 120_000);
    utimesSync(lock, old, old);
    expect((await call('mission_advance', { missionId })).status).toBe('waiting');
  });
});
