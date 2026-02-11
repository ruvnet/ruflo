/**
 * Human Authority Gate + Irreversibility Classification
 *
 * Provides typed boundaries between agent, human, and institutional authority,
 * along with irreversibility classification for actions that require elevated
 * proof and pre-commit simulation.
 *
 * AuthorityGate:
 * - Defines authority levels (agent, human, institutional, regulatory)
 * - Maintains a registry of authority scopes and permissions
 * - Checks if a given authority level can perform an action
 * - Determines if escalation is required
 * - Records signed human interventions for audit trails
 *
 * IrreversibilityClassifier:
 * - Classifies actions as reversible, costly-reversible, or irreversible
 * - Uses configurable pattern matching (regex arrays)
 * - Determines required proof levels (standard, elevated, maximum)
 * - Identifies actions requiring pre-commit simulation
 *
 * Human interventions are cryptographically signed using HMAC-SHA256 to
 * create an immutable audit trail of override decisions.
 *
 * @module @claude-flow/guidance/authority
 */

import { createHmac, randomUUID } from 'node:crypto';
import { timingSafeEqual } from './crypto-utils.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Authority levels in the decision hierarchy.
 *
 * - 'agent': Autonomous agent decisions
 * - 'human': Human operator approval required
 * - 'institutional': Organizational policy/compliance required
 * - 'regulatory': External regulatory approval required
 */
export type AuthorityLevel = 'agent' | 'human' | 'institutional' | 'regulatory';

/**
 * Classification of action reversibility.
 *
 * - 'reversible': Can be undone easily with no or minimal cost
 * - 'costly-reversible': Can be undone but with significant cost/effort
 * - 'irreversible': Cannot be undone once executed
 */
export type IrreversibilityClass =
  | 'reversible'
  | 'costly-reversible'
  | 'irreversible';

/**
 * Required proof level based on action irreversibility.
 *
 * - 'standard': Normal verification (reversible actions)
 * - 'elevated': Enhanced verification (costly-reversible actions)
 * - 'maximum': Maximum verification (irreversible actions)
 */
export type ProofLevel = 'standard' | 'elevated' | 'maximum';

/**
 * Defines the scope of authority for a given level.
 */
export interface AuthorityScope {
  /** The authority level this scope applies to */
  level: AuthorityLevel;
  /** Actions this authority level is permitted to perform */
  permissions: string[];
  /** Actions this level can override from lower levels */
  overrideScope: string[];
  /** Whether this level requires escalation to a higher level */
  escalationRequired: boolean;
}

/**
 * Record of a human intervention/override decision.
 */
