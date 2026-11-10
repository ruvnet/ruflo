import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimsTools } from '../src/mcp-tools/claims-tools.js';

// claims_steal copied the context given to claims_mark-stealable onto the
// claim unconditionally, so stealing an issue that was marked stealable
// without a context (context is optional) wiped the context recorded with
// claims_claim and the new owner got nothing.
const tool = (name: string) => claimsTools.find(t => t.name === name)!;
let dir: string;

type Result = Record<string, any>;
const call = (name: string, input: Record<string, unknown>) => tool(name).handler(input) as Promise<Result>;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ruflo-claims-steal-context-'));
  mkdirSync(join(dir, '.claude-flow', 'claims'), { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
  await call('claims_claim', { issueId: 'issue-1', claimant: 'agent:a1:coder', context: 'start from the parser tests' });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('claims_steal context', () => {
  it('keeps the claim context when the issue was marked stealable without one', async () => {
    await call('claims_mark-stealable', { issueId: 'issue-1', reason: 'overloaded' });
    const stolen = await call('claims_steal', { issueId: 'issue-1', stealer: 'agent:a2:coder' });
    expect(stolen.success).toBe(true);
    expect(stolen.claim.context).toBe('start from the parser tests');
    expect((await call('claims_list', {})).claims[0].context).toBe('start from the parser tests');
  });

  it('uses the handoff context given to claims_mark-stealable', async () => {
    await call('claims_mark-stealable', { issueId: 'issue-1', reason: 'stale', context: 'parser done, lexer left' });
    const stolen = await call('claims_steal', { issueId: 'issue-1', stealer: 'agent:a2:coder' });
    expect(stolen.claim.context).toBe('parser done, lexer left');
  });
});
