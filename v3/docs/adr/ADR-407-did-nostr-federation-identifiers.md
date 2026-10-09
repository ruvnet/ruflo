# ADR-407: Add did:nostr identifiers to Ruflo federation

**Status**: Implemented in source; gateway deployment pending
**Date**: 2026-10-04
**Related**: ADR-386 (swarm channels), ADR-387 (ChatGPT federation connector), ADR-388 (OAuth on x.ruv.io)
**Surfaces**: `plugins/ruflo-x-gateway`

## Context

x.ruv.io already authenticates Nostr members with NIP-42 and verifies signed relay
events. A Nostr public key is therefore already the cryptographic principal. A
W3C DID representation can make that principal easier to reference from DID and
verifiable credential tooling, but it must not create a second authentication
system or imply authorization.

Ruflo also has ANS identities based on Ed25519. Nostr uses secp256k1 x-only
public keys. These are distinct key types and are not interchangeable. A DID
alias for a Nostr key must not silently assert that the same operator controls
an ANS identity.

The `did:nostr` method specification is a work in progress. This ADR implements
a local identifier and projection, not a general purpose DID resolver or a
claim of standards conformance.

## Decision

Add a deterministic conversion from a valid secp256k1 x-only public key to
`did:nostr:<lowercase-hex>`. Validate the x coordinate against the secp256k1
field and curve before formatting or parsing.

Expose the derived identifier as additive metadata:

- `federation_identity` returns both the existing `pubkey` and its `did`.
- Gateway discovery and `ruv://federation/registry` expose `gatewayDid`.
- Verified event projections include `did`, derived from the relay event's
  verified `pubkey` after untrusted content has been spread.
- Roster and claim views include derived DIDs when their owner is a valid
  Nostr public key.

The existing public key remains the authorization and relay admission key.
NIP-42 remains the authentication mechanism. The DID field grants no rights.
Ruflo does not query public relays to resolve identity metadata. ANS identity
linking requires a separate, explicit proof of control and is out of scope.

## Alternatives

| Option | Delivery and runtime cost | Security and interoperability |
| --- | --- | --- |
| Keep raw keys only | No code change | Preserves current behavior, but leaves consumers to invent identity formatting |
| Replace NIP-42 with DID resolution | Network calls and new resolver dependency | Adds latency and a remote trust surface without improving proof of key control |
| Add a local DID alias | Small local conversion, no network call | Preserves NIP-42 and public key ACLs while exposing a standard identifier |

The local alias is selected because it adds interoperability without changing
the trust model or requiring a relay round trip.

## Data and trust boundaries

1. NIP-42 authenticates a Nostr key to the relay.
2. Relay event signature verification establishes the event's Nostr public key.
3. Ruflo derives the DID only from that verified key.
4. Event content, profile metadata, and caller supplied DIDs never override the
   verified `pubkey` or the derived DID.
5. Authorization continues to use the existing Nostr public key and gateway
   policy.

The converter checks canonical hex shape, field range, and curve membership.
It uses public key input only; the arithmetic is not a secret dependent
cryptographic operation.

## Compatibility, rollout, and rollback

All additions are optional response fields. Existing keys, event formats,
tool names, input schemas, relay configuration, and authorization rules remain
unchanged. Old clients can ignore the fields.

Rollback is removal of the new projection fields and helper import. No stored
data migration or relay change is required. Do not deploy automatically from
this source change; validate the gateway build and live read path first.

## Validation

Required checks:

- Unit tests accept a known secp256k1 generator x coordinate, normalize uppercase
  hex, round trip the DID, and reject malformed, out of range, and off-curve
  values.
- Gateway tests verify `gatewayDid` agrees with `gatewayPubkey` in discovery,
  `federation_identity`, and the registry resource.
- Event projection tests forge a victim `pubkey` and DID inside signed content
  and verify that `fetchRecent`, `fetchManyOn`, and `fetchChannel` return the
  DID derived from the actual verified signer.
- Run the complete `npm test` suite in `plugins/ruflo-x-gateway`.

A successful local unit run does not establish production deployment or DID
method interoperability. A later interoperability test should resolve the DID
with an independent DID-aware implementation before using it in credentials.
