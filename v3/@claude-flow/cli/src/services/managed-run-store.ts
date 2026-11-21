/** Bounded console projections and a fail-closed cross-process collector lease. */
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync, type Stats } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { ManagedRunSnapshot } from './managed-run-collector.js';

const flights = new Map<string, { scope: string; promise: Promise<unknown> }>();
function folder(root: string): string {
  let p = resolve(root);
  if (!lstatSync(p).isDirectory()) throw new Error('Invalid managed project root');
  for (const name of ['.claude-flow', 'managed-workflows']) {
    p = join(p, name);
    if (!existsSync(p)) mkdirSync(p, { mode: 0o700 });
    if (!lstatSync(p).isDirectory() || lstatSync(p).isSymbolicLink()) throw new Error('Managed snapshot directory must be regular');
  }
  return p;
}

/** Other processes fail rather than poll twice. Never automatically steal a lease. */
export function collectWithLease<T>(root: string, sessionId: string, action: () => Promise<T>, scope = ''): Promise<T> {
  if (!/^sesn_[A-Za-z0-9]+$/.test(sessionId)) return Promise.reject(new Error('Invalid managed session ID'));
  const path = join(folder(root), `${sessionId}.collector.lock`);
  const pending = flights.get(path);
  if (pending) return pending.scope === scope ? pending.promise.then(v => structuredClone(v) as T) : Promise.reject(new Error('Managed collector belongs to another credential scope'));
  let fd: number;
  try { fd = openSync(path, 'wx', 0o600); } catch { return Promise.reject(new Error('Managed collector is leased by another process; inspect before recovering a stale lease')); }
  const flight = Promise.resolve().then(action).finally(() => { closeSync(fd); unlinkSync(path); flights.delete(path); });
  flights.set(path, { scope, promise: flight });
  return flight.then(v => structuredClone(v));
}

/** Read only the fixed, capped projection. It has no authorization role. */
function previous(path: string): ManagedRunSnapshot[] {
  if (!existsSync(path)) return [];
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Invalid managed snapshot file');
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const buffer = Buffer.alloc(128_001);
    const count = readSync(fd, buffer, 0, buffer.length, 0);
    if (count > 128_000) throw new Error('Managed snapshot exceeds limit');
    const value = JSON.parse(buffer.subarray(0, count).toString('utf8'));
    if (value.version !== 1 || !Array.isArray(value.sessions) || value.sessions.length > 6) throw new Error('Invalid managed snapshot');
    return value.sessions;
  } finally { closeSync(fd); }
}

export function publishManagedSnapshot(root: string, snapshot: ManagedRunSnapshot): void {
  const dir = folder(root), lockPath = join(dir, 'snapshot.lock');
  const fd = openSync(lockPath, 'wx', 0o600), temp = join(dir, `${randomUUID()}.tmp`);
  try {
    const path = join(dir, 'snapshot.json');
    const old = previous(path);
    const sessions = [snapshot, ...old.filter(s => s.sessionId !== snapshot.sessionId)].slice(0, 6);
    if (JSON.stringify(sessions) === JSON.stringify(old)) return;
    const text = JSON.stringify({ version: 1, updatedMs: Date.now(), sessions });
    if (Buffer.byteLength(text) > 128_000) throw new Error('Managed snapshot exceeds limit');
    const out = openSync(temp, 'wx', 0o600);
    try { writeFileSync(out, text); fsyncSync(out); } finally { closeSync(out); }
    renameSync(temp, path);
  } finally { if (existsSync(temp)) unlinkSync(temp); closeSync(fd); unlinkSync(lockPath); }
}

