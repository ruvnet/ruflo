/**
 * updateJsonStore: load → mutate → atomic save under the store's lock file.
 * Cross-process contention is covered by json-store-concurrency.test.ts; these
 * tests pin the helper's own edge cases in one process.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Lets a test make the next acquireLock fail without waiting out the real 5 s timeout.
const lockFault = vi.hoisted(() => ({ next: undefined as Error | undefined }));
vi.mock('../src/services/policy-runtime.js', async (original) => {
  const real = await original<typeof import('../src/services/policy-runtime.js')>();
  return {
    ...real,
    acquireLock: (path: string) => {
      const fault = lockFault.next;
      lockFault.next = undefined;
      return fault ? Promise.reject(fault) : real.acquireLock(path);
    },
  };
});

import { storeLockPath, updateJsonStore } from '../src/mcp-tools/locked-json-store.js';
import { readRecordStore } from '../src/mcp-tools/record-store.js';
import { acquireLock } from '../src/services/policy-runtime.js';

interface Store { items: Record<string, number> }

let dir: string;
let file: string;
const load = () => readRecordStore<Store>(file, 'items', () => ({ items: {} }));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ruflo-locked-store-'));
  file = join(dir, 'nested', 'store.json');
});

afterEach(() => {
  lockFault.next = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe('updateJsonStore', () => {
  it('creates the folder, saves the change and returns the result', async () => {
    const result = await updateJsonStore(file, load, (store) => {
      store.items.a = 1;
      return { save: true, result: 'ok' };
    }, 'test');
    expect(result).toBe('ok');
    expect(JSON.parse(readFileSync(file, 'utf-8')).items).toEqual({ a: 1 });
  });

  it('applies each update to the latest data', async () => {
    await Promise.all(['a', 'b', 'c'].map((key) => updateJsonStore(file, load, (store) => {
      store.items[key] = 1;
      return { save: true, result: undefined };
    }, 'test')));
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf-8')).items).sort()).toEqual(['a', 'b', 'c']);
  });

  it('leaves the file untouched when save is false', async () => {
    mkdirSync(join(dir, 'nested'));
    writeFileSync(file, '{"items":{"a":1}}');
    const before = statSync(file).mtimeMs;
    const result = await updateJsonStore(file, load, (store) => {
      store.items.b = 2; // a refused operation may still have touched its copy
      return { save: false, result: 'refused' };
    }, 'test');
    expect(result).toBe('refused');
    expect(readFileSync(file, 'utf-8')).toBe('{"items":{"a":1}}');
    expect(statSync(file).mtimeMs).toBe(before);
  });

  it('releases the lock and writes nothing when mutate throws', async () => {
    await expect(updateJsonStore(file, load, () => { throw new Error('boom'); }, 'test'))
      .rejects.toThrow('boom');
    expect(existsSync(file)).toBe(false);
    expect(existsSync(storeLockPath(file))).toBe(false);
    // The next writer gets the lock straight away.
    await updateJsonStore(file, load, (store) => { store.items.a = 1; return { save: true, result: undefined }; }, 'test');
    expect(JSON.parse(readFileSync(file, 'utf-8')).items).toEqual({ a: 1 });
  });

  it('keeps a corrupt store and writes nothing', async () => {
    mkdirSync(join(dir, 'nested'));
    writeFileSync(file, '{"items": [1, 2]}');
    await expect(updateJsonStore(file, load, (store) => {
      store.items.a = 1;
      return { save: true, result: undefined };
    }, 'test')).rejects.toThrow(/Invalid items store/);
    expect(readFileSync(file, 'utf-8')).toBe('{"items": [1, 2]}');
    expect(existsSync(storeLockPath(file))).toBe(false);
  });

  it('waits for a lock held elsewhere, then applies the update', async () => {
    mkdirSync(join(dir, 'nested'));
    const release = await acquireLock(storeLockPath(file));
    let applied = false;
    const pending = updateJsonStore(file, load, (store) => {
      applied = true;
      store.items.a = 1;
      return { save: true, result: undefined };
    }, 'test');
    await new Promise((r) => setTimeout(r, 50));
    expect(applied).toBe(false);
    release();
    await pending;
    expect(JSON.parse(readFileSync(file, 'utf-8')).items).toEqual({ a: 1 });
  });

  it('reports a lock timeout as a busy store to retry, and writes nothing', async () => {
    lockFault.next = new Error('policy-state-lock-timeout');
    await expect(updateJsonStore(file, load, () => ({ save: true, result: undefined }), 'tasks'))
      .rejects.toThrow('tasks store is busy (another process holds store.json.lock); retry');
    expect(existsSync(file)).toBe(false);
  });

  it('keeps the message of any other lock failure', async () => {
    lockFault.next = new Error('policy-state-lock-error: lock path is not a regular file');
    await expect(updateJsonStore(file, load, () => ({ save: true, result: undefined }), 'tasks'))
      .rejects.toThrow('policy-state-lock-error: lock path is not a regular file');
  });

  it('leaves no lock or temp files behind', async () => {
    await updateJsonStore(file, load, (store) => { store.items.a = 1; return { save: true, result: undefined }; }, 'test');
    expect(readdirSync(join(dir, 'nested'))).toEqual(['store.json']);
  });
});
