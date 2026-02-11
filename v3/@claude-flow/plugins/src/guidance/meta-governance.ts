/**
 * @fileoverview Meta-Governance Module
 *
 * Provides constitutional governance over the governance system itself.
 * Manages invariants, amendments, and optimizer constraints to prevent
 * governance drift and ensure constitutional stability.
 *
 * Features:
 * - Constitutional invariants with severity levels
 * - Amendment proposal and voting system
 * - Optimizer action validation
 * - Rate limiting and supermajority requirements
 * - Built-in constitutional protections
 *
 * Core capabilities:
 * - Constitutional invariant checking
 * - Amendment lifecycle (propose → vote → resolve → enact)
 * - Optimizer constraint enforcement
 * - Supermajority voting
 * - Emergency veto power
 * - Immutability protection
 *
 * @module @claude-flow/guidance/meta-governance
 * @author Claude Flow Team
 */

import { randomUUID } from 'node:crypto';

/**
 * Result of checking a constitutional invariant
 */
export interface InvariantCheckResult {
  /** Whether the invariant holds */
  holds: boolean;
  /** Description of violation if invariant does not hold */
  violation?: string;
  /** Additional details about the check */
  details?: Record<string, unknown>;
}

/**
 * Current state of the governance system for invariant checking
 */
export interface GovernanceState {
  /** Number of active governance rules */
  ruleCount: number;
  /** Size of constitution in lines */
  constitutionSize: number;
  /** Number of active gates */
  gateCount: number;
  /** Whether optimizer is enabled */
  optimizerEnabled: boolean;
  /** Number of active agents */
  activeAgentCount: number;
  /** Timestamp of last amendment */
  lastAmendmentTimestamp: number;
  /** Additional state metadata */
  metadata: Record<string, unknown>;
}

/**
 * Constitutional invariant that must hold
 */
export interface ConstitutionalInvariant {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of the invariant */
  description: string;
  /** Function to check if invariant holds */
  check: (state: GovernanceState) => InvariantCheckResult;
  /** Severity level */
  severity: 'critical' | 'warning';
  /** Whether this invariant can be removed */
  immutable: boolean;
}

/**
 * A specific change within an amendment
 */
export interface AmendmentChange {
  /** Type of change */
  type: 'add-rule' | 'remove-rule' | 'modify-rule' | 'adjust-threshold' | 'add-gate' | 'remove-gate';
  /** Target of the change (rule ID, gate ID, etc.) */
  target: string;
  /** State before the change (for modify operations) */
  before?: string;
  /** State after the change */
  after?: string;
}

/**
 * Amendment to the governance system
 */
export interface Amendment {
  /** Unique identifier */
  id: string;
  /** Agent or entity that proposed the amendment */
  proposedBy: string;
  /** Description of the amendment */
  description: string;
  /** Specific changes in the amendment */
  changes: AmendmentChange[];
  /** When the amendment was proposed */
  timestamp: number;
  /** Current status */
  status: 'proposed' | 'approved' | 'rejected' | 'enacted' | 'vetoed';
  /** Votes for/against (voterId → approve) */
  votes: Map<string, boolean>;
  /** Number of approvals required to pass */
  requiredApprovals: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Constraints on optimizer behavior
 */
export interface OptimizerConstraint {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of the constraint */
  description: string;
  /** Maximum governance drift per optimization cycle (0-1) */
  maxDriftPerCycle: number;
  /** Maximum rules promoted per cycle */
  maxPromotionRate: number;
  /** Maximum rules demoted per cycle */
  maxDemotionRate: number;
  /** Cooldown between optimizer actions (ms) */
  cooldownMs: number;
}

/**
 * Action the optimizer wants to take
 */
export interface OptimizerAction {
  /** Type of action */
  type: 'promote' | 'demote' | 'add' | 'remove' | 'reweight';
  /** Target rule identifier */
  targetRuleId: string;
  /** Magnitude of the action (interpretation depends on type) */
  magnitude: number;
  /** When the action was requested */
  timestamp: number;
}

/**
 * Validation result for an optimizer action
 */
export interface OptimizerValidation {
  /** Whether the action is allowed */
  allowed: boolean;
  /** Reason for the decision */
  reason: string;
  /** Specific constraint violations */
  constraintViolations: string[];
}

/**
 * Report of all invariant checks
 */
export interface InvariantReport {
  /** Whether all invariants hold */
  allHold: boolean;
  /** Results for each invariant */
  results: Array<{
    invariant: ConstitutionalInvariant;
    result: InvariantCheckResult;
  }>;
  /** When the report was generated */
  timestamp: number;
}

/**
 * Configuration for meta-governance
 */
export interface MetaGovernanceConfig {
  /** Threshold for supermajority (0-1, default 0.75) */
  supermajorityThreshold?: number;
  /** Maximum amendments allowed per time window */
  maxAmendmentsPerWindow?: number;
  /** Time window for amendment rate limiting (ms) */
  amendmentWindowMs?: number;
  /** Optimizer constraints (partial allows overriding defaults) */
  optimizerConstraints?: Partial<OptimizerConstraint>;
  /** Optional signing key for amendments */
  signingKey?: string;
}

/**
 * Meta-Governor: Governs the governance system itself
 *
 * Enforces constitutional invariants, manages amendments,
 * and constrains optimizer behavior to prevent governance drift.
 */
export class MetaGovernor {
  private invariants: Map<string, ConstitutionalInvariant> = new Map();
  private amendments: Map<string, Amendment> = new Map();
  private amendmentHistory: Amendment[] = [];
  private optimizerConstraints: OptimizerConstraint;
  private lastOptimizerAction: number = 0;
  private optimizerActionsThisCycle: Map<string, number> = new Map();

