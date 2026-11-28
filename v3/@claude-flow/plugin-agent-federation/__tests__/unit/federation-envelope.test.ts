/**
 * FederationEnvelope Tests
 *
 * Tests the ACTUAL FederationEnvelope class, CONSENSUS_REQUIRED_TYPES,
 * and FederationMessageType from the real source module.
 * No mocks, no simulations, no local reimplementations.
 */

import { describe, it, expect } from 'vitest';
import {
  FederationEnvelope,
  type FederationEnvelopeProps,
  type FederationMessageType,
  CONSENSUS_REQUIRED_TYPES,
  type PIIScanResult,
} from '../../src/domain/entities/federation-envelope.js';

function makeScanResult(overrides: Partial<PIIScanResult> = {}): PIIScanResult {
  return {
    scanned: false,
    piiFound: false,
    detections: [],
    actionsApplied: [],
    scanDurationMs: 0,
    ...overrides,
  };
}

function makeProps<T = unknown>(overrides: Partial<FederationEnvelopeProps<T>> = {}): FederationEnvelopeProps<T> {
  return {
    envelopeId: 'env-001',
    sourceNodeId: 'node-A',
    targetNodeId: 'node-B',
    sessionId: 'session-1',
    messageType: 'task-assignment' as FederationMessageType,
    payload: { action: 'ping' } as T,
    timestamp: new Date('2026-01-15T12:00:00.000Z'),
    nonce: 'nonce-abc123',
    hmacSignature: 'sig-deadbeef',
    piiScanResult: makeScanResult(),
    ...overrides,
  };
}

