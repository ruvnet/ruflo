/**
 * The signature on a federation envelope must cover everything a receiver
 * stores and serves as that origin's content. A relaying peer must not be able
 * to add fields to another node's genuine envelope and have them pass
 * verification.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  getNodeIdentity,
  signEnvelope,
  verifyEnvelope,
  canonicalEnvelopeBytes,
  mergeEnvelopes,
  type SignedEnvelope,
} from '../src/mcp-tools/agentbbs-federation.js';

const ROOM = 'sales-dd6531eb';
let dirA: string, dirB: string;

beforeEach(() => {
  dirA = mkdtempSync(join(tmpdir(), 'abbs-cov-a-'));
  dirB = mkdtempSync(join(tmpdir(), 'abbs-cov-b-'));
});
afterEach(() => {
  for (const d of [dirA, dirB]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* gone */ } }
});

async function signed(payload: unknown): Promise<SignedEnvelope> {
  return signEnvelope(dirA, {
    envelopeId: 'e-cov-1', roomId: ROOM, seq: 1, msgType: 'Note',
    payload, timestamp: '2026-11-21T00:00:00.000Z',
  });
}

/** A genuine envelope after a JSON round trip, with `extra` spliced into its payload text. */
function withPayloadKey(env: SignedEnvelope, extra: string): SignedEnvelope {
  const text = JSON.stringify(env).replace('"payload":{', `"payload":{${extra},`);
  return JSON.parse(text) as SignedEnvelope;
}

describe('agentbbs federation: signature covers stored content', () => {
  it('rejects a genuine envelope whose payload gained a __proto__ key in transit', async () => {
    const a = await getNodeIdentity(dirA);
    const env = await signed({ m: 'hi' });
    const tampered = withPayloadKey(env, '"__proto__":{"injected":"unsigned text"}');
    expect(Object.prototype.hasOwnProperty.call(tampered.payload, '__proto__')).toBe(true);

    expect(await verifyEnvelope(env, a.publicKey)).toBe(true);
    expect(await verifyEnvelope(tampered, a.publicKey)).toBe(false);
  });

  it('rejects a nested __proto__ key as well', async () => {
    const a = await getNodeIdentity(dirA);
    const env = await signed({ m: { deep: [{ x: 1 }] } });
    const text = JSON.stringify(env).replace('{"x":1}', '{"x":1,"__proto__":{"y":2}}');
    const tampered = JSON.parse(text) as SignedEnvelope;
    expect(await verifyEnvelope(tampered, a.publicKey)).toBe(false);
  });

  it('refuses to canonicalize (and so to sign) a payload with an own __proto__ key', async () => {
    const payload = JSON.parse('{"m":"hi","__proto__":{"x":1}}');
    expect(() => canonicalEnvelopeBytes({
      envelopeId: 'e', roomId: ROOM, seq: 1, msgType: 'Note', payload, timestamp: 't',
    })).toThrow();
    await expect(signed(payload)).rejects.toThrow();
  });

  it('does not merge a relayed envelope carrying a payload __proto__ key', async () => {
    const a = await getNodeIdentity(dirA);
    const env = await signed({ m: 'hi' });
    const tampered = withPayloadKey(env, '"__proto__":{"injected":"unsigned text"}');
    const r = await mergeEnvelopes(dirB, ROOM, [tampered], a.publicKey,
      { peerNodeId: a.nodeId, pinned: new Map([[a.nodeId, a.publicKey]]) });
    expect(r.merged).toBe(0);
    expect(r.skippedUnverified).toBe(1);
  });

  it('stores only signed fields when merging, dropping unsigned top-level additions', async () => {
    const a = await getNodeIdentity(dirA);
    const env = await signed({ m: 'hi' });
    const relayed = { ...env, note: 'unsigned text added by relay' } as SignedEnvelope;
    const r = await mergeEnvelopes(dirB, ROOM, [relayed], a.publicKey,
      { peerNodeId: a.nodeId, pinned: new Map([[a.nodeId, a.publicKey]]) });
    expect(r.merged).toBe(1);

    const log = readFileSync(join(dirB, `room-${ROOM}.jsonl`), 'utf-8').trim().split('\n');
    const stored = JSON.parse(log[log.length - 1]);
    expect(stored).not.toHaveProperty('note');
    expect(stored.payload).toEqual({ m: 'hi' });
    expect(stored.hops).toBe(1);
    expect(await verifyEnvelope(stored, a.publicKey)).toBe(true);
  });
});