  private readonly supermajorityThreshold: number;
  private readonly maxAmendmentsPerWindow: number;
  private readonly amendmentWindowMs: number;
  private readonly signingKey?: string;

  constructor(config: MetaGovernanceConfig = {}) {
    this.supermajorityThreshold = config.supermajorityThreshold ?? 0.75;
    this.maxAmendmentsPerWindow = config.maxAmendmentsPerWindow ?? 3;
    this.amendmentWindowMs = config.amendmentWindowMs ?? 24 * 60 * 60 * 1000; // 24 hours
    this.signingKey = config.signingKey;

    // Initialize optimizer constraints with defaults
    this.optimizerConstraints = {
      id: 'default-optimizer-constraints',
      name: 'Default Optimizer Constraints',
      description: 'Default constraints on optimizer behavior',
      maxDriftPerCycle: 0.1, // 10% change max
      maxPromotionRate: 2,
      maxDemotionRate: 1,
      cooldownMs: 3600000, // 1 hour
      ...config.optimizerConstraints,
    };

    // Add built-in invariants
    this.addBuiltInInvariants();
  }

  /**
   * Add built-in constitutional invariants
   */
  private addBuiltInInvariants(): void {
    // 1. Constitution size limit
    this.addInvariant({
      id: 'constitution-size-limit',
      name: 'Constitution Size Limit',
      description: 'Constitution must not exceed 60 lines',
      severity: 'critical',
      immutable: true,
      check: (state: GovernanceState): InvariantCheckResult => {
        const holds = state.constitutionSize <= 60;
        return {
          holds,
          violation: holds ? undefined : `Constitution size ${state.constitutionSize} exceeds limit of 60 lines`,
          details: { constitutionSize: state.constitutionSize, limit: 60 },
        };
      },
    });

    // 2. Gate minimum
    this.addInvariant({
      id: 'gate-minimum',
      name: 'Minimum Gate Count',
      description: 'At least 4 gates must be active',
      severity: 'critical',
      immutable: true,
      check: (state: GovernanceState): InvariantCheckResult => {
        const holds = state.gateCount >= 4;
        return {
          holds,
          violation: holds ? undefined : `Gate count ${state.gateCount} is below minimum of 4`,
          details: { gateCount: state.gateCount, minimum: 4 },
        };
      },
    });

    // 3. Rule count sanity
    this.addInvariant({
      id: 'rule-count-sanity',
      name: 'Rule Count Sanity Check',
      description: 'Total rules should not exceed 1000',
      severity: 'warning',
      immutable: false,
      check: (state: GovernanceState): InvariantCheckResult => {
        const holds = state.ruleCount <= 1000;
        return {
          holds,
          violation: holds ? undefined : `Rule count ${state.ruleCount} exceeds recommended limit of 1000`,
          details: { ruleCount: state.ruleCount, recommendedLimit: 1000 },
        };
      },
    });

    // 4. Optimizer bounds
    this.addInvariant({
      id: 'optimizer-bounds',
      name: 'Optimizer Drift Bounds',
      description: 'Optimizer must operate within reasonable drift bounds',
      severity: 'warning',
      immutable: false,
      check: (state: GovernanceState): InvariantCheckResult => {
        if (!state.optimizerEnabled) {
          return { holds: true, details: { optimizerEnabled: false } };
        }

        const reasonableDrift = this.optimizerConstraints.maxDriftPerCycle <= 0.2;
        return {
          holds: reasonableDrift,
          violation: reasonableDrift ? undefined : `Optimizer drift ${this.optimizerConstraints.maxDriftPerCycle} exceeds reasonable bounds`,
          details: { maxDrift: this.optimizerConstraints.maxDriftPerCycle, reasonableLimit: 0.2 },
        };
      },
    });
  }

