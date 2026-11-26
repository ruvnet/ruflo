/**
 * The sql.js fallback in searchEntries() loaded candidates with `LIMIT 1000`
 * and no `ORDER BY`, so on a store with more than 1000 live rows SQLite handed
 * back the oldest-inserted 1000 and the newest entries were never scored (the
 * #2982 root cause, fixed in the bridge by #2982/#4397 and in `embeddings
 * search` by #5084). It now reads the newest rows first, with the bridge's
 * search window.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ENV_KEYS = ['CLAUDE_FLOW_DISABLE_BRIDGE', 'CLAUDE_FLOW_MEMORY_PATH', 'CLAUDE_FLOW_SEARCH_WINDOW'] as const;
const saved: Record<string, string | undefined> = {};
let dir: string;
let dbPath: string;

async function load() {
  const mod = await import('../src/memory/memory-initializer.js');
  mod._resetMemoryRootCache();
  return mod;
}

/** Inserts `fillers` unrelated rows, then the one row the query matches, newest last. */
async function seed(fillers: number): Promise<void> {
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(dbPath));
  const insert = db.prepare(
    `INSERT INTO memory_entries (id, key, namespace, content, status, created_at, updated_at)
     VALUES (?, ?, 'default', ?, 'active', ?, ?)`,
  );
  for (let i = 0; i < fillers; i++) {
    insert.run([`filler-${i}`, `filler-${i}`, 'unrelated release note', 1000 + i, 1000 + i]);
  }
  insert.run(['newest', 'newest-decision', 'kubernetes ingress tls certificate rotation runbook', 1000 + fillers, 1000 + fillers]);
  insert.free();
  writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
}

beforeEach(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  delete process.env.CLAUDE_FLOW_SEARCH_WINDOW;
  dir = mkdtempSync(path.join(tmpdir(), 'ruflo-fallback-newest-'));
  const root = path.join(dir, '.swarm');
  dbPath = path.join(root, 'memory.db');
  process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
  process.env.CLAUDE_FLOW_MEMORY_PATH = root;
  const { initializeMemoryDatabase } = await load();
  expect((await initializeMemoryDatabase({ dbPath, verbose: false })).success).toBe(true);
});

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  (await load())._resetMemoryRootCache();
  rmSync(dir, { recursive: true, force: true });
});

describe('searchEntries sql.js fallback scores the newest rows', () => {
  it.each([
    ['a small store', 10],
    ['a store with more than 1000 rows', 1100],
  ])('finds the newest entry in %s', async (_name, fillers) => {
    await seed(fillers);
    const { searchEntries } = await load();

    const result = await searchEntries({ query: 'kubernetes ingress', namespace: 'default', dbPath });

    expect(result.success).toBe(true);
    expect(result.results.map(r => r.key)).toContain('newest-decision');
  }, 60_000);

  it('finds the newest entry across namespaces', async () => {
    await seed(1100);
    const { searchEntries } = await load();

    const result = await searchEntries({ query: 'kubernetes ingress', namespace: 'all', dbPath });

    expect(result.results.map(r => r.key)).toContain('newest-decision');
  }, 60_000);
});
