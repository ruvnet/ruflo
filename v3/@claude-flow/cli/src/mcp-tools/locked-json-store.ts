/**
 * Locked read-modify-write for the MCP JSON stores (claims, tasks, agents,
 * workflows).
 *
 * Each store used to load the whole file, change it in memory, and write it
 * back with writeFileSync. Two processes (two MCP servers, parallel agents)
 * doing that at once both read the same file, and the last write erased the
 * other's change while both reported success: 4 of 4 racers "won" the same
 * claims_claim, and 8 concurrent task_create calls kept 1 task.
 *
 * updateJsonStore runs load → mutate → save under the store's cross-process
 * lock file, so the mutation always sees the latest data and a check-and-set
 * (an issue is free → claim it) cannot interleave. The lock and the atomic
 * write are the policy runtime's (`acquireLock`, `writeJsonAtomic`), shared
 * rather than copied, as ADR-406 mission storage does.
 *
 * Rules for callers:
 * - Keep `mutate` synchronous. Do slow work (model calls, imports) before
 *   the call, then reload and apply the result inside it.
 * - Never wait on updateJsonStore for the same file while a call for it is
 *   still running: the turn is not re-entrant, so that wait never ends. Run
 *   follow-up writes after the call returns (see task-tools' afterSave).
 */
import { mkdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { acquireLock, writeJsonAtomic } from '../services/policy-runtime.js';

export interface StoreUpdate<R> {
  /** Returned to the caller of updateJsonStore. */
  result: R;
  /** false leaves the file untouched, e.g. for a refused operation. */
  save: boolean;
}

/** Save the mutated store and return `result`. */
export function saved<R>(result: R): StoreUpdate<R> {
  return { result, save: true };
}

/** Return `result` without writing, e.g. for a refused operation. */
export function unchanged<R>(result: R): StoreUpdate<R> {
  return { result, save: false };
}

/** Lock file guarding `file`. Every writer of a store must use this path. */
export function storeLockPath(file: string): string {
  return `${file}.lock`;
}

/**
 * Calls in one process queue here, in order, before taking the lock file.
 * The lock file then only arbitrates between processes, and a call in this
 * process never polls it on a timer while another call here holds it.
 */
const queues = new Map<string, Promise<void>>();

async function inProcessTurn<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  let finish!: () => void;
  const mine = previous.then(() => new Promise<void>((done) => { finish = done; }));
  queues.set(key, mine);
  await previous;
  try {
    return await run();
  } finally {
    finish();
    if (queues.get(key) === mine) queues.delete(key);
  }
}

export function updateJsonStore<S, R>(
  file: string,
  load: () => S,
  mutate: (store: S) => StoreUpdate<R>,
  label: string,
): Promise<R> {
  return inProcessTurn(resolve(file), () => lockedUpdate(file, load, mutate, label));
}

/**
 * Overwrite a whole store under its lock, e.g. when session_restore puts back
 * a saved copy. Without the lock, a concurrent locked update that read the
 * file before the restore would write its stale copy over the restored one.
 */
export function replaceJsonStore(file: string, value: unknown, label: string): Promise<void> {
  return updateJsonStore(file, () => value, () => saved(undefined), label);
}

async function lockedUpdate<S, R>(
  file: string,
  load: () => S,
  mutate: (store: S) => StoreUpdate<R>,
  label: string,
): Promise<R> {
  // acquireLock creates its lock file next to the store, so the folder must
  // exist on the very first write.
  mkdirSync(dirname(file), { recursive: true });

  let release: () => void;
  try {
    release = await acquireLock(storeLockPath(file));
  } catch (error) {
    // Only a timeout means another writer holds the lock; other lock errors
    // (permissions, a non-file at the lock path) keep their own message.
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('policy-state-lock-timeout')) {
      throw new Error(
        `${label} store is busy (another process holds ${basename(storeLockPath(file))}); retry`,
        { cause: error },
      );
    }
    throw error;
  }

  try {
    const store = load();
    const { result, save } = mutate(store);
    if (save) await writeJsonAtomic(file, store);
    return result;
  } finally {
    release();
  }
}
