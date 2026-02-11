/**
 * Truth Anchor System
 *
 * Immutable, externally-signed facts that anchor the system to reality
 * beyond tool outputs and internal memory.
 *
 * A Truth Anchor is a fact that:
 * - Is immutable once recorded (cannot be overwritten or decayed)
 * - Is externally signed (by a human, hardware sensor, or external authority)
 * - Supersedes any internal belief that contradicts it
 * - Can be referenced but never mutated
 * - Has a verifiable signature chain
 *
 * TruthAnchorStore:
 * - Creates and signs new truth anchors with HMAC-SHA256
 * - Append-only storage (anchors are never mutated after creation)
 * - Retrieval by ID, time range, kind, attester, or tags
 * - Signature verification for individual anchors or the full store
 * - Supersession chain: new anchors can declare they supersede old ones
 * - Export/import for persistence and transfer
 * - Max 50,000 anchors with LRU eviction of expired ones only
 *
 * TruthResolver:
 * - Resolves conflicts between internal beliefs and truth anchors
 * - Memory conflict resolution (truth anchor always wins)
 * - Decision conflict resolution (constrains proposed actions)
 * - Topic-based ground truth retrieval with fuzzy tag matching
 *
 * @module @claude-flow/guidance/truth-anchors
 */

import { createHmac, randomUUID } from 'node:crypto';

// ============================================================================
// Types
// ============================================================================

/**
 * The kind of external source that attested to a truth anchor.
 */
export type TruthSourceKind =
  | 'human-attestation'
  | 'hardware-signal'
  | 'regulatory-input'
  | 'external-observation'
  | 'signed-document'
  | 'consensus-result';

/**
 * An immutable, externally-signed fact anchored to the system.
 *
 * Once created, a TruthAnchor is never mutated. It can only be
 * superseded by a new anchor that references the old one.
 */
export interface TruthAnchor {
  /** Unique identifier (UUID v4) */
  id: string;
  /** The kind of external source that attested to this fact */
  kind: TruthSourceKind;
  /** The fact being asserted, in natural language */
  claim: string;
  /** Supporting data or evidence for the claim */
  evidence: string;
  /** Who or what signed this anchor (human ID, sensor ID, authority ID) */
  attesterId: string;
  /** HMAC-SHA256 signature over the canonical anchor content */
  signature: string;
  /** Unix timestamp (ms) when the anchor was created */
  timestamp: number;
  /** Unix timestamp (ms) when the fact became true */
  validFrom: number;
  /** Unix timestamp (ms) when the fact expires, or null for indefinite */
  validUntil: number | null;
  /** IDs of anchors that this anchor supersedes */
  supersedes: string[];
  /** Searchable tags for topic-based retrieval */
  tags: string[];
  /** Arbitrary metadata attached to the anchor */
  metadata: Record<string, unknown>;
}

/**
 * Configuration for the TruthAnchorStore.
 */
export interface TruthAnchorConfig {
  /** HMAC-SHA256 signing key */
  signingKey: string;
  /** Maximum number of anchors to retain (default 50,000) */
  maxAnchors: number;
}

/**
 * Parameters for creating a new truth anchor.
 */
export interface AnchorParams {
  kind: TruthSourceKind;
  claim: string;
  evidence: string;
  attesterId: string;
  validFrom?: number;
  validUntil?: number | null;
  supersedes?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Query options for filtering truth anchors.
 */
export interface TruthAnchorQuery {
  /** Filter by source kind */
  kind?: TruthSourceKind;
  /** Filter by attester ID */
  attesterId?: string;
  /** Filter by tags (anchor must have at least one matching tag) */
  tags?: string[];
  /** Only return anchors valid at this timestamp */
  validAt?: number;
}

/**
 * Result of verifying all anchors in the store.
 */
export interface VerifyAllResult {
  /** Number of anchors with valid signatures */
  valid: number;
  /** IDs of anchors with invalid signatures */
  invalid: string[];
}

/**
 * Result of resolving a conflict between an internal belief and truth anchors.
 */
export interface ConflictResolution {
  /** Whether a truth anchor overrides the internal belief */
  truthWins: boolean;
  /** The truth anchor that overrides, if any */
  anchor?: TruthAnchor;
  /** Human-readable explanation of the resolution */
  reason: string;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: TruthAnchorConfig = {
  signingKey: '',
  maxAnchors: 50_000,
};

// ============================================================================
// Signing Helpers
// ============================================================================

/**
 * Compute the canonical string representation of an anchor for signing.
 *
 * Deterministic ordering ensures the same anchor always produces
 * the same signature regardless of property insertion order.
 */
function canonicalize(anchor: Omit<TruthAnchor, 'signature'>): string {
  return [
    anchor.id,
    anchor.kind,
    anchor.claim,
    anchor.evidence,
    anchor.attesterId,
    String(anchor.timestamp),
    String(anchor.validFrom),
    String(anchor.validUntil ?? 'null'),
    anchor.supersedes.join(','),
    anchor.tags.join(','),
    JSON.stringify(anchor.metadata),
  ].join('|');
}

/**
 * Produce an HMAC-SHA256 signature for the given data using the provided key.
 */
function sign(data: string, key: string): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

// ============================================================================
// Truth Anchor Store
// ============================================================================

/**
 * Append-only store for truth anchors.
 *
 * Anchors are immutable once created. The store provides signing,
 * verification, querying, supersession, and capacity management
 * with LRU eviction of expired anchors only.
 */
export class TruthAnchorStore {
  private readonly config: TruthAnchorConfig;
  private readonly anchors: TruthAnchor[] = [];
  private readonly indexById: Map<string, number> = new Map();

