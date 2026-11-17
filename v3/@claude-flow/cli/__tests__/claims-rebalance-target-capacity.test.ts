import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimsTools } from '../src/mcp-tools/claims-tools.js';

// claims_rebalance checked `target.claims.length < maxClaims` against the load
// snapshot taken before any move, so every movable claim went to the first
// underloaded agent and pushed it past maxClaims instead of spreading the work.
const tool = (name: string) => claimsTools.find(t => t.name === name)!;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ruflo-claims-rebalance-'));
  mkdirSync(join(dir, '.claude-flow', 'claims'), { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

type Load = { agentId: string; claimCount: number; maxClaims: number };

describe('claims_rebalance', () => {
  beforeEach(async () => {
    // One overloaded coder with 10 claims, two idle coders with 1 claim each.
    for (let i = 0; i < 10; i++) {
      await tool('claims_claim').handler({ issueId: `busy-${i}`, claimant: 'agent:busy:coder' });
    }
    await tool('claims_claim').handler({ issueId: 'idle-a-0', claimant: 'agent:idle-a:coder' });
    await tool('claims_claim').handler({ issueId: 'idle-b-0', claimant: 'agent:idle-b:coder' });
  });

  it('does not suggest moves that push a target past maxClaims', async () => {
    const result = await tool('claims_rebalance').handler({ dryRun: true }) as {
      suggestions: Array<{ issueId: string; to: string }>;
    };
    expect(result.suggestions.length).toBeGreaterThan(0);

    const incoming = new Map<string, number>();
    for (const s of result.suggestions) incoming.set(s.to, (incoming.get(s.to) ?? 0) + 1);
    // Each idle agent starts with 1 claim, so it can take at most 4 more.
    for (const [to, n] of incoming) {
      expect(1 + n, `${to} receives ${n} claims`).toBeLessThanOrEqual(5);
    }
    expect(incoming.size).toBe(2);
  });

  it('leaves no agent over maxClaims after applying the moves', async () => {
    await tool('claims_rebalance').handler({ dryRun: false });
    const { loads } = await tool('claims_load').handler({}) as { loads: Load[] };
    for (const l of loads) {
      expect(l.claimCount, l.agentId).toBeLessThanOrEqual(l.maxClaims);
    }
    expect(loads.reduce((sum, l) => sum + l.claimCount, 0)).toBe(12);
  });
});
