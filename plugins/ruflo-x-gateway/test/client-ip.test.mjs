// Per-IP limits must key on the trusted end of the forwarding chain. Using the
// leftmost X-Forwarded-For entry let a caller rotate it to escape every limit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configuredProxyHops, deriveClientIp } from '../src/client-ip.mjs';
import { clientIp, rateLimited } from '../src/security.mjs';

const req = (xff, remoteAddress = '10.0.0.9') => ({ headers: xff ? { 'x-forwarded-for': xff } : {}, socket: { remoteAddress } });

test('the client address comes from the right of the chain, not the caller-supplied left', () => {
  assert.equal(clientIp(req('1.2.3.4, 203.0.113.7'), 1), '203.0.113.7');
  assert.equal(clientIp(req('9.9.9.9, 203.0.113.7'), 1), '203.0.113.7');
  assert.equal(clientIp(req('1.2.3.4'), 0), '10.0.0.9');
  assert.equal(clientIp(req('not-an-ip', 'also-bad'), 0), 'unknown');
  assert.equal(deriveClientIp(req('x'.repeat(2000)), 1).error, 'invalid forwarding chain');
});

test('rotating X-Forwarded-For does not refill the bucket', () => {
  let limited = false;
  for (let i = 0; i < 5 && !limited; i++) limited = rateLimited(req(`198.51.100.${i}, 203.0.113.50`, '10.0.0.9'), 3);
  // rateLimited uses the configured hops; with 0 it keys on the socket address, which is equally fixed.
  assert.equal(limited, true);
});

test('proxy hops come from RUFLO_PROXY_HOPS, then the registration setting, clamped to 0..3', () => {
  assert.equal(configuredProxyHops({}), 0);
  assert.equal(configuredProxyHops({ RUFLO_REGISTRATION_PROXY_HOPS: '1' }), 1);
  assert.equal(configuredProxyHops({ RUFLO_PROXY_HOPS: '2', RUFLO_REGISTRATION_PROXY_HOPS: '1' }), 2);
  assert.equal(configuredProxyHops({ RUFLO_PROXY_HOPS: '9' }), 0);
});
