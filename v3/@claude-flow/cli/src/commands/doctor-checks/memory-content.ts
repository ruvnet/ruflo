/**
 * Doctor checks for memory database integrity and content coverage.
 * Split out of commands/doctor.ts (#4773).
 */

import {
  isMemoryDbEncryptedAtRest,
  isNativeSqliteBindingUnavailable,
  nativeBindingUnavailableCheck,
  resolveMemoryDbPath,
  tryOpenSqlJs,
} from './memory-store.js';
import type { HealthCheck } from './shared.js';

// Check 1 (--component memory, deep path) — #2737 part 2 strengthens this:
// prefer native better-sqlite3 PRAGMA integrity_check (adds index↔table
// cross-checking + UNIQUE verification that quick_check above deliberately
// skips, and is WAL-aware — see checkMemoryStructuralIntegrity's comment)
// when better-sqlite3 is available, falling back to the original sql.js
// probe when it's not. The sql.js fallback is main-image-only (WAL-blind);
// its message says so explicitly so operators know its limits.
//
// #2737 part 3: with the encryption carve-out applied up front on BOTH
// paths, a "file is not a database" / "malformed" result is now definitive,
// unencrypted corruption in every branch below — fail, not warn (the
// previous version treated this as an ambiguous warn because it couldn't
// tell corruption from encryption; that ambiguity is what the carve-out
// resolves).
export async function checkMemoryIntegrity(): Promise<HealthCheck> {
  const dbPath = await resolveMemoryDbPath();
  if (!dbPath) return { name: 'Memory Integrity', status: 'warn', message: 'no memory.db found (see Memory Database Presence check above)' };

  if (isMemoryDbEncryptedAtRest(dbPath)) {
    return {
      name: 'Memory Integrity',
      status: 'warn',
      message: `${dbPath} — RFE1-encrypted at rest; integrity check can't run without decrypting (expected, not corruption — see Encryption at Rest)`,
    };
  }

  // Prefer native better-sqlite3 (WAL-aware, full integrity_check). Module
  // load is isolated in its own try/catch so ONLY "not installed" falls
  // through to the sql.js fallback below. A loaded JavaScript wrapper can
  // still lack its native binding (#2968); that capability failure is a warn,
  // while genuine open/query failures remain authoritative failures here.
  let Database: any;
  try {
    Database = ((await import('better-sqlite3')) as any).default;
  } catch {
    Database = null; // not installed — fall through to the sql.js fallback below.
  }

  if (Database) {
    let db: any;
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
    } catch (e) {
      if (isNativeSqliteBindingUnavailable(e)) {
        return nativeBindingUnavailableCheck(
          'Memory Integrity',
          dbPath,
          e,
          '[native WAL-backed persistence unavailable]',
        );
      }
      const msg = (e as Error).message || String(e);
      return {
        name: 'Memory Integrity',
        status: 'fail',
        message: `${dbPath} — better-sqlite3 failed to open: ${msg} (unencrypted; definitively malformed) [native, WAL-aware]`,
        fix: 'back up .swarm/memory.db then `claude-flow memory init --force`',
      };
    }
    try {
      const rows = db.pragma('integrity_check') as Array<Record<string, unknown>>;
      const values = rows.map((r) => String(Object.values(r)[0]));
      if (values.length === 1 && values[0] === 'ok') {
        return { name: 'Memory Integrity', status: 'pass', message: `${dbPath} — PRAGMA integrity_check: ok [native, WAL-aware]` };
      }
      return {
        name: 'Memory Integrity',
        status: 'fail',
        message: `${dbPath} — PRAGMA integrity_check: ${values.slice(0, 3).join('; ')}${values.length > 3 ? ` (+${values.length - 3} more)` : ''} [native, WAL-aware]`,
        fix: 'back up .swarm/memory.db then `claude-flow memory init --force`',
      };
    } catch (e) {
      // DB opened but the pragma itself threw — still definitive,
      // unencrypted breakage (encryption ruled out above). Fail, not warn,
      // and NOT a fall-through to the sql.js fallback: better-sqlite3 IS
      // installed and just gave us the answer.
      const msg = (e as Error).message || String(e);
      return {
        name: 'Memory Integrity',
        status: 'fail',
        message: `${dbPath} — integrity_check probe threw: ${msg} (unencrypted; definitively malformed) [native, WAL-aware]`,
        fix: 'back up .swarm/memory.db then `claude-flow memory init --force`',
      };
    } finally {
      try { db.close(); } catch { /* best-effort */ }
    }
  }

  // Fallback: sql.js — main-image-only (WAL-blind). tryOpenSqlJs()
  // readFileSync()s the base file directly, so any committed-but-not-
  // checkpointed rows sitting in a sibling -wal file are invisible here.
  // Install better-sqlite3 for the WAL-aware path above.
  const db = await tryOpenSqlJs(dbPath);
  if (!db) {
    // Encryption already ruled out above — an unencrypted file sql.js can't
    // even open is definitive corruption too.
    return {
      name: 'Memory Integrity',
      status: 'fail',
      message: `${dbPath} — sql.js can't open (unencrypted; definitively malformed) [main-image-only fallback — install better-sqlite3 for WAL-aware checking]`,
      fix: 'back up .swarm/memory.db then `claude-flow memory init --force`',
    };
  }
  try {
    const res = db.exec('PRAGMA integrity_check');
    const rows: string[] = res[0]?.values?.map((v: any[]) => String(v[0])) ?? [];
    if (rows.length === 1 && rows[0] === 'ok') {
      return {
        name: 'Memory Integrity',
        status: 'warn',
        message: `${dbPath} — PRAGMA integrity_check: ok, but only for the main image [sql.js fallback; native WAL-backed persistence unavailable]`,
        fix: 'install better-sqlite3 with npm install scripts enabled, then rerun this check',
      };
    }
    return {
      name: 'Memory Integrity',
      status: 'fail',
      message: `${dbPath} — PRAGMA integrity_check: ${rows.slice(0, 3).join('; ')}${rows.length > 3 ? ` (+${rows.length - 3} more)` : ''} [main-image-only fallback]`,
      fix: 'back up .swarm/memory.db then `claude-flow memory init --force`',
    };
  } catch (e) {
    const msg = (e as Error).message || String(e);
    const definitivelyMalformed = msg.includes('file is not a database') || msg.includes('malformed');
    // Encryption already ruled out above, so — matched pattern or not —
    // this is a query refusal on a file we KNOW isn't RFE1-encrypted.
    // #2737 part 3: fail, not warn.
    return {
      name: 'Memory Integrity',
      status: 'fail',
      message: definitivelyMalformed
        ? `${dbPath} — DB refused query: ${msg} (unencrypted; definitively malformed) [main-image-only fallback]`
        : `${dbPath} — probe threw: ${msg} (unencrypted — encryption ruled out above) [main-image-only fallback]`,
      fix: 'back up .swarm/memory.db then `claude-flow memory init --force`',
    };
  } finally { try { db.close(); } catch { /* best-effort */ } }
}