  constructor(config: Partial<TruthAnchorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (!this.config.signingKey) {
      throw new Error(
        'TruthAnchorStore requires a signingKey in config. ' +
        'Anchors cannot be created without a signing key.',
      );
    }
  }

  /**
   * Create and sign a new truth anchor.
   *
   * The anchor is appended to the store and can never be mutated.
   * If the store exceeds capacity, expired anchors are evicted
   * starting from the oldest.
   */
  anchor(params: AnchorParams): TruthAnchor {
    const now = Date.now();

    const partial: Omit<TruthAnchor, 'signature'> = {
      id: randomUUID(),
      kind: params.kind,
      claim: params.claim,
      evidence: params.evidence,
      attesterId: params.attesterId,
      timestamp: now,
      validFrom: params.validFrom ?? now,
      validUntil: params.validUntil ?? null,
      supersedes: params.supersedes ?? [],
      tags: params.tags ?? [],
      metadata: params.metadata ?? {},
    };

    const signature = sign(canonicalize(partial), this.config.signingKey);

    const truthAnchor: TruthAnchor = {
      ...partial,
      signature,
    };

    // Append (never mutate existing entries)
    this.anchors.push(truthAnchor);
    this.indexById.set(truthAnchor.id, this.anchors.length - 1);

    // Enforce capacity by evicting expired anchors
    this.enforceCapacity(now);

    return truthAnchor;
  }

  /**
   * Retrieve a truth anchor by its ID.
   *
   * Returns undefined if the anchor does not exist.
   */
  get(id: string): TruthAnchor | undefined {
    const index = this.indexById.get(id);
    if (index === undefined) return undefined;
    return this.anchors[index];
  }

  /**
   * Get all anchors that are valid at the given timestamp.
   *
   * An anchor is active when:
   * - `validFrom <= timestamp`
   * - `validUntil` is null (indefinite) or `validUntil > timestamp`
   *
   * Defaults to the current time if no timestamp is provided.
   */
  getActive(timestamp?: number): TruthAnchor[] {
    const ts = timestamp ?? Date.now();
    return this.anchors.filter(a => isActive(a, ts));
  }

  /**
   * Query anchors with optional filters.
   *
   * All provided filters are ANDed together. An anchor must match
   * every specified filter to be included in the result.
   */
  query(opts: TruthAnchorQuery): TruthAnchor[] {
    return this.anchors.filter(a => {
      if (opts.kind !== undefined && a.kind !== opts.kind) return false;
      if (opts.attesterId !== undefined && a.attesterId !== opts.attesterId) return false;
      if (opts.tags !== undefined && opts.tags.length > 0) {
        const hasMatch = opts.tags.some(tag => a.tags.includes(tag));
        if (!hasMatch) return false;
      }
      if (opts.validAt !== undefined && !isActive(a, opts.validAt)) return false;
      return true;
    });
  }

  /**
   * Verify the HMAC-SHA256 signature of a single anchor.
   *
   * Recomputes the signature from the anchor's content and compares
   * it to the stored signature. Returns true if they match.
   */
  verify(id: string): boolean {
    const anchor = this.get(id);
    if (!anchor) return false;

    const { signature, ...rest } = anchor;
    const expected = sign(canonicalize(rest), this.config.signingKey);
    return timingSafeEqual(signature, expected);
  }

  /**
   * Verify all anchors in the store.
   *
   * Returns a summary with the count of valid anchors and the
   * IDs of any anchors whose signatures do not match.
   */
  verifyAll(): VerifyAllResult {
    let valid = 0;
    const invalid: string[] = [];

    for (const anchor of this.anchors) {
      const { signature, ...rest } = anchor;
      const expected = sign(canonicalize(rest), this.config.signingKey);

      if (timingSafeEqual(signature, expected)) {
        valid++;
      } else {
        invalid.push(anchor.id);
      }
    }

    return { valid, invalid };
  }

