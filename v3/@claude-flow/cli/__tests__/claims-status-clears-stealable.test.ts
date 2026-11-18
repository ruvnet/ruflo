import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimsTools } from '../src/mcp-tools/claims-tools.js';

// claims_status changed a stealable claim's status but left its entry in the
// stealable list, so after the owner resumed work with claims_status the
// issue was still listed by claims_stealable and could be taken over with
// claims_steal while it was active again. claims_status cannot set
// 'stealable', so any status it sets now takes the claim off that list.
const tool = (name: string) => claimsTools.find(t => t.name === name)!;
let dir: string;

type Result = Record<string, any>;
const call = (name: string, input: Record<string, unknown>) => tool(name).handler(input) as Promise<Result>;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ruflo-claims-stealable-'));
  mkdirSync(join(dir, '.claude-flow', 'claims'), { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
  await call('claims_claim', { issueId: 'issue-1', claimant: 'agent:a1:coder' });
  const marked = await call('claims_mark-stealable', { issueId: 'issue-1', reason: 'overloaded' });
  expect(marked.success).toBe(true);
  expect((await call('claims_stealable', {})).count).toBe(1);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('claims_status on a stealable claim', () => {
  it('takes a resumed claim off the stealable list', async () => {
    const resumed = await call('claims_status', { issueId: 'issue-1', status: 'active' });
    expect(resumed.success).toBe(true);
    expect(resumed.claim.status).toBe('active');

    const stealable = await call('claims_stealable', {});
    expect(stealable.count).toBe(0);
    expect((await call('claims_list', {})).stealableCount).toBe(0);
  });

  it('refuses claims_steal once the owner has resumed', async () => {
    await call('claims_status', { issueId: 'issue-1', status: 'active' });

    const stolen = await call('claims_steal', { issueId: 'issue-1', stealer: 'agent:a2:coder' });
    expect(stolen.success).toBe(false);
    expect(stolen.error).toBe('Issue is not stealable');
    const claim = (await call('claims_list', {})).claims[0];
    expect(claim.claimant.agentId).toBe('a1');
  });

  it('does not list a completed claim as stealable', async () => {
    await call('claims_status', { issueId: 'issue-1', status: 'completed' });
    expect((await call('claims_stealable', {})).count).toBe(0);
  });

  it('still lets another agent steal while the claim stays stealable', async () => {
    const stolen = await call('claims_steal', { issueId: 'issue-1', stealer: 'agent:a2:coder' });
    expect(stolen.success).toBe(true);
    expect(stolen.claim.claimant.agentId).toBe('a2');
  });
});
