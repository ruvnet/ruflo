/**
 * #4736 — lock ownership in updateJsonStore. Ported from #4987
 * (nicholas-ruest) onto #4981's lock, which is the policy runtime's
 * acquireLock: the lock file records its owner (pid, host, pid namespace,
 * boot id, nonce), release removes it only while it still holds that exact
 * record, and only a lock whose owner process is dead is reclaimed. There is
 * no age-based stale takeover, so #4987's mtime/backdate cases do not apply;
 * the dead-owner reclaim stands in for them.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readlinkSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { saved, storeLockPath, updateJsonStore } from '../src/mcp-tools/locked-json-store.js';

let dir: string;
let store: string;
let lock: string;
const load = () => (existsSync(store) ? JSON.parse(readFileSync(store, 'utf-8')) : { n: 0 }) as { n: number };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ruflo-lock-own-4736-'));
  store = join(dir, 'store.json');
  lock = storeLockPath(store);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('updateJsonStore lock ownership (#4736)', () => {
  it('records its owner in the lock and removes only its own lock on release', async () => {
    let seen: Record<string, unknown> = {};
    await updateJsonStore(store, load, (s) => {
      seen = JSON.parse(readFileSync(lock, 'utf-8'));
      s.n += 1;
      return saved(undefined);
    }, 'test');
    expect(seen.pid).toBe(process.pid);
    expect(typeof seen.nonce).toBe('string');
    expect(existsSync(lock)).toBe(false);
  });

  it('does not delete a successor lock after its own lock was taken over', async () => {
    const successor = JSON.stringify({ pid: process.pid, nonce: 'successor' });
    await updateJsonStore(store, load, (s) => {
      // Simulate: another process took the lock over while this holder ran.
      unlinkSync(lock);
      writeFileSync(lock, successor);
      s.n += 1;
      return saved(undefined);
    }, 'test');
    expect(readFileSync(lock, 'utf-8')).toBe(successor);
  });

  it.skipIf(process.platform !== 'linux')('reclaims a lock left by a dead process', async () => {
    let pidns: string | undefined;
    let boot: string | undefined;
    try { pidns = readlinkSync('/proc/self/ns/pid'); } catch { /* no /proc */ }
    try { boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(); } catch { /* no /proc */ }
    if (!pidns || !boot) return;
    // A real pid that has exited (it may be reused, which only makes the test
    // wait out the timeout and fail loudly, never pass wrongly).
    const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
    const deadPid = Number(dead.stdout);
    writeFileSync(lock, JSON.stringify({
      pid: deadPid, acquiredAt: Date.now(), host: hostname(), platform: process.platform,
      pidns, boot, nonce: 'crashed-holder',
    }));
    const started = Date.now();
    const n = await updateJsonStore(store, load, (s) => { s.n += 1; return saved(s.n); }, 'test');
    expect(n).toBe(1);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(existsSync(lock)).toBe(false);
    expect(existsSync(`${lock}.reclaim`)).toBe(false);
  });

  it('never reclaims a lock whose owner is alive', async () => {
    const live = JSON.stringify({ pid: process.pid, host: hostname(), platform: process.platform, nonce: 'live-holder' });
    writeFileSync(lock, live);
    await expect(updateJsonStore(store, load, () => saved(undefined), 'test')).rejects.toThrow(/busy/);
    expect(readFileSync(lock, 'utf-8')).toBe(live);
    expect(existsSync(store)).toBe(false);
  }, 15_000);
});
