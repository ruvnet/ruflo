import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNostrPublicKey, nostrDidFromPubkey, pubkeyFromNostrDid } from '../src/did-nostr.mjs';

const GENERATOR_X = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

test('valid Nostr x-only keys round trip through did:nostr', () => {
  const did = nostrDidFromPubkey(GENERATOR_X.toUpperCase());
  assert.equal(did, `did:nostr:${GENERATOR_X}`);
  assert.equal(pubkeyFromNostrDid(did), GENERATOR_X);
});

test('rejects malformed and off-curve keys', () => {
  assert.equal(isNostrPublicKey('not-a-key'), false);
  assert.equal(isNostrPublicKey('00'.repeat(32)), false);
  assert.throws(() => nostrDidFromPubkey('00'.repeat(32)), /valid secp256k1/);
  assert.throws(() => pubkeyFromNostrDid(`did:nostr:${'f'.repeat(64)}`), /valid secp256k1/);
  assert.throws(() => pubkeyFromNostrDid(`did:key:${GENERATOR_X}`), /did:nostr/);
});
