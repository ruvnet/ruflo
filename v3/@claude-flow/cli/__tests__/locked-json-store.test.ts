/**
 * #4736 / ADR-531 — unit tests for the shared locked atomic JSON store helper.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

import {
  JSON_STORE_LOCK_STALE_MS,
  updateJsonStore,
  withJsonStoreLock,
  writeJsonAtomic,
} from '../src/mcp-tools/locked-json-store.js';

let dir: string;
let target: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ruflo-lockstore-')); target = join(dir, 'sub', 'store.json'); });
afterEach(() => { vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }); });

const listing = () => readdirSync(join(dir, 'sub'));

describe('writeJsonAtomic', () => {
  it('should write the value and leave no temp file when the write succeeds', () => {
    writeJsonAtomic(target, { a: 1 });
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ a: 1 });
    expect(listing().filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('should leave no temp file and keep the old content when the rename fails', () => {
    writeJsonAtomic(target, { a: 1 });
    vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw new Error('rename boom'); });
    expect(() => writeJsonAtomic(target, { a: 2 })).toThrow('rename boom');
    expect(listing().filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ a: 1 });
  });

  it('should leave no temp file when the value cannot be serialized', () => {
    const cyclic: any = {}; cyclic.self = cyclic;
    expect(() => writeJsonAtomic(target, cyclic)).toThrow();
    expect(listing().filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});

describe('withJsonStoreLock', () => {
  it('should return the operation result and release the lock when it succeeds', () => {
    expect(withJsonStoreLock(target, () => 42)).toBe(42);
    expect(existsSync(`${target}.lock`)).toBe(false);
  });

  it('should release the lock when the operation throws', () => {
    expect(() => withJsonStoreLock(target, () => { throw new Error('op failed'); })).toThrow('op failed');
    expect(existsSync(`${target}.lock`)).toBe(false);
  });

  it('should hold the lock while the operation runs', () => {
    withJsonStoreLock(target, () => { expect(existsSync(`${target}.lock`)).toBe(true); });
  });

  it('should take over a stale lock whose mtime is older than the stale threshold', () => {
    withJsonStoreLock(target, () => 0); // create parent dir
    const lock = `${target}.lock`;
    writeFileSync(lock, '');
    const old = (Date.now() - JSON_STORE_LOCK_STALE_MS - 5_000) / 1000;
    utimesSync(lock, old, old);
    expect(withJsonStoreLock(target, () => 'took over')).toBe('took over');
    expect(existsSync(lock)).toBe(false);
    expect(listing().filter((f) => f.includes('.stale.'))).toEqual([]);
  });

  it('should time out with a busy error when a fresh lock is held', () => {
    withJsonStoreLock(target, () => 0);
    const lock = `${target}.lock`;
    writeFileSync(lock, '');
    // Advance the mocked clock 1s per reading so the 5s wait deadline passes
    // without really waiting; the lock mtime sits in the future so it is never stale.
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 1_000));
    const future = (now + 3_600_000) / 1000;
    utimesSync(lock, future, future);
    expect(() => withJsonStoreLock(target, () => 'never')).toThrow(/is busy/);
    vi.restoreAllMocks();
    expect(existsSync(lock)).toBe(true); // the foreign holder's lock is untouched
  }, 10_000);

  it('should throw the synchronous-only TypeError and release the lock when given an async function', () => {
    expect(() => withJsonStoreLock(target, (async () => 1) as unknown as () => number))
      .toThrow(/must be synchronous/);
    expect(() => withJsonStoreLock(target, (async () => 1) as unknown as () => number)).toThrow(TypeError);
    expect(existsSync(`${target}.lock`)).toBe(false);
  });

  it('should reject a non-function operation', () => {
    expect(() => withJsonStoreLock(target, 5 as unknown as () => number)).toThrow(TypeError);
  });
});

describe('updateJsonStore', () => {
  it('should persist the mutation made on a fresh read', () => {
    writeJsonAtomic(target, { n: 1 });
    const read = () => JSON.parse(readFileSync(target, 'utf8')) as { n: number };
    const out = updateJsonStore(target, read, (s) => { s.n += 1; return { result: s.n }; });
    expect(out).toBe(2);
    expect(read().n).toBe(2);
  });

  it('should not write when the mutation reports changed=false', () => {
    writeJsonAtomic(target, { n: 1 });
    const read = () => JSON.parse(readFileSync(target, 'utf8')) as { n: number };
    updateJsonStore(target, read, (s) => { s.n = 99; return { result: null, changed: false }; });
    expect(read().n).toBe(1);
  });
});