// Check 2 — memory_entries rows should mostly carry non-empty content.
// Stuinfla's live case: 11,133 rows, 3 with content (0.03%). Threshold 95%
// is the number he proposed. Values below → fail with the exact ratio in
// the message ("Print the measurement, not a checkmark").
export async function checkMemoryContent(): Promise<HealthCheck> {
  const dbPath = await resolveMemoryDbPath();
  if (!dbPath) return { name: 'Memory Content', status: 'warn', message: 'no memory.db found' };
  const db = await tryOpenSqlJs(dbPath);
  if (!db) return { name: 'Memory Content', status: 'warn', message: 'DB unreadable (see Memory Integrity)' };
  try {
    const tables: string[] = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_entries'")[0]?.values?.map((v: any[]) => String(v[0])) ?? [];
    if (tables.length === 0) return { name: 'Memory Content', status: 'warn', message: 'no memory_entries table in DB — schema mismatch or empty init' };
    const r = db.exec("SELECT count(*), sum(CASE WHEN length(trim(coalesce(content,'')))>0 THEN 1 ELSE 0 END) FROM memory_entries");
    const total = Number(r[0]?.values?.[0]?.[0] ?? 0);
    const populated = Number(r[0]?.values?.[0]?.[1] ?? 0);
    if (total === 0) return { name: 'Memory Content', status: 'pass', message: `${dbPath} — 0 rows (fresh DB, expected)` };
    const ratio = populated / total;
    const pct = (ratio * 100).toFixed(2);
    const detail = `content ${populated}/${total} (${pct}%)`;
    if (ratio < 0.95) {
      return {
        name: 'Memory Content',
        status: 'fail',
        message: `${dbPath} — ${detail} below 95% floor`,
        fix: 'schema drift likely (rename of value→content or similar). check migration state via `claude-flow migrate status`',
      };
    }
    return { name: 'Memory Content', status: 'pass', message: `${dbPath} — ${detail}` };
  } catch (e) {
    const msg = (e as Error).message || String(e);
    const encryptedOrCorrupt = msg.includes('file is not a database') || msg.includes('malformed');
    return {
      name: 'Memory Content',
      status: 'warn',
      message: encryptedOrCorrupt
        ? `${dbPath} — DB refused query: ${msg} (encrypted DB or corruption; see Memory Integrity above)`
        : `${dbPath} — probe threw: ${msg}`,
    };
  } finally { try { db.close(); } catch { /* best-effort */ } }
}