export type ControlAction = 'inspect' | 'interrupt' | 'terminate';
/** Host settings are read again immediately before side effects, never from console facts. */
export async function executeManagedControl(input: Record<string, unknown>, deps: {
  policy: () => { enabled: boolean; sessions: string[] };
  read: (sessionId: string) => Promise<{ status?: string }>;
  inspect: (sessionId: string, offset: number) => Promise<unknown>;
  interrupt: (sessionId: string) => Promise<unknown>;
  terminate: (sessionId: string) => Promise<unknown>;
}) {
  const sessionId = input.sessionId, action = input.action;
  if (Object.keys(input).some(k => !['sessionId', 'action', 'threadOffset'].includes(k)) || typeof sessionId !== 'string' || !/^sesn_[A-Za-z0-9]+$/.test(sessionId) || !['inspect', 'interrupt', 'terminate'].includes(String(action))) throw new Error('Invalid managed control request');
  const offset = input.threadOffset ?? 0;
  if (!Number.isSafeInteger(offset) || (offset as number) < 0 || (offset as number) >= 10_000 || (action !== 'inspect' && input.threadOffset !== undefined)) throw new Error('Invalid managed worker page');
  const allowed = () => { const p = deps.policy(); return p.enabled && p.sessions.includes(sessionId); };
  if (!allowed()) throw new Error('Host managed control policy denies this session');
  const current = await deps.read(sessionId);
  if (!current || !['idle', 'running', 'rescheduling', 'terminated'].includes(current.status ?? '')) throw new Error('Unknown provider session state');
  if (!allowed()) throw new Error('Host managed control policy changed before dispatch');
  if (action === 'inspect') return { success: true, currentStatus: current.status, snapshot: await deps.inspect(sessionId, offset as number) };
  if (current.status === 'terminated') return { success: true, currentStatus: 'terminated', cancellationConfirmed: true };
  if (action === 'interrupt') return { success: true, currentStatus: current.status, interruptRequested: true, cancellationConfirmed: false, result: await deps.interrupt(sessionId) };
  return { success: true, currentStatus: current.status, cancellationConfirmed: true, result: await deps.terminate(sessionId) };
}

/** Sessions this project created. Every other session in the organisation needs a host allowlist entry. */
export interface ManagedSessionRecord { sessionId: string; environmentId?: string; createdMs: number }
const LEDGER_LIMIT = 1000;

// The ledger lives in the user's state directory, keyed by project, never in the workspace: an agent that can write
// project files must not be able to grant itself another session. Same base directory as the dispatch queue.
export function managedLedgerPath(root: string): string {
  let project = resolve(root);
  try { project = realpathSync.native(project); } catch { /* a missing project keeps its resolved path */ }
  const override = process.env.RUFLO_AI_BUDGET_DIR;
  const base = override && isAbsolute(override) ? override : join(homedir(), '.claude-flow');
  return join(base, 'managed', `${createHash('sha256').update(project).digest('hex')}.json`);
}

function ledgerEntries(path: string): ManagedSessionRecord[] {
  if (!existsSync(path)) return [];
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Invalid managed session ledger');
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const buffer = Buffer.alloc(256_001);
    const count = readSync(fd, buffer, 0, buffer.length, 0);
    if (count > 256_000) throw new Error('Managed session ledger exceeds limit');
    const value = JSON.parse(buffer.subarray(0, count).toString('utf8'));
    if (value.version !== 1 || !Array.isArray(value.sessions) || value.sessions.length > LEDGER_LIMIT) throw new Error('Invalid managed session ledger');
    for (const s of value.sessions) {
      if (typeof s?.sessionId !== 'string' || !/^sesn_[A-Za-z0-9]+$/.test(s.sessionId) || (s.environmentId !== undefined && (typeof s.environmentId !== 'string' || !/^env_[A-Za-z0-9]+$/.test(s.environmentId)))) throw new Error('Invalid managed session ledger');
    }
    return value.sessions;
  } finally { closeSync(fd); }
}

// Reads treat an unreadable ledger as owning nothing. A write keeps it aside for inspection and starts empty.
function writableEntries(path: string): ManagedSessionRecord[] {
  try { return ledgerEntries(path); } catch {
    renameSync(path, `${path}.corrupt-${Date.now()}`);
    return [];
  }
}

const LOCK_STALE_MS = 5_000;

const sameFile = (a: Stats, b: Stats): boolean => a.ino === b.ino && a.dev === b.dev;

