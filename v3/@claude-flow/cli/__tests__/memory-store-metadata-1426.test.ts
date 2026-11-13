/**
 * #1426: `memory_store` had no `metadata` input, and both write paths
 * (the AgentDB bridge and the sql.js fallback) hard-coded `'{}'` into the
 * metadata column. Callers could not record e.g. `{ confidence: 0.9 }`,
 * which AutoMemoryBridge reads to decide sync eligibility.
 *
 * Covers both write paths and the input check at the MCP boundary.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { memoryTools } from '../src/mcp-tools/memory-tools.js';
import { MEMORY_SCHEMA_V3 } from '../src/memory/memory-initializer.js';

const tool = (name: string) => memoryTools.find(t => t.name === name)!;

async function readMetadata(dbPath: string, key: string): Promise<string | null> {
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(dbPath));
  try {
    const stmt = db.prepare('SELECT metadata FROM memory_entries WHERE key = ?');
    stmt.bind([key]);
    const row = stmt.step() ? (stmt.get()[0] as string | null) : null;
    stmt.free();
    return row;
  } finally {
    db.close();
  }
}

describe('memory_store persists metadata (#1426)', () => {
  let dir: string;
  let dbPath: string;
  let prevMemory: string | undefined;
  let prevBridge: string | undefined;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-1426-metadata-'));
    dbPath = join(dir, 'memory.db');
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(MEMORY_SCHEMA_V3);
    writeFileSync(dbPath, Buffer.from(db.export()));
    db.close();

    prevMemory = process.env.CLAUDE_FLOW_MEMORY_PATH;
    prevBridge = process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
    process.env.CLAUDE_FLOW_MEMORY_PATH = dir;
    process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
  });

  afterEach(() => {
    if (prevMemory === undefined) delete process.env.CLAUDE_FLOW_MEMORY_PATH;
    else process.env.CLAUDE_FLOW_MEMORY_PATH = prevMemory;
    if (prevBridge === undefined) delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
    else process.env.CLAUDE_FLOW_DISABLE_BRIDGE = prevBridge;
    rmSync(dir, { recursive: true, force: true });
  });

  it('sql.js path writes the metadata object to the metadata column', async () => {
    const res = await tool('memory_store').handler({
      key: 'with-meta',
      value: 'v',
      namespace: 'probe-1426',
      metadata: { confidence: 0.9, source: 'test' },
      dbPath,
    }) as Record<string, any>;
    expect(res.success).toBe(true);
    expect(JSON.parse((await readMetadata(dbPath, 'with-meta'))!)).toEqual({ confidence: 0.9, source: 'test' });
  });

  it('omitting metadata still stores an empty object', async () => {
    const res = await tool('memory_store').handler({ key: 'no-meta', value: 'v', dbPath }) as Record<string, any>;
    expect(res.success).toBe(true);
    expect(await readMetadata(dbPath, 'no-meta')).toBe('{}');
  });

  it.each([[['a']], [null], ['text'], [3]])('rejects non-object metadata %j', async (metadata) => {
    const res = await tool('memory_store').handler({ key: 'bad', value: 'v', metadata, dbPath }) as Record<string, any>;
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/metadata must be a JSON object/);
    expect(await readMetadata(dbPath, 'bad')).toBeNull();
  });
});

describe('bridgeStoreEntry persists metadata (#1426)', () => {
  it('writes the metadata object on the native bridge path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-1426-bridge-'));
    const bridgeDbPath = join(root, 'memory.db');
    const db = new Database(bridgeDbPath);
    try {
      db.exec(`
        CREATE TABLE memory_entries (
          id TEXT PRIMARY KEY, key TEXT NOT NULL, namespace TEXT DEFAULT 'default',
          content TEXT NOT NULL, type TEXT DEFAULT 'semantic', embedding TEXT,
          embedding_dimensions INTEGER, embedding_model TEXT, tags TEXT, metadata TEXT,
          provenance_type TEXT DEFAULT 'unknown', created_at INTEGER, updated_at INTEGER,
          last_accessed_at INTEGER, access_count INTEGER DEFAULT 0, expires_at INTEGER,
          status TEXT DEFAULT 'active', UNIQUE(namespace, key)
        );
        CREATE TABLE vector_indexes (id TEXT PRIMARY KEY, name TEXT, dimensions INTEGER);
      `);
      const { __setMemoryBridgeRegistryForTests, bridgeStoreEntry } = await import('../src/memory/memory-bridge.js');
      const cache = new Map<string, unknown>();
      __setMemoryBridgeRegistryForTests({
        getAgentDB: () => ({ database: db, embedder: null }),
        get: (kind: string) => (kind === 'tieredCache'
          ? { get: (k: string) => cache.get(k), set: (k: string, v: unknown) => { cache.set(k, v); }, delete: (k: string) => { cache.delete(k); }, size: () => cache.size }
          : null),
      });

      const result = await bridgeStoreEntry({
        key: 'bridge-meta',
        value: 'v',
        namespace: 'probe-1426',
        metadata: { confidence: 0.75 },
        generateEmbeddingFlag: false,
        dbPath: bridgeDbPath,
      });
      expect(result?.success).toBe(true);
      const row = db.prepare('SELECT metadata FROM memory_entries WHERE key = ?').get('bridge-meta') as { metadata: string };
      expect(JSON.parse(row.metadata)).toEqual({ confidence: 0.75 });
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
