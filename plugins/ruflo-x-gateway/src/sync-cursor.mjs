// Opaque resume cursor for federation_sync (#5030).
//
// The relay (buzz-relay) answers NIP-01 REQs only: `since`/`until` are whole
// seconds on the publisher-chosen `created_at`, and `limit` returns the NEWEST
// matching events. It exposes no receive-order sequence, so a cursor cannot be
// "relay receive order". A bare time watermark loses events that share the
// boundary second and events that arrive late with a slightly older
// `created_at`, and re-reading the boundary returns duplicates.
//
// This cursor therefore carries:
//   lo  the oldest created_at the next read must cover (inclusive);
//   s   every event id already delivered with created_at >= lo, as 48-bit id
//       prefixes grouped by second;
//   k   the type filter the cursor was issued for.
// A read covers [lo, …] completely and delivers, oldest first by
// (created_at, id), every event whose id is not in `s`. `lo` trails the read
// time by OVERLAP_SECS, so an event that reaches the relay up to that long
// after its own created_at is still delivered, once. Older late arrivals are
// outside the window and are not delivered — that is the documented limit.
//
// All state lives in the cursor because the gateway is stateless and runs on
// several instances. The cursor arrives on an open read tool, so it is decoded
// as hostile input: bounded length, strict shape, clamped lookback.

export const CURSOR_VERSION = 1;
export const OVERLAP_SECS = 300;            // late-arrival tolerance
export const MAX_LOOKBACK_SECS = 30 * 86400; // same bound as sinceSeconds
export const MAX_SEEN = 2000;
export const MAX_CURSOR_CHARS = 48 * 1024;
const PREFIX = 12; // hex chars of the event id kept per delivered event
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const GROUP_RE = new RegExp(`^(?:[0-9a-f]{${PREFIX}})+$`);
const TYPE_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export class CursorError extends Error {}

