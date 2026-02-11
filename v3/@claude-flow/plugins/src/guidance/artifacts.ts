/**
 * Artifact Ledger - Signed, Versioned Production Outputs
 *
 * Every production output (code, reports, datasets, memory deltas) is recorded
 * in a tamper-evident ledger. Each artifact captures:
 *
 * - SHA-256 content hash for integrity verification
 * - HMAC-SHA256 signature over the artifact envelope
 * - Full lineage tracking (parent artifacts, source traces, tool calls, memory reads)
 * - Multi-dimensional search (by kind, run, cell, tags, time range)
 * - Export/import for portability and replay
 *
 * @module @claude-flow/guidance/artifacts
 */

import { createHash, createHmac, randomUUID } from 'node:crypto';

// ============================================================================
// Types
// ============================================================================

/**
 * Classification of artifact output types.
 */
export type ArtifactKind =
  | 'code'
  | 'report'
  | 'dataset'
  | 'model-output'
  | 'memory-delta'
  | 'config'
  | 'trace-export'
  | 'checkpoint';

/**
 * Tracks where an artifact came from - parent artifacts, source runs,
 * tool calls, and memory reads that contributed to its creation.
 */
export interface ArtifactLineage {
  /** Artifact IDs this artifact was derived from */
  parentArtifacts: string[];
  /** Run ID that produced this artifact */
  sourceRunId: string;
  /** Proof envelope ID linking to the cryptographic evidence trail */
  sourceTraceRef: string;
  /** Tool call IDs that contributed to producing this artifact */
  toolCallIds: string[];
  /** Memory keys that were consulted during production */
  memoryReads: string[];
}

/**
 * A signed, versioned production output with full lineage.
 */
export interface Artifact {
  /** Unique artifact identifier (UUID) */
  artifactId: string;
  /** Run ID that produced this artifact */
  runId: string;
  /** Agent cell that produced this artifact */
  cellId: string;
  /** Tenant that owns this artifact */
  tenantId: string;
  /** Classification of the artifact */
  kind: ArtifactKind;
  /** Human-readable name */
  name: string;
  /** Description of what this artifact contains */
  description: string;
  /** SHA-256 hash of the content */
  contentHash: string;
  /** Size of the content in bytes */
  contentSize: number;
  /** The actual artifact data (string, object, Buffer reference, etc.) */
  content: unknown;
  /** Arbitrary metadata */
  metadata: Record<string, unknown>;
  /** Provenance chain linking this artifact to its sources */
  lineage: ArtifactLineage;
  /** HMAC-SHA256 signature of the artifact envelope */
  signature: string;
  /** Creation timestamp (epoch ms) */
  createdAt: number;
  /** Searchable tags */
  tags: string[];
}

/**
 * Result of verifying an artifact's integrity.
 */
export interface ArtifactVerification {
  /** Overall verification passed */
  verified: boolean;
  /** HMAC signature matches the envelope */
  signatureValid: boolean;
  /** Content hash matches the stored content */
  contentIntact: boolean;
  /** All parent artifacts exist in the ledger */
  lineageComplete: boolean;
  /** Timestamp of this verification */
  verifiedAt: number;
}

/**
 * Search query for filtering artifacts.
 */
export interface ArtifactSearchQuery {
  /** Filter by artifact kind */
  kind?: ArtifactKind;
  /** Filter by tags (artifact must have all specified tags) */
  tags?: string[];
  /** Filter by run ID */
  runId?: string;
  /** Filter by creation time (epoch ms, inclusive lower bound) */
  since?: number;
  /** Filter by creation time (epoch ms, inclusive upper bound) */
  until?: number;
}

/**
 * Aggregate statistics about the ledger contents.
 */
export interface ArtifactStats {
  /** Total number of artifacts stored */
  totalArtifacts: number;
  /** Count by artifact kind */
  byKind: Record<ArtifactKind, number>;
  /** Total content size across all artifacts in bytes */
  totalSize: number;
}

/**
 * Serializable ledger representation for export/import.
 */
export interface SerializedArtifactLedger {
  artifacts: Artifact[];
  createdAt: string;
  version: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_ARTIFACTS = 10_000;
const SERIALIZATION_VERSION = 1;

/**
 * Constant-time string comparison to prevent timing attacks on HMAC signatures.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

const ALL_KINDS: ArtifactKind[] = [
  'code',
  'report',
  'dataset',
  'model-output',
  'memory-delta',
  'config',
  'trace-export',
  'checkpoint',
];

// ============================================================================
// ArtifactLedger
// ============================================================================

/**
 * Configuration for the ArtifactLedger.
 */
export interface ArtifactLedgerConfig {
  /** HMAC signing key for artifact signatures */
  signingKey?: string;
  /** Maximum number of artifacts to store (FIFO eviction) */
  maxArtifacts?: number;
}

/**
 * Parameters for recording a new artifact.
 */
export interface RecordArtifactParams {
  /** Run ID that produced this artifact */
  runId: string;
  /** Agent cell that produced this artifact */
  cellId: string;
  /** Tenant that owns this artifact */
  tenantId: string;
  /** Classification of the artifact */
  kind: ArtifactKind;
  /** Human-readable name */
  name: string;
  /** Description of what this artifact contains */
  description: string;
  /** The actual artifact data */
  content: unknown;
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
  /** Provenance chain */
  lineage: ArtifactLineage;
  /** Searchable tags */
  tags?: string[];
}

/**
 * A tamper-evident ledger for production artifacts.
 *
 * Every artifact is signed and content-hashed on creation. The ledger
 * supports retrieval by ID, run, kind, cell, and arbitrary search queries.
 * Full lineage traversal allows tracing any artifact back through its
 * entire ancestry chain.
 */
export class ArtifactLedger {
  private artifacts: Map<string, Artifact> = new Map();
  private readonly signingKey: string;
  private readonly maxArtifacts: number;

