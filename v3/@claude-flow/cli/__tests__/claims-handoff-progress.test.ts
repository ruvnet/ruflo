import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimsTools } from '../src/mcp-tools/claims-tools.js';

// claims_handoff read `progress` as `(input.progress as number) || 0`, so a
// handoff that left out the optional progress wiped the progress recorded
// with claims_status, and an out-of-range value was stored as given while
// claims_status clamps it to 0-100.
const tool = (name: string) => claimsTools.find(t => t.name === name)!;
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ruflo-claims-handoff-'));
  mkdirSync(join(dir, '.claude-flow', 'claims'), { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
  await tool('claims_claim').handler({ issueId: 'issue-1', claimant: 'agent:a1:coder' });
  await tool('claims_status').handler({ issueId: 'issue-1', status: 'active', progress: 60 });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

type HandoffResult = { success: boolean; claim: { progress: number; status: string } };
const handoff = (extra: Record<string, unknown> = {}) =>
  tool('claims_handoff').handler({ issueId: 'issue-1', from: 'agent:a1:coder', to: 'agent:a2:coder', ...extra }) as Promise<HandoffResult>;

describe('claims_handoff progress', () => {
  it('keeps the recorded progress when progress is not passed', async () => {
    const result = await handoff();
    expect(result.success).toBe(true);
    expect(result.claim.status).toBe('handoff-pending');
    expect(result.claim.progress).toBe(60);
  });

  it('stores a passed progress, including 0', async () => {
    expect((await handoff({ progress: 75 })).claim.progress).toBe(75);
    expect((await handoff({ progress: 0 })).claim.progress).toBe(0);
  });

  it('clamps progress to 0-100 like claims_status', async () => {
    expect((await handoff({ progress: 150 })).claim.progress).toBe(100);
    expect((await handoff({ progress: -10 })).claim.progress).toBe(0);
  });
});
