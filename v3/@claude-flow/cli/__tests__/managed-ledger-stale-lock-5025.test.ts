// #5025: two waiters that both saw the same stale ledger lock could both break it.
// Waiter A unlinks the dead lock and takes a fresh one; waiter B, still acting on what
// it saw earlier, then unlinked A's fresh lock and took its own, so two writers ran
// their read-modify-rename at once and one session record was lost.
//
// The interleaving is forced deterministically: B's first lstat of the lock (the one
// where it decides the lock is stale) runs contender A to completion before returning
// the stale stats it saw. Exactly one of A and B may then hold the lock.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, lstatSync: vi.fn(actual.lstatSync) };
});

const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
const { acquireLedgerLock, recordManagedSession, managedLedgerPath } = await import('../src/services/managed-run-store.js');

let dir: string;
let lockPath: string;
const writeStaleLock = () => {
  actual.writeFileSync(lockPath, '999999 0\n');
  const old = (Date.now() - 60_000) / 1000;
  actual.utimesSync(lockPath, old, old);
};

beforeEach(() => {
  dir = actual.mkdtempSync(join(tmpdir(), 'ledger-lock-5025-'));
  lockPath = join(dir, 'sessions.json.lock');
});
afterEach(() => {
  vi.mocked(fs.lstatSync).mockReset();
  vi.mocked(fs.lstatSync).mockImplementation(actual.lstatSync as typeof fs.lstatSync);
  actual.rmSync(dir, { recursive: true, force: true });
});

describe('managed-agent ledger stale-lock takeover (#5025)', () => {
  it('two waiters that saw the same stale lock: exactly one acquires', () => {
    writeStaleLock();
    let releaseA: (() => void) | undefined;
    let inodeA: number | undefined;
    vi.mocked(fs.lstatSync).mockImplementationOnce(((p: fs.PathLike) => {
      const seen = actual.lstatSync(p); // B sees the dead writer's lock...
      releaseA = acquireLedgerLock(lockPath); // ...then A breaks it and takes a fresh one
      inodeA = actual.lstatSync(lockPath).ino;
      return seen;
    }) as typeof fs.lstatSync);

    let releaseB: (() => void) | undefined;
    let errorB: unknown;
    try { releaseB = acquireLedgerLock(lockPath); } catch (error) { errorB = error; }

    expect(releaseA).toBeTypeOf('function');
    const holders = [releaseA, releaseB].filter(Boolean);
    expect(holders).toHaveLength(1);
    expect((errorB as NodeJS.ErrnoException | undefined)?.code).toBe('EEXIST');
    expect(actual.lstatSync(lockPath).ino).toBe(inodeA); // A's lock survived B
    expect(actual.existsSync(`${lockPath}.reclaim`)).toBe(false);

    releaseA!();
    expect(actual.existsSync(lockPath)).toBe(false);
  });

  it('a single waiter still breaks a lock left by a dead writer', () => {
    writeStaleLock();
    const release = acquireLedgerLock(lockPath);
    expect(actual.readFileSync(lockPath, 'utf8')).toMatch(new RegExp(`^${process.pid} `));
    release();
    expect(actual.existsSync(lockPath)).toBe(false);
    expect(actual.existsSync(`${lockPath}.reclaim`)).toBe(false);
  });

  it('a fresh lock is never broken', () => {
    actual.writeFileSync(lockPath, '999999 0\n');
    expect(() => acquireLedgerLock(lockPath)).toThrow(expect.objectContaining({ code: 'EEXIST' }));
    expect(actual.readFileSync(lockPath, 'utf8')).toBe('999999 0\n');
  });

  it('removes a reclaim guard orphaned by a breaker that died, then breaks the stale lock', () => {
    writeStaleLock();
    actual.writeFileSync(`${lockPath}.reclaim`, '');
    const old = (Date.now() - 60_000) / 1000;
    actual.utimesSync(`${lockPath}.reclaim`, old, old);
    const release = acquireLedgerLock(lockPath);
    release();
    expect(actual.existsSync(`${lockPath}.reclaim`)).toBe(false);
  });

  it('release leaves a lock that is no longer the one it created', () => {
    const release = acquireLedgerLock(lockPath);
    actual.writeFileSync(`${lockPath}.other`, 'someone else\n'); // created while ours exists: a different inode
    actual.renameSync(`${lockPath}.other`, lockPath);
    release();
    expect(actual.readFileSync(lockPath, 'utf8')).toBe('someone else\n');
  });

  it('recordManagedSession still writes through the lock end to end', () => {
    const root = actual.mkdtempSync(join(tmpdir(), 'ledger-root-5025-'));
    vi.stubEnv('RUFLO_AI_BUDGET_DIR', join(root, 'budget')); // keep the ledger out of the real home
    try {
      recordManagedSession(root, 'sesn_a1', 'env_a1');
      recordManagedSession(root, 'sesn_b2', 'env_b2');
      const ledger = JSON.parse(actual.readFileSync(managedLedgerPath(root), 'utf8'));
      expect(ledger.sessions.map((s: { sessionId: string }) => s.sessionId)).toEqual(['sesn_b2', 'sesn_a1']);
      expect(actual.existsSync(`${managedLedgerPath(root)}.lock`)).toBe(false);
    } finally { actual.rmSync(root, { recursive: true, force: true }); vi.unstubAllEnvs(); }
  });
});
