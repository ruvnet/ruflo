/**
 * Cross-process locked, atomic JSON stores (ADR-531, #4736).
 *
 * The claims, tasks, agents and workflows MCP stores used a plain
 * load → mutate → writeFileSync cycle, so two MCP servers in one project lost
 * each other's updates and `claims_claim` was not an atomic check-and-set.
 *
 * - `writeJsonAtomic` writes a unique sibling temp file and renames it over
 *   the target, so readers never see a torn file.
 * - `withJsonStoreLock` holds `<path>.lock` (O_EXCL) for a SYNCHRONOUS
 *   operation. The lock is never held across an `await`.
 * - `updateJsonStore` = lock → fresh read → mutate → atomic write → unlock.
 */
import { closeSync, mkdirSync, openSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

/** A lock older than this is treated as abandoned by a crashed process. */
export const JSON_STORE_LOCK_STALE_MS = 10_000;
const LOCK_RETRY_DELAY_MS = 5;
const LOCK_MAX_WAIT_MS = 5_000;

const waiter = new Int32Array(new SharedArrayBuffer(4));

export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: 'utf-8', mode: 0o600 });
    renameSync(temporary, path);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* already renamed or never created */ }
    throw error;
  }
}

export function withJsonStoreLock<T>(path: string, operation: () => T): T {
  if (typeof operation !== 'function') throw new TypeError('operation must be a function');
  mkdirSync(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  const deadline = Date.now() + LOCK_MAX_WAIT_MS;
  let descriptor: number | undefined;
  while (descriptor === undefined) {
    try {
      descriptor = openSync(lockPath, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (takeOverStaleLock(lockPath)) continue;
      if (Date.now() >= deadline) {
        throw new Error(`JSON store ${path} is busy (lock held by another process); retry the operation`);
      }
      Atomics.wait(waiter, 0, 0, LOCK_RETRY_DELAY_MS);
    }
  }
  try {
    const result = operation();
    if (result && typeof (result as { then?: unknown }).then === 'function') {
      throw new TypeError('withJsonStoreLock operation must be synchronous; do not hold the lock across await');
    }
    return result;
  } finally {
    try { closeSync(descriptor); } catch { /* best effort */ }
    try { unlinkSync(lockPath); } catch { /* best effort */ }
  }
}

/**
 * Remove a lock whose mtime is older than the stale threshold. Rename-then-
 * unlink so two waiters cannot both delete a lock and then both acquire.
 */
function takeOverStaleLock(lockPath: string): boolean {
  try {
    if (Date.now() - statSync(lockPath).mtimeMs <= JSON_STORE_LOCK_STALE_MS) return false;
    const claimed = `${lockPath}.stale.${process.pid}.${randomBytes(4).toString('hex')}`;
    renameSync(lockPath, claimed);
    try { unlinkSync(claimed); } catch { /* best effort */ }
    return true;
  } catch {
    // The holder released it, or another waiter took it over first. Retry.
    return true;
  }
}

export interface JsonStoreUpdate<R> {
  /** Value returned to the caller. */
  result: R;
  /** Write the store back. Defaults to true. */
  changed?: boolean;
}

/**
 * Atomic read-modify-write. `read` loads the store fresh inside the lock;
 * `mutate` changes it in place and returns the result plus whether to persist.
 */
export function updateJsonStore<S, R>(
  path: string,
  read: () => S,
  mutate: (store: S) => JsonStoreUpdate<R>,
): R {
  return withJsonStoreLock(path, () => {
    const store = read();
    const { result, changed = true } = mutate(store);
    if (changed) writeJsonAtomic(path, store);
    return result;
  });
}
