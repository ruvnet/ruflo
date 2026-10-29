/**
 * ADR-503 §2.3 — the real re-verify runner (`gitWorktreeRunner`), against a tiny temporary git repo.
 *
 * The session-layer tests (mods-learning-loop-defences.test.ts) inject a fake runner; this file runs the code that
 * actually starts project code: a detached worktree at HEAD, `npm run <script>` with no shell, the process-group kill
 * at the timeout, and the worktree removal. After every run only the main worktree is left and the
 * `ruflo-reverify-*` temp dir is gone; after a timeout the hung check's process is dead.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { gitWorktreeRunner, type ReverifyCheck } from '../src/memory/verified-reverify.js';

const npm = (name: string): ReverifyCheck => ({ name: `npm:${name}`, kind: 'test', argv: ['npm', 'run', name] });
const reverifyDirs = () => new Set(readdirSync(tmpdir()).filter((d) => d.startsWith('ruflo-reverify-')));
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe.skipIf(process.platform === 'win32')('gitWorktreeRunner (real git worktree, real process)', () => {
  let repo: string;
  let pidFile: string;
  let head: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'reverify-repo-'));
    pidFile = join(repo, '..', `${repo.split('/').at(-1)}.pid`);
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({
        name: 'reverify-fixture',
        private: true,
        scripts: {
          test: 'node -e "process.exit(0)"',
          lint: 'node -e "process.exit(1)"',
          // Writes its own pid where the test can read it after the worktree is gone, then hangs.
          build: 'node -e "require(\'fs\').writeFileSync(process.env.REVERIFY_PID_FILE, String(process.pid)); setInterval(() => {}, 1000)"',
        },
      }),
    );
    git('init', '-q');
    git('add', 'package.json');
    git('-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'fixture');
    head = git('rev-parse', 'HEAD');
    process.env.REVERIFY_PID_FILE = pidFile;
  });

  afterAll(() => {
    delete process.env.REVERIFY_PID_FILE;
    rmSync(repo, { recursive: true, force: true });
    rmSync(pidFile, { force: true });
  });

  /** Runs one check and asserts the cleanup contract: one worktree left, no new temp dir. */
  async function run(check: ReverifyCheck, timeoutMs: number) {
    const before = reverifyDirs();
    const outcome = await gitWorktreeRunner(repo, check, timeoutMs);
    expect(git('worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree '))).toHaveLength(1);
    expect([...reverifyDirs()].filter((d) => !before.has(d))).toEqual([]);
    return outcome;
  }

  it('passes on exit 0 and records the commit it ran at', async () => {
    expect(await run(npm('test'), 30_000)).toEqual({ status: 'pass', commit: head });
  }, 40_000);

  it('fails on a non-zero exit', async () => {
    expect(await run(npm('lint'), 30_000)).toEqual({ status: 'fail', commit: head });
  }, 40_000);

  it('a missing script is a failure, not a pass', async () => {
    expect((await run(npm('typecheck'), 30_000)).status).toBe('fail');
  }, 40_000);

  it('times out a hung check and kills its whole process group', async () => {
    rmSync(pidFile, { force: true });
    const started = Date.now();
    // Long enough for npm to start the script and write its pid; short enough to keep the suite fast.
    expect(await run(npm('build'), 3_000)).toEqual({ status: 'timeout', commit: head });
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(existsSync(pidFile)).toBe(true);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    expect(pid).toBeGreaterThan(0);
    let tries = 0;
    while (alive(pid) && tries++ < 50) await new Promise((r) => setTimeout(r, 20));
    expect(alive(pid)).toBe(false);
  }, 40_000);

  it('a directory that is not a git repo is an error, and leaves no temp dir behind', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'reverify-plain-'));
    try {
      const before = reverifyDirs();
      expect(await gitWorktreeRunner(plain, npm('test'), 5_000)).toEqual({ status: 'error', commit: null });
      expect([...reverifyDirs()].filter((d) => !before.has(d))).toEqual([]);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
