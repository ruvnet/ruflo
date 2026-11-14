/**
 * #4736 / ADR-531: concurrent MCP servers (separate processes) must neither
 * lose each other's claim writes nor all win the same issue.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const claimsModule = new URL('../src/mcp-tools/claims-tools.ts', import.meta.url).href;
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href;

// Each child waits for a shared wall-clock instant, then calls the real handler once.
const childSource = `
import { claimsTools } from ${JSON.stringify(claimsModule)};
const { ISSUE, CLAIMANT, START_AT } = process.env;
while (Date.now() < Number(START_AT)) { /* spin: release all racers together */ }
const tool = claimsTools.find((t) => t.name === 'claims_claim');
const result = await tool.handler({ issueId: ISSUE, claimant: CLAIMANT });
process.stdout.write(JSON.stringify(result));
`;

interface ClaimOutcome { success: boolean; error?: string }

function runClaimChild(project: string, issue: string, claimant: string, startAt: number): Promise<ClaimOutcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', tsxLoader, '--input-type=module', '-e', childSource], {
      cwd: packageDir,
      env: { ...process.env, CLAUDE_FLOW_CWD: project, ISSUE: issue, CLAIMANT: claimant, START_AT: String(startAt) },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`child exited ${code}: ${err}`));
      resolve(JSON.parse(out) as ClaimOutcome);
    });
  });
}

describe('claims store is safe across concurrent processes (#4736)', () => {
  let project: string;
  beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'claims-4736-')); });
  afterEach(() => { rmSync(project, { recursive: true, force: true }); });

  const readClaims = (): Record<string, { claimant: { agentId?: string } }> =>
    JSON.parse(readFileSync(join(project, '.claude-flow/claims/claims.json'), 'utf8')).claims;
  const startAt = () => Date.now() + 4000;

  it('lets exactly one of 6 racers claim the same issue', async () => {
    const at = startAt();
    const racers = Array.from({ length: 6 }, (_, i) => runClaimChild(project, 'race-1', `agent:racer-${i}:coder`, at));
    const outcomes = await Promise.all(racers);

    expect(outcomes.filter((o) => o.success)).toHaveLength(1);
    const losers = outcomes.filter((o) => !o.success);
    expect(losers).toHaveLength(5);
    for (const loser of losers) expect(loser.error).toMatch(/already claimed/);
    expect(Object.keys(readClaims())).toEqual(['race-1']);
  }, 60_000);

  it('persists every claim when 10 processes claim different issues at once', async () => {
    const at = startAt();
    const writers = Array.from({ length: 10 }, (_, i) => runClaimChild(project, `issue-${i}`, `agent:writer-${i}:coder`, at));
    const outcomes = await Promise.all(writers);

    expect(outcomes.every((o) => o.success)).toBe(true);
    const claims = readClaims();
    expect(Object.keys(claims).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `issue-${i}`).sort());
    for (let i = 0; i < 10; i++) expect(claims[`issue-${i}`].claimant.agentId).toBe(`writer-${i}`);
  }, 60_000);
});
