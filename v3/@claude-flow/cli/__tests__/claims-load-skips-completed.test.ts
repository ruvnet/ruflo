import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimsTools } from '../src/mcp-tools/claims-tools.js';

// claims_status 'completed' keeps the claim in the store, and claims_load and
// claims_rebalance counted it as load. An agent that had finished its issues
// was reported as busy (claimCount and utilization included the finished
// work), and claims_rebalance treated it as overloaded and moved its one open
// claim to another agent. Completed claims are no longer counted as load.
const tool = (name: string) => claimsTools.find(t => t.name === name)!;
let dir: string;

type Result = Record<string, any>;
const call = (name: string, input: Record<string, unknown>) => tool(name).handler(input) as Promise<Result>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ruflo-claims-load-completed-'));
  mkdirSync(join(dir, '.claude-flow', 'claims'), { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('completed claims and agent load', () => {
  it('claims_load counts only claims that are not completed', async () => {
    for (let i = 0; i < 3; i++) {
      await call('claims_claim', { issueId: `issue-${i}`, claimant: 'agent:a1:coder' });
    }
    await call('claims_status', { issueId: 'issue-0', status: 'completed' });
    await call('claims_status', { issueId: 'issue-1', status: 'completed' });

    const result = await call('claims_load', {});
    expect(result.totalClaims).toBe(1);
    const load = result.loads.find((l: Result) => l.agentId === 'a1');
    expect(load.claimCount).toBe(1);
    expect(load.utilization).toBeCloseTo(0.2);
    expect(load.claims.map((c: Result) => c.issueId)).toEqual(['issue-2']);
  });

  it('claims_load leaves out an agent whose claims are all completed', async () => {
    await call('claims_claim', { issueId: 'done-1', claimant: 'agent:a1:coder' });
    await call('claims_status', { issueId: 'done-1', status: 'completed' });

    const result = await call('claims_load', {});
    expect(result.totalAgents).toBe(0);
    expect(result.totalClaims).toBe(0);
  });

  it('claims_rebalance does not treat finished work as overload', async () => {
    // a1 finished 5 issues and has 1 open one; a2 has 1 open issue.
    for (let i = 0; i < 5; i++) {
      await call('claims_claim', { issueId: `done-${i}`, claimant: 'agent:a1:coder' });
      await call('claims_status', { issueId: `done-${i}`, status: 'completed' });
    }
    await call('claims_claim', { issueId: 'open-a1', claimant: 'agent:a1:coder' });
    await call('claims_claim', { issueId: 'open-a2', claimant: 'agent:a2:coder' });

    const result = await call('claims_rebalance', { dryRun: false });
    expect(result.suggestions).toEqual([]);
    expect(result.metrics.overloadedCount).toBe(0);
    const claim = (await call('claims_list', {})).claims.find((c: Result) => c.issueId === 'open-a1');
    expect(claim.claimant.agentId).toBe('a1');
  });
});