  constructor(config: ArtifactLedgerConfig = {}) {
    if (!config.signingKey) {
      throw new Error('ArtifactLedger requires an explicit signingKey — hardcoded defaults are not secure');
    }
    this.signingKey = config.signingKey;
    this.maxArtifacts = config.maxArtifacts ?? DEFAULT_MAX_ARTIFACTS;
  }

  /**
   * Record a new artifact in the ledger.
   *
   * Computes the content hash, signs the envelope, and stores the artifact.
   * If the ledger exceeds maxArtifacts, the oldest artifact is evicted.
   *
   * @param params - Artifact creation parameters
   * @returns The fully signed and stored Artifact
   */
  record(params: RecordArtifactParams): Artifact {
    const contentHash = this.computeContentHash(params.content);
    const contentSize = this.computeContentSize(params.content);

    const artifact: Artifact = {
      artifactId: randomUUID(),
      runId: params.runId,
      cellId: params.cellId,
      tenantId: params.tenantId,
      kind: params.kind,
      name: params.name,
      description: params.description,
      contentHash,
      contentSize,
      content: params.content,
      metadata: params.metadata ?? {},
      lineage: params.lineage,
      signature: '', // placeholder; signed below
      createdAt: Date.now(),
      tags: params.tags ?? [],
    };

    artifact.signature = this.signArtifact(artifact);
    this.artifacts.set(artifact.artifactId, artifact);

    // Evict oldest if over capacity
    if (this.artifacts.size > this.maxArtifacts) {
      this.evictOldest();
    }

    return artifact;
  }

  /**
   * Verify an artifact's signature, content integrity, and lineage completeness.
   *
   * @param artifactId - The artifact to verify
   * @returns Verification result with individual check outcomes
   */
  verify(artifactId: string): ArtifactVerification {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      return {
        verified: false,
        signatureValid: false,
        contentIntact: false,
        lineageComplete: false,
        verifiedAt: Date.now(),
      };
    }

    const expectedSignature = this.signArtifact(artifact);
    const signatureValid = timingSafeEqual(artifact.signature, expectedSignature);

    const expectedHash = this.computeContentHash(artifact.content);
    const contentIntact = artifact.contentHash === expectedHash;

    const lineageComplete = artifact.lineage.parentArtifacts.every(
      parentId => this.artifacts.has(parentId),
    );

    return {
      verified: signatureValid && contentIntact && lineageComplete,
      signatureValid,
      contentIntact,
      lineageComplete,
      verifiedAt: Date.now(),
    };
  }

  /**
   * Retrieve an artifact by its ID.
   *
   * @param artifactId - The artifact to retrieve
   * @returns The artifact, or undefined if not found
   */
  get(artifactId: string): Artifact | undefined {
    return this.artifacts.get(artifactId);
  }

  /**
   * Retrieve all artifacts produced by a specific run.
   *
   * @param runId - The run ID to filter by
   * @returns Artifacts matching the run, ordered by creation time
   */
  getByRun(runId: string): Artifact[] {
    return this.filterAndSort(a => a.runId === runId);
  }

  /**
   * Retrieve all artifacts of a specific kind.
   *
   * @param kind - The artifact kind to filter by
   * @returns Artifacts matching the kind, ordered by creation time
   */
  getByKind(kind: ArtifactKind): Artifact[] {
    return this.filterAndSort(a => a.kind === kind);
  }

  /**
   * Retrieve all artifacts produced by a specific agent cell.
   *
   * @param cellId - The cell ID to filter by
   * @returns Artifacts matching the cell, ordered by creation time
   */
  getByCell(cellId: string): Artifact[] {
    return this.filterAndSort(a => a.cellId === cellId);
  }

  /**
   * Traverse the full ancestry of an artifact, depth-first.
   *
   * Returns all ancestor artifacts reachable through the lineage
   * parentArtifacts chain. Handles cycles by tracking visited IDs.
   *
   * @param artifactId - The artifact whose lineage to traverse
   * @returns All ancestor artifacts in depth-first order
   */
  getLineage(artifactId: string): Artifact[] {
    const result: Artifact[] = [];
    const visited = new Set<string>();

    const traverse = (id: string): void => {
      if (visited.has(id)) return;
      visited.add(id);

      const artifact = this.artifacts.get(id);
      if (!artifact) return;

      for (const parentId of artifact.lineage.parentArtifacts) {
        if (!visited.has(parentId)) {
          const parent = this.artifacts.get(parentId);
          if (parent) {
            result.push(parent);
            traverse(parentId);
          }
        }
      }
    };

    traverse(artifactId);
    return result;
  }

