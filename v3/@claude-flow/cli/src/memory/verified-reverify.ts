/**
 * Re-verify before training (ADR-503 §2.3). Opt-in: `.claude-flow/config.json`
 * `learningLoop.reverify: true`. Off by default because it runs project code.
 *
 * - The command comes only from a fixed allowlist built from the project's own
 *   manifest (`package.json` scripts named test/typecheck/build/lint, or
 *   `cargo test`/`cargo check` when `Cargo.toml` exists). A record's text is
 *   never executed: it only selects, by its verifier *kind*, which allowlisted
 *   check NOT to run.
 * - Checks rotate round-robin across ingests, preferring one the record did
 *   not use, so no single check is the one that counts.
 * - The real runner works in a temporary detached `git worktree` at HEAD,
 *   with a hard timeout; timeout, error or a non-zero exit downgrades the
 *   record to `unknown`.
 */

import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { VerifierKind } from './verified-outcomes.js';

export interface ReverifyCheck {
  /** `npm:test`, `cargo:check`, ...: a stable name for the ledger. */
  readonly name: string;
  readonly kind: VerifierKind;
  readonly argv: readonly string[];
}

export interface ReverifyOutcome {
  readonly status: 'pass' | 'fail' | 'timeout' | 'error';
  /** The commit the check ran at, when known. */
  readonly commit: string | null;
}

/** Runs one allowlisted check for `root` at HEAD. Injectable so tests never start a process. */
export type ReverifyRunner = (root: string, check: ReverifyCheck, timeoutMs: number) => Promise<ReverifyOutcome>;

/** package.json scripts that may be re-run, in rotation order, and the kind each verifies. */
const NPM_SCRIPTS: ReadonlyArray<readonly [string, VerifierKind]> = [
  ['test', 'test'],
  ['typecheck', 'typecheck'],
  ['build', 'build'],
  ['lint', 'lint'],
];

/**
 * The allowlist for a project. Only the script NAMES are read from the
 * manifest; the argv is fixed here (`npm run <name>`, `cargo test`, ...).
 */
export function reverifyChecks(root: string): ReverifyCheck[] {
  const checks: ReverifyCheck[] = [];
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts?: unknown };
    const scripts = pkg && typeof pkg.scripts === 'object' && pkg.scripts !== null ? (pkg.scripts as Record<string, unknown>) : {};
    for (const [name, kind] of NPM_SCRIPTS) {
      if (typeof scripts[name] === 'string' && (scripts[name] as string).trim()) checks.push({ name: `npm:${name}`, kind, argv: ['npm', 'run', name] });
    }
  } catch {
    // no or unreadable package.json: no npm checks
  }
  if (existsSync(join(root, 'Cargo.toml'))) {
    checks.push({ name: 'cargo:test', kind: 'test', argv: ['cargo', 'test'] });
    checks.push({ name: 'cargo:check', kind: 'typecheck', argv: ['cargo', 'check'] });
  }
  return checks;
}

/**
 * The check to run for a record decided by a `used` verifier: round-robin by
 * `cursor` over the checks of another kind, or over all of them when every
 * check is that kind. Null when the project has none.
 */
export function pickCheck(checks: readonly ReverifyCheck[], used: VerifierKind, cursor: number): ReverifyCheck | null {
  if (checks.length === 0) return null;
  const others = checks.filter(c => c.kind !== used);
  const pool = others.length > 0 ? others : checks;
  return pool[Math.abs(Math.floor(cursor)) % pool.length]!;
}

const COMMIT = /^[0-9a-f]{40,64}$/;

function git(args: string[], cwd: string, timeout = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout, maxBuffer: 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(String(stdout))));
  });
}

/** Runs argv (no shell) in `cwd`; the whole process group is killed at the timeout. */
function runCheck(argv: readonly string[], cwd: string, timeoutMs: number): Promise<ReverifyOutcome['status']> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (status: ReverifyOutcome['status']) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(status);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(argv[0]!, argv.slice(1), { cwd, shell: false, stdio: 'ignore', detached: process.platform !== 'win32', env: { ...process.env, CI: '1' } });
    } catch {
      resolve('error');
      return;
    }
    const timer = setTimeout(() => {
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        // already gone
      }
      finish('timeout');
    }, timeoutMs);
    child.on('error', () => finish('error'));
    child.on('exit', code => finish(code === 0 ? 'pass' : 'fail'));
  });
}

/**
 * The real runner: a detached `git worktree` at HEAD in a temp directory, the
 * root's `node_modules` linked in (a fresh worktree has none), the check run,
 * the worktree removed. Any failure along the way is `error`.
 */
export const gitWorktreeRunner: ReverifyRunner = async (root, check, timeoutMs) => {
  let commit: string | null = null;
  const base = mkdtempSync(join(tmpdir(), 'ruflo-reverify-'));
  const dir = join(base, 'wt');
  let added = false;
  try {
    const head = (await git(['rev-parse', 'HEAD'], root, 10_000)).trim();
    if (!COMMIT.test(head)) return { status: 'error', commit: null };
    commit = head;
    await git(['worktree', 'add', '--detach', dir, head], root);
    added = true;
    if (existsSync(join(root, 'node_modules')) && !existsSync(join(dir, 'node_modules'))) symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
    return { status: await runCheck(check.argv, dir, timeoutMs), commit };
  } catch {
    return { status: 'error', commit };
  } finally {
    if (added) await git(['worktree', 'remove', '--force', dir], root).catch(() => undefined);
    rmSync(base, { recursive: true, force: true });
    if (added) await git(['worktree', 'prune'], root).catch(() => undefined);
  }
};

/** A runner that never settles still ends: past the deadline its outcome is `timeout`. */
function withDeadline(run: Promise<ReverifyOutcome>, ms: number): Promise<ReverifyOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<ReverifyOutcome>(resolve => {
    timer = setTimeout(() => resolve({ status: 'timeout', commit: null }), ms);
    timer.unref?.();
  });
  return Promise.race([run, deadline]).finally(() => clearTimeout(timer));
}

/** One ingest's re-verification: picks per record, runs each distinct check at most once, never throws. */
export class ReverifySession {
  private readonly results = new Map<string, Promise<ReverifyOutcome>>();
  private readonly checks: ReverifyCheck[];
  ran = 0;

  constructor(
    private readonly root: string,
    private readonly cursor: number,
    private readonly timeoutMs: number,
    private readonly runner: ReverifyRunner,
    checks?: ReverifyCheck[],
  ) {
    this.checks = checks ?? reverifyChecks(root);
  }

  /** Re-verifies a success decided by a `used` verifier. The record's own command and task are never passed. */
  async verify(used: VerifierKind): Promise<{ check: string | null; outcome: ReverifyOutcome }> {
    const check = pickCheck(this.checks, used, this.cursor);
    if (!check) return { check: null, outcome: { status: 'error', commit: null } };
    let pending = this.results.get(check.name);
    if (!pending) {
      this.ran++;
      pending = withDeadline(Promise.resolve().then(() => this.runner(this.root, check, this.timeoutMs)),this.timeoutMs + Math.min(this.timeoutMs, 30_000)).then(
        o => (o && ['pass', 'fail', 'timeout', 'error'].includes(o.status) ? { status: o.status, commit: typeof o.commit === 'string' && COMMIT.test(o.commit) ? o.commit : null } : { status: 'error' as const, commit: null }),
        () => ({ status: 'error' as const, commit: null }),
      );
      this.results.set(check.name, pending);
    }
    return { check: check.name, outcome: await pending };
  }
}
