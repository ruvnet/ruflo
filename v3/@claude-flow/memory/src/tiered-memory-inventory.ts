/**
 * Persisted inventory and exact-ID reads for {@link TieredMemoryStore} (#4712).
 *
 * `recall()` scores the hydrated in-memory maps, which hold at most 5,000
 * active entries per tier plus a 5,000-entry archive and collapse same-key
 * rows. They cannot answer "what is stored?". These helpers read the durable
 * `tiered_memory` table instead, so every persisted row — including history
 * beyond the hydration caps — is reachable.
 *
 * Status of a row, by fixed precedence (one definition, used for both the
 * list filter and the label returned to callers):
 *   1. `superseded` — `superseded_by` is set (invalidated by a newer fact)
 *   2. `archived`   — `archived = 1` without a superseding id
 *   3. `expired`    — outside its validity window per {@link isTemporallyValid};
 *                     this includes not-yet-valid (future `validFrom`) rows,
 *                     matching `recall()`'s `includeExpired` semantics
 *   4. `active`     — everything else
 *
 * Each call captures one evaluation instant, so temporal classification is
 * consistent within a call. Reads are live, not a snapshot: rows written
 * between page requests may or may not appear.
 *
 * Ordering is `ts DESC, id DESC` (newest first, id breaks ties), paginated
 * by keyset, so it is stable across calls.
 *
 * @module @claude-flow/memory/tiered-memory-inventory
 */

import type { TieredMemoryDb, TieredMemoryEntry, TieredMemoryRow } from './tiered-memory.js';

/** Status of a persisted tiered-memory row. */
export type TieredEntryStatus = 'active' | 'expired' | 'superseded' | 'archived';

/** Status filter accepted by `listEntries`. */
export type TieredStatusFilter = TieredEntryStatus | 'all';

export const TIERED_STATUS_FILTERS: readonly TieredStatusFilter[] = [
  'active', 'expired', 'superseded', 'archived', 'all',
];

export const TIERED_LIST_DEFAULT_LIMIT = 100;
export const TIERED_LIST_MAX_LIMIT = 1000;
/** Upper bound on characters accepted for a cursor or an id. */
export const TIERED_CURSOR_MAX_LENGTH = 2048;
export const TIERED_ID_MAX_LENGTH = 1000;
/** Rows read from SQLite per batch while filtering. */
const SCAN_BATCH = 500;
/** Rows examined by one listEntries call before it returns a partial page. */
const MAX_SCAN_PER_CALL = 50_000;

/** Options accepted by `listEntries`. */
export interface TieredListOptions {
  /** Only rows in this tier (working, episodic, semantic). */
  tier?: string;
  /** Status filter (default `active`). */
  status?: TieredStatusFilter;
  /** Page size, clamped to 1..1000 (default 100). */
  limit?: number;
  /** Opaque cursor from a previous page's `nextCursor`. */
  cursor?: string;
}

/** Options accepted by `getEntry`. */
export interface TieredGetOptions {
  /** Return superseded / archived / expired rows too (default false). */
  includeInactive?: boolean;
}

/** A persisted entry with its derived status. */
export interface TieredInventoryEntry extends TieredMemoryEntry {
  status: TieredEntryStatus;
  /** Raw `archived` column — kept separate from temporal validity. */
  archived: boolean;
}

/** One page of `listEntries`. */
export interface TieredListResult {
  entries: TieredInventoryEntry[];
  /**
   * Cursor for the next page, or null when there is nothing after this page.
   * A short (even empty) page with a non-null cursor means the per-call scan
   * budget ran out before the page filled; keep paging.
   */
  nextCursor: string | null;
  /**
   * Exact row count for the tier/status filter when it is SQL-expressible
   * (`all`, `superseded`, `archived`). Omitted for `active` / `expired`,
   * which need a full JS temporal scan to count.
   */
  totalEstimate?: number;
  /** The single instant used to classify temporal validity for this call. */
  evaluatedAt: string;
}

export type TieredInventoryErrorCode = 'unsupported' | 'invalid-cursor' | 'invalid-argument';

/** Base error for inventory reads. */
export class TieredMemoryInventoryError extends Error {
  constructor(message: string, readonly code: TieredInventoryErrorCode) {
    super(message);
    this.name = 'TieredMemoryInventoryError';
  }
}

