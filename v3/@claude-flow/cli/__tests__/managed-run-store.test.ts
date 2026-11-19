import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { collectWithLease, executeManagedControl, publishManagedSnapshot } from '../src/services/managed-run-store.js';
import type { ManagedRunSnapshot } from '../src/services/managed-run-collector.js';

const roots: string[] = [];
const root = () => { const p = mkdtempSync(join(tmpdir(), 'managed-run-store-')); roots.push(p); return p; };
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });
const sample = (): ManagedRunSnapshot => ({ sessionId: 'sesn_a', status: 'idle', stopReason: 'end_turn', budgetCents: 100, listCostCents: 11, providerFinished: true, workersInspected: false, acceptancePassed: false, verification: 'unverified', runs: [], threads: [], threadOffset: 0, threadCount: 0, threadCounts: { running: 0, ended: 0, failed: 0, idle: 0 }, blockedEventIds: [], observedFailures: 0, updatedMs: 1000 });
function controls() {
  return { policy: vi.fn(() => ({ enabled: true, sessions: ['sesn_a'] })), read: vi.fn(async () => ({ status: 'running' })), inspect: vi.fn(async () => sample()), interrupt: vi.fn(async () => ({})), terminate: vi.fn(async () => ({})) };
}

it('shares one collection and holds a real exclusive OS lease across processes', async () => {
  const r = root(); let done!: (v: object) => void;
  const operation = vi.fn(() => new Promise<object>(resolve => { done = resolve; }));
  const first = collectWithLease(r, 'sesn_a', operation), second = collectWithLease(r, 'sesn_a', operation);
  await Promise.resolve();
  const path = join(r, '.claude-flow/managed-workflows/sesn_a.collector.lock');
  const child = spawnSync(process.execPath, ['-e', 'try { require("node:fs").openSync(process.argv[1], "wx"); process.exit(1); } catch { process.exit(0); }', path]);
  expect(child.status).toBe(0); expect(operation).toHaveBeenCalledTimes(1);
  done({ events: 1000 });
  expect(await first).toEqual(await second);
});
it('fails closed on a preexisting collector lease instead of starting another poller', async () => {
  const r = root(); mkdirSync(join(r, '.claude-flow/managed-workflows'), { recursive: true });
  writeFileSync(join(r, '.claude-flow/managed-workflows/sesn_a.collector.lock'), 'stale');
  const operation = vi.fn(); await expect(collectWithLease(r, 'sesn_a', operation)).rejects.toThrow('leased');
  expect(operation).not.toHaveBeenCalled();
});
it('publishes bounded display facts that never claim acceptance', () => {
  const r = root(); publishManagedSnapshot(r, sample());
  const value = JSON.parse(readFileSync(join(r, '.claude-flow/managed-workflows/snapshot.json'), 'utf8'));
  expect(value.sessions[0]).toMatchObject({ providerFinished: true, workersInspected: false, acceptancePassed: false, verification: 'unverified' });
  expect(JSON.stringify(value)).not.toContain('api-key');
});
it('refuses caller approval flags and invalid session or worker-page inputs before provider reads', async () => {
  for (const input of [{ sessionId: 'sesn_a', action: 'terminate', approved: true }, { sessionId: '../x', action: 'inspect' }, { sessionId: 'sesn_a', action: 'inspect', threadOffset: -1 }]) {
    const c = controls(); await expect(executeManagedControl(input, c)).rejects.toThrow('Invalid'); expect(c.read).not.toHaveBeenCalled();
  }
});
it('refuses actions without fresh host policy permission', async () => {
  const c = controls(); c.policy.mockReturnValue({ enabled: false, sessions: ['sesn_a'] });
  await expect(executeManagedControl({ sessionId: 'sesn_a', action: 'terminate' }, c)).rejects.toThrow('denies');
  expect(c.read).not.toHaveBeenCalled(); expect(c.terminate).not.toHaveBeenCalled();
});
it('checks policy again after a provider read, defeating stale-console permission', async () => {
  const c = controls(); c.policy.mockReturnValueOnce({ enabled: true, sessions: ['sesn_a'] }).mockReturnValueOnce({ enabled: false, sessions: [] });
  await expect(executeManagedControl({ sessionId: 'sesn_a', action: 'terminate' }, c)).rejects.toThrow('changed');
  expect(c.read).toHaveBeenCalledTimes(1); expect(c.terminate).not.toHaveBeenCalled();
});
it('always reads provider state and leaves interruption distinct from termination', async () => {
  const c = controls();
  expect(await executeManagedControl({ sessionId: 'sesn_a', action: 'interrupt' }, c)).toMatchObject({ interruptRequested: true, cancellationConfirmed: false });
  expect(c.read).toHaveBeenCalledTimes(1); expect(c.interrupt).toHaveBeenCalledTimes(1);
  expect(await executeManagedControl({ sessionId: 'sesn_a', action: 'terminate' }, c)).toMatchObject({ cancellationConfirmed: true });
  expect(c.read).toHaveBeenCalledTimes(2); expect(c.terminate).toHaveBeenCalledTimes(1);
});
it('never confirms failed deletion or acts on an unknown provider state', async () => {
  const c = controls(); c.terminate.mockRejectedValueOnce(Error('provider failed'));
  await expect(executeManagedControl({ sessionId: 'sesn_a', action: 'terminate' }, c)).rejects.toThrow('provider failed');
  c.read.mockResolvedValueOnce({ status: 'unknown' });
  await expect(executeManagedControl({ sessionId: 'sesn_a', action: 'terminate' }, c)).rejects.toThrow('Unknown');
  expect(c.terminate).toHaveBeenCalledTimes(1);
});
it('inspects the requested worker page through the same checked dispatch', async () => {
  const c = controls(); await executeManagedControl({ sessionId: 'sesn_a', action: 'inspect', threadOffset: 60 }, c);
  expect(c.inspect).toHaveBeenCalledWith('sesn_a', 60); expect(c.interrupt).not.toHaveBeenCalled();
});

it('does not share an in-flight collection across credential scopes', async () => {
  const r = root(); let done!: () => void;
  const first = collectWithLease(r, 'sesn_a', () => new Promise<void>(resolve => { done = resolve; }), 'host-one');
  await Promise.resolve();
  await expect(collectWithLease(r, 'sesn_a', async () => ({}), 'host-two')).rejects.toThrow('credential scope');
  done(); await first;
});
