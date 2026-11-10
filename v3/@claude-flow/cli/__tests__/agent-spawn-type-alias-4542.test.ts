/**
 * Regression guard for ruvnet/ruflo#4542 — agent and command docs installed by
 * `init` called agent_spawn with `type` instead of `agentType`, and every call
 * failed with "Input validation failed: type: Required", which named the key the
 * caller had sent. The handler now accepts `type` as an alias and reports a
 * missing `agentType` by its real name.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentTools } from '../src/mcp-tools/agent-tools.js';

const spawn = (input: Record<string, unknown>) =>
  agentTools.find(t => t.name === 'agent_spawn')!.handler(input) as Promise<Record<string, any>>;

function storedAgent(dir: string, id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, '.claude-flow', 'agents', 'store.json'), 'utf8')).agents[id];
}

describe('#4542 — agent_spawn accepts the legacy type key', () => {
  let dir: string;
  let prevCwd: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-4542-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  it('spawns with `type` alone, stored as agentType', async () => {
    const r = await spawn({ type: 'coordinator', name: 'GitHub Coordinator' });
    expect(r.success).toBe(true);
    expect(r.agentType).toBe('coordinator');
    const stored = storedAgent(dir, r.agentId);
    expect(stored.agentType).toBe('coordinator');
    expect(stored).not.toHaveProperty('type');
  });

  it('prefers agentType when both keys are sent', async () => {
    const r = await spawn({ agentType: 'coder', type: 'tester' });
    expect(r.success).toBe(true);
    expect(r.agentType).toBe('coder');
  });

  it('names agentType when neither key is sent', async () => {
    const r = await spawn({ name: 'nobody' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/agentType is required/);
    expect(r.error).not.toMatch(/type: Required/);
  });

  it('still rejects an unsafe type through the alias', async () => {
    const r = await spawn({ type: '../../etc/passwd' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/agentType/);
  });
});