  /**
   * Search artifacts using a multi-dimensional query.
   *
   * All specified filters are ANDed together.
   *
   * @param query - Search criteria
   * @returns Matching artifacts ordered by creation time
   */
  search(query: ArtifactSearchQuery): Artifact[] {
    return this.filterAndSort(a => {
      if (query.kind !== undefined && a.kind !== query.kind) return false;
      if (query.runId !== undefined && a.runId !== query.runId) return false;
      if (query.since !== undefined && a.createdAt < query.since) return false;
      if (query.until !== undefined && a.createdAt > query.until) return false;
      if (query.tags !== undefined && query.tags.length > 0) {
        const artifactTags = new Set(a.tags);
        if (!query.tags.every(t => artifactTags.has(t))) return false;
      }
      return true;
    });
  }

  /**
   * Export the entire ledger as a serializable object.
   *
   * @returns Serialized ledger data suitable for JSON.stringify
   */
  export(): SerializedArtifactLedger {
    return {
      artifacts: Array.from(this.artifacts.values()).map(a => ({ ...a })),
      createdAt: new Date().toISOString(),
      version: SERIALIZATION_VERSION,
    };
  }

  /**
   * Import a previously exported ledger, replacing all current contents.
   *
   * @param data - Serialized ledger data
   * @throws If the version is unsupported
   */
  import(data: SerializedArtifactLedger): void {
    if (data.version !== SERIALIZATION_VERSION) {
      throw new Error(
        `Unsupported artifact ledger version: ${data.version} (expected ${SERIALIZATION_VERSION})`,
      );
    }
    this.artifacts.clear();
    for (const artifact of data.artifacts) {
      this.artifacts.set(artifact.artifactId, { ...artifact });
    }
  }

  /**
   * Get aggregate statistics about the ledger.
   *
   * @returns Counts by kind and total content size
   */
  getStats(): ArtifactStats {
    const byKind = Object.fromEntries(
      ALL_KINDS.map(k => [k, 0]),
    ) as Record<ArtifactKind, number>;

    let totalSize = 0;
    for (const artifact of this.artifacts.values()) {
      byKind[artifact.kind]++;
      totalSize += artifact.contentSize;
    }

    return {
      totalArtifacts: this.artifacts.size,
      byKind,
      totalSize,
    };
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  /**
   * Produce the HMAC-SHA256 signature for an artifact.
   *
   * The signature covers every field except `signature` and `content` itself
   * (content is covered by contentHash).
   */
  private signArtifact(artifact: Artifact): string {
    const body = {
      artifactId: artifact.artifactId,
      runId: artifact.runId,
      cellId: artifact.cellId,
      tenantId: artifact.tenantId,
      kind: artifact.kind,
      name: artifact.name,
      description: artifact.description,
      contentHash: artifact.contentHash,
      contentSize: artifact.contentSize,
      metadata: artifact.metadata,
      lineage: artifact.lineage,
      createdAt: artifact.createdAt,
      tags: artifact.tags,
    };
    const payload = JSON.stringify(body);
    return createHmac('sha256', this.signingKey).update(payload).digest('hex');
  }

  /**
   * Compute the SHA-256 hash of artifact content.
   *
   * Handles strings directly and serializes everything else to JSON.
   */
  private computeContentHash(content: unknown): string {
    const payload = typeof content === 'string'
      ? content
      : JSON.stringify(content);
    return createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Compute the byte size of artifact content.
   */
  private computeContentSize(content: unknown): number {
    if (typeof content === 'string') {
      return Buffer.byteLength(content, 'utf-8');
    }
    return Buffer.byteLength(JSON.stringify(content), 'utf-8');
  }

  /**
   * Filter artifacts and return them sorted by creation time ascending.
   */
  private filterAndSort(predicate: (a: Artifact) => boolean): Artifact[] {
    const results: Artifact[] = [];
    for (const artifact of this.artifacts.values()) {
      if (predicate(artifact)) {
        results.push(artifact);
      }
    }
    return results.sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Evict the oldest artifact when capacity is exceeded.
   */
  private evictOldest(): void {
    let oldest: Artifact | undefined;
    for (const artifact of this.artifacts.values()) {
      if (!oldest || artifact.createdAt < oldest.createdAt) {
        oldest = artifact;
      }
    }
    if (oldest) {
      this.artifacts.delete(oldest.artifactId);
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a new ArtifactLedger instance.
 *
 * @param config - Optional configuration. `signingKey` sets the HMAC key,
 *                 `maxArtifacts` sets capacity before FIFO eviction.
 * @returns A fresh ArtifactLedger
 */
export function createArtifactLedger(config?: ArtifactLedgerConfig): ArtifactLedger {
  return new ArtifactLedger(config);
}
