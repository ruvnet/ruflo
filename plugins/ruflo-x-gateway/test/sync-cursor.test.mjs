// federation_sync cursor (#5030). The relay has no receive-order sequence, so the
// cursor is (window floor + delivered ids). These tests drive it against a fake
// relay that honours NIP-01 since/until/limit the way buzz-relay does — `limit`
// keeps the NEWEST matches, and is applied in SQL BEFORE #t/#k are matched — because
// a relay that ignored either would let a cursor that skips events pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { generateSecretKey, finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import { createGateway } from '../src/server.mjs';
import { fetchCovering } from '../src/nostr-federation.mjs';
import { encodeCursor, decodeCursor, advance, cursorSync, OVERLAP_SECS, MAX_CURSOR_CHARS, CursorError } from '../src/sync-cursor.mjs';

const author = generateSecretKey();
const nowS = () => Math.floor(Date.now() / 1000);
let seq = 0;
const ev = (created_at, type = 'Status') =>
  finalizeEvent({ kind: 1, created_at, tags: [['t', 'ruflo-swarm'], ['k', type]], content: JSON.stringify({ type, n: seq++ }) }, author);
// Other kind-1 traffic on the same relay: no swarm tag.
const noise = (created_at) => finalizeEvent({ kind: 1, created_at, tags: [], content: 'hello ' + seq++ }, author);

/** NIP-42 relay stand-in over a mutable store. Like buzz-relay, kinds/since/until and
 *  limit select rows first (newest first), and #t/#k are matched on what is left. */
async function storeRelay() {
  const store = [];
  const wss = new WebSocketServer({ port: 0 });
  const stats = { reqs: 0 };
  wss.on('connection', (sock) => {
    sock.send(JSON.stringify(['AUTH', 'c' + Math.random()]));
    sock.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m[0] === 'AUTH') return sock.send(JSON.stringify(['OK', m[1].id, verifyEvent(m[1]), '']));
      if (m[0] !== 'REQ') return;
      stats.reqs++;
      const f = m[2];
      const rows = store.filter((e) => (!f.kinds || f.kinds.includes(e.kind))
        && (f.since === undefined || e.created_at >= f.since)
        && (f.until === undefined || e.created_at <= f.until));
      // buzz-relay order: newest first, then id; `limit` keeps the head.
      rows.sort((a, b) => (b.created_at - a.created_at) || (a.id < b.id ? -1 : 1));
      const hit = rows.slice(0, f.limit ?? 500).filter((e) =>
        (!f['#t'] || e.tags.some((t) => t[0] === 't' && f['#t'].includes(t[1])))
        && (!f['#k'] || e.tags.some((t) => t[0] === 'k' && f['#k'].includes(t[1]))));
      for (const e of hit) sock.send(JSON.stringify(['EVENT', m[1], e]));
      sock.send(JSON.stringify(['EOSE', m[1]]));
    });
  });
  await new Promise((r) => wss.once('listening', r));
  return { url: `ws://127.0.0.1:${wss.address().port}`, store, stats,
    close: () => { for (const c of wss.clients) c.terminate(); wss.close(); } };
}

async function gatewayOn(relayUrl) {
  const gw = createGateway({ relay: relayUrl, keyFile: `/tmp/x-gw-sc-${Date.now()}-${Math.random().toString(36).slice(2)}.key`, port: 0 });
  const port = await gw.listen(0);
  const call = async (args) => {
    const raw = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'federation_sync', arguments: args } }) }).then((r) => r.text());
    const { result } = JSON.parse(raw.slice(raw.indexOf('{')));
    const text = result.content[0].text;
    if (result.isError) return { error: text };
    const body = text.slice(text.indexOf('\n{') + 1, text.lastIndexOf('\n<<<END_'));
    return JSON.parse(body).data;
  };
  return { call, close: () => gw.server.close() };
}

const ids = (msgs) => msgs.map((m) => m.id);
const assertAscending = (msgs) => {
  for (let i = 1; i < msgs.length; i++) {
    const [a, b] = [msgs[i - 1], msgs[i]];
    assert.ok(a.created_at < b.created_at || (a.created_at === b.created_at && a.id < b.id), 'cursor output is ordered by (created_at, id)');
  }
};

// ---- acceptance: identical created_at across calls ----