  /**
   * Add a constitutional invariant
   */
  addInvariant(invariant: ConstitutionalInvariant): void {
    this.invariants.set(invariant.id, invariant);
  }

  /**
   * Remove an invariant (only if not immutable)
   */
  removeInvariant(id: string): boolean {
    const invariant = this.invariants.get(id);
    if (!invariant) {
      return false;
    }
    if (invariant.immutable) {
      throw new Error(`Cannot remove immutable invariant: ${id}`);
    }
    return this.invariants.delete(id);
  }

  /**
   * Check all constitutional invariants against current state
   */
  checkAllInvariants(state: GovernanceState): InvariantReport {
    const results: Array<{ invariant: ConstitutionalInvariant; result: InvariantCheckResult }> = [];
    let allHold = true;

    for (const invariant of this.invariants.values()) {
      const result = invariant.check(state);
      results.push({ invariant, result });
      if (!result.holds) {
        allHold = false;
      }
    }

    return {
      allHold,
      results,
      timestamp: Date.now(),
    };
  }

  /**
   * Propose a new amendment
   */
  proposeAmendment(
    proposal: Omit<Amendment, 'id' | 'timestamp' | 'status' | 'votes'>
  ): Amendment {
    // Check rate limiting
    const now = Date.now();
    const recentAmendments = this.amendmentHistory.filter(
      (a) => now - a.timestamp < this.amendmentWindowMs
    );

    if (recentAmendments.length >= this.maxAmendmentsPerWindow) {
      throw new Error(
        `Amendment rate limit exceeded: ${this.maxAmendmentsPerWindow} per ${this.amendmentWindowMs}ms`
      );
    }

    const amendment: Amendment = {
      id: randomUUID(),
      timestamp: now,
      status: 'proposed',
      votes: new Map(),
      ...proposal,
    };

    this.amendments.set(amendment.id, amendment);
    return amendment;
  }

  /**
   * Vote on an amendment
   */
  voteOnAmendment(amendmentId: string, voterId: string, approve: boolean): void {
    const amendment = this.amendments.get(amendmentId);
    if (!amendment) {
      throw new Error(`Amendment not found: ${amendmentId}`);
    }
    if (amendment.status !== 'proposed') {
      throw new Error(`Cannot vote on amendment with status: ${amendment.status}`);
    }

    amendment.votes.set(voterId, approve);
  }

  /**
   * Resolve an amendment (check if supermajority reached)
   */
  resolveAmendment(amendmentId: string): Amendment {
    const amendment = this.amendments.get(amendmentId);
    if (!amendment) {
      throw new Error(`Amendment not found: ${amendmentId}`);
    }
    if (amendment.status !== 'proposed') {
      throw new Error(`Amendment already resolved: ${amendment.status}`);
    }

    const totalVotes = amendment.votes.size;
    const approvals = Array.from(amendment.votes.values()).filter((v) => v).length;
    const approvalRate = totalVotes > 0 ? approvals / totalVotes : 0;

    if (approvalRate >= this.supermajorityThreshold && approvals >= amendment.requiredApprovals) {
      amendment.status = 'approved';
    } else {
      amendment.status = 'rejected';
    }

    return amendment;
  }