// Check 3 — most memory_entries with content should also carry an embedding
// vector. Rows without a vector are BOTH unrecallable (no similarity search
// can find them) AND undistillable (ADR-174's distill skips rows with no
// parseable vector). Same 95% threshold + fail-with-ratio pattern as check 2.
//
// Embedding storage varies across ruflo installs (agentdb migrations, HNSW
// index vs inline vector column). Discovers the shape via schema probes,
// falls back to warn if the schema is unrecognized (better than a false
// pass, per "UNKNOWN is never PASS").
export async function checkMemoryEmbeddingCoverage(): Promise<HealthCheck> {
  const dbPath = await resolveMemoryDbPath();
  if (!dbPath) return { name: 'Memory Embedding Coverage', status: 'warn', message: 'no memory.db found' };
  const db = await tryOpenSqlJs(dbPath);
  if (!db) return { name: 'Memory Embedding Coverage', status: 'warn', message: 'DB unreadable (see Memory Integrity)' };
  try {
    // Schema-shape discovery. Three candidate columns / tables we've seen
    // across the agentdb / ruvector history — first match wins.
    const cols = db.exec("PRAGMA table_info(memory_entries)");
    const colNames = new Set<string>((cols[0]?.values ?? []).map((v: any[]) => String(v[1])));
    let vectorPredicate: string | null = null;
    if (colNames.has('embedding')) vectorPredicate = "embedding IS NOT NULL AND length(embedding) > 0";
    else if (colNames.has('vector')) vectorPredicate = "vector IS NOT NULL AND length(vector) > 0";
    if (!vectorPredicate) {
      const otherTables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('vector_indexes','embeddings','memory_embeddings')")[0]?.values?.map((v: any[]) => String(v[0])) ?? [];
      if (otherTables.length === 0) {
        return {
          name: 'Memory Embedding Coverage',
          status: 'warn',
          message: 'no embedding column/table recognized (agentdb schema mismatch or older format) — doctor cannot measure',
        };
      }
      const tbl = otherTables[0];
      const r = db.exec(`SELECT count(*) FROM memory_entries m WHERE EXISTS (SELECT 1 FROM ${tbl} e WHERE e.memory_id = m.id OR e.entry_id = m.id OR e.id = m.id)`);
      const withEmbedding = Number(r[0]?.values?.[0]?.[0] ?? 0);
      const total = Number(db.exec("SELECT count(*) FROM memory_entries WHERE length(trim(coalesce(content,'')))>0")[0]?.values?.[0]?.[0] ?? 0);
      if (total === 0) return { name: 'Memory Embedding Coverage', status: 'pass', message: `${dbPath} — 0 content rows (nothing to embed)` };
      const ratio = withEmbedding / total;
      const pct = (ratio * 100).toFixed(2);
      const detail = `embedded ${withEmbedding}/${total} (${pct}%) via ${tbl}`;
      if (ratio < 0.95) return { name: 'Memory Embedding Coverage', status: 'fail', message: `${dbPath} — ${detail} below 95% floor`, fix: 'unembedded rows are unrecallable + undistillable — re-run `claude-flow memory embed --namespace <name>` for populated namespaces' };
      return { name: 'Memory Embedding Coverage', status: 'pass', message: `${dbPath} — ${detail}` };
    }
    // Inline embedding column
    const r = db.exec(`SELECT count(*), sum(CASE WHEN ${vectorPredicate} THEN 1 ELSE 0 END) FROM memory_entries WHERE length(trim(coalesce(content,'')))>0`);
    const total = Number(r[0]?.values?.[0]?.[0] ?? 0);
    const withEmb = Number(r[0]?.values?.[0]?.[1] ?? 0);
    if (total === 0) return { name: 'Memory Embedding Coverage', status: 'pass', message: `${dbPath} — 0 content rows (nothing to embed)` };
    const ratio = withEmb / total;
    const pct = (ratio * 100).toFixed(2);
    const detail = `embedded ${withEmb}/${total} (${pct}%)`;
    if (ratio < 0.95) {
      return { name: 'Memory Embedding Coverage', status: 'fail', message: `${dbPath} — ${detail} below 95% floor`, fix: 'unembedded rows are unrecallable + undistillable — re-run `claude-flow memory embed --namespace <name>` for populated namespaces' };
    }
    return { name: 'Memory Embedding Coverage', status: 'pass', message: `${dbPath} — ${detail}` };
  } catch (e) {
    const msg = (e as Error).message || String(e);
    const encryptedOrCorrupt = msg.includes('file is not a database') || msg.includes('malformed');
    return {
      name: 'Memory Embedding Coverage',
      status: 'warn',
      message: encryptedOrCorrupt
        ? `${dbPath} — DB refused query: ${msg} (encrypted DB or corruption; see Memory Integrity above)`
        : `${dbPath} — probe threw: ${msg}`,
    };
  } finally { try { db.close(); } catch { /* best-effort */ } }
}