const prefixOf = (id) => String(id).slice(0, PREFIX).toLowerCase();
export const compareEvents = (a, b) => (a.created_at - b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Encode cursor state as versioned base64url JSON. `seen` is a Map<prefix, created_at>. */
export function encodeCursor({ lo, seen, type }) {
  const s = {};
  for (const [p, t] of seen) (s[t] ||= []).push(p);
  for (const t of Object.keys(s)) s[t] = s[t].sort().join('');
  return Buffer.from(JSON.stringify({ v: CURSOR_VERSION, lo, k: type ?? null, s })).toString('base64url');
}

/** Decode and validate a cursor. Throws CursorError with a fixed message; never echoes input. */
export function decodeCursor(cursor, { now = Math.floor(Date.now() / 1000), type } = {}) {
  if (typeof cursor !== 'string' || !cursor || cursor.length > MAX_CURSOR_CHARS || !B64URL_RE.test(cursor)) throw new CursorError('invalid since_cursor');
  let o;
  try { o = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { throw new CursorError('invalid since_cursor'); }
  if (!o || typeof o !== 'object' || Array.isArray(o) || o.v !== CURSOR_VERSION) throw new CursorError('invalid since_cursor');
  if (!Number.isSafeInteger(o.lo) || o.lo < 0) throw new CursorError('invalid since_cursor');
  if (!(o.k === null || (typeof o.k === 'string' && TYPE_RE.test(o.k)))) throw new CursorError('invalid since_cursor');
  if ((o.k ?? undefined) !== (type ? String(type) : undefined)) throw new CursorError('since_cursor was issued for a different type filter');
  if (!o.s || typeof o.s !== 'object' || Array.isArray(o.s)) throw new CursorError('invalid since_cursor');
  // Clamp: never look back further than sinceSeconds may, never ahead of now.
  const lo = Math.min(Math.max(o.lo, now - MAX_LOOKBACK_SECS), now);
  const seen = new Map();
  for (const [k, v] of Object.entries(o.s)) {
    const t = Number(k);
    if (!/^\d{1,12}$/.test(k) || typeof v !== 'string' || !GROUP_RE.test(v)) throw new CursorError('invalid since_cursor');
    for (let i = 0; i < v.length; i += PREFIX) {
      if (seen.size >= MAX_SEEN) throw new CursorError('invalid since_cursor');
      if (t >= lo) seen.set(v.slice(i, i + PREFIX), t);
    }
  }
  return { lo, seen, type: o.k ?? undefined };
}

/** A fresh cursor state for a caller that has nothing yet, covering the last `sinceSeconds`. */
export function initialState({ now = Math.floor(Date.now() / 1000), sinceSeconds = 3600, type } = {}) {
  return { lo: now - sinceSeconds, seen: new Map(), type };
}

/**
 * One cursor step. `fetched` must be EVERY event with created_at in
 * [state.lo, coveredTo] (coveredTo = Infinity when the read reached the end).
 * Returns the events to deliver (oldest first) and the next cursor state.
 */
export function advance(state, fetched, { limit = 100, now = Math.floor(Date.now() / 1000), coveredTo = Infinity } = {}) {
  const byId = new Map();
  for (const e of fetched) {
    if (!e || typeof e.id !== 'string' || !Number.isSafeInteger(e.created_at)) continue;
    if (e.created_at < state.lo || e.created_at > coveredTo) continue;
    if (state.seen.has(prefixOf(e.id))) continue;
    byId.set(e.id, e);
  }
  const fresh = [...byId.values()].sort(compareEvents);
  const delivered = fresh.slice(0, limit);
  // Everything not yet delivered must stay >= the next lo: the first undelivered
  // fresh event, and anything past the covered range.
  let bound = Math.min(now, coveredTo === Infinity ? Infinity : coveredTo + 1);
  if (fresh.length > delivered.length) bound = Math.min(bound, fresh[delivered.length].created_at);
  let lo = Math.max(state.lo, Math.min(now - OVERLAP_SECS, bound));
  const seen = new Map([...state.seen].filter(([, t]) => t >= lo));
  for (const e of delivered) seen.set(prefixOf(e.id), e.created_at);
  let degraded = false;
  if (seen.size > MAX_SEEN) {
    // Shrink the late-arrival window rather than grow the cursor, but never past
    // `bound`, which would skip an undelivered event. If one second alone holds
    // more than MAX_SEEN deliveries, keep the newest and accept possible repeats.
    const times = [...seen.values()].sort((a, b) => b - a);
    lo = Math.max(lo, Math.min(times[MAX_SEEN] + 1, bound));
    for (const [p, t] of seen) if (t < lo) seen.delete(p);
    if (seen.size > MAX_SEEN) {
      degraded = true;
      const keep = [...seen].sort((a, b) => b[1] - a[1]).slice(0, MAX_SEEN);
      seen.clear(); for (const [p, t] of keep) seen.set(p, t);
    }
  }
  return { delivered, more: fresh.length > delivered.length || coveredTo !== Infinity, state: { lo, seen, type: state.type }, degraded };
}

/**
 * federation_sync with an optional cursor. `io` supplies the relay reads
 * ({ fetchRecent, fetchCovering }) so the logic is testable without a socket.
 *   - no since_cursor: the time-window read exactly as before (same filter, same
 *     order), plus a next_cursor that resumes after it;
 *   - since_cursor: every not-yet-delivered event from the cursor's window, oldest
 *     first by (created_at, id), at most `limit`; `more` says another call has more.
 */
export async function cursorSync(io, { sinceSeconds, limit = 100, type, since_cursor } = {}, { now = Math.floor(Date.now() / 1000) } = {}) {
  if (since_cursor === undefined) {
    const messages = await io.fetchRecent({ sinceSeconds, limit, type });
    // A timed-out read may be missing events, so it cannot anchor a cursor.
    if (messages.partial) return { messages };
    const start = initialState({ now, sinceSeconds: sinceSeconds ?? 3600, type });
    // A full page kept only the newest `limit`; the older rest of the window must
    // stay reachable, so the cursor keeps the whole window in that case.
    const lo = messages.length >= limit ? start.lo : Math.max(start.lo, now - OVERLAP_SECS);
    const seen = new Map();
    for (const e of messages) {
      if (typeof e?.id === 'string' && Number.isSafeInteger(e.created_at) && e.created_at >= lo) seen.set(prefixOf(e.id), e.created_at);
    }
    return { messages, next_cursor: encodeCursor({ lo, seen, type }) };
  }
  const state = decodeCursor(since_cursor, { now, type });
  const r = await io.fetchCovering({ lo: state.lo, type, now });
  // Incomplete read: deliver nothing and hand the same cursor back, so nothing is skipped.
  if (r.partial) {
    const messages = Object.defineProperty([], 'partial', { value: true });
    if (r.relayNotice) Object.defineProperty(messages, 'relayNotice', { value: r.relayNotice });
    return { messages, next_cursor: since_cursor, more: true };
  }
  if (r.saturated) throw new Error('too many events share one created_at second at the cursor position to page through');
  const step = advance(state, r.events, { limit, now, coveredTo: r.coveredTo });
  return { messages: step.delivered, next_cursor: encodeCursor(step.state), more: step.more, ...(step.degraded ? { degraded: true } : {}) };
}
