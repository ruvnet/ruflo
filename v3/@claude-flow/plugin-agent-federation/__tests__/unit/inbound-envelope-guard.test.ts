import { describe, expect, it, vi } from 'vitest';
import { InboundEnvelopeGuard, INBOUND_ENVELOPE_LIMITS as limits } from '../../src/application/inbound-envelope-guard.js';
import { dispatchInbound, type InboundDispatchDeps } from '../../src/application/inbound-dispatcher.js';
import { FederationNode } from '../../src/domain/entities/federation-node.js';
import type { AgentMessage } from '../../src/transport/midstream-aware-loader.js';

const start = Date.parse('2026-11-06T12:00:00.000Z');
function message(id = 'id', source = 'remote', timestamp = start): AgentMessage {
  return {
    id, type: 'heartbeat',
    payload: { envelopeId: id, messageType: 'heartbeat', sourceNodeId: source, targetNodeId: 'local', sessionId: 's', timestamp: new Date(timestamp).toISOString() },
    metadata: { sourceNodeId: source, targetNodeId: 'local', sessionId: 's', signatureVersion: 'jcs-v1', signature: 'fixture' },
  };
}

describe('bounded authenticated envelope history', () => {
  it.each([
    ['envelopeId', 'different'], ['messageType', 'task-assignment'],
    ['sourceNodeId', 'other-peer'], ['sessionId', 'other-session'], ['timestamp', 'not-a-date'],
  ])('rejects invalid or inconsistent %s', (field, value) => {
    const guard = new InboundEnvelopeGuard('local', () => start);
    const input = message();
    (input.payload as Record<string, unknown>)[field] = value;
    expect(guard.checkAndRecord(input, 'remote')).toBe('INVALID_ENVELOPE');
    expect(guard.checkAndRecord(message(), 'remote')).toBeNull();
  });

  it.each(['metadata', 'payload'])('rejects a wrong recipient in %s', (field) => {
    const guard = new InboundEnvelopeGuard('local', () => start);
    const input = message();
    (input[field] as Record<string, unknown>).targetNodeId = 'other';
    expect(guard.checkAndRecord(input, 'remote')).toBe('WRONG_RECIPIENT');
  });

  it('bounds IDs and accepts distinct peers using the same ID', () => {
    const guard = new InboundEnvelopeGuard('local', () => start);
    expect(guard.checkAndRecord(message(''), 'remote')).toBe('INVALID_ENVELOPE');
    expect(guard.checkAndRecord(message('x'.repeat(limits.maxIdLength + 1)), 'remote')).toBe('INVALID_ENVELOPE');
    const longPeer = 'x'.repeat(limits.maxIdLength + 1);
    expect(guard.checkAndRecord(message('id', longPeer), longPeer)).toBe('INVALID_ENVELOPE');
    expect(() => new InboundEnvelopeGuard(longPeer)).toThrow(/node id/);
    expect(guard.checkAndRecord(message(), 'remote')).toBeNull();
    expect(guard.checkAndRecord(message('id', 'other'), 'other')).toBeNull();
    expect(guard.checkAndRecord(message(), 'remote')).toBe('MESSAGE_REPLAYED');
  });

  it('keeps a future-dated ID until the signed timestamp expires, including the boundary', () => {
    let now = start;
    const guard = new InboundEnvelopeGuard('local', () => now);
    const input = message('future', 'remote', start + limits.futureSkewMs);
    expect(guard.checkAndRecord(input, 'remote')).toBeNull();
    now += limits.maxAgeMs + 1;
    expect(guard.checkAndRecord(input, 'remote')).toBe('MESSAGE_REPLAYED');
    now = start + limits.futureSkewMs + limits.maxAgeMs;
    expect(guard.checkAndRecord(input, 'remote')).toBe('MESSAGE_REPLAYED');
    now++;
    expect(guard.checkAndRecord(input, 'remote')).toBe('MESSAGE_EXPIRED');
    expect(guard.checkAndRecord(message('future', 'remote', now), 'remote')).toBeNull();
  });

  it('accepts exact freshness boundaries and rejects malformed time', () => {
    const guard = new InboundEnvelopeGuard('local', () => start);
    expect(guard.checkAndRecord(message('old', 'remote', start - limits.maxAgeMs), 'remote')).toBeNull();
    expect(guard.checkAndRecord(message('future', 'remote', start + limits.futureSkewMs), 'remote')).toBeNull();
    const invalid = message();
    (invalid.payload as Record<string, unknown>).timestamp = 0;
    expect(guard.checkAndRecord(invalid, 'remote')).toBe('INVALID_ENVELOPE');
    expect(new InboundEnvelopeGuard('local', () => NaN).checkAndRecord(message(), 'remote')).toBe('INVALID_ENVELOPE');
  });

  it('fails closed at the per-peer limit without evicting a live ID', () => {
    const guard = new InboundEnvelopeGuard('local', () => start);
    for (let index = 0; index < limits.maxMessagesPerPeer; index++) {
      expect(guard.checkAndRecord(message(String(index)), 'remote')).toBeNull();
    }
    expect(guard.checkAndRecord(message('overflow'), 'remote')).toBe('REPLAY_CACHE_FULL');
    expect(guard.checkAndRecord(message('0'), 'remote')).toBe('MESSAGE_REPLAYED');
  });

  it('bounds peer count and frees only expired peer histories', () => {
    let now = start;
    const guard = new InboundEnvelopeGuard('local', () => now);
    for (let index = 0; index < limits.maxPeers; index++) {
      const peer = `peer-${index}`;
      expect(guard.checkAndRecord(message('id', peer), peer)).toBeNull();
    }
    expect(guard.checkAndRecord(message('id', 'overflow'), 'overflow')).toBe('REPLAY_CACHE_FULL');
    expect(guard.checkAndRecord(message('id', 'peer-0'), 'peer-0')).toBe('MESSAGE_REPLAYED');
    now += limits.maxAgeMs + 1;
    expect(guard.checkAndRecord(message('id', 'new-peer', now), 'new-peer')).toBeNull();
  });

  it('bounds total IDs across peers and recovers capacity after expiry', () => {
    let now = start;
    const guard = new InboundEnvelopeGuard('local', () => now);
    for (let index = 0; index < limits.maxMessages; index++) {
      const peer = `peer-${Math.floor(index / limits.maxMessagesPerPeer)}`;
      expect(guard.checkAndRecord(message(String(index), peer), peer)).toBeNull();
    }
    expect(guard.checkAndRecord(message('id', 'new-peer'), 'new-peer')).toBe('REPLAY_CACHE_FULL');
    expect(guard.checkAndRecord(message('0', 'peer-0'), 'peer-0')).toBe('MESSAGE_REPLAYED');
    now += limits.maxAgeMs + 1;
    expect(guard.checkAndRecord(message('id', 'new-peer', now), 'new-peer')).toBeNull();
  });
});

