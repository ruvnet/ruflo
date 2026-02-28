/**
 * Tests for RvfEventLog (ADR-057 Phase 2)
 *
 * Covers: initialize, append, getEvents, getAllEvents, snapshots,
 *         stats, persistence, close, and edge cases.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Use dynamic import — tsx handles TS source directly.
const { RvfEventLog } = await import(
  '../v3/@claude-flow/shared/src/events/rvf-event-log.ts'
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type DomainEvent = {
  id: string;
  type: string;
  aggregateId: string;
  aggregateType: string;
  version: number;
  timestamp: number;
  source: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  causationId?: string;
  correlationId?: string;
};

type EventSnapshot = {
  aggregateId: string;
  aggregateType: string;
  version: number;
  state: Record<string, unknown>;
  timestamp: number;
};

let tmpCounter = 0;

function makeTmpDir(): string {
  const dir = join(tmpdir(), `rvf-test-${Date.now()}-${++tmpCounter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeEvent(
  aggregateId: string,
  type: string,
  timestampOverride?: number,
): DomainEvent {
  return {
    id: crypto.randomUUID(),
    type,
    aggregateId,
    aggregateType: 'test' as any,
    timestamp: timestampOverride ?? Date.now(),
    version: 0,
    source: 'swarm',
    payload: {},
    metadata: { correlationId: crypto.randomUUID(), causationId: '' },
  };
}

function makeSnapshot(
  aggregateId: string,
  version: number,
  state: Record<string, unknown> = {},
): EventSnapshot {
  return {
    aggregateId,
    aggregateType: 'test' as any,
    version,
    state,
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let dir: string;
let logPath: string;

beforeEach(() => {
  dir = makeTmpDir();
  logPath = join(dir, 'events.rvf');
});

afterEach(() => {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ===========================================================================
// 1. Initialize
// ===========================================================================

describe('RvfEventLog#initialize', () => {
  it('creates event file with magic header', async () => {
    const log = new RvfEventLog({ logPath });
    await log.initialize();

    assert.ok(existsSync(logPath));
    const buf = readFileSync(logPath);
    assert.equal(buf.subarray(0, 4).toString(), 'RVFL');

    await log.close();
  });

  it('creates snapshot file alongside event file', async () => {
    const log = new RvfEventLog({ logPath });
    await log.initialize();

    const snapPath = logPath.replace(/\.rvf$/, '.snap.rvf');
    assert.ok(existsSync(snapPath));
    const buf = readFileSync(snapPath);
    assert.equal(buf.subarray(0, 4).toString(), 'RVFL');

    await log.close();
  });

  it('rebuilds indexes on re-open', async () => {
    const log1 = new RvfEventLog({ logPath });
    await log1.initialize();
    await log1.append(makeEvent('agg-1', 'created'));
    await log1.append(makeEvent('agg-1', 'updated'));
    await log1.close();

    const log2 = new RvfEventLog({ logPath });
    await log2.initialize();

    const events = await log2.getEvents('agg-1');
    assert.equal(events.length, 2);
    assert.equal(events[0].version, 1);
    assert.equal(events[1].version, 2);

    await log2.close();
  });

  it('emits initialized event', async () => {
    const log = new RvfEventLog({ logPath });
    let emitted = false;
    log.on('initialized', () => { emitted = true; });
    await log.initialize();

    assert.ok(emitted);
    await log.close();
  });

  it('is idempotent when called twice', async () => {
    const log = new RvfEventLog({ logPath });
    await log.initialize();
    await log.initialize();

    assert.ok(existsSync(logPath));
    await log.close();
  });
});

// ===========================================================================
// 2. Append
// ===========================================================================

describe('RvfEventLog#append', () => {
  it('assigns incrementing versions per aggregate', async () => {
    const log = new RvfEventLog({ logPath });
    await log.initialize();

    const e1 = makeEvent('agg-A', 'step');
    const e2 = makeEvent('agg-A', 'step');
    const e3 = makeEvent('agg-B', 'step');

    await log.append(e1);
    await log.append(e2);
    await log.append(e3);

    assert.equal(e1.version, 1);
    assert.equal(e2.version, 2);
    assert.equal(e3.version, 1); // separate aggregate

    await log.close();
  });

  it('persists to disk immediately', async () => {
    const log = new RvfEventLog({ logPath });
    await log.initialize();
    await log.append(makeEvent('agg-1', 'op'));

    // File should be larger than just the 4-byte magic header.
    const size = readFileSync(logPath).length;
    assert.ok(size > 4);

    await log.close();
  });

  it('emits event:appended', async () => {
    const log = new RvfEventLog({ logPath });
    await log.initialize();

    const captured: any[] = [];
    log.on('event:appended', (e: any) => captured.push(e));

    const ev = makeEvent('agg-1', 'op');
    await log.append(ev);

    assert.equal(captured.length, 1);
    assert.equal(captured[0].id, ev.id);

    await log.close();
  });

  it('throws when not initialized', async () => {
    const log = new RvfEventLog({ logPath });
    await assert.rejects(
      () => log.append(makeEvent('x', 'y')),
      /not initialized/i,
    );
  });
});

// ===========================================================================
// 3. GetEvents
// ===========================================================================

describe('RvfEventLog#getEvents', () => {
  it('filters by aggregateId', async () => {
    const log = new RvfEventLog({ logPath });
    await log.initialize();

    await log.append(makeEvent('agg-A', 'x'));
    await log.append(makeEvent('agg-B', 'x'));
    await log.append(makeEvent('agg-A', 'y'));

    const result = await log.getEvents('agg-A');
    assert.equal(result.length, 2);
    assert.ok(result.every((e: any) => e.aggregateId === 'agg-A'));

    await log.close();
  });

  it('filters by fromVersion', async () => {
    const log = new RvfEventLog({ logPath });
    await log.initialize();

    await log.append(makeEvent('agg-A', 'a'));
    await log.append(makeEvent('agg-A', 'b'));
    await log.append(makeEvent('agg-A', 'c'));

    const result = await log.getEvents('agg-A', 2);
    assert.equal(result.length, 2);
    assert.equal(result[0].version, 2);
    assert.equal(result[1].version, 3);

    await log.close();
  });

  it('returns empty array for unknown aggregate', async () => {
    const log = new RvfEventLog({ logPath });
    await log.initialize();
    await log.append(makeEvent('agg-A', 'x'));

    const result = await log.getEvents('nonexistent');
    assert.deepEqual(result, []);

    await log.close();
  });
});

// ===========================================================================
// 4. GetAllEvents
// ===========================================================================

describe('RvfEventLog#getAllEvents', () => {
  it('returns all events sorted by timestamp when no filter', async () => {
    const log = new RvfEventLog({ logPath });
    await log.initialize();

    const base = Date.now();
    await log.append(makeEvent('a', 'x', base + 20));
    await log.append(makeEvent('b', 'y', base + 10));
    await log.append(makeEvent('c', 'z', base + 30));

    const result = await log.getAllEvents();
    assert.equal(result.length, 3);
    assert.ok(result[0].timestamp <= result[1].timestamp);
    assert.ok(result[1].timestamp <= result[2].timestamp);

    await log.close();
  });

  it('filters by eventTypes', async () => {
    const log = new RvfEventLog({ logPath });
    await log.initialize();

    await log.append(makeEvent('a', 'created'));
    await log.append(makeEvent('a', 'updated'));
    await log.append(makeEvent('a', 'deleted'));

    const result = await log.getAllEvents({ eventTypes: ['created', 'deleted'] });
    assert.equal(result.length, 2);
    const types = result.map((e: any) => e.type).sort();
    assert.deepEqual(types, ['created', 'deleted']);

    await log.close();
  });

  it('filters by timestamps (after/before)', async () => {
    const log = new RvfEventLog({ logPath });
    await log.initialize();

    const base = 1000000;
    await log.append(makeEvent('a', 'x', base + 100));
    await log.append(makeEvent('a', 'y', base + 200));
    await log.append(makeEvent('a', 'z', base + 300));

    const result = await log.getAllEvents({
      afterTimestamp: base + 100,
      beforeTimestamp: base + 300,
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].timestamp, base + 200);

    await log.close();
  });

  it('supports pagination (offset + limit)', async () => {
    const log = new RvfEventLog({ logPath });
    await log.initialize();

    const base = Date.now();
    for (let i = 0; i < 10; i++) {
      await log.append(makeEvent('a', 'step', base + i));
    }

    const page = await log.getAllEvents({ offset: 3, limit: 4 });
    assert.equal(page.length, 4);

    await log.close();
  });
});

// ===========================================================================
// 5. Snapshots
// ===========================================================================

describe('RvfEventLog#snapshots', () => {
  it('saveSnapshot persists and getSnapshot retrieves', async () => {
    const log = new RvfEventLog({ logPath });
    await log.initialize();

    const snap = makeSnapshot('agg-1', 5, { counter: 42 });
    await log.saveSnapshot(snap);

    const retrieved = await log.getSnapshot('agg-1');
    assert.ok(retrieved);
    assert.equal(retrieved!.aggregateId, 'agg-1');
    assert.equal(retrieved!.version, 5);
    assert.deepEqual(retrieved!.state, { counter: 42 });

    await log.close();
  });

  it('returns null for missing snapshot', async () => {
    const log = new RvfEventLog({ logPath });
    await log.initialize();

    const result = await log.getSnapshot('nonexistent');
    assert.equal(result, null);

    await log.close();
  });

  it('multiple snapshots: latest wins', async () => {
    const log = new RvfEventLog({ logPath });
    await log.initialize();

    await log.saveSnapshot(makeSnapshot('agg-1', 3, { v: 'old' }));
    await log.saveSnapshot(makeSnapshot('agg-1', 7, { v: 'new' }));

    const snap = await log.getSnapshot('agg-1');
    assert.equal(snap!.version, 7);
    assert.deepEqual(snap!.state, { v: 'new' });

    await log.close();
  });

  it('snapshots survive close and re-initialize', async () => {
    const log1 = new RvfEventLog({ logPath });
    await log1.initialize();
    await log1.saveSnapshot(makeSnapshot('agg-1', 10, { val: 99 }));
    await log1.close();

    const log2 = new RvfEventLog({ logPath });
    await log2.initialize();
    const snap = await log2.getSnapshot('agg-1');
    assert.ok(snap);
    assert.equal(snap!.version, 10);
    assert.deepEqual(snap!.state, { val: 99 });

    await log2.close();
  });
});

// ===========================================================================
// 6. Stats
// ===========================================================================

describe('RvfEventLog#getStats', () => {
  it('returns correct statistics', async () => {
    const log = new RvfEventLog({ logPath });
    await log.initialize();

    const base = 1000000;
    await log.append(makeEvent('agg-1', 'created', base + 10));
    await log.append(makeEvent('agg-1', 'updated', base + 20));
    await log.append(makeEvent('agg-2', 'created', base + 30));
    await log.saveSnapshot(makeSnapshot('agg-1', 2));

    const stats = await log.getStats();
    assert.equal(stats.totalEvents, 3);
    assert.equal(stats.eventsByType['created'], 2);
    assert.equal(stats.eventsByType['updated'], 1);
    assert.equal(stats.eventsByAggregate['agg-1'], 2);
    assert.equal(stats.eventsByAggregate['agg-2'], 1);
    assert.equal(stats.oldestEvent, base + 10);
    assert.equal(stats.newestEvent, base + 30);
    assert.equal(stats.snapshotCount, 1);

    await log.close();
  });

  it('returns nulls for empty log', async () => {
    const log = new RvfEventLog({ logPath });
    await log.initialize();

    const stats = await log.getStats();
    assert.equal(stats.totalEvents, 0);
    assert.equal(stats.oldestEvent, null);
    assert.equal(stats.newestEvent, null);

    await log.close();
  });
});

// ===========================================================================
// 7. Persistence
// ===========================================================================

describe('RvfEventLog persistence', () => {
  it('data survives close and re-initialize cycle', async () => {
    const log1 = new RvfEventLog({ logPath });
    await log1.initialize();
    await log1.append(makeEvent('agg-1', 'created'));
    await log1.append(makeEvent('agg-1', 'updated'));
    await log1.append(makeEvent('agg-2', 'created'));
    await log1.close();

    const log2 = new RvfEventLog({ logPath });
    await log2.initialize();

    const all = await log2.getAllEvents();
    assert.equal(all.length, 3);

    // Versions should continue from where they left off.
    const e = makeEvent('agg-1', 'deleted');
    await log2.append(e);
    assert.equal(e.version, 3);

    await log2.close();
  });

  it('truncated records are handled gracefully', async () => {
    const log1 = new RvfEventLog({ logPath });
    await log1.initialize();
    await log1.append(makeEvent('agg-1', 'created'));
    await log1.close();

    // Simulate a truncated write: append a length prefix that claims
    // more bytes than actually exist.
    const lengthBuf = Buffer.allocUnsafe(4);
    lengthBuf.writeUInt32BE(99999, 0);
    appendFileSync(logPath, Buffer.concat([lengthBuf, Buffer.from('partial')]));

    // Re-open should recover the valid event and skip the truncated one.
    const log2 = new RvfEventLog({ logPath });
    await log2.initialize();

    const events = await log2.getEvents('agg-1');
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'created');

    await log2.close();
  });
});

// ===========================================================================
// 8. Close
// ===========================================================================

describe('RvfEventLog#close', () => {
  it('clears in-memory state', async () => {
    const log = new RvfEventLog({ logPath });
    await log.initialize();
    await log.append(makeEvent('agg-1', 'x'));
    await log.close();

    // After close, operations should fail because initialized is false.
    await assert.rejects(() => log.getEvents('agg-1'), /not initialized/i);
    await assert.rejects(() => log.getAllEvents(), /not initialized/i);
    await assert.rejects(() => log.getStats(), /not initialized/i);
  });

  it('prevents append after close', async () => {
    const log = new RvfEventLog({ logPath });
    await log.initialize();
    await log.close();

    await assert.rejects(
      () => log.append(makeEvent('x', 'y')),
      /not initialized/i,
    );
  });

  it('emits shutdown event', async () => {
    const log = new RvfEventLog({ logPath });
    await log.initialize();

    let emitted = false;
    log.on('shutdown', () => { emitted = true; });
    await log.close();

    assert.ok(emitted);
  });

  it('is idempotent', async () => {
    const log = new RvfEventLog({ logPath });
    await log.initialize();
    await log.close();
    await log.close(); // should not throw
  });
});

// ===========================================================================
// 9. Edge Cases
// ===========================================================================

describe('RvfEventLog edge cases', () => {
  it('empty log returns empty arrays', async () => {
    const log = new RvfEventLog({ logPath });
    await log.initialize();

    assert.deepEqual(await log.getEvents('anything'), []);
    assert.deepEqual(await log.getAllEvents(), []);

    await log.close();
  });

  it('corrupt JSON records are skipped', async () => {
    // Create a valid file with magic header, then inject bad JSON.
    writeFileSync(logPath, Buffer.from('RVFL'));
    const badPayload = Buffer.from('{{{invalid json');
    const lenBuf = Buffer.allocUnsafe(4);
    lenBuf.writeUInt32BE(badPayload.length, 0);
    appendFileSync(logPath, Buffer.concat([lenBuf, badPayload]));

    // Now append a valid record manually.
    const validEvent = makeEvent('agg-1', 'ok');
    validEvent.version = 1;
    const validJson = Buffer.from(JSON.stringify(validEvent), 'utf8');
    const validLen = Buffer.allocUnsafe(4);
    validLen.writeUInt32BE(validJson.length, 0);
    appendFileSync(logPath, Buffer.concat([validLen, validJson]));

    // Also create the snapshot file so initialize does not fail.
    const snapPath = logPath.replace(/\.rvf$/, '.snap.rvf');
    writeFileSync(snapPath, Buffer.from('RVFL'));

    const log = new RvfEventLog({ logPath });
    await log.initialize();

    const events = await log.getEvents('agg-1');
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'ok');

    await log.close();
  });

  it('handles large number of events', async () => {
    const log = new RvfEventLog({ logPath });
    await log.initialize();

    const count = 500;
    for (let i = 0; i < count; i++) {
      await log.append(makeEvent('bulk', 'tick', Date.now() + i));
    }

    const all = await log.getAllEvents();
    assert.equal(all.length, count);

    const stats = await log.getStats();
    assert.equal(stats.totalEvents, count);

    await log.close();
  });

  it('invalid file header throws', async () => {
    writeFileSync(logPath, Buffer.from('BAAD'));
    const snapPath = logPath.replace(/\.rvf$/, '.snap.rvf');
    writeFileSync(snapPath, Buffer.from('RVFL'));

    const log = new RvfEventLog({ logPath });
    await assert.rejects(() => log.initialize(), /Invalid file header/);
  });

  it('snapshot:recommended emitted at threshold', async () => {
    const log = new RvfEventLog({ logPath, snapshotThreshold: 3 });
    await log.initialize();

    const recommended: any[] = [];
    log.on('snapshot:recommended', (info: any) => recommended.push(info));

    for (let i = 0; i < 6; i++) {
      await log.append(makeEvent('agg-1', 'tick'));
    }

    // Versions 3 and 6 should trigger the recommendation.
    assert.equal(recommended.length, 2);
    assert.equal(recommended[0].version, 3);
    assert.equal(recommended[1].version, 6);

    await log.close();
  });
});