/** Thrown when the store has no SQLite handle, so the full inventory cannot be read. */
export class TieredMemoryUnsupportedError extends TieredMemoryInventoryError {
  constructor(operation: string) {
    super(
      `unsupported: volatile store — ${operation} reads the persisted tiered_memory table, ` +
        'and this TieredMemoryStore has no SQLite handle. Refusing rather than returning a partial in-memory view.',
      'unsupported',
    );
    this.name = 'TieredMemoryUnsupportedError';
  }
}

/** Thrown for a cursor that is malformed, altered, or issued for a different filter. */
export class TieredMemoryCursorError extends TieredMemoryInventoryError {
  constructor(reason: string) {
    super(`invalid cursor: ${reason}. Restart pagination without a cursor.`, 'invalid-cursor');
    this.name = 'TieredMemoryCursorError';
  }
}

/** Collaborators supplied by the store, so this module holds no runtime import of it. */
export interface TieredInventoryDeps {
  decode(row: TieredMemoryRow): TieredMemoryEntry;
  isValid(entry: Pick<TieredMemoryEntry, 'validFrom' | 'validUntil'>, nowMs: number): boolean;
  validTiers: readonly string[];
}

/** Status of a row at `nowMs`, by the precedence documented on this module. */
export function deriveTieredStatus(
  row: TieredMemoryRow,
  entry: TieredMemoryEntry,
  nowMs: number,
  isValid: TieredInventoryDeps['isValid'],
): TieredEntryStatus {
  if (row.superseded_by) return 'superseded';
  if (Number(row.archived) !== 0) return 'archived';
  if (!isValid(entry, nowMs)) return 'expired';
  return 'active';
}

interface CursorPayload {
  v: 1;
  ts: number;
  id: string;
  tier: string | null;
  status: TieredStatusFilter;
}

function encodeCursor(p: CursorPayload): string {
  const canonical = JSON.stringify({ v: p.v, ts: p.ts, id: p.id, tier: p.tier, status: p.status });
  return Buffer.from(canonical, 'utf8').toString('base64url');
}

function decodeCursor(cursor: unknown, tier: string | null, status: TieredStatusFilter): CursorPayload {
  if (typeof cursor !== 'string' || cursor.length === 0) throw new TieredMemoryCursorError('must be a non-empty string');
  if (cursor.length > TIERED_CURSOR_MAX_LENGTH) throw new TieredMemoryCursorError('too long');
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new TieredMemoryCursorError('not base64url');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new TieredMemoryCursorError('not decodable');
  }
  const p = parsed as Partial<CursorPayload> | null;
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new TieredMemoryCursorError('not an object');
  if (p.v !== 1) throw new TieredMemoryCursorError('unknown version');
  if (typeof p.ts !== 'number' || !Number.isSafeInteger(p.ts)) throw new TieredMemoryCursorError('bad position');
  if (typeof p.id !== 'string' || p.id.length === 0 || p.id.length > TIERED_ID_MAX_LENGTH) {
    throw new TieredMemoryCursorError('bad position');
  }
  if (!(p.tier === null || typeof p.tier === 'string')) throw new TieredMemoryCursorError('bad filter');
  if (!TIERED_STATUS_FILTERS.includes(p.status as TieredStatusFilter)) throw new TieredMemoryCursorError('bad filter');
  const payload: CursorPayload = { v: 1, ts: p.ts, id: p.id, tier: p.tier, status: p.status as TieredStatusFilter };
  // Only cursors this module minted round-trip byte-for-byte.
  if (encodeCursor(payload) !== cursor) throw new TieredMemoryCursorError('not canonical (altered)');
  if (payload.tier !== tier || payload.status !== status) {
    throw new TieredMemoryCursorError('issued for a different tier/status filter');
  }
  return payload;
}

function invalid(message: string): TieredMemoryInventoryError {
  return new TieredMemoryInventoryError(message, 'invalid-argument');
}