test('cursor: events sharing one created_at second, interleaved with calls, each arrive exactly once', async () => {
  const relay = await storeRelay(); const gw = await gatewayOn(relay.url);
  try {
    const t0 = nowS() - 30;
    relay.store.push(ev(t0), ev(t0), ev(t0));
    const first = await gw.call({ sinceSeconds: 600 });
    assert.equal(first.count, 3);
    assert.ok(first.next_cursor, 'the no-cursor read hands back a cursor');
    const seen = [...ids(first.messages)];
    // Same second as the watermark: a time-only `since` would skip or repeat these.
    relay.store.push(ev(t0), ev(t0), ev(t0 + 1));
    const second = await gw.call({ since_cursor: first.next_cursor });
    assert.equal(second.count, 3, 'only the three new events');
    assertAscending(second.messages);
    seen.push(...ids(second.messages));
    relay.store.push(ev(t0 + 1), ev(t0));
    const third = await gw.call({ since_cursor: second.next_cursor });
    assert.equal(third.count, 2);
    seen.push(...ids(third.messages));
    const fourth = await gw.call({ since_cursor: third.next_cursor });
    assert.equal(fourth.count, 0, 'a repeat with nothing new returns nothing');
    assert.equal(fourth.more, false);
    assert.equal(new Set(seen).size, seen.length, 'no event delivered twice');
    assert.deepEqual(new Set(seen), new Set(ids(relay.store)), 'every event delivered');
  } finally { gw.close(); relay.close(); }
});

test('cursor: a late event with an older created_at inside the overlap window is delivered once', async () => {
  const relay = await storeRelay(); const gw = await gatewayOn(relay.url);
  try {
    relay.store.push(ev(nowS() - 5));
    const a = await gw.call({});
    const late = ev(nowS() - Math.floor(OVERLAP_SECS / 2)); // older than what was delivered
    relay.store.push(late);
    const b = await gw.call({ since_cursor: a.next_cursor });
    assert.deepEqual(ids(b.messages), [late.id]);
    const c = await gw.call({ since_cursor: b.next_cursor });
    assert.equal(c.count, 0);
    // Outside the window is the documented limit, not a silent duplicate.
    relay.store.push(ev(nowS() - OVERLAP_SECS - 120));
    const d = await gw.call({ since_cursor: c.next_cursor });
    assert.equal(d.count, 0);
  } finally { gw.close(); relay.close(); }
});

test('cursor: a backlog bigger than the relay page and the call limit drains gap-free, oldest first', async () => {
  const relay = await storeRelay(); const gw = await gatewayOn(relay.url);
  try {
    const base = nowS() - 3000;
    // 1200 events over 40 seconds: 30 per second, so every page boundary splits a second.
    for (let i = 0; i < 1200; i++) relay.store.push(ev(base + (i % 40) * 60));
    // Non-swarm notes interleaved, more of them than a page: they fill the relay's
    // LIMIT before its #t match, so a short filtered page is not a complete one.
    for (let i = 0; i < 1500; i++) relay.store.push(noise(base + (i % 50) * 60 + 1));
    const first = await gw.call({ sinceSeconds: 3600, limit: 100 }); // newest 100 only
    const seen = [...ids(first.messages)];
    let cursor = first.next_cursor, more = true, calls = 0;
    while (more && calls++ < 120) {
      // 45 is not a multiple of 30, so the call limit also splits seconds.
      const r = await gw.call({ since_cursor: cursor, limit: 45 });
      assertAscending(r.messages);
      seen.push(...ids(r.messages)); cursor = r.next_cursor; more = r.more;
    }
    assert.equal(more, false, 'the backlog drains');
    assert.equal(seen.length, 1200, 'each event exactly once');
    assert.deepEqual(new Set(seen), new Set(ids(relay.store.filter((e) => e.tags.length))));
  } finally { gw.close(); relay.close(); }
});

test('cursor: the type filter is bound into the cursor', async () => {
  const relay = await storeRelay(); const gw = await gatewayOn(relay.url);
  try {
    relay.store.push(ev(nowS() - 3, 'Task'), ev(nowS() - 3, 'Status'));
    const a = await gw.call({ type: 'Task' });
    assert.equal(a.count, 1);
    relay.store.push(ev(nowS() - 2, 'Task'), ev(nowS() - 2, 'Status'));
    const b = await gw.call({ type: 'Task', since_cursor: a.next_cursor });
    assert.deepEqual(b.messages.map((m) => m.type), ['Task']);
    const wrong = await gw.call({ type: 'Status', since_cursor: a.next_cursor });
    assert.match(wrong.error, /different type filter/);
  } finally { gw.close(); relay.close(); }
});

test('cursor: any type string the tool accepts yields a cursor the tool accepts back', async () => {
  const relay = await storeRelay(); const gw = await gatewayOn(relay.url);
  try {
    for (const type of ['a.b', '', 'Task with spaces']) {
      const a = await gw.call(type === '' ? { type } : { type });
      assert.ok(a.next_cursor, JSON.stringify(a));
      const b = await gw.call({ type, since_cursor: a.next_cursor });
      assert.equal(b.error, undefined, `type ${JSON.stringify(type)}: ${b.error}`);
    }
  } finally { gw.close(); relay.close(); }
});

