export type FederationMessageType =
  | 'task-assignment'
  | 'memory-query'
  | 'memory-response'
  | 'context-share'
  | 'status-broadcast'
  | 'trust-change'
  | 'topology-change'
  | 'agent-spawn'
  | 'heartbeat'
  | 'challenge'
  | 'challenge-response'
  | 'handshake-init'
  | 'handshake-accept'
  | 'handshake-reject'
  | 'session-terminate'
  // ADR-101 Component C: cross-node claims operations
  | 'claim-event'      // gossip a ClaimDomainEvent across the federation
  | 'agent-handoff';   // request to transfer ownership of a claim to a remote agent

export type PIIScanAction = 'pass' | 'redact' | 'hash' | 'block';

export interface PIIScanResult {
  readonly scanned: boolean;
  readonly piiFound: boolean;
  readonly detections: readonly PIIScanDetection[];
  readonly actionsApplied: readonly PIIScanAction[];
  readonly scanDurationMs: number;
}

export interface PIIScanDetection {
  readonly type: string;
  readonly action: PIIScanAction;
  readonly confidence: number;
}

export interface FederationEnvelopeProps<T = unknown> {
  readonly envelopeId: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly sessionId: string;
  readonly messageType: FederationMessageType;
  readonly payload: T;
  readonly timestamp: Date;
  readonly nonce: string;
  readonly hmacSignature: string;
  readonly piiScanResult: PIIScanResult;
}

export class FederationEnvelope<T = unknown> {
  readonly envelopeId: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly sessionId: string;
  readonly messageType: FederationMessageType;
  readonly payload: T;
  readonly timestamp: Date;
  readonly nonce: string;
  readonly hmacSignature: string;
  readonly piiScanResult: PIIScanResult;

  constructor(props: FederationEnvelopeProps<T>) {
    this.envelopeId = props.envelopeId;
    this.sourceNodeId = props.sourceNodeId;
    this.targetNodeId = props.targetNodeId;
    this.sessionId = props.sessionId;
    this.messageType = props.messageType;
    this.payload = props.payload;
    this.timestamp = props.timestamp;
    this.nonce = props.nonce;
    this.hmacSignature = props.hmacSignature;
    this.piiScanResult = props.piiScanResult;
  }

  isExpired(maxAgeMs: number): boolean {
    return Date.now() - this.timestamp.getTime() > maxAgeMs;
  }

  toJSON(): Record<string, unknown> {
    return {
      envelopeId: this.envelopeId,
      sourceNodeId: this.sourceNodeId,
      targetNodeId: this.targetNodeId,
      sessionId: this.sessionId,
      messageType: this.messageType,
      payload: this.payload,
      timestamp: this.timestamp.toISOString(),
      nonce: this.nonce,
      hmacSignature: this.hmacSignature,
      piiScanResult: this.piiScanResult,
    };
  }

  toSignablePayload(): string {
    return JSON.stringify({
      envelopeId: this.envelopeId,
      sourceNodeId: this.sourceNodeId,
      targetNodeId: this.targetNodeId,
      sessionId: this.sessionId,
      messageType: this.messageType,
      payload: this.payload,
      timestamp: this.timestamp.toISOString(),
      nonce: this.nonce,
    });
  }

  /**
   * The JSON projection the transport sends and the receiver reconstructs.
   *
   * Use this when canonicalizing for signing. The JCS canonicalizer rejects a
   * class prototype, a `Date` and `undefined` values, all of which disappear in
   * the wire round trip; signing the class instance instead throws before the
   * message reaches the transport (#5153).
   */
  toWireObject(): Record<string, unknown> {
    return JSON.parse(JSON.stringify(this)) as Record<string, unknown>;
  }

  static emptyScanResult(): PIIScanResult {
    return {
      scanned: false,
      piiFound: false,
      detections: [],
      actionsApplied: [],
      scanDurationMs: 0,
    };
  }
}

export const CONSENSUS_REQUIRED_TYPES: ReadonlySet<FederationMessageType> = new Set([
  'trust-change',
  'topology-change',
  'agent-spawn',
  // ADR-101 Component C: handoffs cross trust boundaries — optionally
  // require quorum from validators in high-trust deployments.
  'agent-handoff',
]);
