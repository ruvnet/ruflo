/**
 * #4410 — AgentDBBackend's SQL fallback against the real, resolved agentdb.
 *
 * agentdb's `.database` is a prepare/exec handle (no run/get on the handle),
 * and `references` is an SQLite keyword. Before the fix the fallback gated on
 * `typeof db.run === 'function'`, so no table was created and every write was
 * a silent no-op: an entry was never readable from a reopened backend.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentDBBackend } from './agentdb-backend.js';
import { createDefaultEntry } from './types.js';

let dir: string;
let dbFile: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-sql-fallback-'));
  dbFile = path.join(dir, 'agentdb-memory.db');
});
afterEach(() => {
  delete process.env.AGENTDB_FORCE_SQLJS;
  fs.rmSync(dir, { recursive: true, force: true });
});

const drivers = [
  { name: 'native better-sqlite3', forceWasm: false, sqljs: false },
  { name: 'sql.js shim', forceWasm: true, sqljs: true },
];

describe.each(drivers)('AgentDBBackend SQL fallback ($name)', ({ forceWasm, sqljs }) => {
  const mk = () => new AgentDBBackend({ dbPath: dbFile, namespace: 'fallback', vectorDimension: 4, forceWasm });

  it('an entry stored through the fallback is readable after reopening', async () => {
    if (sqljs) process.env.AGENTDB_FORCE_SQLJS = '1';
    const entry = createDefaultEntry({
      key: 'persisted-key',
      content: 'survives a restart',
      namespace: 'fallback',
      tags: ['a', 'b'],
      metadata: { source: 'test' },
      references: ['ref-1'],
    });
    entry.embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);

    const first = mk();
    await first.initialize();
    expect(first.isAvailable()).toBe(true);
    // Prove which driver is exercised; only the sql.js shim rejects array-bound params.
    const driver = (first as any).getAgentDB().database.constructor.name;
    expect(driver === 'SqlJsDatabase').toBe(sqljs);
    await first.store(entry);
    await first.shutdown();

    const second = mk();
    await second.initialize();
    try {
      const got = await second.get(entry.id);
      expect(got).not.toBeNull();
      expect(got!.key).toBe('persisted-key');
      expect(got!.content).toBe('survives a restart');
      expect(got!.namespace).toBe('fallback');
      expect(got!.tags).toEqual(['a', 'b']);
      expect(got!.metadata).toEqual({ source: 'test' });
      expect(got!.references).toEqual(['ref-1']);
      expect(Array.from(got!.embedding!)).toEqual(Array.from(new Float32Array([0.1, 0.2, 0.3, 0.4])));
    } finally {
      await second.shutdown();
    }
  });
});
