import { chmodSync, copyFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * Give a record map a null prototype. Record keys come from MCP tool input; on
 * a plain object `__proto__` or `constructor` resolve to Object.prototype or a
 * built-in, which a handler would then write into. A null-prototype map only
 * ever returns its own records.
 */
export function nullPrototypeRecords<M extends object>(map: M | undefined | null): M {
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    Object.setPrototypeOf(map, null);
    return map;
  }
  return Object.create(null) as M;
}

/** Only an absent store is empty. Failed reads must never authorize replacement. */
export function readRecordStore<T>(path: string, collection: string, empty: () => T): T {
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const store = empty() as Record<string, unknown>;
      store[collection] = nullPrototypeRecords(store[collection] as object | undefined);
      return store as T;
    }
    throw error;
  }
  const store = JSON.parse(text);
  const records = store?.[collection];
  if (!store || typeof store !== 'object' || Array.isArray(store)
      || !records || typeof records !== 'object' || Array.isArray(records)) {
    throw new Error(`Invalid ${collection} store at ${path}; existing data was preserved`);
  }
  nullPrototypeRecords(records);
  return store as T;
}

/**
 * JSON object store read for workflow, hive-mind, and swarm (#4737).
 * Same rule as {@link readRecordStore}: only a missing file is empty.
 * A parse failure, a non-object document, or a document `accept` rejects is
 * copied to `${path}.corrupt-<timestamp>` and thrown, so a later save cannot
 * replace the original.
 */
export function readPreservedJsonStore<T extends object>(
  path: string,
  label: string,
  empty: () => T,
  accept: (store: T) => boolean = () => true,
): T {
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty();
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    refuseCorruptStore(path, label, why);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !accept(parsed as T)) {
    refuseCorruptStore(path, label);
  }
  return parsed as T;
}

function refuseCorruptStore(path: string, label: string, detail?: string): never {
  let where = 'existing data was preserved';
  try {
    where = `corrupt file backed up to ${backupCorruptStore(path)}; existing data was preserved`;
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    where = `backup failed (${why}); existing data was preserved`;
  }
  const suffix = detail ? ` (${detail})` : '';
  throw new Error(`Invalid ${label} store at ${path}${suffix}; ${where}`);
}

/**
 * Copy `path` to `${path}.corrupt-<timestamp>` without removing the original.
 * A backup with identical bytes is reused, so polling a corrupt store does not
 * add a copy on every read.
 */
function backupCorruptStore(path: string): string {
  const existing = existingIdenticalBackup(path);
  if (existing) return existing;
  const stamp = Date.now();
  let backup = `${path}.corrupt-${stamp}`;
  let n = 0;
  while (existsSync(backup)) {
    n += 1;
    backup = `${path}.corrupt-${stamp}-${n}`;
  }
  copyFileSync(path, backup);
  try {
    chmodSync(backup, statSync(path).mode & 0o777);
  } catch {
    /* content is already copied; mode is best-effort */
  }
  return backup;
}

function existingIdenticalBackup(path: string): string | null {
  const dir = dirname(path);
  const prefix = `${basename(path)}.corrupt-`;
  let current: Buffer;
  try {
    current = readFileSync(path);
  } catch {
    return null;
  }
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.startsWith(prefix));
  } catch {
    return null;
  }
  for (const name of names) {
    const candidate = join(dir, name);
    try {
      if (statSync(candidate).size === current.length && readFileSync(candidate).equals(current)) return candidate;
    } catch {
      /* unreadable candidate: keep looking */
    }
  }
  return null;
}
