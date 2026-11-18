/**
 * #1426 — SQLiteBackend on a memory.db created by the CLI.
 *
 * The CLI's memory-initializer DDL creates memory_entries without
 * access_level, version and "references". SQLiteBackend's
 * CREATE TABLE IF NOT EXISTS left that table as-is, so store() failed with
 * "table memory_entries has no column named access_level". initialize()
 * now adds the missing columns.
 *
 * better-sqlite3 is an optional dependency, so the suite skips without it.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDefaultEntry } from './types.js';

async function loadBetterSqlite3(): Promise<any | null> {
  try {
    return (await import('better-sqlite3')).default;
  } catch {
    return null;
  }
}

// memory_entries as created by v3/@claude-flow/cli/src/memory/memory-initializer.ts
const CLI_DDL = `
  CREATE TABLE memory_entries (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    namespace TEXT DEFAULT 'default',
    content TEXT NOT NULL,
    type TEXT DEFAULT 'semantic' CHECK(type IN ('semantic', 'episodic', 'procedural', 'working', 'pattern')),
    embedding TEXT,
    embedding_model TEXT DEFAULT 'local',
    embedding_dimensions INTEGER,
    tags TEXT,
    metadata TEXT,
    owner_id TEXT,
    provenance_type TEXT DEFAULT 'unknown',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    expires_at INTEGER,
    last_accessed_at INTEGER,
    access_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'archived', 'deleted')),
    UNIQUE(namespace, key)
  );
`;

const root = mkdtempSync(join(tmpdir(), 'ruflo-1426-legacy-schema-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('#1426 — SQLiteBackend migrates a CLI-created memory_entries table', async () => {
  const Database = await loadBetterSqlite3();
  const maybeIt = Database ? it : it.skip;

  maybeIt('adds the missing columns and keeps existing CLI rows readable', async () => {
    const dbPath = join(root, 'cli-created.db');
    const seed = new Database(dbPath);
    seed.exec(CLI_DDL);
    seed
      .prepare(
        `INSERT INTO memory_entries (id, key, namespace, content, tags, metadata, created_at, updated_at)
         VALUES ('cli-1', 'from-cli', 'default', 'written by the CLI', '["cli"]', '{}', 1, 1)`,
      )
      .run();
    seed.close();

    const { SQLiteBackend } = await import('./sqlite-backend.js');
    const backend = new SQLiteBackend({ databasePath: dbPath });
    await backend.initialize();

    const entry = createDefaultEntry({ key: 'from-backend', content: 'written by SQLiteBackend' });
    await backend.store(entry);

    const stored = await backend.get(entry.id);
    expect(stored?.content).toBe('written by SQLiteBackend');
    expect(stored?.accessLevel).toBe(entry.accessLevel);

    const legacy = await backend.get('cli-1');
    expect(legacy?.key).toBe('from-cli');
    expect(legacy?.accessLevel).toBe('private');
    expect(legacy?.version).toBe(1);
    expect(legacy?.references).toEqual([]);

    await backend.shutdown();

    // A second initialize() must not try to add the columns again.
    const again = new SQLiteBackend({ databasePath: dbPath });
    await again.initialize();
    await again.shutdown();
  });
});
