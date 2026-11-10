/**
 * Regression test for issue #1047: the statusline's "DDD ●XX%" / "DDD Domains"
 * fields have nothing to do with Domain-Driven-Design domain completion. They
 * are purely `.swarm/memory.db` file-size-derived pattern-count buckets run
 * through getV3Progress() — e.g. `memory init --force` drops "DDD progress"
 * from 100% to 80% just by resetting the DB file size, with zero change to
 * any actual domain/architecture work.
 *
 * This test guards the fix: the rendered statusline must not claim this is
 * "DDD" anywhere, and must instead label it honestly (a memory/learning
 * signal) and show the real underlying pattern count rather than a
 * fabricated percentage.
 *
 * Pure unit test against commands/hooks.ts's statusline subcommand — no CLI
 * binary, no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const lines = vi.hoisted(() => [] as string[]);
vi.mock('../src/output.js', () => ({ output: new Proxy({}, {
  get: (_target, name) => name === 'writeln'
    ? (text = '') => { lines.push(String(text)); }
    : (value: unknown) => value,
}) }));
vi.mock('../src/mcp-client.js', () => ({ callMCPTool: vi.fn(), MCPClientError: class extends Error {} }));
vi.mock('../src/funnel/index.js', () => ({ getFunnelPromo: () => null }));
vi.mock('../src/funnel/local-signals.js', () => ({
  getSecurityStatus: () => ({ status: 'CLEAN', findings: 0, cvesFixed: 0, totalCves: 0 }),
  getSwarmStatus: () => ({ activeAgents: 0, maxAgents: 15, coordinationActive: false }),
  getGitUncommittedCount: () => 0,
}));
import { hooksCommand } from '../src/commands/hooks.js';
import { CommandParser } from '../src/parser.js';

const cwd = process.cwd();
let root: string;
beforeEach(() => {
  lines.length = 0;
  root = mkdtempSync(join(tmpdir(), 'issue-1047-ddd-'));
  process.chdir(root);
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
});
afterEach(() => {
  delete (process.stdin as { isTTY?: boolean }).isTTY;
  process.chdir(cwd);
  rmSync(root, { recursive: true, force: true });
});

/** Fakes `.swarm/memory.db` at a size that makes getLearningStats() report
 * exactly `patterns` patterns: patterns = floor(sizeKB / 2). */
function fakeMemoryDb(patterns: number) {
  mkdirSync(join(root, '.swarm'), { recursive: true });
  const sizeKB = patterns * 2 + 1; // floor(sizeKB / 2) === patterns
  writeFileSync(join(root, '.swarm', 'memory.db'), Buffer.alloc(sizeKB * 1024));
}

async function statusline(argv: string[]): Promise<string> {
  const parser = new CommandParser();
  parser.registerCommand(hooksCommand);
  const { flags } = parser.parse(['hooks', 'statusline', ...argv]);
  const command = hooksCommand.subcommands!.find(c => c.name === 'statusline')!;
  const result = await command.action!({ args: [], flags, cwd: root, interactive: false });
  expect(result?.success).toBe(true);
  return lines.join('\n');
}

describe('hooks statusline — issue #1047 (DDD% is not DDD)', () => {
  it('full view: never labels the pattern-count tier "DDD"', async () => {
    fakeMemoryDb(80); // -> domainsCompleted=2, old dddProgress=40%
    const text = await statusline(['--full', '--no-color']);
    expect(text).not.toMatch(/DDD/);
  });

  it('full view: shows the honest "Learning Tier" label instead of "DDD Domains"', async () => {
    fakeMemoryDb(80);
    const text = await statusline(['--full', '--no-color']);
    expect(text).toContain('Learning Tier');
  });

  it('full view: shows the real pattern count ("Memory ●80") instead of a fabricated "DDD ●40%"', async () => {
    fakeMemoryDb(80);
    const text = await statusline(['--full', '--no-color']);
    expect(text).toContain('Memory ●80');
    expect(text).not.toContain('●40%');
  });

  it('a lower pattern count never renders as a stale higher "DDD %" leftover', async () => {
    // Regression for the exact user report: dropping the pattern count must
    // show a smaller honest number, never a cached/derived percentage.
    fakeMemoryDb(10); // -> domainsCompleted=1
    const text = await statusline(['--full', '--no-color']);
    expect(text).toContain('Memory ●10');
    expect(text).not.toMatch(/DDD/);
  });

  it('compact view: never emits "DDD:" either', async () => {
    fakeMemoryDb(80);
    const text = await statusline(['--compact', '--no-color']);
    expect(text).not.toMatch(/DDD/);
    expect(text).toContain('Learning:2/5');
  });
});