export interface HumanIntervention {
  /** Unique identifier for this intervention */
  id: string;
  /** Unix timestamp (ms) when the intervention occurred */
  timestamp: number;
  /** Authority level that performed the intervention */
  authorityLevel: AuthorityLevel;
  /** The action that was authorized or denied */
  action: string;
  /** Human-readable reason for the intervention */
  reason: string;
  /** Identifier of the person/entity who signed off */
  signedBy: string;
  /** HMAC-SHA256 signature for integrity verification */
  signature: string;
  /** Additional context or metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result of an authority check.
 */
export interface AuthorityCheckResult {
  /** Whether the action is allowed at the current authority level */
  allowed: boolean;
  /** The minimum authority level required for this action */
  requiredLevel: AuthorityLevel;
  /** The authority level being checked */
  currentLevel: AuthorityLevel;
  /** Human-readable explanation of the decision */
  reason: string;
}

/**
 * Result of an irreversibility classification.
 */
export interface IrreversibilityResult {
  /** The classification of the action */
  classification: IrreversibilityClass;
  /** Patterns that matched this action */
  matchedPatterns: string[];
  /** Required proof level for this action */
  requiredProofLevel: ProofLevel;
  /** Whether pre-commit simulation is required */
  requiresSimulation: boolean;
}

/**
 * Configuration for the AuthorityGate.
 */
export interface AuthorityGateConfig {
  /** Authority scopes to register (defaults provided if not specified) */
  scopes?: AuthorityScope[];
  /** Secret key for HMAC signing (generated if not provided) */
  signatureSecret?: string;
}

/**
 * Configuration for the IrreversibilityClassifier.
 */
export interface IrreversibilityClassifierConfig {
  /** Patterns for irreversible actions (regex strings) */
  irreversiblePatterns?: string[];
  /** Patterns for costly-reversible actions (regex strings) */
  costlyReversiblePatterns?: string[];
  /** Patterns for reversible actions (regex strings) */
  reversiblePatterns?: string[];
}

// ============================================================================
// Default Configurations
// ============================================================================

/**
 * Default authority scopes for each level.
 */
const DEFAULT_AUTHORITY_SCOPES: AuthorityScope[] = [
  {
    level: 'agent',
    permissions: [
      'read_file',
      'analyze_code',
      'suggest_changes',
      'run_tests',
      'generate_documentation',
    ],
    overrideScope: [],
    escalationRequired: false,
  },
  {
    level: 'human',
    permissions: [
      'write_file',
      'modify_code',
      'deploy_staging',
      'create_branch',
      'merge_pr',
      'delete_resource',
    ],
    overrideScope: ['read_file', 'analyze_code', 'suggest_changes', 'run_tests'],
    escalationRequired: false,
  },
  {
    level: 'institutional',
    permissions: [
      'deploy_production',
      'modify_security_policy',
      'grant_access',
      'revoke_access',
      'approve_budget',
      'sign_contract',
    ],
    overrideScope: [
      'write_file',
      'modify_code',
      'deploy_staging',
      'create_branch',
    ],
    escalationRequired: false,
  },
  {
    level: 'regulatory',
    permissions: [
      'approve_compliance',
      'certify_audit',
      'approve_data_transfer',
      'approve_privacy_policy',
      'issue_license',
    ],
    overrideScope: [
      'deploy_production',
      'modify_security_policy',
      'grant_access',
      'approve_budget',
    ],
    escalationRequired: false,
  },
];

/**
 * Default patterns for irreversible actions.
 */
const DEFAULT_IRREVERSIBLE_PATTERNS = [
  'send.*email',
  'publish.*package',
  'process.*payment',
  'execute.*payment',
  'delete.*permanent',
  'drop.*database',
  'revoke.*certificate',
  'propagate.*dns',
  'broadcast.*message',
  'sign.*transaction',
  'commit.*blockchain',
  'release.*funds',
];

/**
 * Default patterns for costly-reversible actions.
 */
const DEFAULT_COSTLY_REVERSIBLE_PATTERNS = [
  'migrate.*database',
  'deploy.*production',
  'rollback.*deployment',
  'update.*config',
  'modify.*schema',
  'send.*notification',
  'create.*user',
  'delete.*user',
  'grant.*permission',
  'revoke.*permission',
  'scale.*infrastructure',
  'provision.*resource',
];

/**
 * Default patterns for reversible actions.
 */
const DEFAULT_REVERSIBLE_PATTERNS = [
  'read.*file',
  'analyze.*code',
  'generate.*report',
  'run.*test',
  'preview.*change',
  'simulate.*deployment',
  'validate.*input',
  'check.*status',
];

// ============================================================================
// Authority Hierarchy
// ============================================================================

/**
 * Ordered authority hierarchy from lowest to highest.
 */
const AUTHORITY_HIERARCHY: AuthorityLevel[] = [
  'agent',
  'human',
  'institutional',
  'regulatory',
];

// ============================================================================
// AuthorityGate
// ============================================================================

/**
 * Gate that enforces authority boundaries and records human interventions.
 *
 * Maintains a registry of authority scopes, checks permissions, determines
 * escalation requirements, and creates cryptographically signed intervention
 * records for audit trails.
 */
export class AuthorityGate {
  private readonly scopes: Map<AuthorityLevel, AuthorityScope> = new Map();
  private readonly interventions: HumanIntervention[] = [];
  private readonly signatureSecret: string;

  constructor(config: AuthorityGateConfig = {}) {
    // Initialize scopes
    const scopesToRegister = config.scopes ?? DEFAULT_AUTHORITY_SCOPES;
    for (const scope of scopesToRegister) {
      this.scopes.set(scope.level, scope);
    }

    // Initialize signature secret
    this.signatureSecret =
      config.signatureSecret ?? randomUUID() + randomUUID();
  }

