/**
 * Doctor checks for the memory persistence driver, learning bridge and memory package version.
 * Split out of commands/doctor.ts (#4773).
 */

import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as semver from 'semver';
import {
  resolveMemoryPackageFromProject,
  resolveMemoryPackageFromCli,
  readMemoryPackageVersion,
  recordMemoryPackagePath,
} from '../../init/memory-package-resolver.js';
import {
  isMemoryDbEncryptedAtRest,
  isNativeSqliteBindingUnavailable,
  resolveMemoryDbPath,
  tryOpenSqlJs,
} from './memory-store.js';
import type { HealthCheck } from './shared.js';

// #2968/#3321 — read-only native SQLite capability probe. A skipped
// postinstall can leave the wrapper importable but its binding unavailable.
// Schema size cannot identify the runtime driver or the database's history:
// memory init creates its schema with sql.js even when native is available.
// This probe does not verify schema compatibility or cross-process writes;
// integrity checks and memory store's persistWarning retain their own roles.
//
// #3552: `loadBetterSqlite3` is injected as a parameter (default: the real
// dynamic import) so tests can supply a fake driver directly instead of
// racing `vi.doMock` against this function's own `import('better-sqlite3')`
// call, which was reliable in isolation but flaky under the full suite.
export type MemoryPersistenceDriverDeps = {
  loadBetterSqlite3?: () => Promise<{ default: any }>;
};

export async function checkMemoryPersistenceDriver(
  deps: MemoryPersistenceDriverDeps = {},
): Promise<HealthCheck> {
  const loadBetterSqlite3 = deps.loadBetterSqlite3
    ?? (() => import('better-sqlite3') as Promise<{ default: any }>);
  const NAME = 'Memory Persistence Driver';
  const dbPath = await resolveMemoryDbPath();
  if (!dbPath) {
    return {
      name: NAME,
      status: 'warn',
      message: 'no memory.db found (see Memory Database Presence above) — driver check skipped',
    };
  }

  if (isMemoryDbEncryptedAtRest(dbPath)) {
    return {
      name: NAME,
      status: 'warn',
      message: `${dbPath} — RFE1-encrypted at rest; driver check can't run without decrypting (expected, not corruption)`,
    };
  }

  let Database: any;
  try {
    Database = ((await loadBetterSqlite3()) as any).default;
  } catch {
    Database = null;
  }

  let tableCount: number | null = null;
  let nativeUnavailableReason: string | null = null;
  let nativeOpenOtherError: string | null = null;
  let nativeQueryError: string | null = null;

  if (Database) {
    let db: any;
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
    } catch (e) {
      if (isNativeSqliteBindingUnavailable(e)) {
        nativeUnavailableReason = ((e as Error).message || String(e)).split(/\r?\n/, 1)[0];
      } else {
        nativeOpenOtherError = (e as Error).message || String(e);
      }
      db = null;
    }
    if (db) {
      try {
        const row = db.prepare("SELECT count(*) AS c FROM sqlite_master WHERE type='table'").get() as { c?: unknown } | undefined;
        if (typeof row?.c === 'number' && Number.isSafeInteger(row.c) && row.c >= 0) {
          tableCount = row.c;
        } else {
          nativeQueryError = 'query returned no reliable table count';
        }
      } catch (e) {
        nativeQueryError = (e as Error).message || String(e);
      } finally {
        try { db.close(); } catch { /* best-effort */ }
      }
    }
  } else {
    nativeUnavailableReason = 'better-sqlite3 not installed';
  }

  // Fall back to sql.js purely to report table count when the native path
  // couldn't — informational only, never used to claim durability.
  if (tableCount === null && (nativeUnavailableReason || nativeOpenOtherError)) {
    const sdb = await tryOpenSqlJs(dbPath);
    if (sdb) {
      try {
        const res = sdb.exec("SELECT count(*) FROM sqlite_master WHERE type='table'");
        const count = res[0]?.values?.[0]?.[0];
        if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) {
          tableCount = count;
        }
      } catch {
        // leave null
      } finally {
        try { sdb.close(); } catch { /* best-effort */ }
      }
    }
  }

  const tableSummary = tableCount === null
    ? 'table count unavailable'
    : `${tableCount} tables`;

  if (nativeUnavailableReason) {
    return {
      name: NAME,
      status: 'warn',
      message: `${dbPath} — native better-sqlite3 binding unavailable: ${nativeUnavailableReason} — native read-only probe unavailable; runtime driver and write persistence not verified (#2968) [${tableSummary}; sql.js main-image-only fallback]`,
      fix: 'reinstall with npm install scripts enabled, or run `npm rebuild better-sqlite3`; then rerun this check',
    };
  }

  if (nativeOpenOtherError) {
    return {
      name: NAME,
      status: 'warn',
      message: `${dbPath} — native better-sqlite3 module loadable, but could not open this database (${nativeOpenOtherError}) — see Memory Integrity above for the corruption/encryption diagnosis [${tableSummary}]`,
    };
  }

  if (nativeQueryError || tableCount === null) {
    return {
      name: NAME,
      status: 'warn',
      message: `${dbPath} — native better-sqlite3 opened read-only, but table count unavailable: ${nativeQueryError ?? 'query returned no reliable result'}; runtime driver and write persistence not verified`,
    };
  }

  return {
    name: NAME,
    status: 'pass',
    message: `${dbPath} — native better-sqlite3 read-only open and schema query succeeded [${tableSummary}]; runtime driver, schema compatibility, and write persistence not verified`,
  };
}

