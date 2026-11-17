/**
 * TieredMemoryStore persisted inventory + exact-ID reads (#4712).
 *
 * The hydrated maps cap each tier and the archive at 5,000 rows and collapse
 * same-key rows, so `listEntries` / `getEntry` must read the `tiered_memory`
 * table itself. Rows are seeded with raw SQL so populations beyond the
 * hydration caps exist on disk (going through `store()` would evict them).
 */

import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TieredMemoryStore, type TieredMemoryDb } from './tiered-memory.js';
import {
  TieredMemoryCursorError,
  TieredMemoryInventoryError,
  TieredMemoryUnsupportedError,
  type TieredInventoryEntry,
  type TieredListOptions,
} from './tiered-memory-inventory.js';

const PAST = '2000-01-01T00:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';

interface SeedRow {
  id: string; key?: string; value?: string; tier?: string; ts: number;
  valid_from?: string | null; valid_until?: string | null; superseded_by?: string | null; archived?: number;
}

const dbs: Database.Database[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) { try { db.close(); } catch { /* closed */ } }
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function openDb(file = ':memory:'): Database.Database {
  const db = new Database(file);
  dbs.push(db);
  return db;
}

function seed(db: Database.Database, rows: SeedRow[]): void {
  const insert = db.prepare(
    `INSERT INTO tiered_memory (id, key, value, tier, ts, valid_from, valid_until, superseded_by, archived)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const r of rows) {
      insert.run(r.id, r.key ?? r.id, r.value ?? `value-${r.id}`, r.tier ?? 'working', r.ts,
        r.valid_from ?? null, r.valid_until ?? null, r.superseded_by ?? null, r.archived ?? 0);
    }
  })();
}

/** A durable store whose table already holds `rows`, opened fresh (as after a restart). */
function storeWith(rows: SeedRow[]): { store: TieredMemoryStore; db: Database.Database } {
  const db = openDb();
  new TieredMemoryStore({ db }); // creates the schema
  seed(db, rows);
  return { store: new TieredMemoryStore({ db }), db };
}

function pageAll(store: TieredMemoryStore, opts: TieredListOptions): { entries: TieredInventoryEntry[]; pages: number } {
  const entries: TieredInventoryEntry[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = store.listEntries({ ...opts, cursor });
    entries.push(...page.entries);
    cursor = page.nextCursor ?? undefined;
    if (++pages > 10_000) throw new Error('pagination did not terminate');
  } while (cursor);
  return { entries, pages };
}

/** One row of every status, plus an odd archived row without a superseding id. */
function mixedRows(): SeedRow[] {
  return [
    { id: 'a-active', ts: 10 },
    { id: 'b-active-window', ts: 9, valid_from: PAST, valid_until: FUTURE },
    { id: 'c-expired', ts: 8, valid_until: PAST },
    { id: 'd-future', ts: 7, valid_from: FUTURE },
    { id: 'e-superseded', ts: 6, valid_until: PAST, superseded_by: 'a-active', archived: 1 },
    { id: 'f-archived-odd', ts: 5, archived: 1 },
    { id: 'g-unparseable', ts: 4, valid_until: 'not-a-date' },
  ];
}

describe('TieredMemoryStore.listEntries — beyond the hydration caps', () => {
  it('pages through every persisted row when the table holds more than 5,000 per tier', () => {
    const N = 6200;
    const rows: SeedRow[] = [];
    for (let i = 0; i < N; i++) {
      // Duplicate keys (collapse in the maps) and shared timestamps (exercise the id tiebreak).
      rows.push({ id: `tm_${String(i).padStart(5, '0')}`, key: `k${i % 50}`, ts: 1_000 + Math.floor(i / 7) });
    }
    const { store } = storeWith(rows);

    // The hydrated view really is capped — the bug this API exists for.
    expect(store.getTierStats().working).toBeLessThanOrEqual(50);
    expect(store.countPersisted()).toBe(N);

    const { entries, pages } = pageAll(store, { tier: 'working', limit: 1000 });
    expect(entries).toHaveLength(N);
    expect(pages).toBe(7);
    expect(new Set(entries.map(e => e.id)).size).toBe(N);

    // ts DESC, id DESC throughout.
    for (let i = 1; i < entries.length; i++) {
      const [a, b] = [entries[i - 1], entries[i]];
      expect(a.ts > b.ts || (a.ts === b.ts && a.id > b.id)).toBe(true);
    }
  });

  it('preserves the stored id, key, value, tier and timestamps', () => {
    const { store } = storeWith([
      { id: 'x1', key: 'shared-key', value: 'first', tier: 'semantic', ts: 2, valid_from: PAST },
      { id: 'x2', key: 'shared-key', value: 'second', tier: 'semantic', ts: 3 },
    ]);
    const { entries } = store.listEntries({ tier: 'semantic' });
    expect(entries).toEqual([
      { id: 'x2', key: 'shared-key', value: 'second', tier: 'semantic', ts: 3, status: 'active', archived: false },
      { id: 'x1', key: 'shared-key', value: 'first', tier: 'semantic', ts: 2, validFrom: PAST, status: 'active', archived: false },
    ]);
  });

  it('survives a restart: a new store on the same file lists what an old one wrote', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiered-inventory-'));
    dirs.push(dir);
    const file = path.join(dir, 'memory.db');
    const writer = new TieredMemoryStore({ db: openDb(file) });
    const stored = writer.store('restart-key', 'restart-value', 'episodic');

    const reader = new TieredMemoryStore({ db: openDb(file) });
    const { entries } = reader.listEntries({ tier: 'episodic' });
    expect(entries.map(e => e.id)).toEqual([stored.id]);
    expect(reader.getEntry(stored.id)?.value).toBe('restart-value');
  });
});

describe('TieredMemoryStore.listEntries — ordering and cursors', () => {
  const rows: SeedRow[] = Array.from({ length: 25 }, (_, i) => ({ id: `id-${String(i).padStart(2, '0')}`, ts: i % 3 }));

  it('returns the same order on every call and pages without gaps or repeats', () => {
    const { store } = storeWith(rows);
    const once = pageAll(store, { limit: 4 }).entries.map(e => e.id);
    const twice = pageAll(store, { limit: 4 }).entries.map(e => e.id);
    const single = store.listEntries({ limit: 1000 }).entries.map(e => e.id);
    expect(once).toEqual(twice);
    expect(once).toEqual(single);
    expect(once).toHaveLength(25);
    expect(once[0]).toBe('id-23'); // ts 2, highest id
  });

  it('returns a null cursor on the last page, and an empty page past the end is not reachable', () => {
    const { store } = storeWith(rows);
    const page = store.listEntries({ limit: 25 });
    expect(page.entries).toHaveLength(25);
    expect(page.nextCursor).toBeNull();
    const exact = store.listEntries({ limit: 5 });
    expect(exact.nextCursor).not.toBeNull();
  });

  it('clamps limit to 1..1000', () => {
    const { store } = storeWith(rows);
    expect(store.listEntries({ limit: 0 }).entries).toHaveLength(1);
    expect(store.listEntries({ limit: -50 }).entries).toHaveLength(1);
    expect(store.listEntries({ limit: 2.9 }).entries).toHaveLength(2);
    expect(store.listEntries({ limit: 1e9 }).entries).toHaveLength(25);
    expect(store.listEntries().entries).toHaveLength(25); // default 100
  });

  it('rejects a tampered, malformed or foreign cursor with a typed error', () => {
    const { store } = storeWith(rows);
    const cursor = store.listEntries({ limit: 3 }).nextCursor!;
    const json = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));

    const forged = Buffer.from(JSON.stringify({ ...json, ts: 'x' })).toString('base64url');
    const reordered = Buffer.from(JSON.stringify({ id: json.id, v: 1, ts: json.ts, tier: null, status: 'active' })).toString('base64url');
    for (const bad of [forged, reordered, 'not*base64', cursor + 'AA', 'e30', Buffer.from('[]').toString('base64url'), 'A'.repeat(5000)]) {
      expect(() => store.listEntries({ cursor: bad }), bad.slice(0, 20)).toThrow(TieredMemoryCursorError);
    }
    // Issued for status=active, replayed against a different filter.
    expect(() => store.listEntries({ cursor, status: 'all' })).toThrow(/different tier\/status/);
    expect(() => store.listEntries({ cursor, tier: 'semantic' })).toThrow(TieredMemoryCursorError);
    try {
      store.listEntries({ cursor: forged });
    } catch (e) {
      expect((e as TieredMemoryInventoryError).code).toBe('invalid-cursor');
    }
  });

  it('rejects an unknown tier, status or non-numeric limit', () => {
    const { store } = storeWith(rows);
    expect(() => store.listEntries({ tier: 'nonsense' })).toThrow(TieredMemoryInventoryError);
    expect(() => store.listEntries({ status: 'deleted' as never })).toThrow(/status must be one of/);
    expect(() => store.listEntries({ limit: '10' as never })).toThrow(/limit/);
  });
});

describe('TieredMemoryStore.listEntries — status filters', () => {
  const ids = (es: TieredInventoryEntry[]) => es.map(e => e.id);

  it('active: valid and window-open rows, plus unparseable timestamps (treated as absent)', () => {
    const { store } = storeWith(mixedRows());
    const page = store.listEntries({ status: 'active' });
    expect(ids(page.entries)).toEqual(['a-active', 'b-active-window', 'g-unparseable']);
    expect(page.totalEstimate).toBeUndefined();
  });

  it('expired: closed windows AND not-yet-valid rows, never superseded or archived ones', () => {
    const { store } = storeWith(mixedRows());
    expect(ids(store.listEntries({ status: 'expired' }).entries)).toEqual(['c-expired', 'd-future']);
  });

  it('superseded: rows with a superseding id, with an exact count', () => {
    const { store } = storeWith(mixedRows());
    const page = store.listEntries({ status: 'superseded' });
    expect(page.entries).toEqual([
      expect.objectContaining({ id: 'e-superseded', supersededBy: 'a-active', status: 'superseded', archived: true }),
    ]);
    expect(page.totalEstimate).toBe(1);
  });

  it('archived: archived rows that no newer fact superseded', () => {
    const { store } = storeWith(mixedRows());
    const page = store.listEntries({ status: 'archived' });
    expect(ids(page.entries)).toEqual(['f-archived-odd']);
    expect(page.entries[0].status).toBe('archived');
    expect(page.totalEstimate).toBe(1);
  });

  it('all: every row, labelled with its derived status, with an exact count', () => {
    const { store } = storeWith(mixedRows());
    const page = store.listEntries({ status: 'all' });
    expect(page.entries.map(e => [e.id, e.status])).toEqual([
      ['a-active', 'active'], ['b-active-window', 'active'], ['c-expired', 'expired'], ['d-future', 'expired'],
      ['e-superseded', 'superseded'], ['f-archived-odd', 'archived'], ['g-unparseable', 'active'],
    ]);
    expect(page.totalEstimate).toBe(7);
    expect(Number.isNaN(Date.parse(page.evaluatedAt))).toBe(false);
  });

  it('labels a real supersede made through store() as superseded', () => {
    const db = openDb();
    const store = new TieredMemoryStore({ db });
    const old = store.store('fact', 'v1', 'semantic');
    const fresh = store.store('fact', 'v2', 'semantic', { supersedes: old.id });
    expect(store.getEntry(old.id, { includeInactive: true })).toMatchObject({ status: 'superseded', supersededBy: fresh.id });
    expect(ids(store.listEntries({ tier: 'semantic' }).entries)).toEqual([fresh.id]);
  });

  it('filters by tier together with status', () => {
    const { store } = storeWith([
      { id: 's1', tier: 'semantic', ts: 1 },
      { id: 's2', tier: 'semantic', ts: 2, valid_until: PAST },
      { id: 'w1', tier: 'working', ts: 3 },
    ]);
    expect(ids(store.listEntries({ tier: 'semantic', status: 'all' }).entries)).toEqual(['s2', 's1']);
    expect(store.listEntries({ tier: 'semantic', status: 'all' }).totalEstimate).toBe(2);
    expect(ids(store.listEntries({ tier: 'semantic' }).entries)).toEqual(['s1']);
  });

  it('keeps paging through a sparse status filter that spans many scan batches', () => {
    const rows: SeedRow[] = [];
    for (let i = 0; i < 3000; i++) rows.push({ id: `r${String(i).padStart(4, '0')}`, ts: i, valid_until: i % 500 === 0 ? undefined : PAST });
    const { store } = storeWith(rows);
    const { entries } = pageAll(store, { status: 'active', limit: 2 });
    expect(ids(entries)).toEqual(['r2500', 'r2000', 'r1500', 'r1000', 'r0500', 'r0000']);
  });
});

describe('TieredMemoryStore.getEntry', () => {
  it('returns an active entry with its status', () => {
    const { store } = storeWith(mixedRows());
    expect(store.getEntry('a-active')).toEqual({
      id: 'a-active', key: 'a-active', value: 'value-a-active', tier: 'working', ts: 10, status: 'active', archived: false,
    });
  });

  it('hides inactive entries unless includeInactive is set', () => {
    const { store } = storeWith(mixedRows());
    for (const [id, status] of [['c-expired', 'expired'], ['d-future', 'expired'], ['e-superseded', 'superseded'], ['f-archived-odd', 'archived']]) {
      expect(store.getEntry(id)).toBeNull();
      expect(store.getEntry(id, { includeInactive: true })?.status).toBe(status);
    }
  });

  it('returns null for a missing id, and throws for a malformed one', () => {
    const { store } = storeWith(mixedRows());
    expect(store.getEntry('does-not-exist')).toBeNull();
    expect(store.getEntry('does-not-exist', { includeInactive: true })).toBeNull();
    expect(() => store.getEntry('')).toThrow(TieredMemoryInventoryError);
    expect(() => store.getEntry('x'.repeat(1001))).toThrow(/at most 1000/);
    expect(() => store.getEntry(42 as never)).toThrow(TieredMemoryInventoryError);
  });

  it('matches only the stable id, not the key', () => {
    const { store } = storeWith([{ id: 'tm_1', key: 'human-key', ts: 1 }]);
    expect(store.getEntry('human-key')).toBeNull();
    expect(store.getEntry('tm_1')?.key).toBe('human-key');
  });
});

describe('TieredMemoryStore inventory — refusal and read-only contract', () => {
  it('a volatile store refuses with a typed unsupported error instead of partial data', () => {
    const store = new TieredMemoryStore();
    store.store('k', 'v');
    expect(() => store.listEntries()).toThrow(TieredMemoryUnsupportedError);
    expect(() => store.getEntry('anything')).toThrow(/^unsupported: volatile store/);
    try {
      store.listEntries();
    } catch (e) {
      expect((e as TieredMemoryInventoryError).code).toBe('unsupported');
    }
  });

  /** Wraps a real handle and records every statement prepared through it. */
  function recordingDb(inner: Database.Database, failOn?: RegExp): { db: TieredMemoryDb; sql: string[] } {
    const sql: string[] = [];
    const db: TieredMemoryDb = {
      exec: (s: string) => { sql.push(s); return inner.exec(s); },
      prepare: (s: string) => {
        sql.push(s);
        if (failOn?.test(s)) throw new Error('disk I/O error');
        return inner.prepare(s);
      },
    };
    return { db, sql };
  }

  it('never writes during a read', () => {
    const inner = openDb();
    new TieredMemoryStore({ db: inner });
    seed(inner, mixedRows());
    const { db, sql } = recordingDb(inner);
    const store = new TieredMemoryStore({ db });
    sql.length = 0;

    store.listEntries({ status: 'all' });
    store.listEntries({ status: 'expired', limit: 1 });
    store.getEntry('a-active');
    store.getEntry('e-superseded', { includeInactive: true });

    expect(sql.length).toBeGreaterThan(0);
    for (const s of sql) expect(s).toMatch(/^\s*SELECT /i);
  });

  it('propagates a read failure instead of returning an empty page', () => {
    const inner = openDb();
    new TieredMemoryStore({ db: inner });
    seed(inner, mixedRows());
    const { db } = recordingDb(inner, /ORDER BY ts DESC|WHERE id = \?/);
    const store = new TieredMemoryStore({ db });
    expect(() => store.listEntries()).toThrow('disk I/O error');
    expect(() => store.getEntry('a-active')).toThrow('disk I/O error');
  });

  it('leaves recall() behaviour unchanged', () => {
    const { store } = storeWith(mixedRows());
    expect(store.recall('value', 10).map(e => e.id).sort()).toEqual(['a-active', 'b-active-window', 'g-unparseable']);
  });
});