  /**
   * Enact an approved amendment
   * Returns true if enacted successfully
   */
  enactAmendment(amendmentId: string): boolean {
    const amendment = this.amendments.get(amendmentId);
    if (!amendment) {
      throw new Error(`Amendment not found: ${amendmentId}`);
    }
    if (amendment.status !== 'approved') {
      throw new Error(`Cannot enact amendment with status: ${amendment.status}`);
    }

    // Check if any changes would violate immutable invariants
    for (const change of amendment.changes) {
      if (change.type === 'remove-rule' || change.type === 'modify-rule') {
        const invariant = this.invariants.get(change.target);
        if (invariant?.immutable) {
          throw new Error(`Cannot modify immutable invariant: ${change.target}`);
        }
      }
    }

    amendment.status = 'enacted';
    this.amendmentHistory.push(amendment);
    this.amendments.delete(amendmentId);

    return true;
  }

  /**
   * Emergency veto of an amendment
   */
  vetoAmendment(amendmentId: string, reason: string): void {
    const amendment = this.amendments.get(amendmentId);
    if (!amendment) {
      throw new Error(`Amendment not found: ${amendmentId}`);
    }

    amendment.status = 'vetoed';
    amendment.metadata = {
      ...amendment.metadata,
      vetoReason: reason,
      vetoedAt: Date.now(),
    };

    this.amendmentHistory.push(amendment);
    this.amendments.delete(amendmentId);
  }

  /**
   * Get full amendment history
   */
  getAmendmentHistory(): Amendment[] {
    return [...this.amendmentHistory];
  }

  /**
   * Validate an optimizer action against constraints
   */
  validateOptimizerAction(action: OptimizerAction): OptimizerValidation {
    const violations: string[] = [];
    const now = Date.now();

    // Check cooldown
    if (now - this.lastOptimizerAction < this.optimizerConstraints.cooldownMs) {
      violations.push(
        `Cooldown not met: ${now - this.lastOptimizerAction}ms < ${this.optimizerConstraints.cooldownMs}ms`
      );
    }

    // Track actions this cycle
    const cycleKey = `${action.type}-${action.targetRuleId}`;
    const actionsThisCycle = this.optimizerActionsThisCycle.get(cycleKey) ?? 0;

    // Check promotion rate
    if (action.type === 'promote') {
      if (actionsThisCycle >= this.optimizerConstraints.maxPromotionRate) {
        violations.push(
          `Promotion rate exceeded: ${actionsThisCycle} >= ${this.optimizerConstraints.maxPromotionRate}`
        );
      }
    }

    // Check demotion rate
    if (action.type === 'demote') {
      if (actionsThisCycle >= this.optimizerConstraints.maxDemotionRate) {
        violations.push(
          `Demotion rate exceeded: ${actionsThisCycle} >= ${this.optimizerConstraints.maxDemotionRate}`
        );
      }
    }

    // Check drift magnitude
    if (action.magnitude > this.optimizerConstraints.maxDriftPerCycle) {
      violations.push(
        `Drift magnitude ${action.magnitude} exceeds limit ${this.optimizerConstraints.maxDriftPerCycle}`
      );
    }

    const allowed = violations.length === 0;

    if (allowed) {
      this.lastOptimizerAction = now;
      this.optimizerActionsThisCycle.set(cycleKey, actionsThisCycle + 1);
    }

    return {
      allowed,
      reason: allowed ? 'Action permitted' : `Constraint violations: ${violations.join(', ')}`,
      constraintViolations: violations,
    };
  }

  /**
   * Get current optimizer constraints
   */
  getConstraints(): OptimizerConstraint {
    return { ...this.optimizerConstraints };
  }

  /**
   * Reset optimizer action tracking (call at cycle boundaries)
   */
  resetOptimizerTracking(): void {
    this.optimizerActionsThisCycle.clear();
  }

  /**
   * Get all invariants
   */
  getInvariants(): ConstitutionalInvariant[] {
    return Array.from(this.invariants.values());
  }

  /**
   * Get pending amendments
   */
  getPendingAmendments(): Amendment[] {
    return Array.from(this.amendments.values()).filter((a) => a.status === 'proposed');
  }
}

/**
 * Factory function to create a MetaGovernor instance
 */
export function createMetaGovernor(config?: MetaGovernanceConfig): MetaGovernor {
  return new MetaGovernor(config);
}
