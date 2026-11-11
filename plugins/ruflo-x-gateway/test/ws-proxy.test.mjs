import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { attachWsProxy, activeConnections } from '../src/ws-proxy.mjs';

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const settle = () => new Promise((r) => setTimeout(r, 100));

test('ws proxy releases each connection slot exactly once (#4752)', async () => {
  const relay = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((r) => relay.once('listening', r));
  const relayUrl = `ws://127.0.0.1:${relay.address().port}`;
  const server = createServer();
  const wss = attachWsProxy(server, relayUrl);
  const port = await listen(server);
  const before = activeConnections();
  try {
    for (let i = 0; i < 3; i++) {
      const c = new WebSocket(`ws://127.0.0.1:${port}/relay`);
      await new Promise((r, j) => { c.once('open', r); c.once('error', j); });
      await settle();
      assert.equal(activeConnections(), before + 1);
      c.close();
      await settle();
      // close fires on both the client side and the relay side; the slot must be freed once.
      assert.equal(activeConnections(), before);
    }
    // Relay side going away first must also free exactly one slot.
    const c = new WebSocket(`ws://127.0.0.1:${port}/relay`);
    await new Promise((r, j) => { c.once('open', r); c.once('error', j); });
    await settle();
    for (const s of relay.clients) s.terminate();
    await settle();
    assert.equal(activeConnections(), before);
  } finally {
    wss.close(); server.close(); relay.close();
  }
});