// #2677 check 6 — ReflexionMemory.retrieveRelevant() INNER JOINs episodes to
// episode_embeddings. A populated episodes table with an empty/missing partner
// table is therefore not degraded recall; it is structurally zero recall.
export async function checkMemoryReflexionCoverage(): Promise<HealthCheck> {
  const dbPath = await resolveMemoryDbPath();
  if (!dbPath) return { name: 'Memory Reflexion Coverage', status: 'warn', message: 'no memory.db found' };
  const db = await tryOpenSqlJs(dbPath);
  if (!db) return { name: 'Memory Reflexion Coverage', status: 'warn', message: 'DB unreadable (see Memory Integrity)' };
  try {
    const tables = new Set<string>(
      db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('episodes','episode_embeddings')")
        [0]?.values?.map((v: any[]) => String(v[0])) ?? [],
    );
    if (!tables.has('episodes')) {
      return { name: 'Memory Reflexion Coverage', status: 'warn', message: 'episodes table absent — AgentDB Reflexion schema not initialized' };
    }
    const episodes = Number(db.exec('SELECT count(*) FROM episodes')[0]?.values?.[0]?.[0] ?? 0);
    if (episodes === 0) {
      return { name: 'Memory Reflexion Coverage', status: 'warn', message: `${dbPath} — 0 episodes (Reflexion has not been exercised)` };
    }
    if (!tables.has('episode_embeddings')) {
      return {
        name: 'Memory Reflexion Coverage',
        status: 'fail',
        message: `${dbPath} — episode embeddings 0/${episodes} (0.00%); retrieveRelevant() cannot return rows`,
        fix: 'run `claude-flow memory distill run`; current distillation creates/backfills episode_embeddings',
      };
    }
    const embedded = Number(db.exec(
      'SELECT count(*) FROM episodes e JOIN episode_embeddings ee ON ee.episode_id=e.id',
    )[0]?.values?.[0]?.[0] ?? 0);
    const ratio = embedded / episodes;
    const detail = `episode embeddings ${embedded}/${episodes} (${(ratio * 100).toFixed(2)}%)`;
    if (ratio < 0.95) {
      return {
        name: 'Memory Reflexion Coverage',
        status: 'fail',
        message: `${dbPath} — ${detail} below 95% floor; retrieveRelevant() cannot see uncovered episodes`,
        fix: 'run `claude-flow memory distill run` to populate retrievable episodes',
      };
    }
    return { name: 'Memory Reflexion Coverage', status: 'pass', message: `${dbPath} — ${detail}` };
  } catch (e) {
    return { name: 'Memory Reflexion Coverage', status: 'warn', message: `${dbPath} — probe threw: ${(e as Error).message || String(e)}` };
  } finally { try { db.close(); } catch { /* best-effort */ } }
}

