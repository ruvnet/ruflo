/** Bounded console projections and a fail-closed cross-process collector lease. */
import { closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
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

/** Successful provider deletion is a session fact, never an acceptance verdict. */
export function publishManagedTermination(root: string, sessionId: string, collector: { page: (id: string) => ManagedRunSnapshot | undefined; forget: (id: string) => boolean }): void {
  const snapshot = collector.page(sessionId);
  if (snapshot) publishManagedSnapshot(root, { ...snapshot, status: 'terminated', providerFinished: false, updatedMs: Date.now() });
  collector.forget(sessionId);
}