// #5025: breaking a stale lock was lstat → unlink, so two waiters that saw the same dead lock could both break it, the
// second unlinking the fresh lock the first had just taken. Breakers now serialise on `<lock>.reclaim` and re-check
// the lock under it: the first unlinks the dead lock, a later one finds a fresh lock (or none) and leaves it. A guard
// is held for microseconds, so one older than LOCK_STALE_MS was left by a breaker that died and is removed.
function breakStaleLock(path: string, seen: Stats): boolean {
  const guard = `${path}.reclaim`;
  let fd: number, mine: Stats;
  try { fd = openSync(guard, 'wx', 0o600); mine = fstatSync(fd); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    try { if (Date.now() - lstatSync(guard).mtimeMs > LOCK_STALE_MS) unlinkSync(guard); } catch { /* released meanwhile */ }
    return false;
  }
  try {
    const now = lstatSync(path);
    if (!now.isFile() || !sameFile(now, seen) || now.mtimeMs !== seen.mtimeMs || Date.now() - now.mtimeMs <= LOCK_STALE_MS) return false;
    unlinkSync(path);
    return true;
  } catch { return true; /* released meanwhile: retry the create */ }
  finally { closeSync(fd); try { if (sameFile(lstatSync(guard), mine)) unlinkSync(guard); } catch { /* already gone */ } }
}

// A lost record would strand a session this project just paid for, so wait briefly for another writer. The lock
// names its owner; one older than LOCK_STALE_MS was left by a writer that died, and is broken. Returns the release,
// which removes the lock only if it is still the file this call created.
export function acquireLedgerLock(path: string): () => void {
  for (let attempt = 0; ; attempt++) {
    try {
      const fd = openSync(path, 'wx', 0o600);
      let mine: Stats;
      try { writeFileSync(fd, `${process.pid} ${Date.now()}\n`); mine = fstatSync(fd); } catch (error) { closeSync(fd); unlinkSync(path); throw error; }
      return () => {
        try { if (sameFile(lstatSync(path), mine)) unlinkSync(path); } catch { /* already gone */ } finally { closeSync(fd); }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt >= 20) throw error;
      let lock: Stats;
      try { lock = lstatSync(path); } catch { /* released meanwhile */ continue; }
      if (lock.isFile() && Date.now() - lock.mtimeMs > LOCK_STALE_MS && breakStaleLock(path, lock)) continue;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
}

// Returns the records the size cap dropped.
function updateLedger(root: string, change: (sessions: ManagedSessionRecord[]) => ManagedSessionRecord[]): ManagedSessionRecord[] {
  const path = managedLedgerPath(root), dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) throw new Error('Managed session ledger directory must be regular');
  const lockPath = `${path}.lock`, temp = join(dir, `${randomUUID()}.tmp`);
  const release = acquireLedgerLock(lockPath);
  try {
    const sessions = change(writableEntries(path));
    const out = openSync(temp, 'wx', 0o600);
    try { writeFileSync(out, JSON.stringify({ version: 1, sessions: sessions.slice(0, LEDGER_LIMIT) })); fsyncSync(out); } finally { closeSync(out); }
    renameSync(temp, path);
    return sessions.slice(LEDGER_LIMIT);
  } finally { if (existsSync(temp)) unlinkSync(temp); release(); }
}

export function recordManagedSession(root: string, sessionId: string, environmentId: string): ManagedSessionRecord[] {
  if (!/^sesn_[A-Za-z0-9]+$/.test(sessionId) || !/^env_[A-Za-z0-9]+$/.test(environmentId)) throw new Error('Invalid managed session ID');
  return updateLedger(root, sessions => [{ sessionId, environmentId, createdMs: Date.now() }, ...sessions.filter(s => s.sessionId !== sessionId)]);
}

export function forgetManagedSession(root: string, sessionId: string): void {
  updateLedger(root, sessions => sessions.filter(s => s.sessionId !== sessionId));
}

/** Reads never create state. A missing ledger owns nothing; an unreadable one throws. */
export function ownedManagedSession(root: string, sessionId: string): ManagedSessionRecord | undefined {
  return ledgerEntries(managedLedgerPath(root)).find(s => s.sessionId === sessionId);
}

/** Successful provider deletion is a session fact, never an acceptance verdict. */
export function publishManagedTermination(root: string, sessionId: string, collector: { page: (id: string) => ManagedRunSnapshot | undefined; forget: (id: string) => boolean }): void {
  const snapshot = collector.page(sessionId);
  if (snapshot) publishManagedSnapshot(root, { ...snapshot, status: 'terminated', providerFinished: false, updatedMs: Date.now() });
  collector.forget(sessionId);
}
