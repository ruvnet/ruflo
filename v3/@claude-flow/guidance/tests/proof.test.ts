/**
 * Tests for the Proof Envelope system
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ProofChain,
  createProofChain,
} from '../src/proof.js';
import type {
  ProofEnvelope,
  ToolCallRecord,
  MemoryOperation,
} from '../src/proof.js';
import type { RunEvent } from '../src/types.js';

// ============================================================================
// Helpers
// ============================================================================

function createMockEvent(overrides: Partial<RunEvent> = {}): RunEvent {
  return {
    eventId: `evt-${Math.random().toString(36).slice(2, 8)}`,
    taskId: 'task-1',
    guidanceHash: 'abc123',
    retrievedRuleIds: ['R001', 'R002'],
    toolsUsed: ['Read', 'Edit', 'Bash'],
    filesTouched: ['src/main.ts', 'src/utils.ts'],
    diffSummary: { linesAdded: 50, linesRemoved: 10, filesChanged: 2 },
    testResults: { ran: true, passed: 10, failed: 0, skipped: 1 },
    violations: [],
    outcomeAccepted: true,
    reworkLines: 5,
    intent: 'feature',
    timestamp: Date.now(),
    durationMs: 5000,
    sessionId: 'session-1',
    ...overrides,
  };
}

function createMockToolCall(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    callId: `call-${Math.random().toString(36).slice(2, 8)}`,
    toolName: 'Edit',
    params: { file_path: '/src/main.ts', old_string: 'foo', new_string: 'bar' },
    result: { success: true },
    timestamp: Date.now(),
    durationMs: 120,
    ...overrides,
  };
}

function createMockMemoryOp(overrides: Partial<MemoryOperation> = {}): MemoryOperation {
  return {
    key: 'agent/status',
    namespace: 'coordination',
    operation: 'write',
    valueHash: 'a'.repeat(64),
    timestamp: Date.now(),
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ProofChain', () => {
  let chain: ProofChain;

  beforeEach(() => {
    chain = createProofChain({ signingKey: 'test-secret-key' });
  });

  // --------------------------------------------------------------------------
  // Genesis envelope
  // --------------------------------------------------------------------------

  describe('genesis envelope', () => {
    it('should create the first envelope with previousHash of all zeros', () => {
      const event = createMockEvent();
      const envelope = chain.append(event);

      expect(envelope.previousHash).toBe('0'.repeat(64));
    });

    it('should set the runEventId to the event ID', () => {
      const event = createMockEvent({ eventId: 'evt-genesis' });
      const envelope = chain.append(event);

      expect(envelope.runEventId).toBe('evt-genesis');
    });

    it('should have a valid ISO 8601 timestamp', () => {
      const event = createMockEvent();
      const envelope = chain.append(event);

      expect(() => new Date(envelope.timestamp)).not.toThrow();
      expect(new Date(envelope.timestamp).toISOString()).toBe(envelope.timestamp);
    });

    it('should have a non-empty content hash', () => {
      const event = createMockEvent();
      const envelope = chain.append(event);

      expect(envelope.contentHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should have a non-empty HMAC signature', () => {
      const event = createMockEvent();
      const envelope = chain.append(event);

      expect(envelope.signature).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce a unique envelope ID', () => {
      const event = createMockEvent();
      const e1 = chain.append(event);
      const e2 = chain.append(createMockEvent());

      expect(e1.envelopeId).not.toBe(e2.envelopeId);
    });
  });

  // --------------------------------------------------------------------------
  // Hash chaining
  // --------------------------------------------------------------------------

  describe('hash chaining', () => {
    it('should link the second envelope to the first via contentHash', () => {
      const first = chain.append(createMockEvent());
      const second = chain.append(createMockEvent());

      expect(second.previousHash).toBe(first.contentHash);
    });

    it('should form a valid chain across multiple envelopes', () => {
      const envelopes: ProofEnvelope[] = [];
      for (let i = 0; i < 5; i++) {
        envelopes.push(chain.append(createMockEvent()));
      }

      expect(envelopes[0].previousHash).toBe('0'.repeat(64));
      for (let i = 1; i < envelopes.length; i++) {
        expect(envelopes[i].previousHash).toBe(envelopes[i - 1].contentHash);
      }
    });

    it('should produce different content hashes for different events', () => {
      const e1 = chain.append(createMockEvent({ taskId: 'task-a', reworkLines: 0 }));
      const e2 = chain.append(createMockEvent({ taskId: 'task-b', reworkLines: 99 }));

      expect(e1.contentHash).not.toBe(e2.contentHash);
    });
  });

  // --------------------------------------------------------------------------
  // Signature verification
  // --------------------------------------------------------------------------

  describe('signature verification', () => {
    it('should verify a valid envelope', () => {
      const envelope = chain.append(createMockEvent());

      expect(chain.verify(envelope)).toBe(true);
    });

    it('should reject an envelope with a tampered contentHash', () => {
      const envelope = chain.append(createMockEvent());

      // Tamper with the content hash
      const tampered: ProofEnvelope = { ...envelope, contentHash: 'f'.repeat(64) };

      expect(chain.verify(tampered)).toBe(false);
    });

    it('should reject an envelope with a tampered guidanceHash', () => {
      const envelope = chain.append(createMockEvent());

      const tampered: ProofEnvelope = { ...envelope, guidanceHash: 'tampered' };

      expect(chain.verify(tampered)).toBe(false);
    });

    it('should reject an envelope with a tampered metadata field', () => {
      const envelope = chain.append(createMockEvent(), [], [], {
        agentId: 'agent-1',
        sessionId: 'session-1',
      });

      const tampered: ProofEnvelope = {
        ...envelope,
        metadata: { ...envelope.metadata, agentId: 'attacker' },
      };

      expect(chain.verify(tampered)).toBe(false);
    });

    it('should reject an envelope signed with a different key', () => {
      const otherChain = createProofChain({ signingKey: 'other-key' });
      const event = createMockEvent();
      const envelope = otherChain.append(event);

      // Verify with the original chain (different key)
      expect(chain.verify(envelope)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Full chain verification
  // --------------------------------------------------------------------------

  describe('chain verification', () => {
    it('should verify an empty chain', () => {
      expect(chain.verifyChain()).toBe(true);
    });

    it('should verify a single-envelope chain', () => {
      chain.append(createMockEvent());

      expect(chain.verifyChain()).toBe(true);
    });

    it('should verify a multi-envelope chain', () => {
      for (let i = 0; i < 10; i++) {
        chain.append(createMockEvent());
      }

      expect(chain.verifyChain()).toBe(true);
    });

    it('should detect a broken chain when an envelope signature is tampered', () => {
      chain.append(createMockEvent());
      chain.append(createMockEvent());
      chain.append(createMockEvent());

      // Export, tamper, and reimport
      const serialized = chain.export();
      serialized.envelopes[1].signature = 'bad'.repeat(21) + 'b';

      const tamperedChain = createProofChain({ signingKey: 'test-secret-key' });
      tamperedChain.import(serialized);

      expect(tamperedChain.verifyChain()).toBe(false);
    });

    it('should detect a broken chain when previousHash is tampered', () => {
      chain.append(createMockEvent());
      chain.append(createMockEvent());

      const serialized = chain.export();
      // Tamper with the second envelope's previousHash
      serialized.envelopes[1] = {
        ...serialized.envelopes[1],
        previousHash: 'f'.repeat(64),
      };
      // Re-sign would be needed, but since we tampered the field the
      // signature itself will also fail, which is the desired behavior.

      const tamperedChain = createProofChain({ signingKey: 'test-secret-key' });
      tamperedChain.import(serialized);

      expect(tamperedChain.verifyChain()).toBe(false);
    });

    it('should detect a chain with a wrong genesis hash', () => {
      chain.append(createMockEvent());

      const serialized = chain.export();
      serialized.envelopes[0] = {
        ...serialized.envelopes[0],
        previousHash: 'a'.repeat(64),
      };

      const tamperedChain = createProofChain({ signingKey: 'test-secret-key' });
      tamperedChain.import(serialized);

      expect(tamperedChain.verifyChain()).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Tool call hashing
  // --------------------------------------------------------------------------

  describe('tool call hashing', () => {
    it('should include tool call hashes in the envelope', () => {
      const call1 = createMockToolCall({ callId: 'c1', toolName: 'Read' });
      const call2 = createMockToolCall({ callId: 'c2', toolName: 'Edit' });

      const envelope = chain.append(createMockEvent(), [call1, call2]);

      expect(Object.keys(envelope.toolCallHashes)).toHaveLength(2);
      expect(envelope.toolCallHashes['c1']).toMatch(/^[a-f0-9]{64}$/);
      expect(envelope.toolCallHashes['c2']).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce different hashes for different tool calls', () => {
      const call1 = createMockToolCall({
        callId: 'c1',
        toolName: 'Read',
        params: { file: 'a.ts' },
        result: 'content-a',
      });
      const call2 = createMockToolCall({
        callId: 'c2',
        toolName: 'Read',
        params: { file: 'b.ts' },
        result: 'content-b',
      });

      const envelope = chain.append(createMockEvent(), [call1, call2]);

      expect(envelope.toolCallHashes['c1']).not.toBe(envelope.toolCallHashes['c2']);
    });

    it('should produce the same hash for identical tool calls', () => {
      const sharedParams = { file: 'same.ts' };
      const sharedResult = { ok: true };
      const call1 = createMockToolCall({
        callId: 'c1',
        toolName: 'Read',
        params: sharedParams,
        result: sharedResult,
      });
      const call2 = createMockToolCall({
        callId: 'c2',
        toolName: 'Read',
        params: sharedParams,
        result: sharedResult,
      });

      const envelope = chain.append(createMockEvent(), [call1, call2]);

      // Same tool name + params + result => same hash
      expect(envelope.toolCallHashes['c1']).toBe(envelope.toolCallHashes['c2']);
    });

    it('should handle empty tool calls', () => {
      const envelope = chain.append(createMockEvent(), []);

      expect(Object.keys(envelope.toolCallHashes)).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Memory lineage tracking
  // --------------------------------------------------------------------------

  describe('memory lineage tracking', () => {
    it('should include memory operations in the envelope', () => {
      const ops: MemoryOperation[] = [
        createMockMemoryOp({ key: 'status', namespace: 'agent', operation: 'write' }),
        createMockMemoryOp({ key: 'config', namespace: 'system', operation: 'read' }),
      ];

      const envelope = chain.append(createMockEvent(), [], ops);

      expect(envelope.memoryLineage).toHaveLength(2);
      expect(envelope.memoryLineage[0]).toEqual({
        key: 'status',
        namespace: 'agent',
        operation: 'write',
        hash: 'a'.repeat(64),
      });
      expect(envelope.memoryLineage[1]).toEqual({
        key: 'config',
        namespace: 'system',
        operation: 'read',
        hash: 'a'.repeat(64),
      });
    });

    it('should handle all operation types', () => {
      const ops: MemoryOperation[] = [
        createMockMemoryOp({ operation: 'read', valueHash: 'r'.repeat(64) }),
        createMockMemoryOp({ operation: 'write', valueHash: 'w'.repeat(64) }),
        createMockMemoryOp({ operation: 'delete', valueHash: 'd'.repeat(64) }),
      ];

      const envelope = chain.append(createMockEvent(), [], ops);

      expect(envelope.memoryLineage[0].operation).toBe('read');
      expect(envelope.memoryLineage[0].hash).toBe('r'.repeat(64));
      expect(envelope.memoryLineage[1].operation).toBe('write');
      expect(envelope.memoryLineage[1].hash).toBe('w'.repeat(64));
      expect(envelope.memoryLineage[2].operation).toBe('delete');
      expect(envelope.memoryLineage[2].hash).toBe('d'.repeat(64));
    });

    it('should handle empty memory operations', () => {
      const envelope = chain.append(createMockEvent(), [], []);

      expect(envelope.memoryLineage).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Export / Import roundtrip
  // --------------------------------------------------------------------------

  describe('export and import', () => {
    it('should roundtrip a chain through export/import', () => {
      chain.append(createMockEvent({ taskId: 'task-1' }));
      chain.append(createMockEvent({ taskId: 'task-2' }));
      chain.append(createMockEvent({ taskId: 'task-3' }));

      const exported = chain.export();
      expect(exported.envelopes).toHaveLength(3);
      expect(exported.version).toBe(1);
      expect(exported.createdAt).toBeTruthy();

      const restored = createProofChain({ signingKey: 'test-secret-key' });
      restored.import(exported);

      expect(restored.getChainLength()).toBe(3);
      expect(restored.verifyChain()).toBe(true);
    });

    it('should preserve envelope contents through roundtrip', () => {
      const toolCalls = [createMockToolCall({ callId: 'tc-1' })];
      const memOps = [createMockMemoryOp({ key: 'k1', namespace: 'ns1' })];

      const original = chain.append(
        createMockEvent({ eventId: 'evt-rt' }),
        toolCalls,
        memOps,
        { agentId: 'agent-a', sessionId: 'sess-a' },
      );

      const exported = chain.export();
      const restored = createProofChain({ signingKey: 'test-secret-key' });
      restored.import(exported);

      const reimported = restored.getEnvelope(original.envelopeId);
      expect(reimported).toBeDefined();
      expect(reimported!.runEventId).toBe('evt-rt');
      expect(reimported!.toolCallHashes['tc-1']).toBe(original.toolCallHashes['tc-1']);
      expect(reimported!.memoryLineage).toEqual(original.memoryLineage);
      expect(reimported!.metadata.agentId).toBe('agent-a');
      expect(reimported!.signature).toBe(original.signature);
    });

    it('should reject imports with an unsupported version', () => {
      const bad: any = { envelopes: [], createdAt: new Date().toISOString(), version: 999 };

      expect(() => chain.import(bad)).toThrow(/Unsupported proof chain version/);
    });

    it('should replace existing chain on import', () => {
      chain.append(createMockEvent());
      chain.append(createMockEvent());
      expect(chain.getChainLength()).toBe(2);

      const other = createProofChain({ signingKey: 'test-secret-key' });
      other.append(createMockEvent());
      const exported = other.export();

      chain.import(exported);
      expect(chain.getChainLength()).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // Retrieval helpers
  // --------------------------------------------------------------------------

  describe('retrieval helpers', () => {
    it('getEnvelope should return undefined for unknown ID', () => {
      expect(chain.getEnvelope('nonexistent')).toBeUndefined();
    });

    it('getEnvelope should find an envelope by ID', () => {
      const envelope = chain.append(createMockEvent());
      const found = chain.getEnvelope(envelope.envelopeId);

      expect(found).toBeDefined();
      expect(found!.envelopeId).toBe(envelope.envelopeId);
    });

    it('getChainTip should return undefined for empty chain', () => {
      expect(chain.getChainTip()).toBeUndefined();
    });

    it('getChainTip should return the latest envelope', () => {
      chain.append(createMockEvent({ taskId: 'first' }));
      const last = chain.append(createMockEvent({ taskId: 'last' }));

      expect(chain.getChainTip()?.envelopeId).toBe(last.envelopeId);
    });

    it('getChainLength should return zero for empty chain', () => {
      expect(chain.getChainLength()).toBe(0);
    });

    it('getChainLength should count all envelopes', () => {
      chain.append(createMockEvent());
      chain.append(createMockEvent());
      chain.append(createMockEvent());

      expect(chain.getChainLength()).toBe(3);
    });
  });

  // --------------------------------------------------------------------------
  // Factory function
  // --------------------------------------------------------------------------

  describe('createProofChain factory', () => {
    it('should throw when no signingKey is provided', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => createProofChain({} as any)).toThrow('requires an explicit signingKey');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => createProofChain(undefined as any)).toThrow();
    });

    it('should create a ProofChain with an explicit signing key', () => {
      const chain = createProofChain({ signingKey: 'test-key' });
      const envelope = chain.append(createMockEvent());

      expect(envelope.signature).toMatch(/^[a-f0-9]{64}$/);
      expect(chain.verify(envelope)).toBe(true);
    });

    it('should create a ProofChain with a custom signing key', () => {
      const customChain = createProofChain({ signingKey: 'my-custom-key' });
      const envelope = customChain.append(createMockEvent());

      expect(customChain.verify(envelope)).toBe(true);

      // A chain with a different key should not verify the same envelope
      const otherChain = createProofChain({ signingKey: 'different-key' });
      expect(otherChain.verify(envelope)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Guidance hash propagation
  // --------------------------------------------------------------------------

  describe('guidance hash', () => {
    it('should capture the guidanceHash from the RunEvent', () => {
      const event = createMockEvent({ guidanceHash: 'policy-sha256-hash' });
      const envelope = chain.append(event);

      expect(envelope.guidanceHash).toBe('policy-sha256-hash');
    });
  });

  // --------------------------------------------------------------------------
  // Metadata
  // --------------------------------------------------------------------------

  describe('metadata', () => {
    it('should use provided metadata', () => {
      const envelope = chain.append(createMockEvent(), [], [], {
        agentId: 'coder-1',
        sessionId: 'sess-42',
        parentEnvelopeId: 'parent-env-1',
      });

      expect(envelope.metadata.agentId).toBe('coder-1');
      expect(envelope.metadata.sessionId).toBe('sess-42');
      expect(envelope.metadata.parentEnvelopeId).toBe('parent-env-1');
    });

    it('should default to unknown agent and event sessionId', () => {
      const event = createMockEvent({ sessionId: 'from-event' });
      const envelope = chain.append(event);

      expect(envelope.metadata.agentId).toBe('unknown');
      expect(envelope.metadata.sessionId).toBe('from-event');
    });

    it('should default sessionId to unknown when event has none', () => {
      const event = createMockEvent();
      delete (event as any).sessionId;
      const envelope = chain.append(event);

      expect(envelope.metadata.sessionId).toBe('unknown');
    });
  });
});