// #2545: Check that the self-learning bridge can actually load @claude-flow/memory
// the SAME way the SessionStart auto-memory hook does. On the documented `npx ruflo`
// path the package lands in the npx cache — unreachable from the project — so the
// hook silently no-op'd with no signal anywhere. This surfaces it.
export async function checkLearningBridge(): Promise<HealthCheck> {
  const cwd = process.cwd();
  const hookPath = join(cwd, '.claude', 'helpers', 'auto-memory-hook.mjs');

  // Only relevant once init has deployed the hook; otherwise stay quiet.
  if (!existsSync(hookPath)) {
    return {
      name: 'Learning Bridge',
      status: 'pass',
      message: 'auto-memory hook not installed (run: npx ruflo@latest init)',
    };
  }

  const distPath = resolveMemoryPackageFromProject(cwd);
  if (distPath) {
    const version = readMemoryPackageVersion(distPath);
    return {
      name: 'Learning Bridge',
      status: 'pass',
      message: `@claude-flow/memory resolvable${version ? ` (v${version})` : ''}`,
    };
  }

  // #2599: Self-heal on plain `doctor` (not just --fix). The project-side resolver
  // fails when the sidecar is stale or missing (e.g. npx cache generation rotated),
  // but the CLI process itself can resolve @claude-flow/memory from its own module
  // context. Write the sidecar automatically instead of hard-failing the check.
  const record = recordMemoryPackagePath(cwd, 'doctor-auto');
  if (record) {
    const version = readMemoryPackageVersion(record.distPath);
    return {
      name: 'Learning Bridge',
      status: 'pass',
      message: `@claude-flow/memory resolvable via auto-recorded sidecar${version ? ` (v${version})` : ''}`,
    };
  }

  return {
    name: 'Learning Bridge',
    status: 'fail',
    message: '@claude-flow/memory NOT resolvable — SessionStart self-learning imports are a silent no-op',
    fix: 'npm i -D @claude-flow/memory   (optional dep appears absent — likely --omit=optional install)',
  };
}

/**
 * #3392: pure verdict for "does the @claude-flow/memory the CLI loads satisfy
 * the range the CLI declares?". `npx @claude-flow/cli@latest` reuses one npx
 * cache directory across CLI versions, and npm keeps an already-installed
 * dependency that still satisfies a caret range, so a stale memory could
 * survive a CLI upgrade with no error. Exported for unit testing.
 */
export function evaluateMemoryPackageVersion(declared: string | null, installed: string | null): HealthCheck {
  const NAME = '@claude-flow/memory version';
  if (!declared) {
    return { name: NAME, status: 'warn', message: 'could not read the @claude-flow/memory range declared by @claude-flow/cli' };
  }
  if (!installed) {
    return {
      name: NAME,
      status: 'warn',
      message: `@claude-flow/memory is not resolvable from the CLI (declared ${declared}) — memory features fall back to degraded paths`,
      fix: `npm install @claude-flow/memory@${declared} --include=optional`,
    };
  }
  if (!semver.validRange(declared) || !semver.valid(installed)) {
    return { name: NAME, status: 'warn', message: `cannot compare installed ${installed} against declared ${declared}` };
  }
  if (semver.satisfies(installed, declared, { includePrerelease: true })) {
    return { name: NAME, status: 'pass', message: `v${installed} satisfies declared ${declared}` };
  }
  // warn, not fail: a dev/hoisted layout can legitimately differ, and doctor's
  // exit code must not depend on which copy a package manager happened to hoist.
  return {
    name: NAME,
    status: 'warn',
    message: `installed v${installed} does not satisfy declared ${declared} — a stale cached copy is running, so fixes shipped in a newer @claude-flow/memory are silently absent`,
    fix: `rm -rf "$(npm config get cache)/_npx" && npx @claude-flow/cli@latest doctor   # or: npm install @claude-flow/memory@${declared}`,
  };
}

export async function checkMemoryPackageVersion(): Promise<HealthCheck> {
  try {
    // Walk up from this module to the CLI package root (npx cache, global,
    // project-local and monorepo dev all resolve the same way).
    let declared: string | null = null;
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8 && declared === null; i++) {
      const pj = join(dir, 'package.json');
      if (existsSync(pj)) {
        try {
          const pkg = JSON.parse(readFileSync(pj, 'utf-8')) as {
            name?: string;
            dependencies?: Record<string, string>;
            optionalDependencies?: Record<string, string>;
          };
          if (pkg.name === '@claude-flow/cli') {
            declared = pkg.optionalDependencies?.['@claude-flow/memory'] ?? pkg.dependencies?.['@claude-flow/memory'] ?? null;
            break;
          }
        } catch { /* keep walking */ }
      }
      dir = dirname(dir);
    }
    // Resolve exactly as the CLI's own runtime does (its module context),
    // not from process.cwd() — that would report the project's copy instead.
    const distPath = resolveMemoryPackageFromCli();
    return evaluateMemoryPackageVersion(declared, distPath ? readMemoryPackageVersion(distPath) : null);
  } catch (err) {
    return { name: '@claude-flow/memory version', status: 'warn', message: `check failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