  /**
   * Check if a given authority level can perform an action.
   *
   * Returns a result indicating whether the action is allowed, the required
   * authority level, and a human-readable explanation.
   */
  canPerform(level: AuthorityLevel, action: string): AuthorityCheckResult {
    const scope = this.scopes.get(level);

    if (!scope) {
      return {
        allowed: false,
        requiredLevel: 'regulatory',
        currentLevel: level,
        reason: `Unknown authority level: ${level}`,
      };
    }

    // Check if action is in this level's permissions
    if (this.hasPermission(scope, action)) {
      return {
        allowed: true,
        requiredLevel: level,
        currentLevel: level,
        reason: `Action '${action}' is permitted at ${level} authority level`,
      };
    }

    // Find minimum required authority level
    const requiredLevel = this.getMinimumAuthority(action);

    return {
      allowed: false,
      requiredLevel,
      currentLevel: level,
      reason: `Action '${action}' requires ${requiredLevel} authority level (current: ${level})`,
    };
  }

  /**
   * Check if an action requires escalation from the current authority level.
   */
  requiresEscalation(level: AuthorityLevel, action: string): boolean {
    const checkResult = this.canPerform(level, action);

    if (checkResult.allowed) {
      return false;
    }

    // Escalation is required if a higher authority level is needed
    const currentIndex = AUTHORITY_HIERARCHY.indexOf(level);
    const requiredIndex = AUTHORITY_HIERARCHY.indexOf(checkResult.requiredLevel);

    return requiredIndex > currentIndex;
  }

  /**
   * Get the minimum authority level required to perform an action.
   *
   * Returns the lowest authority level that has permission for this action.
   * If no level has permission, returns 'regulatory' as the highest level.
   */
  getMinimumAuthority(action: string): AuthorityLevel {
    // Check levels from lowest to highest
    for (const level of AUTHORITY_HIERARCHY) {
      const scope = this.scopes.get(level);
      if (scope && this.hasPermission(scope, action)) {
        return level;
      }
    }

    // If no level has permission, require highest authority
    return 'regulatory';
  }

  /**
   * Record a human intervention with cryptographic signature.
   *
   * Creates an immutable audit record of the intervention decision.
   * The signature is computed using HMAC-SHA256 over the intervention details.
   */
  recordIntervention(intervention: Omit<HumanIntervention, 'id' | 'signature'>): HumanIntervention {
    const id = randomUUID();
    const signature = this.signIntervention({
      id,
      ...intervention,
      signature: '', // Placeholder for signature computation
    });

    const signedIntervention: HumanIntervention = {
      id,
      ...intervention,
      signature,
    };

    this.interventions.push(signedIntervention);

    return signedIntervention;
  }

  /**
   * Get all recorded interventions.
   */
  getInterventions(): HumanIntervention[] {
    return [...this.interventions];
  }

  /**
   * Get interventions for a specific action.
   */
  getInterventionsForAction(action: string): HumanIntervention[] {
    return this.interventions.filter(i => i.action === action);
  }

  /**
   * Get interventions by authority level.
   */
  getInterventionsByLevel(level: AuthorityLevel): HumanIntervention[] {
    return this.interventions.filter(i => i.authorityLevel === level);
  }

  /**
   * Verify the signature of an intervention.
   */
  verifyIntervention(intervention: HumanIntervention): boolean {
    const expectedSignature = this.signIntervention(intervention);
    return timingSafeEqual(expectedSignature, intervention.signature);
  }

  /**
   * Get the number of recorded interventions.
   */
  get interventionCount(): number {
    return this.interventions.length;
  }

  /**
   * Get all registered authority levels.
   */
  getAuthorityLevels(): AuthorityLevel[] {
    return [...this.scopes.keys()];
  }

  /**
   * Get the scope for a specific authority level.
   */
  getScope(level: AuthorityLevel): AuthorityScope | undefined {
    return this.scopes.get(level);
  }

  /**
   * Add or update an authority scope.
   */
  registerScope(scope: AuthorityScope): void {
    this.scopes.set(scope.level, scope);
  }

