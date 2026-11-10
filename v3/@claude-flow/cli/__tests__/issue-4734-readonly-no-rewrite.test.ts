/**
 * Regression coverage for issue #4734: the sql.js fallback getEntry path was a
 * mutator, not a reader — every read bumped access_count and then exported the
 * whole sql.js image back over the live database. That made each get a full-image
 * write serialized on the exclusive memory.db lock, so concurrent readers raced
 * real writers and, under load, some reads could fail to acquire the lock.
 *
 * The fix makes getEntry read-only: it no longer bumps access_count nor
 * re-persists the image (and no longer takes the exclusive lock around the read).
 * The response still reports accessCount = stored + 1 (display-only).
 *
 * These cases pin two guarantees:
 *   1. A plain read does not touch the database file (mtime/size unchanged).
 *   2. Concurrent readers + a writer do not lose the writer's row or error out.
 *
 * The bridge is force-disabled via CLAUDE_FLOW_DISABLE_BRIDGE=1 so every case
 * exercises the sql.js fallback path directly, deterministically (same switch
 * the #2735 suite uses).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let dir: string;
let dbPath: string;
const ORIGINAL_ENV = process.env.CLAUDE_FLOW_DISABLE_BRIDGE;

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'ruflo-4734-'));
  dbPath = path.join(dir, 'memory.db');
  process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
  const { initializeMemoryDatabase } = await import('../src/memory/memory-initializer.js');
  const initResult = await initializeMemoryDatabase({ dbPath, verbose: false });
  expect(initResult.success).toBe(true);
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
  else process.env.CLAUDE_FLOW_DISABLE_BRIDGE = ORIGINAL_ENV;
  rmSync(dir, { recursive: true, force: true });
});

describe('memory getEntry is read-only — issue #4734', () => {
  it('getEntry does not rewrite the database file on a plain read', async () => {
    const { storeEntry, getEntry } = await import('../src/memory/memory-initializer.js');
    const stored = await storeEntry({ key: 'k1', value: 'v1', dbPath, generateEmbeddingFlag: false });
    expect(stored.success).toBe(true);

    const before = statSync(dbPath);
    const beforeMtime = before.mtimeMs;
    const beforeSize = before.size;

    const result = await getEntry({ key: 'k1', dbPath });
    expect(result.success).toBe(true);
    expect(result.found).toBe(true);
    expect(result.entry?.content).toBe('v1');

    const after = statSync(dbPath);
    // The whole point of #4734: a read must not flush the image.
    expect(after.mtimeMs).toBe(beforeMtime);
    expect(after.size).toBe(beforeSize);
  });

  it('getEntry still reports accessCount = stored + 1 (display-only, not persisted)', async () => {
    const { storeEntry, getEntry } = await import('../src/memory/memory-initializer.js');
    await storeEntry({ key: 'k2', value: 'v2', dbPath, generateEmbeddingFlag: false });

    const first = await getEntry({ key: 'k2', dbPath });
    expect(first.found).toBe(true);
    expect(first.entry?.accessCount).toBe(1);

    // A second read does not advance the persisted count (nothing is written),
    // so it still reports stored(0) + 1.
    const second = await getEntry({ key: 'k2', dbPath });
    expect(second.entry?.accessCount).toBe(1);
  });

  it('concurrent readers do not lose a writer\'s row nor fail on the lock', async () => {
    const { storeEntry, getEntry } = await import('../src/memory/memory-initializer.js');
    await storeEntry({ key: 'seed', value: 'seed-value', dbPath, generateEmbeddingFlag: false });

    const rounds = 8;
    const readerResults: Array<{ success: boolean; found: boolean; error?: string }> = [];

    // Fire several readers that each read the seed key, interleaved with a
    // writer storing a fresh key — all in flight together.
    const tasks: Promise<void>[] = [];
    for (let i = 0; i < rounds; i++) {
      tasks.push(
        (async () => {
          const r = await getEntry({ key: 'seed', dbPath });
          readerResults.push({ success: r.success, found: r.found, error: r.error });
        })(),
      );
    }
    tasks.push(
      (async () => {
        const w = await storeEntry({ key: 'fresh', value: 'fresh-value', dbPath, generateEmbeddingFlag: false });
        expect(w.success).toBe(true);
      })(),
    );

    await Promise.all(tasks);

    // No reader should have errored (e.g. lock-acquire timeout) — pre-fix the
    // readers each held the exclusive lock for a whole-image write and contended.
    for (const r of readerResults) {
      expect(r.success).toBe(true);
      expect(r.found).toBe(true);
      expect(r.error).toBeUndefined();
    }

    // The writer's row must have survived all the concurrent reads.
    const fresh = await getEntry({ key: 'fresh', dbPath });
    expect(fresh.success).toBe(true);
    expect(fresh.found).toBe(true);
    expect(fresh.entry?.content).toBe('fresh-value');
  });
});
