/**
 * Graph Edge Writer — ADR-130 Phase 1
 *
 * Provides a minimal interface for inserting rows into the graph_edges
 * SQLite table defined by MEMORY_SCHEMA_V3.
 *
 * #2431 fix (2026-06-22) — replaces the prior sql.js implementation. The
 * prior version opened sql.js, performed in-memory updates, then called
 * `fs.writeFileSync(dbPath, db.export())` after every edge insert. This
 * whole-file flush overwrote the main `memory.db` while the better-sqlite3
 * bridge was actively writing through its WAL — exactly the dual-write
 * race that ADR-068 (#1257) removed. Symptom: PRAGMA integrity_check
 * reports `database disk image is malformed (11)` after a single
 * memory_store + causal-edge sequence.
 *
 * Fix posture: use better-sqlite3 directly (the same native engine the
 * memory bridge uses). WAL-native, no whole-file fsync, no race. Keeps
 * the public API surface identical so callers don't have to change.
 *
 * Note: this is the minimum-safe fix. The architecturally cleaner fix
 * (route writes through the bridge's controller layer) is scoped to a
 * future ADR — see #2431 for the discussion. Until that ADR lands, this
 * module owns its own better-sqlite3 handle but on the same file, with
 * WAL mode enabled (which makes concurrent writers safe by SQLite's own
 * design — no overlapping fsync).
 *
 * The module is designed for fire-and-forget callers — every public
 * function suppresses errors internally so callers never need try/catch.
 *
 * @module v3/cli/memory/graph-edge-writer
 */

import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { getMemoryRoot } from './memory-initializer.js';
import { encodeEmbedding } from './embedding-quantization.js';

// ============================================================================
// Lazy-cached better-sqlite3 db handle
// ============================================================================

let _db: any = null;
let _dbPath = '';
let _dbInitializing = false;

// #3397 — the handle used to live for the whole MCP server process, keeping
// the -wal/-shm sidecars on disk forever; the #2735 guard then refused every
// later sql.js whole-image write (memory_store on Windows, where the native
// bridge is off by default). The handle is now released after a short idle
// window, and memory-initializer releases it on demand before its guard.
//
// Invariant this relies on: every caller of getBridgeDb() finishes using the
// returned handle synchronously after the await (no await between it and the
// last `db.` call), so a release can only land between operations. If a
// caller ever breaks that, it gets "database connection is not open", which
// every call site already catches.
const DEFAULT_IDLE_RELEASE_MS = 1000;
let _idleTimer: ReturnType<typeof setTimeout> | null = null;
let _exitHookInstalled = false;

function idleReleaseMs(): number {
  const configured = Number(process.env.CLAUDE_FLOW_GRAPH_EDGE_IDLE_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_IDLE_RELEASE_MS;
}

function armIdleRelease(): void {
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(() => { _idleTimer = null; releaseBridgeDb(); }, idleReleaseMs());
  _idleTimer.unref?.();
  if (!_exitHookInstalled) {
    _exitHookInstalled = true;
    // 'exit' (not SIGINT/SIGTERM handlers, which would change Node's default
    // termination) — sync-only work, so a clean shutdown checkpoints and
    // removes the sidecars instead of leaving them for the next process.
    process.once('exit', () => { releaseBridgeDb(); });
  }
}

/**
 * Checkpoint and close the cached handle if it is open (optionally only if it
 * is open on `dbPath`). Returns true if a handle was released. Never throws.
 *
 * busy_timeout is dropped to 0 first so the TRUNCATE checkpoint cannot stall
 * the event loop behind another connection: if another native connection is
 * attached the sidecars stay anyway (it owns them), so a busy checkpoint loses
 * nothing; if this is the only connection, the checkpoint is never busy.
 */
export function releaseBridgeDb(dbPath?: string): boolean {
  if (!_db) return false;
  if (dbPath !== undefined && path.resolve(dbPath) !== path.resolve(_dbPath)) return false;
  if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
  const db = _db;
  _db = null;
  _dbPath = '';
  try { db.pragma('busy_timeout = 0'); } catch { /* best-effort */ }
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* best-effort */ }
  try { db.close(); } catch { /* best-effort */ }
  return true;
}

