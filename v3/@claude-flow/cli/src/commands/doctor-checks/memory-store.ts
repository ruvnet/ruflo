/**
 * Doctor checks for the memory database files and their structural integrity.
 * Split out of commands/doctor.ts (#4773).
 */

import { existsSync, statSync, openSync, readSync, closeSync } from 'fs';
import { join, dirname } from 'path';
import { isEncryptedBlob } from '../../encryption/vault.js';
import type { HealthCheck } from './shared.js';

// Check memory database
//
// #2737: renamed the reported row from "Memory Database" to "Memory Database
// Presence" — this check is existsSync()+statSync() ONLY, it never opens the
// file or queries it, so it PASSES for any file that exists and can be
// stat'd, corrupt or not. It was the ONLY memory probe in the default
// `allChecks` run (the real integrity checks were --component memory only),
// so a corrupt .swarm/memory.db could sail through a bare `doctor` run as
// "healthy". The name change makes the check's actual scope honest; the
// behavior below is unchanged. See checkMemoryStructuralIntegrity below for
// the new default-run check that actually opens the file.
export async function checkMemoryDatabase(): Promise<HealthCheck> {
  // Authoritative path comes from `getMemoryRoot()` (honors
  // `CLAUDE_FLOW_MEMORY_PATH`, claude-flow.config.json's `memory.persistPath`,
  // then defaults to `.swarm/`). #1946: the previous hard-coded list missed
  // `data/memory/memory.db` (a common config) and ignored the env var
  // entirely, so doctor reported "Not initialized" on perfectly-init'd DBs.
  // Try the configured path first, then fall back to the historic candidates.
  const candidates: string[] = [];
  try {
    const { getMemoryRoot } = await import('../../memory/memory-initializer.js');
    candidates.push(join(getMemoryRoot(), 'memory.db'));
  } catch {
    /* memory-initializer not available — fall through to legacy candidates */
  }
  candidates.push(
    '.swarm/memory.db',
    '.claude-flow/memory.db',
    'data/memory/memory.db', // matches `CLAUDE_FLOW_MEMORY_PATH=data/memory`
    'data/memory.db',
  );

  for (const dbPath of candidates) {
    if (existsSync(dbPath)) {
      try {
        const stats = statSync(dbPath);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        return { name: 'Memory Database Presence', status: 'pass', message: `${dbPath} (${sizeMB} MB) — existence/size only, not a health check (see Memory Structural Integrity)` };
      } catch {
        return { name: 'Memory Database Presence', status: 'warn', message: `${dbPath} (unable to stat)` };
      }
    }
  }

  return { name: 'Memory Database Presence', status: 'warn', message: 'Not initialized', fix: 'claude-flow memory configure --backend hybrid' };
}

// ═══════════════════════════════════════════════════════════════════════════
// #2677 — memory doctor: functional checks (stuinfla)
//
// The existing `checkMemoryDatabase` above asserts existence + statability
// only, so it CANNOT distinguish a healthy DB from a 99.97%-empty or
// SQLite-malformed one. Stuinfla reported both cases live (81-store fleet).
// The checks below layer functional assertions on top, ordered so
// the earliest chain-break is always the first red the user sees:
//   1. Integrity          — can sql.js open it AND does PRAGMA integrity_check pass?
//   2. Content            — do most memory_entries rows carry non-empty content?
//   3. Embedding coverage — do most rows have a vector? (unembedded rows are
//                           both unrecallable AND undistillable per ADR-174)
//   6. Reflexion coverage — can episodes participate in retrieveRelevant's
//                           required episode_embeddings INNER JOIN?
//      Feedback critiques — do execution-tier episodes carry a real lesson?
// Ordering matters: content ratio is meaningless on a DB that can't open;
// embedding coverage is meaningless on rows with no content. First red wins.
//
// Recall probe (stuinfla check 4) still requires an isolated write+search+
// delete round trip through the CLI's own memory pipeline. It remains separate
// because doctor otherwise stays read-only.
//
// Design rules (also from stuinfla's report):
//   - "A check that cannot fail protects nothing" — every check has a
//     demonstrable red state.
//   - "UNKNOWN is never PASS" — if the check can't RUN, report warn/fail,
//     never a reassuring pass. Encrypted-DB case gets warn with the caveat
//     spelled out; corruption gets fail.
//   - "Print the measurement, not a checkmark" — messages include the
//     ratios so operators see the shape of the problem.