describe('dispatcher cache reservation follows authentication and authorization', () => {
  it('does not consume an ID on bad signature or policy denial', async () => {
    const peer = FederationNode.create({ nodeId: 'remote', publicKey: 'fixture', endpoint: 'ws://remote:1',
      capabilities: { agentTypes: [], maxConcurrentSessions: 1, supportedProtocols: [], complianceModes: [] }, metadata: {} });
    const verifyEnvelope = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const authorizeInbound = vi.fn().mockReturnValueOnce({ allowed: false }).mockReturnValue({ allowed: true });
    const emit = vi.fn();
    const deps: InboundDispatchDeps = {
      discovery: { getPeer: () => peer }, audit: { log: vi.fn(async () => {}) },
      eventBus: { emit }, logger: { debug: vi.fn(), warn: vi.fn() },
      verifyEnvelope, authorizeInbound, authorizationMode: 'enforce',
      envelopeGuard: new InboundEnvelopeGuard('local', () => start),
    };
    expect(await dispatchInbound('remote:1', message(), deps)).toMatchObject({ accepted: false, reason: 'INVALID_SIGNATURE' });
    expect(await dispatchInbound('remote:1', message(), deps)).toMatchObject({ accepted: false, reason: 'AUTHORIZATION_DENIED' });
    expect(await dispatchInbound('remote:1', message(), deps)).toMatchObject({ accepted: true });
    expect(await dispatchInbound('remote:1', message(), deps)).toMatchObject({ accepted: false, reason: 'MESSAGE_REPLAYED' });
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
