/**
 * Proof Envelope - Cryptographic Evidence Trail
 *
 * Makes every run auditable and tamper-evident by producing a hash-chained,
 * HMAC-signed envelope for each RunEvent. Each envelope captures:
 *
 * - SHA-256 content hash of the run event
 * - Hash chain linking to the previous envelope (genesis = '0' x 64)
 * - Individual tool call hashes
 * - Memory lineage (reads/writes with value hashes)
 * - HMAC-SHA256 signature over the entire envelope body
 *
 * @module @claude-flow/guidance/proof
 */

import { createHash, createHmac, randomUUID } from 'node:crypto';
import { timingSafeEqual } from './crypto-utils.js';
import type { RunEvent } from './types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Record of a single tool invocation with its parameters and result.
 */
export interface ToolCallRecord {
  /** Unique call identifier */
  callId: string;
  /** Name of the tool invoked */
  toolName: string;
  /** Parameters passed to the tool */
  params: Record<string, unknown>;
  /** Result returned by the tool */
  result: unknown;
  /** Timestamp of the call (epoch ms) */
  timestamp: number;
  /** Duration of the call in milliseconds */
  durationMs: number;
}

/**
 * Record of a memory read, write, or delete operation.
 */
export interface MemoryOperation {
  /** Memory key */
  key: string;
  /** Memory namespace */
  namespace: string;
  /** Type of operation */
  operation: 'read' | 'write' | 'delete';
  /** SHA-256 hash of the value */
  valueHash: string;
  /** Timestamp of the operation (epoch ms) */
  timestamp: number;
}

/**
 * Entry in the memory lineage array stored inside a ProofEnvelope.
 */
export interface MemoryLineageEntry {
  key: string;
  namespace: string;
  operation: 'read' | 'write' | 'delete';
  hash: string;
}

/**
 * Metadata attached to every proof envelope.
 */
export interface ProofEnvelopeMetadata {
  agentId: string;
  sessionId: string;
  parentEnvelopeId?: string;
}

/**
 * A cryptographically signed, hash-chained proof envelope.
 */
export interface ProofEnvelope {
  /** Unique envelope identifier */
  envelopeId: string;
  /** Reference to the RunEvent this envelope covers */
  runEventId: string;
  /** ISO 8601 timestamp of envelope creation */
  timestamp: string;
  /** SHA-256 hash of the full RunEvent */
  contentHash: string;
  /** Hash of the previous envelope in the chain (genesis = '0'.repeat(64)) */
  previousHash: string;
  /** Map of tool call ID to SHA-256(toolName + params + result) */
  toolCallHashes: Record<string, string>;
  /** SHA-256 hash of the policy bundle used */
  guidanceHash: string;
  /** Lineage of memory operations during the run */
  memoryLineage: MemoryLineageEntry[];
  /** HMAC-SHA256 signature of the envelope content */
  signature: string;
  /** Contextual metadata */
  metadata: ProofEnvelopeMetadata;
}

/**
 * Serializable chain representation for export/import.
 */
export interface SerializedProofChain {
  envelopes: ProofEnvelope[];
  createdAt: string;
  version: number;
}

// ============================================================================
// Constants
// ============================================================================

const GENESIS_HASH = '0'.repeat(64);
const SERIALIZATION_VERSION = 1;

// ============================================================================
// ProofChain
// ============================================================================

/**
 * A tamper-evident, hash-chained sequence of ProofEnvelopes.
 *
 * Each envelope links to the previous one via `previousHash`, forming
 * a blockchain-like structure. Every envelope is HMAC-signed so any
 * modification to the chain can be detected.
 */
export class ProofChain {
  private envelopes: ProofEnvelope[] = [];
  private readonly signingKey: string;

  constructor(signingKey: string) {
    if (!signingKey) {
      throw new Error('ProofChain requires an explicit signingKey — hardcoded defaults are not secure');
    }
    this.signingKey = signingKey;
  }

  /**
   * Append a new ProofEnvelope to the chain.
   *
   * @param runEvent - The RunEvent to wrap
   * @param toolCalls - Tool call records from the run
   * @param memoryOps - Memory operations from the run
   * @param metadata - Optional metadata overrides
   * @returns The newly created and signed ProofEnvelope
   */
  append(
    runEvent: RunEvent,
    toolCalls: ToolCallRecord[] = [],
    memoryOps: MemoryOperation[] = [],
    metadata?: Partial<ProofEnvelopeMetadata>,
  ): ProofEnvelope {
    const previousHash = this.envelopes.length > 0
      ? this.envelopes[this.envelopes.length - 1].contentHash
      : GENESIS_HASH;

    const contentHash = this.computeContentHash(runEvent);

    const toolCallHashes: Record<string, string> = {};
    for (const call of toolCalls) {
      toolCallHashes[call.callId] = this.computeToolCallHash(call);
    }

    const memoryLineage: MemoryLineageEntry[] = memoryOps.map(op => ({
      key: op.key,
      namespace: op.namespace,
      operation: op.operation,
      hash: op.valueHash,
    }));

    const envelope: ProofEnvelope = {
      envelopeId: randomUUID(),
      runEventId: runEvent.eventId,
      timestamp: new Date().toISOString(),
      contentHash,
      previousHash,
      toolCallHashes,
      guidanceHash: runEvent.guidanceHash,
      memoryLineage,
      signature: '', // placeholder; signed below
      metadata: {
        agentId: metadata?.agentId ?? 'unknown',
        sessionId: metadata?.sessionId ?? runEvent.sessionId ?? 'unknown',
        parentEnvelopeId: metadata?.parentEnvelopeId,
      },
    };

    envelope.signature = this.signEnvelope(envelope);
    this.envelopes.push(envelope);

    return envelope;
  }