describe('FederationEnvelope', () => {
  describe('construction', () => {
    it('should construct with all required fields', () => {
      const props = makeProps();
      const envelope = new FederationEnvelope(props);

      expect(envelope.envelopeId).toBe('env-001');
      expect(envelope.sourceNodeId).toBe('node-A');
      expect(envelope.targetNodeId).toBe('node-B');
      expect(envelope.sessionId).toBe('session-1');
      expect(envelope.messageType).toBe('task-assignment');
      expect(envelope.payload).toEqual({ action: 'ping' });
      expect(envelope.timestamp).toEqual(new Date('2026-01-15T12:00:00.000Z'));
      expect(envelope.nonce).toBe('nonce-abc123');
      expect(envelope.hmacSignature).toBe('sig-deadbeef');
      expect(envelope.piiScanResult).toEqual(makeScanResult());
    });

    it('should preserve generic payload type', () => {
      const props = makeProps<{ code: number }>({
        payload: { code: 42 },
      });
      const envelope = new FederationEnvelope(props);
      expect(envelope.payload.code).toBe(42);
    });
  });

  describe('isExpired', () => {
    it('should return true when envelope age exceeds maxAgeMs', () => {
      const oldTimestamp = new Date(Date.now() - 60_000); // 60 seconds ago
      const envelope = new FederationEnvelope(makeProps({ timestamp: oldTimestamp }));
      expect(envelope.isExpired(30_000)).toBe(true); // 30s max age
    });

    it('should return false when envelope age is within maxAgeMs', () => {
      const freshTimestamp = new Date(); // just now
      const envelope = new FederationEnvelope(makeProps({ timestamp: freshTimestamp }));
      expect(envelope.isExpired(60_000)).toBe(false); // 60s max age
    });

    it('should return true when maxAgeMs is zero and timestamp is in the past', () => {
      const pastTimestamp = new Date(Date.now() - 1);
      const envelope = new FederationEnvelope(makeProps({ timestamp: pastTimestamp }));
      expect(envelope.isExpired(0)).toBe(true);
    });
  });

  describe('toJSON', () => {
    it('should return a plain object with all fields', () => {
      const envelope = new FederationEnvelope(makeProps());
      const json = envelope.toJSON();

      expect(json['envelopeId']).toBe('env-001');
      expect(json['sourceNodeId']).toBe('node-A');
      expect(json['targetNodeId']).toBe('node-B');
      expect(json['sessionId']).toBe('session-1');
      expect(json['messageType']).toBe('task-assignment');
      expect(json['payload']).toEqual({ action: 'ping' });
      expect(json['nonce']).toBe('nonce-abc123');
      expect(json['hmacSignature']).toBe('sig-deadbeef');
      expect(json['piiScanResult']).toEqual(makeScanResult());
    });

    it('should serialize timestamp as ISO 8601 string', () => {
      const envelope = new FederationEnvelope(makeProps({
        timestamp: new Date('2026-01-15T12:00:00.000Z'),
      }));
      const json = envelope.toJSON();
      expect(json['timestamp']).toBe('2026-01-15T12:00:00.000Z');
      expect(typeof json['timestamp']).toBe('string');
    });

    it('should include all 10 expected keys', () => {
      const envelope = new FederationEnvelope(makeProps());
      const json = envelope.toJSON();
      const keys = Object.keys(json);
      expect(keys).toContain('envelopeId');
      expect(keys).toContain('sourceNodeId');
      expect(keys).toContain('targetNodeId');
      expect(keys).toContain('sessionId');
      expect(keys).toContain('messageType');
      expect(keys).toContain('payload');
      expect(keys).toContain('timestamp');
      expect(keys).toContain('nonce');
      expect(keys).toContain('hmacSignature');
      expect(keys).toContain('piiScanResult');
      expect(keys).toHaveLength(10);
    });
  });

  describe('toSignablePayload', () => {
    it('should return a JSON string', () => {
      const envelope = new FederationEnvelope(makeProps());
      const signable = envelope.toSignablePayload();
      expect(() => JSON.parse(signable)).not.toThrow();
    });

    it('should exclude hmacSignature from signable payload', () => {
      const envelope = new FederationEnvelope(makeProps());
      const parsed = JSON.parse(envelope.toSignablePayload());
      expect(parsed).not.toHaveProperty('hmacSignature');
    });

    it('should exclude piiScanResult from signable payload', () => {
      const envelope = new FederationEnvelope(makeProps());
      const parsed = JSON.parse(envelope.toSignablePayload());
      expect(parsed).not.toHaveProperty('piiScanResult');
    });

    it('should include envelopeId, sourceNodeId, targetNodeId, sessionId, messageType, payload, timestamp, and nonce', () => {
      const envelope = new FederationEnvelope(makeProps());
      const parsed = JSON.parse(envelope.toSignablePayload());

      expect(parsed['envelopeId']).toBe('env-001');
      expect(parsed['sourceNodeId']).toBe('node-A');
      expect(parsed['targetNodeId']).toBe('node-B');
      expect(parsed['sessionId']).toBe('session-1');
      expect(parsed['messageType']).toBe('task-assignment');
      expect(parsed['payload']).toEqual({ action: 'ping' });
      expect(parsed['timestamp']).toBe('2026-01-15T12:00:00.000Z');
      expect(parsed['nonce']).toBe('nonce-abc123');
    });

    it('should contain exactly 8 keys (everything except hmacSignature and piiScanResult)', () => {
      const envelope = new FederationEnvelope(makeProps());
      const parsed = JSON.parse(envelope.toSignablePayload());
      expect(Object.keys(parsed)).toHaveLength(8);
    });
  });

  describe('toWireObject', () => {
    it('projects a plain, JSON-safe payload the JCS canonicalizer accepts (#5153)', async () => {
      const { canonicalizeEnvelopeForVerify } = await import(
        '../../src/application/inbound-dispatcher.js'
      );
      const envelope = new FederationEnvelope(makeProps({
        hmacSignature: undefined as unknown as string,
        piiScanResult: undefined as unknown as PIIScanResult,
        payload: { action: 'ping', at: new Date('2026-01-15T12:00:00.000Z') },
      }));

      const payload = envelope.toWireObject();
      expect(Object.getPrototypeOf(payload)).toBe(Object.prototype);
      expect(payload['timestamp']).toBe('2026-01-15T12:00:00.000Z');
      expect('hmacSignature' in payload).toBe(false);
      expect('piiScanResult' in payload).toBe(false);

      const base = {
        id: envelope.envelopeId,
        type: envelope.messageType,
        payload,
        metadata: {
          sourceNodeId: envelope.sourceNodeId,
          targetNodeId: envelope.targetNodeId,
          sessionId: envelope.sessionId,
          signatureVersion: 'jcs-v1',
        },
      };
      // The class instance is exactly what the canonicalizer refuses; the wire projection is not.
      expect(() => canonicalizeEnvelopeForVerify({ ...base, payload: envelope }, 'jcs-v1')).toThrow(/plain objects/);
      // Legacy canonicalization is unchanged: JSON.stringify already serialized the class through toJSON.
      expect(canonicalizeEnvelopeForVerify({ ...base, payload: envelope }, 'legacy-v1'))
        .toBe(canonicalizeEnvelopeForVerify(base, 'legacy-v1'));
      const signedBytes = canonicalizeEnvelopeForVerify(base, 'jcs-v1');
      // The receiver reconstructs the signed message from JSON; the bytes must match.
      const wire = JSON.parse(JSON.stringify({
        ...base,
        metadata: { ...base.metadata, signature: 'sig' },
      }));
      expect(canonicalizeEnvelopeForVerify(wire, 'jcs-v1')).toBe(signedBytes);
    });
  });

  describe('emptyScanResult', () => {
    it('should return scanned=false', () => {
      const result = FederationEnvelope.emptyScanResult();
      expect(result.scanned).toBe(false);
    });

    it('should return piiFound=false', () => {
      const result = FederationEnvelope.emptyScanResult();
      expect(result.piiFound).toBe(false);
    });

    it('should return empty detections array', () => {
      const result = FederationEnvelope.emptyScanResult();
      expect(result.detections).toEqual([]);
    });

    it('should return empty actionsApplied array', () => {
      const result = FederationEnvelope.emptyScanResult();
      expect(result.actionsApplied).toEqual([]);
    });

    it('should return scanDurationMs=0', () => {
      const result = FederationEnvelope.emptyScanResult();
      expect(result.scanDurationMs).toBe(0);
    });
  });

  describe('CONSENSUS_REQUIRED_TYPES', () => {
    it('should contain trust-change', () => {
      expect(CONSENSUS_REQUIRED_TYPES.has('trust-change')).toBe(true);
    });

    it('should contain topology-change', () => {
      expect(CONSENSUS_REQUIRED_TYPES.has('topology-change')).toBe(true);
    });

    it('should contain agent-spawn', () => {
      expect(CONSENSUS_REQUIRED_TYPES.has('agent-spawn')).toBe(true);
    });

    it('should contain exactly 4 entries (ADR-101 added agent-handoff)', () => {
      expect(CONSENSUS_REQUIRED_TYPES.size).toBe(4);
    });
  });

  describe('FederationMessageType coverage', () => {
    const allMessageTypes: FederationMessageType[] = [
      'task-assignment',
      'memory-query',
      'memory-response',
      'context-share',
      'status-broadcast',
      'trust-change',
      'topology-change',
      'agent-spawn',
      'heartbeat',
      'challenge',
      'challenge-response',
      'handshake-init',
      'handshake-accept',
      'handshake-reject',
      'session-terminate',
      // ADR-101 Component C
      'claim-event',
      'agent-handoff',
    ];

    it('should accept all 17 message types as valid', () => {
      for (const msgType of allMessageTypes) {
        const envelope = new FederationEnvelope(makeProps({ messageType: msgType }));
        expect(envelope.messageType).toBe(msgType);
      }
    });

    it('should have exactly 17 known message types (15 base + 2 from ADR-101)', () => {
      expect(allMessageTypes).toHaveLength(17);
    });
  });
});