  /**
   * Create a new anchor that supersedes an existing one.
   *
   * The old anchor remains in the store (immutable) but the new
   * anchor's `supersedes` array includes the old anchor's ID.
   * This creates a verifiable supersession chain.
   *
   * Throws if the old anchor ID does not exist.
   */
  supersede(oldId: string, params: AnchorParams): TruthAnchor {
    const old = this.get(oldId);
    if (!old) {
      throw new Error(`Cannot supersede: anchor "${oldId}" not found`);
    }

    const supersedes = [...(params.supersedes ?? [])];
    if (!supersedes.includes(oldId)) {
      supersedes.push(oldId);
    }

    return this.anchor({
      ...params,
      supersedes,
    });
  }

  /**
   * Resolve a claim against an internal belief.
   *
   * Searches for active truth anchors whose claim matches the
   * provided claim text. If a matching truth anchor exists and
   * is currently valid, it wins over the internal belief.
   *
   * Returns the truth anchor if it exists, otherwise returns
   * undefined (meaning the internal belief stands).
   */
  resolve(
    claim: string,
    _internalBelief: string,
  ): TruthAnchor | undefined {
    const now = Date.now();
    const normalizedClaim = claim.toLowerCase().trim();

    // Find active anchors whose claim matches
    for (const anchor of this.anchors) {
      if (!isActive(anchor, now)) continue;
      if (anchor.claim.toLowerCase().trim() === normalizedClaim) {
        return anchor;
      }
    }

    return undefined;
  }

  /**
   * Export all anchors for persistence or transfer.
   *
   * Returns a shallow copy of the anchor array. The individual
   * anchor objects are returned as-is since they are immutable.
   */
  exportAnchors(): TruthAnchor[] {
    return [...this.anchors];
  }

  /**
   * Import anchors from an external source.
   *
   * Imported anchors are appended to the store. Duplicate IDs
   * (anchors already in the store) are silently skipped.
   * Capacity enforcement runs after import.
   */
  importAnchors(anchors: TruthAnchor[]): void {
    const now = Date.now();

    for (const anchor of anchors) {
      // Skip duplicates
      if (this.indexById.has(anchor.id)) continue;

      this.anchors.push(anchor);
      this.indexById.set(anchor.id, this.anchors.length - 1);
    }

    this.enforceCapacity(now);
  }

  /**
   * Get the total number of anchors in the store.
   */
  get size(): number {
    return this.anchors.length;
  }

  // ===== Private =====

  /**
   * Enforce the maximum anchor capacity.
   *
   * Only expired anchors are evicted, starting from the oldest.
   * If no expired anchors can be evicted and the store is still
   * over capacity, the oldest expired anchors are removed first.
   * Active (non-expired) anchors are never evicted.
   */
  private enforceCapacity(now: number): void {
    if (this.anchors.length <= this.config.maxAnchors) return;

    // Collect indices of expired anchors (oldest first, array is append-only)
    const expiredIndices: number[] = [];
    for (let i = 0; i < this.anchors.length; i++) {
      const a = this.anchors[i];
      if (a.validUntil !== null && a.validUntil <= now) {
        expiredIndices.push(i);
      }
    }

    // Determine how many we need to evict
    const excess = this.anchors.length - this.config.maxAnchors;
    const toEvict = Math.min(excess, expiredIndices.length);

    if (toEvict <= 0) return;

    // Build a set of indices to remove (oldest expired first)
    const removeSet = new Set(expiredIndices.slice(0, toEvict));

    // Rebuild the array and index, preserving order
    const surviving: TruthAnchor[] = [];
    this.indexById.clear();

    for (let i = 0; i < this.anchors.length; i++) {
      if (removeSet.has(i)) continue;
      this.indexById.set(this.anchors[i].id, surviving.length);
      surviving.push(this.anchors[i]);
    }

    // Replace contents (splice to preserve the same array reference)
    this.anchors.length = 0;
    for (const a of surviving) {
      this.anchors.push(a);
    }
  }
}

// ============================================================================
// Truth Resolver
// ============================================================================

/**
 * Resolves conflicts between internal system beliefs and externally
 * anchored truth.
 *
 * The fundamental principle: truth anchors always win. If a valid,
 * active truth anchor contradicts an internal belief, the anchor
 * takes precedence.
 */
export class TruthResolver {
  private readonly store: TruthAnchorStore;

  constructor(store: TruthAnchorStore) {
    this.store = store;
  }