/**
 * Return the better-sqlite3 Database instance for graph_edges writes.
 * Creates the graph_edges table if it is absent (idempotent).
 * Returns null if better-sqlite3 is not available or db cannot be opened.
 *
 * #2246 fix: `createIfMissing` (default false for back-compat) — when true,
 * lazily creates an empty memory.db with the graph_edges schema so
 * graph-pathfinder works on fresh environments before any memory writes.
 *
 * #2431 fix: better-sqlite3 + WAL mode replaces sql.js + whole-file
 * writeFileSync. Eliminates the dual-write race that corrupted memory.db
 * when called alongside the memory bridge's better-sqlite3 writer.
 */
export async function getBridgeDb(customDbPath?: string, opts?: { createIfMissing?: boolean }): Promise<any | null> {
  const dbPath = customDbPath ?? path.join(getMemoryRoot(), 'memory.db');
  const createIfMissing = opts?.createIfMissing === true;

  if (_db && _dbPath === dbPath) { armIdleRelease(); return _db; }
  if (_dbInitializing) return null;
  _dbInitializing = true;

  try {
    const dbExists = fs.existsSync(dbPath);
    if (!dbExists && !createIfMissing) return null;

    // Ensure parent dir exists for createIfMissing case.
    if (!dbExists && createIfMissing) {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    // better-sqlite3 may not be available on all platforms (it's a native
    // module, so platform-specific binaries are required). If unavailable,
    // return null and let callers degrade gracefully — same posture as the
    // prior sql.js version when sql.js failed to load.
    //
    // The module name is hidden behind a variable so the TypeScript compiler
    // does not statically resolve and require the `better-sqlite3` types at
    // build time — they would only be installed via optionalDependencies,
    // which CI doesn't always install. This is the standard pattern for
    // runtime-only optional native deps. The actual presence is gated by
    // the try/catch below.
    let BetterSqlite3: any;
    try {
      const mod: string = 'better-sqlite3';
      BetterSqlite3 = (await import(mod)).default;
    } catch {
      return null;
    }

    const db = new BetterSqlite3(dbPath);

    // WAL mode is the load-bearing piece of the #2431 fix: it lets multiple
    // connections (this module + the memory bridge) write to the same file
    // without overlapping fsyncs corrupting each other. SQLite's WAL is
    // designed for exactly this case.
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');  // WAL-safe + faster than FULL
    db.pragma('busy_timeout = 5000');    // wait up to 5s on lock contention

    // Ensure graph_edges table exists (in case this is an older DB that
    // predates ADR-130 Phase 1 schema migration).
    db.exec(`
      CREATE TABLE IF NOT EXISTS graph_edges (
        id              TEXT PRIMARY KEY,
        source_id       TEXT NOT NULL,
        target_id       TEXT NOT NULL,
        relation        TEXT NOT NULL,
        weight          REAL DEFAULT 1.0,
        confidence      REAL DEFAULT 1.0,
        decay_rate      REAL DEFAULT 0.0,
        last_reinforced TEXT,
        witness_id      TEXT,
        embedding_ref   TEXT,
        metadata        TEXT,
        created_at      TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges (source_id);
      CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges (target_id);
      CREATE INDEX IF NOT EXISTS idx_graph_edges_relation ON graph_edges (relation);
      CREATE INDEX IF NOT EXISTS idx_graph_edges_reinforced ON graph_edges (last_reinforced);
    `);

    // A handle cached for a different path would otherwise be orphaned
    // (still open, sidecars still on disk) by the reassignment below.
    releaseBridgeDb();
    _db = db;
    _dbPath = dbPath;
    armIdleRelease();
    return db;
  } catch {
    return null;
  } finally {
    _dbInitializing = false;
  }
}

// ============================================================================
// Public write API
// ============================================================================

export interface GraphEdgeInput {
  sourceId: string;
  targetId: string;
  relation: string;
  weight?: number;
  confidence?: number;
  decayRate?: number;
  lastReinforced?: string;   // ISO-8601
  witnessId?: string;
  embedding?: number[];       // raw 384-dim float; encoded automatically
  metadata?: Record<string, unknown>;
  dbPath?: string;
}

/**
 * Insert a single edge into graph_edges.
 * Fire-and-forget — errors are suppressed.
 * Returns true if the write succeeded, false otherwise.
 *
 * #2431 fix: uses better-sqlite3 prepared statements + implicit WAL
 * journal. No `fs.writeFileSync` whole-file flush — the WAL handles
 * durability without overwriting the main file out from under other
 * writers.
 */
export async function insertGraphEdge(input: GraphEdgeInput): Promise<boolean> {
  try {
    const db = await getBridgeDb(input.dbPath);
    if (!db) return false;

    const id = `edge-${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();

    let embeddingRef: string | null = null;
    if (input.embedding && input.embedding.length > 0) {
      embeddingRef = encodeEmbedding(input.embedding);
    }

    const metaStr = input.metadata ? JSON.stringify(input.metadata) : null;

    db.prepare(
      `INSERT OR IGNORE INTO graph_edges
        (id, source_id, target_id, relation, weight, confidence, decay_rate,
         last_reinforced, witness_id, embedding_ref, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.sourceId,
      input.targetId,
      input.relation,
      input.weight ?? 1.0,
      input.confidence ?? 1.0,
      input.decayRate ?? 0.0,
      input.lastReinforced ?? null,
      input.witnessId ?? null,
      embeddingRef,
      metaStr,
      createdAt,
    );

    return true;
  } catch {
    return false;
  }
}

/**
 * Query graph_edges by source_id.
 * Returns rows or empty array on error.
 */
export async function queryEdgesBySource(
  sourceId: string,
  relation?: string,
  dbPath?: string,
): Promise<Array<{ id: string; source_id: string; target_id: string; relation: string; weight: number }>> {
  try {
    const db = await getBridgeDb(dbPath);
    if (!db) return [];

    const sql = relation
      ? `SELECT id, source_id, target_id, relation, weight FROM graph_edges WHERE source_id = ? AND relation = ? LIMIT 1000`
      : `SELECT id, source_id, target_id, relation, weight FROM graph_edges WHERE source_id = ? LIMIT 1000`;
    const args = relation ? [sourceId, relation] : [sourceId];

    return db.prepare(sql).all(...args) as Array<{
      id: string;
      source_id: string;
      target_id: string;
      relation: string;
      weight: number;
    }>;
  } catch {
    return [];
  }
}

/**
 * Count rows in graph_edges (for test assertions).
 */
export async function countGraphEdges(dbPath?: string): Promise<number> {
  try {
    const db = await getBridgeDb(dbPath);
    if (!db) return 0;
    const row = db.prepare(`SELECT COUNT(*) AS n FROM graph_edges`).get() as { n: number } | undefined;
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Reset the cached db handle (for tests that need a fresh DB).
 *
 * #2431 fix: also explicitly closes the prior handle so file locks
 * release immediately — better-sqlite3 holds an OS-level file handle
 * which the prior sql.js implementation did not.
 *
 * #2736-followup fix: `close()` alone only checkpoints the WAL back into
 * the main file as a best-effort PASSIVE checkpoint when SQLite considers
 * this the last connection — which is not guaranteed to fully flush under
 * contention, and was observed leaving writes invisible to a same-process
 * sql.js reader that re-reads the raw file immediately after close() on
 * Linux CI runners (not reproduced on Windows). Force a blocking TRUNCATE
 * checkpoint before close so cross-engine readers always see committed
 * writes deterministically, regardless of platform/timing.
 */
export function _resetBridgeDb(): void {
  if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
  if (_db) {
    try { _db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* best-effort */ }
    try { _db.close(); } catch { /* best-effort */ }
  }
  _db = null;
  _dbPath = '';
}
