/**
 * Memory Write Gating System
 *
 * Adds authority scope, TTL, decay, and contradiction tracking
 * to memory operations. Ensures that only authorized agents can
 * write to specific namespaces, enforces rate limits, and detects
 * contradictions between memory entries.
 *
 * @module @claude-flow/guidance/memory-gate
 */

import { createHash } from 'node:crypto';

// ============================================================================
// Types
// ============================================================================

/**
 * Authority definition for a memory-writing agent
 */
export interface MemoryAuthority {
  /** Agent identifier */
  agentId: string;
  /** Role in the hierarchy */
  role: 'queen' | 'coordinator' | 'worker' | 'observer';
  /** Namespaces this agent is allowed to write to */
  namespaces: string[];
  /** Maximum writes allowed per minute */
  maxWritesPerMinute: number;
  /** Whether this agent can delete entries */
  canDelete: boolean;
  /** Whether this agent can overwrite existing entries */
  canOverwrite: boolean;
  /** Trust level from 0 (untrusted) to 1 (fully trusted) */
  trustLevel: number;
}

/**
 * A gated memory entry with metadata for TTL, decay, lineage, and contradictions
 */
export interface MemoryEntry {
  /** Entry key */
  key: string;
  /** Namespace the entry belongs to */
  namespace: string;
  /** The stored value */
  value: unknown;
  /** SHA-256 hash of the serialized value */
  valueHash: string;
  /** Authority that created/last wrote this entry */
  authority: MemoryAuthority;
  /** Timestamp when the entry was created (ms since epoch) */
  createdAt: number;
  /** Timestamp of the last update (ms since epoch) */
  updatedAt: number;
  /** Time-to-live in milliseconds, or null for no expiry */
  ttlMs: number | null;
  /** Decay rate from 0 (no decay) to 1 (immediate decay) */
  decayRate: number;
  /** Confidence score from 0 to 1, decays over time */
  confidence: number;
  /** Lineage tracking for provenance */
  lineage: {
    parentKey?: string;
    derivedFrom?: string[];
    operation: string;
  };
  /** Detected contradictions with other entries */
  contradictions: Array<{
    entryKey: string;
    description: string;
    resolvedAt?: number;
  }>;
}

/**
 * Result of evaluating a write request
 */
export interface WriteDecision {
  /** Whether the write is allowed */
  allowed: boolean;
  /** Human-readable reason for the decision */
  reason: string;
  /** Contradictions detected with existing entries */
  contradictions: Array<{ existingKey: string; description: string }>;
  /** Authority check result */
  authorityCheck: {
    passed: boolean;
    requiredRole: string;
    actualRole: string;
  };
  /** Rate limit check result */
  rateCheck: {
    passed: boolean;
    writesInWindow: number;
    limit: number;
  };
  /** Overwrite permission check result */
  overwriteCheck: {
    isOverwrite: boolean;
    allowed: boolean;
  };
}

/**
 * Configuration for the MemoryWriteGate
 */
export interface MemoryWriteGateConfig {
  /** Pre-registered authorities */
  authorities?: MemoryAuthority[];
  /** Similarity threshold for contradiction detection (0-1) */
  contradictionThreshold?: number;
  /** Default TTL for new entries in ms (null = no expiry) */
  defaultTtlMs?: number;
  /** Default decay rate for new entries (0-1) */
  defaultDecayRate?: number;
  /** Whether to run contradiction detection on writes */
  enableContradictionTracking?: boolean;
}

// ============================================================================
// Role Hierarchy
// ============================================================================

/** Role hierarchy levels (higher = more authority) */
const ROLE_HIERARCHY: Record<MemoryAuthority['role'], number> = {
  queen: 4,
  coordinator: 3,
  worker: 2,
  observer: 1,
};

/**
 * Minimum role required to write to any namespace
 */
const MINIMUM_WRITE_ROLE: MemoryAuthority['role'] = 'worker';

// ============================================================================
// Contradiction Detection Patterns
// ============================================================================