  // ===== Private =====

  /**
   * Check if a scope has permission for an action.
   *
   * Uses exact match and pattern matching (with wildcards).
   */
  private hasPermission(scope: AuthorityScope, action: string): boolean {
    // Check exact match
    if (scope.permissions.includes(action)) {
      return true;
    }

    // Check pattern match (treat * as wildcard)
    for (const permission of scope.permissions) {
      if (this.matchesPattern(action, permission)) {
        return true;
      }
    }

    // Check override scope
    if (scope.overrideScope.includes(action)) {
      return true;
    }

    for (const override of scope.overrideScope) {
      if (this.matchesPattern(action, override)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if an action matches a permission pattern.
   *
   * Supports simple wildcard patterns (e.g., "deploy_*").
   */
  private matchesPattern(action: string, pattern: string): boolean {
    if (!pattern.includes('*')) {
      return action === pattern;
    }

    // Convert wildcard pattern to regex
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
      .replace(/\*/g, '.*'); // Replace * with .*

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(action);
  }

  /**
   * Sign an intervention using HMAC-SHA256.
   */
  private signIntervention(intervention: HumanIntervention): string {
    const payload = JSON.stringify({
      id: intervention.id,
      timestamp: intervention.timestamp,
      authorityLevel: intervention.authorityLevel,
      action: intervention.action,
      reason: intervention.reason,
      signedBy: intervention.signedBy,
      metadata: intervention.metadata,
    });

    const hmac = createHmac('sha256', this.signatureSecret);
    hmac.update(payload);
    return hmac.digest('hex');
  }
}

// ============================================================================
// IrreversibilityClassifier
// ============================================================================

/**
 * Classifies actions by their reversibility to determine required proof levels
 * and whether pre-commit simulation is needed.
 *
 * Uses configurable regex patterns to identify irreversible, costly-reversible,
 * and reversible actions. Irreversible actions require maximum proof and
 * pre-commit simulation.
 */
export class IrreversibilityClassifier {
  private readonly irreversiblePatterns: RegExp[];
  private readonly costlyReversiblePatterns: RegExp[];
  private readonly reversiblePatterns: RegExp[];

  constructor(config: IrreversibilityClassifierConfig = {}) {
    this.irreversiblePatterns = (
      config.irreversiblePatterns ?? DEFAULT_IRREVERSIBLE_PATTERNS
    ).map(p => new RegExp(p, 'i'));

    this.costlyReversiblePatterns = (
      config.costlyReversiblePatterns ?? DEFAULT_COSTLY_REVERSIBLE_PATTERNS
    ).map(p => new RegExp(p, 'i'));

    this.reversiblePatterns = (
      config.reversiblePatterns ?? DEFAULT_REVERSIBLE_PATTERNS
    ).map(p => new RegExp(p, 'i'));
  }

  /**
   * Classify an action by its reversibility.
   *
   * Checks patterns in order: irreversible → costly-reversible → reversible.
   * If no patterns match, defaults to 'costly-reversible' as a safe default.
   */
  classify(action: string): IrreversibilityResult {
    // Check irreversible patterns first (highest risk)
    const irreversibleMatches = this.findMatches(
      action,
      this.irreversiblePatterns,
    );
    if (irreversibleMatches.length > 0) {
      return {
        classification: 'irreversible',
        matchedPatterns: irreversibleMatches,
        requiredProofLevel: 'maximum',
        requiresSimulation: true,
      };
    }

    // Check costly-reversible patterns
    const costlyMatches = this.findMatches(action, this.costlyReversiblePatterns);
    if (costlyMatches.length > 0) {
      return {
        classification: 'costly-reversible',
        matchedPatterns: costlyMatches,
        requiredProofLevel: 'elevated',
        requiresSimulation: true,
      };
    }

    // Check reversible patterns
    const reversibleMatches = this.findMatches(action, this.reversiblePatterns);
    if (reversibleMatches.length > 0) {
      return {
        classification: 'reversible',
        matchedPatterns: reversibleMatches,
        requiredProofLevel: 'standard',
        requiresSimulation: false,
      };
    }

    // Default to costly-reversible if no patterns match (safe default)
    return {
      classification: 'costly-reversible',
      matchedPatterns: [],
      requiredProofLevel: 'elevated',
      requiresSimulation: true,
    };
  }

  /**
   * Get the required proof level for an action.
   *
   * - 'maximum' for irreversible actions
   * - 'elevated' for costly-reversible actions
   * - 'standard' for reversible actions
   */
  getRequiredProofLevel(action: string): ProofLevel {
    return this.classify(action).requiredProofLevel;
  }

  /**
   * Check if an action requires pre-commit simulation.
   *
   * Returns true for irreversible and costly-reversible actions.
   */
  requiresPreCommitSimulation(action: string): boolean {
    return this.classify(action).requiresSimulation;
  }

  /**
   * Get all configured patterns for a classification.
   */
  getPatterns(classification: IrreversibilityClass): string[] {
    switch (classification) {
      case 'irreversible':
        return this.irreversiblePatterns.map(p => p.source);
      case 'costly-reversible':
        return this.costlyReversiblePatterns.map(p => p.source);
      case 'reversible':
        return this.reversiblePatterns.map(p => p.source);
    }
  }

  /**
   * Add a pattern to a classification.
   *
   * Validates the pattern against ReDoS heuristics before accepting it.
   * Rejects patterns with nested quantifiers (e.g., `(a+)+`) that can
   * cause catastrophic backtracking.
   *
   * @throws Error if the pattern is invalid regex or contains ReDoS-prone constructs
   */
  addPattern(classification: IrreversibilityClass, pattern: string): void {
    // ReDoS heuristic: reject nested quantifiers like (a+)+, (a*)+, (a+)*, etc.
    if (/([+*]|\{[0-9]+,?\})\s*\)[\s]*[+*]|\{[0-9]+,?\}/.test(pattern)) {
      throw new Error(`Pattern rejected: nested quantifiers detected (potential ReDoS): ${pattern}`);
    }
    // Also reject patterns longer than 500 chars as a sanity bound
    if (pattern.length > 500) {
      throw new Error(`Pattern rejected: exceeds maximum length of 500 characters`);
    }

    const regex = new RegExp(pattern, 'i');

    switch (classification) {
      case 'irreversible':
        this.irreversiblePatterns.push(regex);
        break;
      case 'costly-reversible':
        this.costlyReversiblePatterns.push(regex);
        break;
      case 'reversible':
        this.reversiblePatterns.push(regex);
        break;
    }
  }

  // ===== Private =====

  /**
   * Find all patterns that match an action.
   */
  private findMatches(action: string, patterns: RegExp[]): string[] {
    const matches: string[] = [];

    for (const pattern of patterns) {
      if (pattern.test(action)) {
        matches.push(pattern.source);
      }
    }

    return matches;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an AuthorityGate with optional configuration.
 */
export function createAuthorityGate(
  config?: AuthorityGateConfig,
): AuthorityGate {
  return new AuthorityGate(config);
}

/**
 * Create an IrreversibilityClassifier with optional configuration.
 */
export function createIrreversibilityClassifier(
  config?: IrreversibilityClassifierConfig,
): IrreversibilityClassifier {
  return new IrreversibilityClassifier(config);
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if one authority level is higher than another.
 */
export function isHigherAuthority(
  level1: AuthorityLevel,
  level2: AuthorityLevel,
): boolean {
  const index1 = AUTHORITY_HIERARCHY.indexOf(level1);
  const index2 = AUTHORITY_HIERARCHY.indexOf(level2);
  return index1 > index2;
}

/**
 * Get the next higher authority level, if any.
 */
export function getNextHigherAuthority(
  level: AuthorityLevel,
): AuthorityLevel | null {
  const index = AUTHORITY_HIERARCHY.indexOf(level);
  if (index === -1 || index === AUTHORITY_HIERARCHY.length - 1) {
    return null;
  }
  return AUTHORITY_HIERARCHY[index + 1];
}

/**
 * Get the authority hierarchy as an ordered array.
 */
export function getAuthorityHierarchy(): AuthorityLevel[] {
  return [...AUTHORITY_HIERARCHY];
}
