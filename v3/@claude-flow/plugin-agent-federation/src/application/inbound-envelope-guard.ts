import type { AgentMessage } from '../transport/midstream-aware-loader.js';

export const INBOUND_ENVELOPE_LIMITS = Object.freeze({
  maxAgeMs: 5 * 60_000,
  futureSkewMs: 30_000,
  maxIdLength: 256,
  maxMessagesPerPeer: 1024,
  maxPeers: 256,
  maxMessages: 8192,
});

export type InboundEnvelopeRejection =
  | 'INVALID_ENVELOPE'
  | 'WRONG_RECIPIENT'
  | 'MESSAGE_EXPIRED'
  | 'MESSAGE_FROM_FUTURE'
  | 'MESSAGE_REPLAYED'
  | 'REPLAY_CACHE_FULL';

/** One lifecycle's bounded replay history; call only after signature and policy checks. */
export class InboundEnvelopeGuard {
  private readonly peers = new Map<string, Map<string, number>>();
  private messages = 0;

  constructor(
    private readonly localNodeId: string,
    private readonly now: () => number = Date.now,
  ) {
    if (!this.validId(localNodeId)) throw new TypeError('Invalid local federation node id');
  }

  /** Synchronously check and reserve a signed envelope before any awaited delivery side effect. */
  checkAndRecord(message: AgentMessage, sourceNodeId: string): InboundEnvelopeRejection | null {
    const envelope = message.payload as Record<string, unknown> | null;
    const metadata = message.metadata;
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || !metadata) {
      return 'INVALID_ENVELOPE';
    }
    if (metadata.targetNodeId !== this.localNodeId || envelope.targetNodeId !== this.localNodeId) {
      return 'WRONG_RECIPIENT';
    }
    if (
      !this.validId(message.id) || !this.validId(sourceNodeId) ||
      envelope.envelopeId !== message.id || envelope.messageType !== message.type ||
      envelope.sourceNodeId !== sourceNodeId || metadata.sourceNodeId !== sourceNodeId ||
      !this.validId(envelope.sessionId) || envelope.sessionId !== metadata.sessionId ||
      typeof envelope.timestamp !== 'string'
    ) return 'INVALID_ENVELOPE';

    const timestamp = Date.parse(envelope.timestamp);
    const now = this.now();
    if (!Number.isFinite(timestamp) || !Number.isFinite(now)) return 'INVALID_ENVELOPE';
    if (now - timestamp > INBOUND_ENVELOPE_LIMITS.maxAgeMs) return 'MESSAGE_EXPIRED';
    if (timestamp - now > INBOUND_ENVELOPE_LIMITS.futureSkewMs) return 'MESSAGE_FROM_FUTURE';

    let seen = this.peers.get(sourceNodeId);
    if (seen) this.prune(seen, now);
    if (seen?.has(message.id)) return 'MESSAGE_REPLAYED';
    if (seen && seen.size >= INBOUND_ENVELOPE_LIMITS.maxMessagesPerPeer) return 'REPLAY_CACHE_FULL';

    if (
      this.messages >= INBOUND_ENVELOPE_LIMITS.maxMessages ||
      (!seen && this.peers.size >= INBOUND_ENVELOPE_LIMITS.maxPeers)
    ) {
      for (const [peer, entries] of this.peers) {
        this.prune(entries, now);
        if (entries.size === 0) this.peers.delete(peer);
      }
      seen = this.peers.get(sourceNodeId);
    }
    if (
      this.messages >= INBOUND_ENVELOPE_LIMITS.maxMessages ||
      (!seen && this.peers.size >= INBOUND_ENVELOPE_LIMITS.maxPeers)
    ) return 'REPLAY_CACHE_FULL';

    if (!seen) {
      seen = new Map();
      this.peers.set(sourceNodeId, seen);
    }
    // A future-dated message stays fresh past receipt+maxAge; retain its ID that long too.
    seen.set(message.id, timestamp + INBOUND_ENVELOPE_LIMITS.maxAgeMs);
    this.messages++;
    return null;
  }

  private validId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= INBOUND_ENVELOPE_LIMITS.maxIdLength;
  }

  private prune(entries: Map<string, number>, now: number): void {
    for (const [id, expiresAt] of entries) {
      if (expiresAt < now) {
        entries.delete(id);
        this.messages--;
      }
    }
  }
}
