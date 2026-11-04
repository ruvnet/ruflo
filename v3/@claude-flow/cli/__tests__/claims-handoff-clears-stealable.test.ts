import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimsTools } from '../src/mcp-tools/claims-tools.js';

// claims_handoff moved a stealable claim to 'handoff-pending' but left its
// entry in the stealable list, so while the handoff was pending another agent
// could still take the issue with claims_steal, and after the target accepted
// the handoff the issue was still listed by claims_stealable and could be
// stolen from its new owner. A claim being handed to a named claimant is no
// longer up for grabs, so claims_handoff now takes it off that list.
const tool = (name: string) => claimsTools.find(t => t.name === name)!;
let dir: string;

type Result = Record<string, any>;
const call = (name: string, input: Record<string, unknown>) => tool(name).handler(input) as Promise<Result>;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ruflo-claims-handoff-'));
  mkdirSync(join(dir, '.claude-flow', 'claims'), { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
  await call('claims_claim', { issueId: 'issue-1', claimant: 'agent:a1:coder' });
  const marked = await call('claims_mark-stealable', { issueId: 'issue-1', reason: 'overloaded' });
  expect(marked.success).toBe(true);
  expect((await call('claims_stealable', {})).count).toBe(1);
  const handoff = await call('claims_handoff', { issueId: 'issue-1', from: 'agent:a1:coder', to: 'agent:a2:coder' });
  expect(handoff.success).toBe(true);
  expect(handoff.claim.status).toBe('handoff-pending');
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('claims_handoff on a stealable claim', () => {
  it('takes the claim off the stealable list', async () => {
    expect((await call('claims_stealable', {})).count).toBe(0);
    expect((await call('claims_list', {})).stealableCount).toBe(0);
  });

  it('refuses claims_steal while the handoff is pending', async () => {
    const stolen = await call('claims_steal', { issueId: 'issue-1', stealer: 'agent:a3:coder' });
    expect(stolen.success).toBe(false);
    expect(stolen.error).toBe('Issue is not stealable');

    const accepted = await call('claims_accept-handoff', { issueId: 'issue-1', claimant: 'agent:a2:coder' });
    expect(accepted.success).toBe(true);
    expect(accepted.claim.claimant.agentId).toBe('a2');
  });

  it('cannot be stolen from the new owner after the handoff is accepted', async () => {
    await call('claims_accept-handoff', { issueId: 'issue-1', claimant: 'agent:a2:coder' });

    expect((await call('claims_stealable', {})).count).toBe(0);
    const stolen = await call('claims_steal', { issueId: 'issue-1', stealer: 'agent:a3:coder' });
    expect(stolen.success).toBe(false);
    const claim = (await call('claims_list', {})).claims[0];
    expect(claim.claimant.agentId).toBe('a2');
    expect(claim.status).toBe('active');
  });
});
