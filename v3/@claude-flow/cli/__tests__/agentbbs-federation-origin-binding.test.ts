/**
 * SECURITY: mergeEnvelopes checked the signature against the syncing peer's
 * pinned key but never compared `origin` with that peer, so a pinned peer could
 * sign envelopes that claimed any other node as their origin. The sync cursor
 * also advanced past envelopes that failed verification.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  canonicalEnvelopeBytes,
  getNodeIdentity,
  mergeEnvelopes,
  readEnvelopes,
  signEnvelope,
  type SignedEnvelope,
} from '../src/mcp-tools/agentbbs-federation.js';

const ROOM = 'sales-dd6531eb';
let dirA: string, dirB: string, dirC: string;

function envelope(over: Partial<SignedEnvelope> = {}): SignedEnvelope {
  return {
    envelopeId: 'e-' + Math.random().toString(36).slice(2, 10),
    roomId: ROOM, seq: 1, msgType: 'Note', payload: { hello: 'world' },
    timestamp: '2026-11-04T00:00:00.000Z', ...over,
  };
}

/** Sign with `signerDir`'s key while naming `claimedOrigin` — what a hostile peer would send. */
async function forge(signerDir: string, claimedOrigin: string, over: Partial<SignedEnvelope> = {}): Promise<SignedEnvelope> {
  const id = await getNodeIdentity(signerDir);
  const ed = await import('@noble/ed25519');
  const env = { ...envelope(over), origin: claimedOrigin, hops: 0 };
  const sig = await ((ed as any).signAsync ?? (ed as any).sign)(canonicalEnvelopeBytes(env), Buffer.from(id.privateKey, 'hex'));
  return { ...env, signature: Buffer.from(sig).toString('hex') };
}

beforeEach(() => {
  [dirA, dirB, dirC] = ['a', 'b', 'c'].map(n => mkdtempSync(join(tmpdir(), `abbs-origin-${n}-`)));
});
afterEach(() => { for (const d of [dirA, dirB, dirC]) rmSync(d, { recursive: true, force: true }); });

describe('origin binding', () => {
  it('refuses an envelope a peer signed while naming another node as origin', async () => {
    const a = await getNodeIdentity(dirA);
    const c = await getNodeIdentity(dirC);
    const forged = await forge(dirA, c.nodeId);
    const r = await mergeEnvelopes(dirB, ROOM, [forged], a.publicKey, { peerNodeId: a.nodeId, pinned: new Map([[a.nodeId, a.publicKey]]) });
    expect(r.merged).toBe(0);
    expect(r.skippedForeignOrigin).toBe(1);
    expect(readEnvelopes(dirB, ROOM)).toHaveLength(0);
  });

  it('refuses a forged origin even when that origin is pinned, because the key does not match', async () => {
    const a = await getNodeIdentity(dirA);
    const c = await getNodeIdentity(dirC);
    const forged = await forge(dirA, c.nodeId);
    const pinned = new Map([[a.nodeId, a.publicKey], [c.nodeId, c.publicKey]]);
    const r = await mergeEnvelopes(dirB, ROOM, [forged], a.publicKey, { peerNodeId: a.nodeId, pinned });
    expect(r.merged).toBe(0);
    expect(r.skippedUnverified).toBe(1);
  });

  it('accepts the peer\'s own envelopes and relays signed by another pinned node', async () => {
    const a = await getNodeIdentity(dirA);
    const c = await getNodeIdentity(dirC);
    const own = await signEnvelope(dirA, envelope({ seq: 3 }));
    const relayed = await signEnvelope(dirC, envelope({ seq: 5 }));
    const pinned = new Map([[a.nodeId, a.publicKey], [c.nodeId, c.publicKey]]);
    const r = await mergeEnvelopes(dirB, ROOM, [own, relayed], a.publicKey, { peerNodeId: a.nodeId, pinned });
    expect(r.merged).toBe(2);
    expect(r.acceptedMaxSeq).toBe(5);
  });

  it('does not count unverified envelopes towards the sync cursor', async () => {
    const a = await getNodeIdentity(dirA);
    const c = await getNodeIdentity(dirC);
    const good = await signEnvelope(dirA, envelope({ seq: 2 }));
    const forged = await forge(dirA, c.nodeId, { seq: 999 });
    const tampered = { ...(await signEnvelope(dirA, envelope({ seq: 500 }))), payload: { evil: true } };
    const r = await mergeEnvelopes(dirB, ROOM, [good, forged, tampered], a.publicKey, { peerNodeId: a.nodeId, pinned: new Map([[a.nodeId, a.publicKey]]) });
    expect(r.merged).toBe(1);
    expect(r.acceptedMaxSeq).toBe(2);
  });
});
