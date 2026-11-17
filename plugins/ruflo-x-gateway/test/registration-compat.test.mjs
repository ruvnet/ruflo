import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGateway } from '../src/server.mjs';

// Client-compat regressions behind "x.ruv.io/mcp registration problems": what a connector does
// right after it is added must work for the request shapes real clients send.

async function withGateway(fn) {
  const gw = createGateway({ relay: 'ws://127.0.0.1:1', keyFile: '/tmp/gw-compat-test.key' });
  const port = await gw.listen(0);
  try { return await fn(`http://127.0.0.1:${port}`); } finally { gw.server.close(); gw.server.closeAllConnections?.(); }
}

const rpc = (base, path, body, extra = {}) => fetch(base + path, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...extra },
  body: JSON.stringify(body),
});
const dataOf = async (res) => JSON.parse((await res.text()).split('\n').find((l) => l.startsWith('data:')).slice(5));

for (const path of ['/mcp', '/claude/mcp', '/chatgpt/mcp']) {
  test(`${path}: tools/call without an "arguments" field is accepted for tools that take none`, async () => {
    await withGateway(async (base) => {
      for (const name of ['federation_identity', 'claims_status', 'federation_onboarding']) {
        const res = await rpc(base, path, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name } });
        assert.equal(res.status, 200);
        const out = await dataOf(res);
        // Relay-backed tools may legitimately error here (the test relay is unreachable); validation must not.
        assert.doesNotMatch(JSON.stringify(out), /-32602|Input validation|expected object/, `${name} without arguments must not fail validation: ${JSON.stringify(out).slice(0, 200)}`);
      }
    });
  });

  test(`${path}: tools/call with "arguments": null is treated like {}`, async () => {
    await withGateway(async (base) => {
      const res = await rpc(base, path, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'federation_identity', arguments: null } });
      assert.ok(!(await dataOf(res)).result?.isError);
    });
  });

  test(`${path}: a batch with one argument-less call is normalised too`, async () => {
    await withGateway(async (base) => {
      const res = await rpc(base, path, [
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'federation_identity' } },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      ]);
      const body = await res.text();
      assert.doesNotMatch(body, /expected object, received undefined/);
    });
  });
}

test('arguments that are present are never rewritten (a required field still fails)', async () => {
  await withGateway(async (base) => {
    const res = await rpc(base, '/claude/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'channel_sync', arguments: {} } });
    assert.match(JSON.stringify(await dataOf(res)), /Required|invalid|channel/i);
  });
});

test('a client that registers the bare host (POST /) reaches the directory-safe MCP profile, not a 404', async () => {
  await withGateway(async (base) => {
    const init = await rpc(base, '/', { jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
    assert.equal(init.status, 200);
    assert.equal((await dataOf(init)).result.serverInfo.name, 'ruflo-x-gateway-public');
    const tools = await dataOf(await rpc(base, '/', { jsonrpc: '2.0', id: 2, method: 'tools/list' }));
    const names = tools.result.tools.map((t) => t.name);
    assert.ok(names.includes('federation_identity'));
    assert.ok(!names.includes('federation_admit') && !names.includes('federation_invite_mint'), 'no operator tools on the bare host');
  });
});

test('a write attempted on the bare host gets the OAuth challenge, pointing at root metadata', async () => {
  await withGateway(async (base) => {
    const res = await rpc(base, '/', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'federation_publish', arguments: { msgType: 'Status', payload: {} } } });
    assert.equal(res.status, 401);
    assert.match(res.headers.get('www-authenticate'), /resource_metadata="[^"]*\/\.well-known\/oauth-protected-resource"/);
  });
});

test('GET / still returns the service document', async () => {
  await withGateway(async (base) => {
    const res = await fetch(base + '/');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).service, 'ruflo-x-gateway');
  });
});