const CONTRADICTION_PATTERNS: Array<{
  positive: RegExp;
  negative: RegExp;
  description: string;
}> = [
  {
    positive: /\bmust\b/i,
    negative: /\bnever\b|\bdo not\b|\bavoid\b/i,
    description: 'Conflicting obligation: "must" vs negation',
  },
  {
    positive: /\balways\b/i,
    negative: /\bnever\b|\bdon't\b|\bdo not\b/i,
    description: 'Conflicting frequency: "always" vs "never"',
  },
  {
    positive: /\brequire\b/i,
    negative: /\bforbid\b|\bprohibit\b/i,
    description: 'Conflicting policy: "require" vs "forbid"',
  },
  {
    positive: /\benable\b/i,
    negative: /\bdisable\b/i,
    description: 'Conflicting state: "enable" vs "disable"',
  },
  {
    positive: /\btrue\b/i,
    negative: /\bfalse\b/i,
    description: 'Conflicting boolean: "true" vs "false"',
  },
];

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Compute SHA-256 hash of a value
 */
function computeValueHash(value: unknown): string {
  const serialized = JSON.stringify(value);
  return createHash('sha256').update(serialized).digest('hex');
}

/**
 * Stringify a value for contradiction detection
 */
function stringifyForComparison(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ============================================================================
// MemoryWriteGate
// ============================================================================

/**
 * Memory Write Gate
 *
 * Controls write access to the memory system by enforcing:
 * - Authority checks (namespace access, role hierarchy)
 * - Rate limiting (sliding window per agent)
 * - Overwrite permissions
 * - Contradiction detection against existing entries
 * - TTL and confidence decay tracking
 */
export class MemoryWriteGate {
  private authorities: Map<string, MemoryAuthority> = new Map();
  private writeTimestamps: Map<string, number[]> = new Map();
  private contradictionThreshold: number;
  private defaultTtlMs: number | null;
  private defaultDecayRate: number;
  private enableContradictionTracking: boolean;
  private contradictionResolutions: Map<string, string> = new Map();

  constructor(config: MemoryWriteGateConfig = {}) {
    this.contradictionThreshold = config.contradictionThreshold ?? 0.5;
    this.defaultTtlMs = config.defaultTtlMs ?? null;
    this.defaultDecayRate = config.defaultDecayRate ?? 0;
    this.enableContradictionTracking = config.enableContradictionTracking ?? true;

    if (config.authorities) {
      for (const authority of config.authorities) {
        this.authorities.set(authority.agentId, authority);
      }
    }
  }

  /**
   * Evaluate whether a write operation should be allowed.
   *
   * Steps:
   * 1. Check authority (namespace allowed, role sufficient)
   * 2. Check rate limit
   * 3. Check overwrite permission
   * 4. Detect contradictions against existing entries
   * 5. Return decision
   */
  evaluateWrite(
    authority: MemoryAuthority,
    key: string,
    namespace: string,
    value: unknown,
    existingEntries?: MemoryEntry[]
  ): WriteDecision {
    const reasons: string[] = [];
    let allowed = true;

    // Step 1: Authority check
    const authorityCheck = this.checkAuthority(authority, namespace);
    if (!authorityCheck.passed) {
      allowed = false;
      reasons.push(
        `Authority check failed: role "${authority.role}" insufficient or namespace "${namespace}" not allowed`
      );
    }

    // Step 2: Rate limit check
    const rateCheck = this.checkRateLimit(authority);
    if (!rateCheck.passed) {
      allowed = false;
      reasons.push(
        `Rate limit exceeded: ${rateCheck.writesInWindow}/${rateCheck.limit} writes in window`
      );
    }

    // Step 3: Overwrite check
    const isOverwrite = existingEntries
      ? existingEntries.some((e) => e.key === key && e.namespace === namespace)
      : false;
    const overwriteCheck = {
      isOverwrite,
      allowed: isOverwrite ? authority.canOverwrite : true,
    };
    if (isOverwrite && !authority.canOverwrite) {
      allowed = false;
      reasons.push('Overwrite not permitted for this authority');
    }

    // Step 4: Contradiction detection
    let contradictions: Array<{ existingKey: string; description: string }> = [];
    if (
      this.enableContradictionTracking &&
      existingEntries &&
      existingEntries.length > 0
    ) {
      const raw = this.detectContradictions(value, existingEntries);
      contradictions = raw.map((c) => ({
        existingKey: c.entryKey,
        description: c.description,
      }));
    }

    // Step 5: Record write timestamp if allowed
    if (allowed) {
      this.recordWrite(authority.agentId);
    }

    const reason = allowed
      ? 'Write allowed'
      : reasons.join('; ');

    return {
      allowed,
      reason,
      contradictions,
      authorityCheck,
      rateCheck,
      overwriteCheck,
    };
  }

  /**
   * Register a new authority or update an existing one
   */
  registerAuthority(authority: MemoryAuthority): void {
    this.authorities.set(authority.agentId, authority);
  }

  /**
   * Compute the current confidence for an entry based on decay over time.
   *
   * Uses exponential decay: confidence = initialConfidence * e^(-decayRate * ageHours)
   * where ageHours is (now - updatedAt) / 3600000
   */
  computeConfidence(entry: MemoryEntry): number {
    if (entry.decayRate === 0) return entry.confidence;
    if (entry.decayRate >= 1) return 0;

    const now = Date.now();
    const ageMs = now - entry.updatedAt;
    const ageHours = ageMs / 3_600_000;

    const decayed = entry.confidence * Math.exp(-entry.decayRate * ageHours);
    return Math.max(0, Math.min(1, decayed));
  }

  /**
   * Get all entries whose TTL has been exceeded
   */
  getExpiredEntries(entries: MemoryEntry[]): MemoryEntry[] {
    const now = Date.now();
    return entries.filter((entry) => {
      if (entry.ttlMs === null) return false;
      return now - entry.createdAt > entry.ttlMs;
    });
  }

  /**
   * Get entries whose decayed confidence has dropped below a threshold
   */
  getDecayedEntries(entries: MemoryEntry[], threshold: number): MemoryEntry[] {
    return entries.filter((entry) => {
      const currentConfidence = this.computeConfidence(entry);
      return currentConfidence < threshold;
    });
  }

  /**
   * Detect contradictions between a new value and existing entries.
   *
   * Uses string-based pattern matching to find conflicting statements
   * (must vs never, always vs never, require vs forbid, etc.)
   */
  detectContradictions(
    newValue: unknown,
    existingEntries: MemoryEntry[]
  ): Array<{ entryKey: string; description: string }> {
    const newText = stringifyForComparison(newValue);
    const contradictions: Array<{ entryKey: string; description: string }> = [];

    for (const entry of existingEntries) {
      const existingText = stringifyForComparison(entry.value);

      for (const pattern of CONTRADICTION_PATTERNS) {
        const newMatchesPositive =
          pattern.positive.test(newText) && pattern.negative.test(existingText);
        const newMatchesNegative =
          pattern.negative.test(newText) && pattern.positive.test(existingText);

        if (newMatchesPositive || newMatchesNegative) {
          contradictions.push({
            entryKey: entry.key,
            description: pattern.description,
          });
          break; // Only report the first contradiction per entry
        }
      }
    }

    return contradictions;
  }

  /**
   * Mark a contradiction as resolved
   */
  resolveContradiction(entryKey: string, resolution: string): void {
    this.contradictionResolutions.set(entryKey, resolution);
  }

  /**
   * Get the authority for an agent by ID
   */
  getAuthorityFor(agentId: string): MemoryAuthority | undefined {
    return this.authorities.get(agentId);
  }

  /**
   * Get the current rate limit status for an agent
   */
  getRateLimitStatus(agentId: string): {
    writesInWindow: number;
    limit: number;
    resetAt: number;
  } {
    const authority = this.authorities.get(agentId);
    const limit = authority?.maxWritesPerMinute ?? 0;
    const now = Date.now();
    const windowMs = 60_000;
    const windowStart = now - windowMs;

    const timestamps = this.writeTimestamps.get(agentId) ?? [];
    const recentWrites = timestamps.filter((t) => t > windowStart);

    // Find the earliest write in the window to compute reset time
    const resetAt =
      recentWrites.length > 0
        ? recentWrites[0] + windowMs
        : now;

    return {
      writesInWindow: recentWrites.length,
      limit,
      resetAt,
    };
  }

  // ===== Accessors =====

  /** Get the default TTL in ms */
  getDefaultTtlMs(): number | null {
    return this.defaultTtlMs;
  }

  /** Get the default decay rate */
  getDefaultDecayRate(): number {
    return this.defaultDecayRate;
  }

  /** Check if contradiction tracking is enabled */
  isContradictionTrackingEnabled(): boolean {
    return this.enableContradictionTracking;
  }

  /** Get the contradiction resolution for an entry key */
  getContradictionResolution(entryKey: string): string | undefined {
    return this.contradictionResolutions.get(entryKey);
  }

  // ===== Private Methods =====

  /**
   * Check whether an authority is allowed to write to a namespace
   */
  private checkAuthority(
    authority: MemoryAuthority,
    namespace: string
  ): { passed: boolean; requiredRole: string; actualRole: string } {
    const roleLevel = ROLE_HIERARCHY[authority.role];
    const minimumLevel = ROLE_HIERARCHY[MINIMUM_WRITE_ROLE];

    // Role check: must be at least 'worker' level
    if (roleLevel < minimumLevel) {
      return {
        passed: false,
        requiredRole: MINIMUM_WRITE_ROLE,
        actualRole: authority.role,
      };
    }

    // Namespace check: must be in allowed list, or queen can write anywhere
    if (authority.role !== 'queen' && !authority.namespaces.includes(namespace)) {
      return {
        passed: false,
        requiredRole: MINIMUM_WRITE_ROLE,
        actualRole: authority.role,
      };
    }

    return {
      passed: true,
      requiredRole: MINIMUM_WRITE_ROLE,
      actualRole: authority.role,
    };
  }

  /**
   * Check rate limit using a sliding window of write timestamps
   */
  private checkRateLimit(authority: MemoryAuthority): {
    passed: boolean;
    writesInWindow: number;
    limit: number;
  } {
    const now = Date.now();
    const windowMs = 60_000;
    const windowStart = now - windowMs;

    const timestamps = this.writeTimestamps.get(authority.agentId) ?? [];
    // Prune old timestamps outside the window
    const recentWrites = timestamps.filter((t) => t > windowStart);
    this.writeTimestamps.set(authority.agentId, recentWrites);

    return {
      passed: recentWrites.length < authority.maxWritesPerMinute,
      writesInWindow: recentWrites.length,
      limit: authority.maxWritesPerMinute,
    };
  }

  /**
   * Record a write timestamp for an agent
   */
  private recordWrite(agentId: string): void {
    const timestamps = this.writeTimestamps.get(agentId) ?? [];
    timestamps.push(Date.now());
    this.writeTimestamps.set(agentId, timestamps);
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a MemoryWriteGate instance with optional configuration
 */
export function createMemoryWriteGate(
  config?: MemoryWriteGateConfig
): MemoryWriteGate {
  return new MemoryWriteGate(config);
}

// ============================================================================
// Helper: Create a MemoryEntry
// ============================================================================

/**
 * Create a new MemoryEntry with defaults applied
 */
export function createMemoryEntry(
  key: string,
  namespace: string,
  value: unknown,
  authority: MemoryAuthority,
  options: {
    ttlMs?: number | null;
    decayRate?: number;
    confidence?: number;
    lineage?: MemoryEntry['lineage'];
  } = {}
): MemoryEntry {
  const now = Date.now();
  return {
    key,
    namespace,
    value,
    valueHash: computeValueHash(value),
    authority,
    createdAt: now,
    updatedAt: now,
    ttlMs: options.ttlMs ?? null,
    decayRate: options.decayRate ?? 0,
    confidence: options.confidence ?? 1,
    lineage: options.lineage ?? { operation: 'create' },
    contradictions: [],
  };
}