/** Resolve the same DB path checkMemoryDatabase above uses. Returns null
 * if no candidate exists (in which case none of these checks should
 * fire — checkMemoryDatabase will already have surfaced the missing DB). */
export async function resolveMemoryDbPath(): Promise<string | null> {
  const candidates: string[] = [];
  try {
    const { getMemoryRoot } = await import('../../memory/memory-initializer.js');
    candidates.push(join(getMemoryRoot(), 'memory.db'));
  } catch { /* fall through to legacy candidates */ }
  candidates.push('.swarm/memory.db', '.claude-flow/memory.db', 'data/memory/memory.db', 'data/memory.db');
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

/** Native AgentDB writes to a plaintext sibling of the sql.js memory file.
 * Probe only stores that already exist: projects without the native bridge
 * should not acquire an extra warning just by running doctor (#3195). */
export async function existingNativeAgentDbPaths(): Promise<string[]> {
  const candidates = new Set<string>();
  try {
    const { getMemoryRoot, resolveDbPath } = await import('../../memory/memory-initializer.js');
    candidates.add(join(getMemoryRoot(), 'agentdb-memory.db'));
    // Explicit CLAUDE_FLOW_DB_PATH callers may put the sibling elsewhere.
    candidates.add(join(dirname(resolveDbPath()), 'agentdb-memory.db'));
  } catch {
    candidates.add(join(process.cwd(), '.swarm', 'agentdb-memory.db'));
  }
  return [...candidates].filter((path) => existsSync(path));
}

/** Open a sql.js Database over an on-disk file, returning null when the
 * file can't be opened as a SQLite database (encrypted / corrupted / not
 * a database). Callers decide whether that's warn or fail. */
export async function tryOpenSqlJs(dbPath: string): Promise<any | null> {
  try {
    const initSqlJs: any = (await import('sql.js')).default ?? (await import('sql.js'));
    const SQL = await (typeof initSqlJs === 'function' ? initSqlJs() : initSqlJs.default());
    const { readFileSync } = await import('fs');
    const buf = readFileSync(dbPath);
    return new SQL.Database(new Uint8Array(buf));
  } catch { return null; }
}

// ── #2737 shared helpers: encryption-at-rest carve-out ─────────────────────
//
// "file is not a database" / "malformed" from sql.js or better-sqlite3 is
// EXACTLY the signal a legitimately RFE1-encrypted-at-rest memory.db also
// produces when opened without decrypting (ADR-096). Before either the new
// default-run check or the strengthened checkMemoryIntegrity below concludes
// "malformed = fail", they sniff for the RFE1 magic using the SAME detector
// checkEncryptionAtRest uses (isEncryptedBlob), so the two checks can never
// disagree about what counts as "encrypted".

/** Read just the first `len` bytes of a file without loading the whole file
 * into memory — a multi-GB memory.db shouldn't get fully buffered just to
 * check a 4-byte magic. Returns fewer bytes (or empty) when the file is
 * shorter than `len`; isEncryptedBlob() correctly treats a too-short blob
 * as "not encrypted", so callers don't need to special-case that. */
export function readHeaderBytes(path: string, len: number): Buffer {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(len);
    const bytesRead = readSync(fd, buf, 0, len, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

// RFE1 wire format is magic(4) + iv(12) + ciphertext(N) + tag(16); the
// shortest possible blob is 32 bytes. 64 gives headroom without importing
// vault.ts's private MIN_BLOB_LEN constant.
export const ENCRYPTION_SNIFF_LEN = 64;

/** True iff `dbPath` is a legitimately RFE1-encrypted-at-rest file. A read
 * failure (permissions, races) is treated as "not encrypted" — callers
 * still hit their own open/query error handling right after, so nothing
 * gets silently swallowed. */
export function isMemoryDbEncryptedAtRest(dbPath: string): boolean {
  try {
    return isEncryptedBlob(readHeaderBytes(dbPath, ENCRYPTION_SNIFF_LEN));
  } catch {
    return false;
  }
}

/**
 * Distinguish an unavailable native addon from a database that the native
 * driver opened and found malformed. Importing better-sqlite3 can succeed even
 * when its postinstall script was skipped: the JavaScript wrapper loads, then
 * the first Database construction throws because better_sqlite3.node is absent
 * or incompatible with the active Node ABI.
 */
export function isNativeSqliteBindingUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return [
    /Could not locate the bindings file/i,
    /better_sqlite3\.node/i,
    /NODE_MODULE_VERSION/i,
    /compiled against a different Node\.js version/i,
    /ERR_DLOPEN_FAILED/i,
    /invalid ELF header/i,
    /wrong ELF class/i,
    /not a valid Win32 application/i,
    /Module did not self-register/i,
    /no suitable image found/i,
  ].some((pattern) => pattern.test(message));
}

export function nativeBindingUnavailableCheck(name: string, dbPath: string, error: unknown, suffix: string): HealthCheck {
  const details = error instanceof Error ? error.message : String(error);
  const summary = details.split(/\r?\n/, 1)[0].replace(/\s+Tried:\s*$/i, '');
  return {
    name,
    status: 'warn',
    message: `${dbPath} — better-sqlite3 package found, but its native binding is unavailable: ${summary} ${suffix}`,
    fix: 'reinstall with npm install scripts enabled or run `npm rebuild better-sqlite3`; then rerun this check',
  };
}

// #2737 part 1 — bare `doctor` (no --component flag) never actually opened
// memory.db: checkMemoryDatabase above is existsSync()+statSync() only, so
// it PASSES on any file that exists and can be stat'd, corrupt or not, and
// it was the ONLY memory probe `allChecks` ran. The real integrity checks
// (checkMemoryIntegrity/Content/EmbeddingCoverage below) were, and remain,
// --component memory only.
//
// This is a NEW, cheaper, native check added to the default `allChecks` run
// (not a replacement for the deep trio):
//   - better-sqlite3 (native) instead of sql.js: it's WAL-aware because
//     SQLite itself resolves any sibling -wal file next to the main image;
//     sql.js is WAL-blind — tryOpenSqlJs() above only readFileSync()s the
//     main file and hands the raw bytes to the WASM build, so any
//     committed-but-not-checkpointed rows sitting in a -wal file are
//     invisible to it.
//   - PRAGMA quick_check, not integrity_check: per sqlite.org, quick_check
//     "is like integrity_check except that it does not verify UNIQUE
//     constraints and does not verify that index content matches table
//     content" — bounded enough to run unconditionally on every bare
//     `doctor` call. The full integrity_check (with those extra
//     cross-checks) is what the strengthened checkMemoryIntegrity below
//     runs when better-sqlite3 is available.
// Explicitly labeled "structural-only" in both the row name and every
// message so nobody mistakes this cheap default-run probe for the deeper
// --component memory one.
export async function checkMemoryStructuralIntegrity(): Promise<HealthCheck> {
  const NAME = 'Memory Structural Integrity (quick_check)';
  const dbPath = await resolveMemoryDbPath();
  if (!dbPath) {
    // Not-yet-initialized project — Memory Database Presence above already
    // surfaces this; "UNKNOWN is never PASS" still applies, so this stays a
    // warn rather than a silent skip, but doesn't pile on a second red for
    // the same root cause.
    return {
      name: NAME,
      status: 'warn',
      message: 'no memory.db found (see Memory Database Presence above) — structural-only check skipped',
    };
  }

  // Encryption-at-rest carve-out (#2737 part 3) — see helpers above.
  if (isMemoryDbEncryptedAtRest(dbPath)) {
    return {
      name: NAME,
      status: 'warn',
      message: `${dbPath} — RFE1-encrypted at rest; structural-only check can't run without decrypting (expected, not corruption — see Encryption at Rest)`,
    };
  }

  let Database: any;
  try {
    Database = ((await import('better-sqlite3')) as any).default;
  } catch {
    return {
      name: NAME,
      status: 'warn',
      message: `${dbPath} — better-sqlite3 not installed; native WAL-backed persistence and the structural-only check are unavailable`,
      fix: 'install better-sqlite3 with npm install scripts enabled, then rerun this check',
    };
  }

  let db: any;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (e) {
    if (isNativeSqliteBindingUnavailable(e)) {
      return nativeBindingUnavailableCheck(
        NAME,
        dbPath,
        e,
        '[structural-only; durable WAL-backed persistence unavailable]',
      );
    }
    const msg = (e as Error).message || String(e);
    // Encryption already ruled out above — an unencrypted file
    // better-sqlite3 can't even open is definitive corruption.
    // #2737 part 3: fail, not warn.
    return {
      name: NAME,
      status: 'fail',
      message: `${dbPath} — better-sqlite3 failed to open: ${msg} (unencrypted; definitively malformed) [structural-only]`,
      fix: 'back up .swarm/memory.db then `claude-flow memory init --force`',
    };
  }

  try {
    const rows = db.pragma('quick_check') as Array<Record<string, unknown>>;
    const values = rows.map((r) => String(Object.values(r)[0]));
    if (values.length === 1 && values[0] === 'ok') {
      return {
        name: NAME,
        status: 'pass',
        message: `${dbPath} — PRAGMA quick_check: ok [structural-only, native + WAL-aware]`,
      };
    }
    return {
      name: NAME,
      status: 'fail',
      message: `${dbPath} — PRAGMA quick_check: ${values.slice(0, 3).join('; ')}${values.length > 3 ? ` (+${values.length - 3} more)` : ''} [structural-only]`,
      fix: 'back up .swarm/memory.db then `claude-flow memory init --force`',
    };
  } catch (e) {
    const msg = (e as Error).message || String(e);
    // Encryption ruled out above; DB opened but the pragma itself threw —
    // still definitive, unencrypted breakage. Fail, not warn.
    return {
      name: NAME,
      status: 'fail',
      message: `${dbPath} — quick_check probe threw: ${msg} (unencrypted) [structural-only]`,
      fix: 'back up .swarm/memory.db then `claude-flow memory init --force`',
    };
  } finally {
    try { db.close(); } catch { /* best-effort */ }
  }
}

/** Check the AgentDB authority independently from the legacy memory.db.
 * Opening read-only with SQLite keeps WAL commits visible without mutating
 * either store; the existing legacy health checks retain their own scope. */
export async function checkNativeAgentDbStructuralIntegrity(dbPath: string): Promise<HealthCheck> {
  const NAME = 'Native AgentDB Structural Integrity (quick_check)';
  if (!existsSync(dbPath)) {
    return { name: NAME, status: 'warn', message: `${dbPath} disappeared before the native check could run` };
  }
  if (isMemoryDbEncryptedAtRest(dbPath)) {
    return {
      name: NAME,
      status: 'fail',
      message: `${dbPath} — RFE1-encrypted; native AgentDB requires a plaintext SQLite file`,
      fix: `back up ${dbPath} and restore a usable native AgentDB database`,
    };
  }

  let Database: any;
  try {
    Database = ((await import('better-sqlite3')) as any).default;
  } catch {
    return {
      name: NAME,
      status: 'warn',
      message: `${dbPath} — better-sqlite3 not installed; native AgentDB structural health is unverified`,
      fix: 'install better-sqlite3 with npm install scripts enabled, then rerun this check',
    };
  }

  let db: any;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (error) {
    if (isNativeSqliteBindingUnavailable(error)) {
      return nativeBindingUnavailableCheck(NAME, dbPath, error, '[native AgentDB structural health unverified]');
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: NAME,
      status: 'fail',
      message: `${dbPath} — better-sqlite3 failed to open: ${message} [native AgentDB]`,
      fix: `back up ${dbPath} and its WAL sidecars, then restore a known-good native AgentDB database`,
    };
  }

  try {
    const rows = db.pragma('quick_check') as Array<Record<string, unknown>>;
    const values = rows.map((row) => String(Object.values(row)[0]));
    if (values.length === 1 && values[0] === 'ok') {
      return { name: NAME, status: 'pass', message: `${dbPath} — PRAGMA quick_check: ok [native AgentDB, WAL-aware]` };
    }
    return {
      name: NAME,
      status: 'fail',
      message: `${dbPath} — PRAGMA quick_check: ${values.slice(0, 3).join('; ')}${values.length > 3 ? ` (+${values.length - 3} more)` : ''} [native AgentDB]`,
      fix: `back up ${dbPath} and its WAL sidecars, then restore a known-good native AgentDB database`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: NAME,
      status: 'fail',
      message: `${dbPath} — quick_check probe threw: ${message} [native AgentDB]`,
      fix: `back up ${dbPath} and its WAL sidecars, then restore a known-good native AgentDB database`,
    };
  } finally {
    try { db.close(); } catch { /* best-effort */ }
  }
}
