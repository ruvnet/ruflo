/**
 * #4736 / ADR-531 — lock ownership and failure paths of locked-json-store.
 * Covers the review findings: release must not delete a successor's lock,
 * stale takeover works, a held lock times out as "busy", and a takeover that
 * keeps failing with a non-ENOENT error backs off to the deadline instead of
 * spinning forever.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSON_STORE_LOCK_STALE_MS, updateJsonStore, withJsonStoreLock, writeJsonAtomic } from '../src/mcp-tools/locked-json-store.js';

let dir: string;
let store: string;
let lock: string;

function backdate(path: string): void {
  const old = (Date.now() - JSON_STORE_LOCK_STALE_MS - 60_000) / 1000;
  utimesSync(path, old, old);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ruflo-lock-4736-'));
  store = join(dir, 'store.json');
  lock = `${store}.lock`;
});

afterEach(() => {
  try { chmodSync(dir, 0o700); } catch { /* already writable */ }
  rmSync(dir, { recursive: true, force: true });
});

describe('locked-json-store ownership (#4736)', () => {
  it('writes an owner token and removes only its own lock on release', () => {
    let tokenSeen = '';
    withJsonStoreLock(store, () => { tokenSeen = readFileSync(lock, 'utf-8'); });
    expect(tokenSeen).toMatch(new RegExp(`^${process.pid}\\.[0-9a-f]{16}$`));
    expect(existsSync(lock)).toBe(false);
  });

  it('does not delete a successor lock after its own lock was taken over', () => {
    withJsonStoreLock(store, () => {
      // Simulate: this holder overran the stale window and another process
      // took the lock over and now holds it with its own token.
      writeFileSync(lock, 'successor-token');
    });
    expect(readFileSync(lock, 'utf-8')).toBe('successor-token');
  });

  it('takes over a stale lock left by a crashed process', () => {
    writeFileSync(lock, 'crashed-holder');
    backdate(lock);
    const started = Date.now();
    const value = withJsonStoreLock(store, () => 42);
    expect(value).toBe(42);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(existsSync(lock)).toBe(false);
    expect(readdirSync(dir).filter((name) => name.includes('.stale.'))).toEqual([]);
  });

  it('reports busy when a live lock is held past the wait deadline', () => {
    writeFileSync(lock, 'live-holder');
    expect(() => withJsonStoreLock(store, () => 1)).toThrow(/is busy/);
    expect(readFileSync(lock, 'utf-8')).toBe('live-holder');
  }, 15_000);

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'backs off to the deadline when a stale lock cannot be renamed (no busy spin)',
    () => {
      writeFileSync(lock, 'crashed-holder');
      backdate(lock);
      chmodSync(dir, 0o555); // rename now fails with EACCES, not ENOENT
      const started = Date.now();
      expect(() => withJsonStoreLock(store, () => 1)).toThrow(/is busy/);
      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(4_000);
      expect(elapsed).toBeLessThan(10_000);
    },
    20_000,
  );

  it('refuses an async operation and still releases the lock', () => {
    expect(() => withJsonStoreLock(store, (() => Promise.resolve(1)) as unknown as () => number))
      .toThrow(/must be synchronous/);
    expect(existsSync(lock)).toBe(false);
  });

  it('releases the lock when the operation throws', () => {
    expect(() => withJsonStoreLock(store, () => { throw new Error('boom'); })).toThrow('boom');
    expect(existsSync(lock)).toBe(false);
  });

  it('writes atomically without leaving temp files, and skips unchanged writes', () => {
    writeJsonAtomic(store, { n: 1 });
    const n = updateJsonStore(store, () => JSON.parse(readFileSync(store, 'utf-8')) as { n: number }, (s) => {
      s.n += 1;
      return { result: s.n };
    });
    expect(n).toBe(2);
    updateJsonStore(store, () => ({ n: 99 }), () => ({ result: undefined, changed: false }));
    expect(JSON.parse(readFileSync(store, 'utf-8'))).toEqual({ n: 2 });
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp') || name.endsWith('.lock'))).toEqual([]);
  });
});