function normalizeLimit(limit: unknown): number {
  if (limit === undefined || limit === null) return TIERED_LIST_DEFAULT_LIMIT;
  if (typeof limit !== 'number' || !Number.isFinite(limit)) throw invalid('limit must be a finite number');
  return Math.min(TIERED_LIST_MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

/** SQL prefilter for a status. The JS status check below stays authoritative. */
function statusClause(status: TieredStatusFilter): string | null {
  switch (status) {
    case 'superseded': return "COALESCE(superseded_by, '') <> ''";
    case 'archived': return "COALESCE(superseded_by, '') = '' AND archived <> 0";
    case 'active':
    case 'expired': return "COALESCE(superseded_by, '') = '' AND archived = 0";
    default: return null;
  }
}

/**
 * One page of persisted entries, newest first. Reads only; never writes.
 * SQL errors propagate so a failed read is never mistaken for an empty one.
 */
export function listPersistedEntries(
  db: TieredMemoryDb,
  options: TieredListOptions | undefined,
  deps: TieredInventoryDeps,
): TieredListResult {
  const opts = options ?? {};
  if (opts.tier !== undefined && opts.tier !== null && !deps.validTiers.includes(opts.tier)) {
    throw invalid(`tier must be one of ${deps.validTiers.join(', ')}`);
  }
  const tier = opts.tier ?? null;
  const status = opts.status ?? 'active';
  if (!TIERED_STATUS_FILTERS.includes(status)) throw invalid(`status must be one of ${TIERED_STATUS_FILTERS.join(', ')}`);
  const limit = normalizeLimit(opts.limit);
  let position = opts.cursor !== undefined && opts.cursor !== null ? decodeCursor(opts.cursor, tier, status) : null;

  const nowMs = Date.now();
  const filters: string[] = [];
  const filterParams: unknown[] = [];
  if (tier) { filters.push('tier = ?'); filterParams.push(tier); }
  const sc = statusClause(status);
  if (sc) filters.push(sc);

  const page: Array<{ row: TieredMemoryRow; item: TieredInventoryEntry }> = [];
  let lastScanned: TieredMemoryRow | null = null;
  let scanned = 0;
  let exhausted = false;
  let overflow = false;

  while (!overflow && scanned < MAX_SCAN_PER_CALL) {
    const where = [...filters];
    const params = [...filterParams];
    if (position) {
      where.push('(ts < ? OR (ts = ? AND id < ?))');
      params.push(position.ts, position.ts, position.id);
    }
    const batch = Math.min(SCAN_BATCH, MAX_SCAN_PER_CALL - scanned);
    const sql = `SELECT * FROM tiered_memory${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ` +
      'ORDER BY ts DESC, id DESC LIMIT ?';
    const rows = db.prepare(sql).all(...params, batch) as TieredMemoryRow[];
    for (const row of rows) {
      scanned++;
      lastScanned = row;
      const entry = deps.decode(row);
      const rowStatus = deriveTieredStatus(row, entry, nowMs, deps.isValid);
      if (status !== 'all' && rowStatus !== status) continue;
      if (page.length === limit) { overflow = true; break; } // one more match exists
      page.push({ row, item: { ...entry, status: rowStatus, archived: Number(row.archived) !== 0 } });
    }
    if (overflow) break;
    if (rows.length < batch) { exhausted = true; break; }
    position = { v: 1, ts: Number(lastScanned!.ts), id: lastScanned!.id, tier, status };
  }

  let next: TieredMemoryRow | null = null;
  if (overflow) next = page[page.length - 1].row; // resume right after the last emitted row
  else if (!exhausted && lastScanned) next = lastScanned; // scan budget hit: skip what was examined

  const result: TieredListResult = {
    entries: page.map(p => p.item),
    nextCursor: next ? encodeCursor({ v: 1, ts: Number(next.ts), id: next.id, tier, status }) : null,
    evaluatedAt: new Date(nowMs).toISOString(),
  };
  if (status === 'all' || status === 'superseded' || status === 'archived') {
    const countSql = `SELECT COUNT(*) AS n FROM tiered_memory${filters.length ? ` WHERE ${filters.join(' AND ')}` : ''}`;
    const row = db.prepare(countSql).get(...filterParams) as { n?: number } | undefined;
    result.totalEstimate = Number(row?.n ?? 0);
  }
  return result;
}

/** Exact read by stable id. Null when missing, or inactive without `includeInactive`. */
export function getPersistedEntry(
  db: TieredMemoryDb,
  id: unknown,
  options: TieredGetOptions | undefined,
  deps: TieredInventoryDeps,
): TieredInventoryEntry | null {
  if (typeof id !== 'string' || id.length === 0 || id.length > TIERED_ID_MAX_LENGTH) {
    throw invalid(`id must be a non-empty string of at most ${TIERED_ID_MAX_LENGTH} characters`);
  }
  const row = db.prepare('SELECT * FROM tiered_memory WHERE id = ?').get(id) as TieredMemoryRow | undefined;
  if (!row) return null;
  const entry = deps.decode(row);
  const status = deriveTieredStatus(row, entry, Date.now(), deps.isValid);
  if (status !== 'active' && options?.includeInactive !== true) return null;
  return { ...entry, status, archived: Number(row.archived) !== 0 };
}