test('cursor: the largest cursor the gateway can emit fits the schema cap and decodes', () => {
  const now = nowS();
  const lo = now - 30 * 86400;
  // Worst case: MAX_SEEN deliveries, each in its own second, spread over the full lookback.
  const seen = new Map();
  for (let i = 0; i < 2000; i++) seen.set(i.toString(16).padStart(12, '0'), lo + i * 1296);
  const c = encodeCursor({ lo, seen, type: 'x'.repeat(256) });
  assert.ok(c.length <= MAX_CURSOR_CHARS, `cursor is ${c.length} chars`);
  assert.equal(decodeCursor(c, { now, type: 'x'.repeat(256) }).seen.size, 2000);
  // And through advance: a full limit on top of a full carried set stays bounded.
  const fetched = Array.from({ length: 1000 }, (_, i) => ({ id: (i + 5000).toString(16).padStart(64, '0'), created_at: now - 299 + (i % 290) }));
  const step = advance({ lo: now - 300, seen: new Map([...seen].map(([p], i) => [p, now - 300 + (i % 300)])), type: undefined }, fetched, { limit: 1000, now });
  const c2 = encodeCursor(step.state);
  assert.ok(c2.length <= MAX_CURSOR_CHARS);
  assert.ok(decodeCursor(c2, { now }).seen.size <= 2000);
});

test('cursor: no cursor keeps the old window read and its relay filter', async () => {
  const relay = await storeRelay(); const gw = await gatewayOn(relay.url);
  try {
    const r = await gw.call({ sinceSeconds: 120, limit: 7 });
    assert.equal(r.count, 0);
    assert.equal(relay.stats.reqs, 1, 'one REQ, as before');
  } finally { gw.close(); relay.close(); }
});

// ---- fetchCovering against the relay's newest-first limit ----

test('fetchCovering: a full page is narrowed until the window is complete', async () => {
  const relay = await storeRelay();
  try {
    const base = nowS() - 1000;
    for (let i = 0; i < 30; i++) relay.store.push(ev(base + i));
    const r = await fetchCovering(relay.url, generateSecretKey(), { lo: base, page: 10 });
    assert.ok(r.coveredTo < base + 29, 'coverage stops below the cut-off events');
    const expected = relay.store.filter((e) => e.created_at <= r.coveredTo).map((e) => e.id).sort();
    assert.deepEqual(r.events.map((e) => e.id).sort(), expected, 'every event in the covered window');
    // A single second holding a full page cannot be split.
    for (let i = 0; i < 10; i++) relay.store.push(ev(base - 5));
    assert.equal((await fetchCovering(relay.url, generateSecretKey(), { lo: base - 5, page: 10 })).saturated, true);
  } finally { relay.close(); }
});

// ---- the cursor as hostile input ----

test('decodeCursor: malformed, oversized, wrong-version and wrong-shape cursors are refused without echo', () => {
  const now = nowS();
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  for (const bad of ['', '!!!', 'a'.repeat(MAX_CURSOR_CHARS + 1), enc([]), enc({ v: 2, lo: now, k: null, s: '' }),
    enc({ v: 1, lo: -1, k: null, s: '' }), enc({ v: 1, lo: 1.5, k: null, s: '' }), enc({ v: 1, lo: now, k: 'x'.repeat(257), s: '' }),
    enc({ v: 1, lo: now, k: null, s: [] }), enc({ v: 1, lo: now, k: null, s: {} }), enc({ v: 1, lo: now, k: null, s: '0:xyz' }),
    enc({ v: 1, lo: now, k: null, s: '-1:aaaaaaaaaaaa' }), enc({ v: 1, lo: now, k: null, s: '0:aaaaaaaaaaaa,,' }), enc({ v: 1, lo: now, k: '', s: '' }),
    enc({ v: 1, lo: now, k: null, s: Array.from({ length: 2001 }, () => '1:aaaaaaaaaaaa').join(',') }), Buffer.from('not json').toString('base64url')]) {
    assert.throws(() => decodeCursor(bad, { now }), (e) => e instanceof CursorError && !e.message.includes(bad || '\u0000'));
  }
  // Lookback is clamped to the sinceSeconds bound, and never ahead of now.
  assert.equal(decodeCursor(enc({ v: 1, lo: 0, k: null, s: '' }), { now }).lo, now - 30 * 86400);
  assert.equal(decodeCursor(enc({ v: 1, lo: now + 9999, k: null, s: '' }), { now }).lo, now);
});

test('advance: a future-dated event cannot drag the window floor past real traffic', () => {
  const now = nowS();
  const future = { id: 'f'.repeat(64), created_at: now + 86400 };
  const step = advance({ lo: now - 600, seen: new Map(), type: undefined }, [future], { now });
  assert.ok(step.state.lo <= now - OVERLAP_SECS, 'floor trails the read time, not the newest created_at');
  const round = decodeCursor(encodeCursor(step.state), { now });
  assert.ok(round.seen.size === 1, 'the future event is remembered so it is not repeated');
});

test('cursorSync: a timed-out read delivers nothing and returns the same cursor', async () => {
  const now = nowS();
  const cursor = encodeCursor({ lo: now - 60, seen: new Map(), type: undefined });
  const r = await cursorSync({ fetchCovering: async () => ({ partial: true }) }, { since_cursor: cursor }, { now });
  assert.equal(r.messages.length, 0);
  assert.equal(r.messages.partial, true);
  assert.equal(r.next_cursor, cursor);
});
