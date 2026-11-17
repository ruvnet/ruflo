/**
 * github_repo_analyze reads owner/repo from `git remote get-url origin` when
 * they are not passed. The pattern stopped the repo name at the first dot, so
 * remotes such as vercel/next.js or socketio/socket.io did not match and the
 * repository was reported (and stored) as local/repo.
 *
 * Mocks `node:child_process` like github-tools-false-success-4424.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execSyncMock = vi.fn();

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  execSync: (...args: unknown[]) => execSyncMock(...args),
}));

const originalProjectCwd = process.env.CLAUDE_FLOW_CWD;

function gitWithRemote(remoteUrl: string) {
  execSyncMock.mockImplementation((cmd: string) => {
    if (cmd === 'git remote get-url origin') return `${remoteUrl}\n`;
    if (cmd === 'git rev-list --count HEAD') return '42\n';
    if (cmd.startsWith('git ')) return '1\n';
    // No gh CLI: skip the issue/PR counts.
    throw new Error('not found');
  });
}

async function analyze(input: Record<string, unknown> = {}) {
  const { githubTools } = await import('../src/mcp-tools/github-tools.js');
  const t = githubTools.find((c) => c.name === 'github_repo_analyze')!;
  return (await t.handler(input)) as Record<string, unknown>;
}

beforeEach(() => {
  execSyncMock.mockReset();
  const scratch = mkdtempSync(join(tmpdir(), 'ruflo-repo-analyze-'));
  process.env.CLAUDE_FLOW_CWD = scratch;
  mkdirSync(join(scratch, '.claude-flow', 'github'), { recursive: true });
});

afterEach(() => {
  if (originalProjectCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
  else process.env.CLAUDE_FLOW_CWD = originalProjectCwd;
});

describe('github_repo_analyze owner/repo from the origin remote', () => {
  it.each([
    ['https://github.com/vercel/next.js.git', 'vercel/next.js'],
    ['https://github.com/vercel/next.js', 'vercel/next.js'],
    ['git@github.com:socketio/socket.io.git', 'socketio/socket.io'],
    ['git@github.com:mrdoob/three.js', 'mrdoob/three.js'],
    ['https://github.com/ruvnet/ruflo.git', 'ruvnet/ruflo'],
    ['git@github.com:ruvnet/ruflo', 'ruvnet/ruflo'],
  ])('%s is %s', async (remoteUrl, expected) => {
    gitWithRemote(remoteUrl);
    const r = await analyze();
    expect(r.success).toBe(true);
    expect(r.repository).toBe(expected);
  });

  it('keeps an explicitly passed owner and repo', async () => {
    gitWithRemote('https://github.com/vercel/next.js.git');
    const r = await analyze({ owner: 'acme', repo: 'widgets' });
    expect(r.repository).toBe('acme/widgets');
  });
});

describe('github_repo_analyze never echoes credentials from the origin remote', () => {
  it.each([
    ['https://x-access-token:ghp_SECRET@github.com/ruvnet/ruflo.git', 'https://github.com/ruvnet/ruflo.git'],
    ['https://oauth2:p@ss@gitlab.com/acme/next.js.git', 'https://gitlab.com/acme/next.js.git'],
    ['ssh://git@github.com/ruvnet/ruflo.git', 'ssh://github.com/ruvnet/ruflo.git'],
    ['git@github.com:ruvnet/ruflo.git', 'git@github.com:ruvnet/ruflo.git'],
  ])('%s is reported as %s', async (remoteUrl, expected) => {
    gitWithRemote(remoteUrl);
    const r = await analyze();
    expect(r.remoteUrl).toBe(expected);
    expect(JSON.stringify(r)).not.toMatch(/SECRET|p@ss/);
  });
});
