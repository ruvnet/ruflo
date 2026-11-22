/**
 * #5065 — the sql.js fallbacks behind memory_search (searchEntries) and
 * memory_search_unified (listEntries) must not write the store.
 *
 * Each call is checked two ways: a content hash of every file under the memory
 * root before and after, and an inotify watch on that directory, which also
 * catches a file created and unlinked during the call (the memory.db.lock that
 * withMemoryDbLock takes). The bridge is disabled so the fallback runs.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';

/** The same load rabitq-index.ts performs; the RaBitQ case is skipped where the optional module cannot load. */
const rabitqAvailable = await (async () => {
  try {
    const mod = await import('@ruvector/rabitq-wasm');
    const wasm = createRequire(import.meta.url).resolve('@ruvector/rabitq-wasm/ruvector_rabitq_wasm_bg.wasm');
    mod.initSync({ module: readFileSync(wasm) });
    return true;
  } catch {
    return false;
  }
})();
const ENV_KEYS = ['CLAUDE_FLOW_DISABLE_BRIDGE', 'CLAUDE_FLOW_MEMORY_PATH'] as const;
const saved: Record<string, string | undefined> = {};
let dir: string;
let root: string;
let dbPath: string;

function snapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(root)) {
    const file = path.join(root, name);
    if (!statSync(file).isFile()) continue;
    out[name] = createHash('sha256').update(readFileSync(file)).digest('hex');
  }
  return out;
}

/** Runs fn and returns every file name inotify saw touched under the memory root. */
async function touched(fn: () => Promise<unknown>): Promise<string[]> {
  const seen = new Set<string>();
  const watcher: FSWatcher = watch(root, (_event, name) => { if (name) seen.add(String(name)); });
  try {
    await fn();
    await new Promise(r => setTimeout(r, 150));
  } finally {
    watcher.close();
  }
  return [...seen].sort();
}

async function load() {
  const mod = await import('../src/memory/memory-initializer.js');
  mod._resetMemoryRootCache();
  return mod;
}

beforeEach(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  dir = mkdtempSync(path.join(tmpdir(), 'ruflo-5065-'));
  root = path.join(dir, '.swarm');
  dbPath = path.join(root, 'memory.db');
  process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
  process.env.CLAUDE_FLOW_MEMORY_PATH = root;
  const { initializeMemoryDatabase, storeEntry } = await load();
  expect((await initializeMemoryDatabase({ dbPath, verbose: false })).success).toBe(true);
  for (const [key, value] of [['alpha', 'authentication with refresh tokens'], ['beta', 'vector search with hnsw'], ['gamma', 'release checklist for npm']]) {
    expect((await storeEntry({ key, value, dbPath })).success).toBe(true);
  }
});

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  (await import('../src/memory/memory-initializer.js'))._resetMemoryRootCache();
  rmSync(dir, { recursive: true, force: true });
});

describe('#5065 memory search fallbacks are read-only', () => {
  it('searchEntries finds entries and writes nothing under the memory root', async () => {
    const { searchEntries } = await load();
    const before = snapshot();
    let result: Awaited<ReturnType<typeof searchEntries>> | undefined;
    const names = await touched(async () => { result = await searchEntries({ query: 'authentication tokens', dbPath, threshold: 0 }); });

    expect(result?.success).toBe(true);
    expect(result?.results.map(r => r.key)).toContain('alpha');
    expect(names).toEqual([]);
    expect(snapshot()).toEqual(before);
  });

  it('a second searchEntries in the same process writes nothing either', async () => {
    const { searchEntries } = await load();
    await searchEntries({ query: 'vector', dbPath, threshold: 0 });
    const before = snapshot();
    const names = await touched(() => searchEntries({ query: 'vector', dbPath, threshold: 0 }));
    expect(names).toEqual([]);
    expect(snapshot()).toEqual(before);
  });

  it.skipIf(!rabitqAvailable)('the RaBitQ build a search triggers (persistMeta: false) keeps the index in memory only', async () => {
    // searchEntries passes persistMeta: false; its auto-build is throttled to once a minute per process,
    // so the build is driven directly. The meta file goes under process.cwd()/.swarm, the memory root here.
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const { storeEntry } = await load();
      for (let i = 0; i < 12; i++) {
        expect((await storeEntry({ key: `bulk-${i}`, value: `bulk entry number ${i} about caching`, dbPath })).success).toBe(true);
      }
      const { buildRabitqIndex } = await import('../src/memory/rabitq-index.js');
      const before = snapshot();
      let built: Awaited<ReturnType<typeof buildRabitqIndex>> | undefined;
      const names = await touched(async () => { built = await buildRabitqIndex({ dbPath, persistMeta: false }); });
      expect(built?.success, built?.error).toBe(true);
      expect(names).toEqual([]);
      expect(snapshot()).toEqual(before);
    } finally {
      process.chdir(cwd);
    }
  });

  it('listEntries({ readOnly: true }) lists entries and writes nothing', async () => {
    const { listEntries } = await load();
    const before = snapshot();
    let result: Awaited<ReturnType<typeof listEntries>> | undefined;
    const names = await touched(async () => { result = await listEntries({ dbPath, readOnly: true }); });

    expect(result?.success).toBe(true);
    expect(result?.entries.map(e => e.key).sort()).toEqual(['alpha', 'beta', 'gamma']);
    expect(names).toEqual([]);
    expect(snapshot()).toEqual(before);
  });

  it('on a store that predates the status/provenance columns, search and read-only list refuse without writing', async () => {
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const db = new SQL.Database(readFileSync(dbPath));
    db.run('ALTER TABLE memory_entries DROP COLUMN provenance_type');
    writeFileSync(dbPath, Buffer.from(db.export()));
    db.close();

    const { searchEntries, listEntries } = await load();
    const before = snapshot();
    let search: Awaited<ReturnType<typeof searchEntries>> | undefined;
    let list: Awaited<ReturnType<typeof listEntries>> | undefined;
    const names = await touched(async () => {
      search = await searchEntries({ query: 'authentication', dbPath, threshold: 0 });
      list = await listEntries({ dbPath, readOnly: true });
    });

    expect(search?.success).toBe(false);
    expect(search?.error).toMatch(/schema/i);
    expect(list?.success).toBe(false);
    expect(list?.error).toMatch(/schema/i);
    expect(names).toEqual([]);
    expect(snapshot()).toEqual(before);
  });
});