// Execution-tier feedback should carry a lesson, not just reward/success bits.
// Proxy episodes intentionally remain critique-free to avoid laundering a
// structural summary into an observed failure explanation.
export async function checkMemoryCritiqueCoverage(): Promise<HealthCheck> {
  const dbPath = await resolveMemoryDbPath();
  if (!dbPath) return { name: 'Memory Feedback Critiques', status: 'warn', message: 'no memory.db found' };
  const db = await tryOpenSqlJs(dbPath);
  if (!db) return { name: 'Memory Feedback Critiques', status: 'warn', message: 'DB unreadable (see Memory Integrity)' };
  try {
    const hasEpisodes = (db.exec(
      "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='episodes'",
    )[0]?.values?.[0]?.[0] ?? 0) > 0;
    if (!hasEpisodes) return { name: 'Memory Feedback Critiques', status: 'warn', message: 'episodes table absent' };
    const row = db.exec(`
      SELECT count(*),
        sum(CASE WHEN length(trim(coalesce(critique,''))) > 0 THEN 1 ELSE 0 END)
      FROM episodes WHERE session_id LIKE 'distill:feedback%'
    `)[0]?.values?.[0] ?? [0, 0];
    const feedback = Number(row[0] ?? 0);
    const withCritique = Number(row[1] ?? 0);
    if (feedback === 0) {
      return { name: 'Memory Feedback Critiques', status: 'warn', message: `${dbPath} — 0 execution-feedback episodes to assess` };
    }
    const ratio = withCritique / feedback;
    const detail = `feedback critiques ${withCritique}/${feedback} (${(ratio * 100).toFixed(2)}%)`;
    if (ratio < 0.95) {
      return {
        name: 'Memory Feedback Critiques',
        status: 'fail',
        message: `${dbPath} — ${detail} below 95% floor`,
        fix: 'run current `claude-flow memory distill run`; execution-tier episodes preserve observed critique/error text',
      };
    }
    return { name: 'Memory Feedback Critiques', status: 'pass', message: `${dbPath} — ${detail}` };
  } catch (e) {
    return { name: 'Memory Feedback Critiques', status: 'warn', message: `${dbPath} — probe threw: ${(e as Error).message || String(e)}` };
  } finally { try { db.close(); } catch { /* best-effort */ } }
}