  /**
   * Verify a single envelope's HMAC signature and hash chain link.
   *
   * @returns true if the signature is valid and the previousHash is correct
   */
  verify(envelope: ProofEnvelope): boolean {
    // Verify HMAC signature
    const expectedSignature = this.signEnvelope(envelope);
    if (!timingSafeEqual(envelope.signature, expectedSignature)) {
      return false;
    }

    // Verify hash chain linkage
    const index = this.envelopes.findIndex(e => e.envelopeId === envelope.envelopeId);
    if (index === -1) {
      // Envelope not in this chain; verify signature only
      return true;
    }

    if (index === 0) {
      return envelope.previousHash === GENESIS_HASH;
    }

    return envelope.previousHash === this.envelopes[index - 1].contentHash;
  }

  /**
   * Verify the entire chain from genesis to tip.
   *
   * Checks that every envelope:
   * 1. Has a valid HMAC signature
   * 2. Links correctly to the previous envelope's contentHash
   *
   * @returns true if the full chain is intact
   */
  verifyChain(): boolean {
    if (this.envelopes.length === 0) {
      return true;
    }

    for (let i = 0; i < this.envelopes.length; i++) {
      const envelope = this.envelopes[i];

      // Verify signature (constant-time comparison)
      const expectedSignature = this.signEnvelope(envelope);
      if (!timingSafeEqual(envelope.signature, expectedSignature)) {
        return false;
      }

      // Verify hash chain
      if (i === 0) {
        if (envelope.previousHash !== GENESIS_HASH) {
          return false;
        }
      } else {
        if (envelope.previousHash !== this.envelopes[i - 1].contentHash) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Retrieve an envelope by its ID.
   */
  getEnvelope(id: string): ProofEnvelope | undefined {
    return this.envelopes.find(e => e.envelopeId === id);
  }

  /**
   * Get the most recent envelope in the chain.
   */
  getChainTip(): ProofEnvelope | undefined {
    return this.envelopes.length > 0
      ? this.envelopes[this.envelopes.length - 1]
      : undefined;
  }

  /**
   * Get the number of envelopes in the chain.
   */
  getChainLength(): number {
    return this.envelopes.length;
  }

  /**
   * Export the chain as a serializable object.
   */
  export(): SerializedProofChain {
    return {
      envelopes: this.envelopes.map(e => ({ ...e })),
      createdAt: new Date().toISOString(),
      version: SERIALIZATION_VERSION,
    };
  }

  /**
   * Restore the chain from a previously exported object.
   *
   * Replaces the current chain contents entirely.
   */
  import(data: SerializedProofChain): void {
    if (data.version !== SERIALIZATION_VERSION) {
      throw new Error(
        `Unsupported proof chain version: ${data.version} (expected ${SERIALIZATION_VERSION})`,
      );
    }
    this.envelopes = data.envelopes.map(e => ({ ...e }));
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  /**
   * Compute the SHA-256 content hash of a RunEvent.
   */
  private computeContentHash(event: RunEvent): string {
    const payload = JSON.stringify(event, Object.keys(event).sort());
    return createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Compute the SHA-256 hash of a single tool call.
   *
   * Hash = SHA-256(toolName + JSON(params) + JSON(result))
   */
  private computeToolCallHash(call: ToolCallRecord): string {
    const payload = call.toolName
      + JSON.stringify(call.params)
      + JSON.stringify(call.result);
    return createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Produce the HMAC-SHA256 signature for an envelope.
   *
   * The signature covers every field except `signature` itself.
   */
  private signEnvelope(envelope: ProofEnvelope): string {
    const body = {
      envelopeId: envelope.envelopeId,
      runEventId: envelope.runEventId,
      timestamp: envelope.timestamp,
      contentHash: envelope.contentHash,
      previousHash: envelope.previousHash,
      toolCallHashes: envelope.toolCallHashes,
      guidanceHash: envelope.guidanceHash,
      memoryLineage: envelope.memoryLineage,
      metadata: envelope.metadata,
    };
    const payload = JSON.stringify(body);
    return createHmac('sha256', this.signingKey).update(payload).digest('hex');
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a new ProofChain instance.
 *
 * @param config - Configuration with a required `signingKey` for HMAC signing.
 *   Callers that previously relied on the optional signature must now provide
 *   an explicit key (see ADR-G026).
 * @returns A fresh ProofChain
 */
export function createProofChain(config: { signingKey: string }): ProofChain {
  return new ProofChain(config.signingKey);
}
