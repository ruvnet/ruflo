// Invite minting and revocation (#5029). Admission is decided by the relay
// (buzz-relay `POST /api/invites/claim`), not in this repository, so these tests
// pin the gateway's side of the contract against a stand-in relay HTTP API:
// what it sends to mint and revoke, and how it reports each relay answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { verifyEvent } from 'nostr-tools/pure';
import { createGateway } from '../src/server.mjs';

const CODE = 'v2.' + 'A'.repeat(43);
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

/** Stand-in relay HTTP API. `reply(path, body)` returns [status, json|null]. */
async function relayApi(reply) {
  const seen = [];
  const srv = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const auth = JSON.parse(Buffer.from(String(req.headers.authorization).replace(/^Nostr /, ''), 'base64').toString());
      seen.push({ path: req.url, method: req.method, body: raw ? JSON.parse(raw) : null, auth });
      const [status, json] = reply(req.url, raw ? JSON.parse(raw) : null);
      res.writeHead(status, json ? { 'content-type': 'application/json' } : {});
      res.end(json ? JSON.stringify(json) : '');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { port: srv.address().port, seen, close: () => srv.close() };
}

async function gatewayFor(api) {
  process.env.RUFLO_ADMIN_TOKEN = 'test-admin-token';
  const gw = createGateway({ relay: `ws://127.0.0.1:${api.port}`, keyFile: `/tmp/x-gw-inv-${Date.now()}-${Math.random().toString(36).slice(2)}.key`, port: 0 });
  const port = await gw.listen(0);
  const call = async (name, args) => {
    const raw = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }).then((r) => r.text());
    const { result } = JSON.parse(raw.slice(raw.indexOf('{')));
    return { isError: result.isError === true, text: result.content[0].text };
  };
  return { call, close: () => gw.server.close() };
}

const mintOk = (path, body) => [200, { code: CODE, expires_at: 1, max_uses: body.max_uses, uses_remaining: body.max_uses, url: 'x' }];

test('mint: an invite is single use unless the caller asks for more', async () => {
  const api = await relayApi(mintOk); const gw = await gatewayFor(api);
  try {
    assert.equal((await gw.call('federation_invite_mint', { adminToken: 'test-admin-token' })).isError, false);
    assert.equal(api.seen.at(-1).body.max_uses, 1, 'default is 1, not 25');
    await gw.call('federation_invite_mint', { adminToken: 'test-admin-token', maxUses: 5 });
    assert.equal(api.seen.at(-1).body.max_uses, 5, 'an explicit value is honoured');
    const zero = await gw.call('federation_invite_mint', { adminToken: 'test-admin-token', maxUses: 0 });
    assert.equal(zero.isError, true, 'zero uses is rejected before the relay');
    assert.equal(api.seen.length, 2);
  } finally { gw.close(); api.close(); }
});

test('revoke: signs a NIP-98 request with a payload tag and returns the relay receipt', async () => {
  const api = await relayApi(() => [200, { id: ID, revoked_at: 1700000000 }]); const gw = await gatewayFor(api);
  try {
    const r = await gw.call('federation_invite_revoke', { adminToken: 'test-admin-token', code: CODE });
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(JSON.parse(r.text), { revoked: true, id: ID, revoked_at: 1700000000 });
    const sent = api.seen.at(-1);
    assert.equal(sent.path, '/api/invites/revoke');
    assert.deepEqual(sent.body, { code: CODE });
    assert.ok(verifyEvent(sent.auth) && sent.auth.kind === 27235);
    const tag = (k) => sent.auth.tags.find((t) => t[0] === k)?.[1];
    assert.equal(tag('u'), `http://127.0.0.1:${api.port}/api/invites/revoke`);
    assert.equal(tag('method'), 'POST');
    assert.equal(tag('payload'), createHash('sha256').update(JSON.stringify({ code: CODE })).digest('hex'));
    await gw.call('federation_invite_revoke', { adminToken: 'test-admin-token', id: ID.toUpperCase() });
    assert.deepEqual(api.seen.at(-1).body, { id: ID }, 'by id as well');
  } finally { gw.close(); api.close(); }
});

test('revoke: admin token required; malformed selectors never reach the relay', async () => {
  const api = await relayApi(() => [200, { id: ID, revoked_at: 1 }]); const gw = await gatewayFor(api);
  try {
    assert.equal((await gw.call('federation_invite_revoke', { code: CODE })).isError, true);
    assert.equal((await gw.call('federation_invite_revoke', { code: CODE, adminToken: 'wrong' })).isError, true);
    for (const args of [{}, { code: CODE, id: ID }, { code: 'v1-legacy-code' }, { id: 'not-a-uuid' }]) {
      const r = await gw.call('federation_invite_revoke', { adminToken: 'test-admin-token', ...args });
      assert.equal(r.isError, true, JSON.stringify(args));
    }
    assert.equal(api.seen.length, 0);
  } finally { gw.close(); api.close(); }
});

test('revoke: a relay without the route is reported as unsupported, distinct from an unknown invite', async () => {
  for (const [reply, re] of [
    [() => [404, null], /does not support invite revocation/],          // pre-#9680 relay
    [() => [404, { error: 'invite_not_found' }], /invite not found/],
    [() => [403, { error: 'only relay owners, admins or the invite\'s creator can revoke it' }], /revoke failed: only relay owners/],
  ]) {
    const api = await relayApi(reply); const gw = await gatewayFor(api);
    try {
      const r = await gw.call('federation_invite_revoke', { adminToken: 'test-admin-token', code: CODE });
      assert.equal(r.isError, true);
      assert.match(r.text, re);
      assert.ok(!r.text.includes(CODE), 'the code is a bearer secret and is never echoed');
    } finally { gw.close(); api.close(); }
  }
});
