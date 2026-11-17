import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { HandshakeService, type HandshakeChallenge } from '../../src/domain/services/handshake-service.js';
import { FederationNode } from '../../src/domain/entities/federation-node.js';
import { canonicalizeEnvelopeForVerify } from '../../src/application/inbound-dispatcher.js';

const context = 'ruflo:federation:handshake:v1:';
const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
const signBytes = (data: string) => sign(null, Buffer.from(data), keys.privateKey).toString('hex');
const verifyBytes = (data: string, signature: string) => verify(null, Buffer.from(data), keys.publicKey, Buffer.from(signature, 'hex'));
const peer = () => FederationNode.create({ nodeId: 'remote', publicKey, endpoint: 'ws://remote:1',
  capabilities: { agentTypes: [], maxConcurrentSessions: 1, supportedProtocols: [], complianceModes: [] } });
const service = () => new HandshakeService({
  generateSessionId: () => 'session', generateSessionToken: () => 'token', generateNonce: () => 'nonce',
  signChallenge: async data => signBytes(data), verifySignature: async (data, signature) => verifyBytes(data, signature),
  pinnedKeyFor: () => publicKey, getLocalNodeId: () => 'local', getLocalPublicKey: () => publicKey,
  getLocalCapabilities: () => [],
});

describe('handshake signature domain', () => {
  it('does not sign arbitrary peer-supplied bytes as another protocol', async () => {
    const nonce = canonicalizeEnvelopeForVerify({ id: 'message', type: 'task-assignment',
      payload: { action: 'fixture' }, metadata: { sourceNodeId: 'remote', signatureVersion: 'jcs-v1' } });
    const challenge: HandshakeChallenge = { challengeId: 'challenge', nonce, timestamp: new Date().toISOString(), sourceNodeId: 'remote', targetNodeId: 'local' };
    const response = await service().respondToHandshake(challenge);
    expect(verifyBytes(nonce, response.signedNonce)).toBe(false);
    expect(verifyBytes(context + nonce, response.signedNonce)).toBe(true);
  });

  it('accepts a correctly prefixed challenge response', async () => {
    const handshake = service();
    const challenge = await handshake.initiateHandshake(peer());
    const result = await handshake.verifyChallenge({ challengeId: challenge.challengeId,
      signedNonce: signBytes(context + challenge.nonce), publicKey, capabilities: [] }, peer());
    expect(result.success).toBe(true);
    expect(result.pinned).toBe(true);
  });

  it('rejects legacy raw-nonce and wrong-domain signatures', async () => {
    for (const prefix of ['', 'different-protocol:']) {
      const handshake = service();
      const challenge = await handshake.initiateHandshake(peer());
      const result = await handshake.verifyChallenge({ challengeId: challenge.challengeId,
        signedNonce: signBytes(prefix + challenge.nonce), publicKey, capabilities: [] }, peer());
      expect(result).toMatchObject({ success: false, error: 'Invalid challenge signature' });
    }
  });
});
