/**
 * #4557: coordination_sync trigger waited on a simulated 50ms "sync", bumped
 * syncCount/lastSync, zeroed pendingChanges and returned
 * { success: true, action: 'synchronized', nodesSync }. No state moved, and it
 * did this even with no nodes registered. It now refuses and leaves the stored
 * sync record untouched.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalProjectCwd = process.env.CLAUDE_FLOW_CWD;
let scratch: string;

async function sync(input: Record<string, unknown>) {
  const { coordinationTools } = await import('../src/mcp-tools/coordination-tools.js');
  return coordinationTools.find((t) => t.name === 'coordination_sync')!.handler(input) as Promise<Record<string, any>>;
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'ruflo-4557-'));
  process.env.CLAUDE_FLOW_CWD = scratch;
});
afterEach(() => {
  if (originalProjectCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
  else process.env.CLAUDE_FLOW_CWD = originalProjectCwd;
});

describe('coordination_sync trigger (#4557)', () => {
  it('refuses instead of reporting a simulated synchronization', async () => {
    const before = await sync({ action: 'status' });
    const r = await sync({ action: 'trigger', force: true });
    // Baseline: { success: true, action: 'synchronized', syncCount: 1, nodesSync: 0 }.
    expect(r.success).toBe(false);
    expect(r.action).toBe('trigger');
    expect(String(r.error)).toMatch(/no sync backend/);
    expect(r).not.toHaveProperty('nodesSync');
    // (An empty project's default record stamps lastSync with "now" on every load,
    // so compare the counters trigger used to change.)
    const after = await sync({ action: 'status' });
    expect(after.sync).toMatchObject({ syncCount: before.sync.syncCount, pendingChanges: before.sync.pendingChanges });
    expect(after.sync.syncCount).toBe(0);
  });

  it('leaves a persisted sync record and status byte-for-byte unchanged', async () => {
    const dir = join(scratch, '.claude-flow', 'coordination');
    mkdirSync(dir, { recursive: true });
    const storePath = join(dir, 'store.json');
    // Pin lastSync so status is stable across loads.
    const seeded = { nodes: {}, sync: { lastSync: '2026-01-01T00:00:00.000Z', syncCount: 3, conflicts: 0, pendingChanges: 2 } };
    writeFileSync(storePath, JSON.stringify(seeded));
    const fileBefore = readFileSync(storePath);
    const statusBefore = JSON.stringify((await sync({ action: 'status' })).sync);
    const r = await sync({ action: 'trigger' });
    expect(r).toMatchObject({ success: false, syncCount: 3, lastSync: '2026-01-01T00:00:00.000Z' });
    expect(readFileSync(storePath)).toEqual(fileBefore);
    expect(JSON.stringify((await sync({ action: 'status' })).sync)).toBe(statusBefore);
  });

  it('does not persist a sync', async () => {
    await sync({ action: 'trigger' });
    const storePath = join(scratch, '.claude-flow', 'coordination', 'store.json');
    // Baseline: store.json written with syncCount 1 and a fresh lastSync.
    if (existsSync(storePath)) expect(JSON.parse(readFileSync(storePath, 'utf8')).sync.syncCount).toBe(0);
  });

  it('leaves status and resolve as they were (control)', async () => {
    expect(await sync({ action: 'status' })).toMatchObject({ success: true, status: 'synced' });
    expect(await sync({ action: 'resolve' })).toMatchObject({ success: true, message: 'No conflicts to resolve' });
  });
});
