/**
 * #3693 — one better-sqlite3 identity per process.
 *
 * AgentDB (via @claude-flow/memory) owns a live native handle on memory.db. If
 * the CLI opens its own handle through a DIFFERENT installed copy of
 * better-sqlite3 (a nested `agentdb/node_modules/better-sqlite3` next to a
 * hoisted one is the common layout), the two copies each statically link their
 * own SQLite and keep separate per-process file bookkeeping. Closing the CLI's
 * handle (graph-edge idle release: wal_checkpoint(TRUNCATE) + close) then looks
 * like "last connection" to that copy and deletes the -wal/-shm sidecars out
 * from under AgentDB's still-open handle.
 *
 * Resolve the constructor from the same place AgentDB resolves it, so both
 * share one SQLite instance (and its connection bookkeeping). Falls back to the
 * CLI's own copy when agentdb cannot be resolved.
 */
import { createRequire } from 'node:module';

type DbCtor = new (path: string, opts?: Record<string, unknown>) => any;

let cached: DbCtor | null | undefined;

/** Test seam: pass `from` to resolve relative to another entry file. */
export function resolveAgentdbBetterSqlite3(from?: string): DbCtor | null {
  if (!from && cached !== undefined) return cached;
  let found: DbCtor | null = null;
  try {
    const own = createRequire(import.meta.url);
    const agentdbEntry = from ?? own.resolve('agentdb');
    const mod = createRequire(agentdbEntry)('better-sqlite3');
    found = (mod?.default ?? mod) as DbCtor;
  } catch {
    found = null;
  }
  if (!from) cached = found;
  return found;
}

/** Constructor shared with AgentDB when possible, else the CLI's own copy. */
export async function loadBetterSqlite3(): Promise<DbCtor> {
  const shared = resolveAgentdbBetterSqlite3();
  if (shared) return shared;
  const mod: string = 'better-sqlite3';
  return (await import(mod)).default as DbCtor;
}
