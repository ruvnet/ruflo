/**
 * #4686: list pagination sorted full content/embedding payloads for every
 * row. The SQL fallback now pages row identities first and loads payloads
 * only for the requested page. This test pins page membership/order/content
 * on the real sql.js path.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import initSqlJs from 'sql.js';
import { listEntries } from '../src/memory/memory-initializer.js';

let dir: string | undefined;
const prior = process.env.CLAUDE_FLOW_DISABLE_BRIDGE;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
  if (prior === undefined) delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
  else process.env.CLAUDE_FLOW_DISABLE_BRIDGE = prior;
});

async function fixture(): Promise<string> {
  dir = mkdtempSync(join(tmpdir(), 'ruflo-list-paged-4686-'));
  const dbPath = join(dir, '.swarm', 'memory.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE memory_entries (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      namespace TEXT DEFAULT 'default',
      content TEXT NOT NULL,
      type TEXT DEFAULT 'semantic',
      embedding TEXT,
      embedding_dimensions INTEGER,
      embedding_model TEXT,
      tags TEXT,
      metadata TEXT,
      provenance_type TEXT DEFAULT 'unknown',
      created_at INTEGER,
      updated_at INTEGER,
      last_accessed_at INTEGER,
      access_count INTEGER DEFAULT 0,
      expires_at INTEGER,
      status TEXT DEFAULT 'active'
    );
  `);
  const rows = [
    ['a', 'alpha', 1000],
    ['b', 'bravo', 2000],
    ['c', 'charlie', 3000],
    ['d', 'delta', 4000],
    ['e', 'echo', 5000],
  ];
  const insert = db.prepare(`
    INSERT INTO memory_entries (id, key, namespace, content, created_at, updated_at, status)
    VALUES (?, ?, 'paged', ?, ?, ?, 'active')
  `);
  for (const [id, key, t] of rows as Array<[string, string, number]>) {
    insert.run([id, key, `content-${key}`, t, t]);
  }
  insert.free();
  writeFileSync(dbPath, db.export());
  db.close();
  process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
  return dbPath;
}

describe('listEntries paged payload loading (#4686)', () => {
  it('returns the requested descending page with total and full content', async () => {
    const dbPath = await fixture();

    const page = await listEntries({ dbPath, limit: 2, offset: 2, includeContent: true });

    expect(page.success).toBe(true);
    expect(page.total).toBe(5);
    expect(page.entries.map(e => e.key)).toEqual(['charlie', 'bravo']);
    expect(page.entries.map(e => e.content)).toEqual(['content-charlie', 'content-bravo']);
  });

  it('returns the first page and honors limit 0', async () => {
    const dbPath = await fixture();

    const first = await listEntries({ dbPath, limit: 2, offset: 0 });
    expect(first.entries.map(e => e.key)).toEqual(['echo', 'delta']);

    const empty = await listEntries({ dbPath, limit: 0 });
    expect(empty.success).toBe(true);
    expect(empty.entries).toEqual([]);
    expect(empty.total).toBe(5);
  });
});