  /**
   * Check if any active truth anchor contradicts a memory value.
   *
   * Searches by namespace and key as tags, and by the memory value
   * as a claim. If a truth anchor exists that covers the same topic,
   * it wins over the internal memory.
   */
  resolveMemoryConflict(
    memoryKey: string,
    memoryValue: string,
    namespace: string,
  ): ConflictResolution {
    const now = Date.now();
    const active = this.store.getActive(now);

    // Search for anchors tagged with the namespace or memory key
    const normalizedKey = memoryKey.toLowerCase().trim();
    const normalizedNs = namespace.toLowerCase().trim();
    const normalizedValue = memoryValue.toLowerCase().trim();

    for (const anchor of active) {
      const lowerTags = anchor.tags.map(t => t.toLowerCase());

      // Check if the anchor is relevant to this memory entry
      const tagMatch =
        lowerTags.includes(normalizedKey) ||
        lowerTags.includes(normalizedNs) ||
        lowerTags.includes(`${normalizedNs}:${normalizedKey}`);

      if (!tagMatch) continue;

      // Check if the anchor's claim contradicts the memory value
      const anchorClaim = anchor.claim.toLowerCase().trim();
      if (anchorClaim !== normalizedValue) {
        return {
          truthWins: true,
          anchor,
          reason:
            `Truth anchor "${anchor.id}" (${anchor.kind}) contradicts memory ` +
            `"${namespace}:${memoryKey}". Anchor claim: "${anchor.claim}" ` +
            `supersedes internal value: "${memoryValue}".`,
        };
      }
    }

    return {
      truthWins: false,
      reason:
        `No active truth anchor contradicts memory "${namespace}:${memoryKey}". ` +
        `Internal belief stands.`,
    };
  }

  /**
   * Check if any active truth anchor constrains a proposed action.
   *
   * Searches for anchors whose claims or tags relate to the proposed
   * action and its context. Returns a conflict resolution indicating
   * whether the action is constrained.
   */
  resolveDecisionConflict(
    proposedAction: string,
    context: Record<string, unknown>,
  ): ConflictResolution {
    const now = Date.now();
    const active = this.store.getActive(now);

    const normalizedAction = proposedAction.toLowerCase().trim();
    const contextKeys = Object.keys(context).map(k => k.toLowerCase());

    for (const anchor of active) {
      const lowerTags = anchor.tags.map(t => t.toLowerCase());
      const lowerClaim = anchor.claim.toLowerCase();

      // Check if the anchor is relevant: tags intersect with context keys
      // or the action text appears in the claim
      const tagOverlap = lowerTags.some(
        t => contextKeys.includes(t) || normalizedAction.includes(t),
      );
      const claimRelevance =
        lowerClaim.includes(normalizedAction) ||
        normalizedAction.includes(lowerClaim);

      if (!tagOverlap && !claimRelevance) continue;

      // The anchor is relevant -- it constrains this action
      return {
        truthWins: true,
        anchor,
        reason:
          `Truth anchor "${anchor.id}" (${anchor.kind}) constrains the ` +
          `proposed action "${proposedAction}". Anchor claim: "${anchor.claim}". ` +
          `Attested by: "${anchor.attesterId}".`,
      };
    }

    return {
      truthWins: false,
      reason:
        `No active truth anchor constrains the proposed action ` +
        `"${proposedAction}". Action may proceed.`,
    };
  }

  /**
   * Get all active truth anchors relevant to a topic.
   *
   * Uses fuzzy tag matching: a tag matches the topic if either
   * the tag contains the topic or the topic contains the tag
   * (case-insensitive). Also matches against the claim text.
   */
  getGroundTruth(topic: string): TruthAnchor[] {
    const now = Date.now();
    const active = this.store.getActive(now);
    const normalizedTopic = topic.toLowerCase().trim();

    return active.filter(anchor => {
      // Fuzzy tag match
      const tagMatch = anchor.tags.some(tag => {
        const lowerTag = tag.toLowerCase();
        return lowerTag.includes(normalizedTopic) || normalizedTopic.includes(lowerTag);
      });

      // Claim text match
      const claimMatch = anchor.claim.toLowerCase().includes(normalizedTopic);

      return tagMatch || claimMatch;
    });
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check whether a truth anchor is active at a given timestamp.
 */
function isActive(anchor: TruthAnchor, timestamp: number): boolean {
  if (anchor.validFrom > timestamp) return false;
  if (anchor.validUntil !== null && anchor.validUntil <= timestamp) return false;
  return true;
}

/**
 * Constant-time string comparison to prevent timing attacks on signatures.
 *
 * Compares two hex strings character by character, accumulating
 * differences without short-circuiting.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return mismatch === 0;
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a TruthAnchorStore with the given configuration.
 *
 * @param config - Must include `signingKey`. `maxAnchors` defaults to 50,000.
 */
export function createTruthAnchorStore(
  config?: Partial<TruthAnchorConfig>,
): TruthAnchorStore {
  return new TruthAnchorStore(config);
}

/**
 * Create a TruthResolver backed by the given store.
 */
export function createTruthResolver(store: TruthAnchorStore): TruthResolver {
  return new TruthResolver(store);
}
