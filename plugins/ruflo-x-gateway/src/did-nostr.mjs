const SECP256K1_FIELD = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;

function modPow(base, exponent, modulus) {
  let result = 1n;
  base %= modulus;
  while (exponent > 0n) {
    if (exponent & 1n) result = (result * base) % modulus;
    base = (base * base) % modulus;
    exponent >>= 1n;
  }
  return result;
}

/** True when a canonical Nostr x-only public key is a secp256k1 curve point. */
export function isNostrPublicKey(pubkey) {
  if (typeof pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(pubkey)) return false;
  const x = BigInt(`0x${pubkey}`);
  if (x >= SECP256K1_FIELD) return false;
  const ySquared = (x * x % SECP256K1_FIELD * x + 7n) % SECP256K1_FIELD;
  return ySquared === 0n || modPow(ySquared, (SECP256K1_FIELD - 1n) / 2n, SECP256K1_FIELD) === 1n;
}

/** Format a valid Nostr x-only public key as its did:nostr identifier. */
export function nostrDidFromPubkey(pubkey) {
  if (!isNostrPublicKey(pubkey)) throw new TypeError('pubkey must be a valid secp256k1 x-only public key');
  return `did:nostr:${pubkey.toLowerCase()}`;
}

/** Parse a did:nostr identifier and return its canonical lowercase public key. */
export function pubkeyFromNostrDid(did) {
  if (typeof did !== 'string' || !did.startsWith('did:nostr:')) throw new TypeError('DID must use the did:nostr method');
  const pubkey = did.slice('did:nostr:'.length);
  if (!isNostrPublicKey(pubkey)) throw new TypeError('DID must contain a valid secp256k1 x-only public key');
  return pubkey.toLowerCase();
}
