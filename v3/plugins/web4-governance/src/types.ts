/**
 * Type definitions for Web4 Governance
 */

/** Trust level categories */
export type TrustLevel =
  | 'unknown'
  | 'low'
  | 'medium_low'
  | 'medium'
  | 'medium_high'
  | 'high';

/**
 * T3 Trust Tensor - Talent/Training/Temperament
 *
 * Per Web4 spec (t3-v3-tensors.md), T3 measures trustworthiness through
 * three FRACTAL capability dimensions, always qualified by role context.
 *
 * "T3/V3 tensors are not absolute properties - they exist only within role contexts."
 *
 * ## Fractal Structure
 *
 * The T3 tensor is FRACTAL - base 3 dimensions, each expandable to subdimensions:
 *
 * ```
 * T3 (base 3D)
 * ├── Talent
 * │   ├── competence (can do)
 * │   └── alignment (values fit)
 * ├── Training
 * │   ├── lineage (history)
 * │   └── witnesses (validation)
 * └── Temperament
 *     ├── reliability (consistency)
 *     └── consistency (quality)
 * ```
 *
 * Composite formula: talent * 0.3 + training * 0.4 + temperament * 0.3
 */
export interface T3Tensor {
  /** Talent: Role-specific capability, natural aptitude, creativity within domain */
  talent: number;
  /** Training: Role-specific expertise, learned skills, relevant experience */
  training: number;
  /** Temperament: Role-contextual reliability, consistency, role-appropriate behavior */
  temperament: number;
}

/**
 * T3 Tensor with subdimensions for detailed tracking
 */
export interface T3TensorFull extends T3Tensor {
  /** Talent subdimension: competence (can they do it?) */
  competence?: number;
  /** Talent subdimension: alignment (values match context?) */
  alignment?: number;
  /** Training subdimension: lineage (track record/history) */
  lineage?: number;
  /** Training subdimension: witnesses (corroborated by others?) */
  witnesses?: number;
  /** Temperament subdimension: reliability (will they do it consistently?) */
  reliability?: number;
  /** Temperament subdimension: consistency (same quality over time?) */
  consistency?: number;
}

/**
 * V3 Value Tensor - Valuation/Veracity/Validity
 *
 * Per Web4 spec, V3 measures value contribution through
 * three FRACTAL dimensions, also role-contextual.
 *
 * ## Fractal Structure
 *
 * ```
 * V3 (base 3D)
 * ├── Valuation
 * │   ├── reputation (perception)
 * │   └── contribution (value added)
 * ├── Veracity
 * │   ├── stewardship (care)
 * │   └── energy (effort)
 * └── Validity
 *     ├── network (reach)
 *     └── temporal (time-based)
 * ```
 */
export interface V3Tensor {
  /** Valuation: Subjective worth, perceived value */
  valuation: number;
  /** Veracity: Objective accuracy, truthfulness */
  veracity: number;
  /** Validity: Confirmed transfer, actual delivery */
  validity: number;
}

/**
 * V3 Tensor with subdimensions for detailed tracking
 */
export interface V3TensorFull extends V3Tensor {
  /** Valuation subdimension: reputation (external perception) */
  reputation?: number;
  /** Valuation subdimension: contribution (value added) */
  contribution?: number;
  /** Veracity subdimension: stewardship (care for resources) */
  stewardship?: number;
  /** Veracity subdimension: energy (effort invested) */
  energy?: number;
  /** Validity subdimension: network (connections/reach) */
  network?: number;
  /** Validity subdimension: temporal (time-based accumulation) */
  temporal?: number;
}

/**
 * Role-qualified T3 tensor binding
 *
 * Trust exists only in role context - an entity trusted as a surgeon
 * has no inherent trust as a mechanic.
 */
export interface RoleT3Binding {
  entityId: string;
  role: string;
  t3: T3Tensor;
  pairedAt: string;
}

/** Policy decision types */
export type PolicyDecision = 'allow' | 'deny' | 'ask_user' | 'log_only';

/** Tool categories for policy matching */
export type ToolCategory =
  | 'file_read'
  | 'file_write'
  | 'execute'
  | 'network'
  | 'agent'
  | 'memory'
  | 'system';

/** Policy evaluation result */
export interface PolicyEvaluation {
  decision: PolicyDecision;
  matchedRule: string | null;
  enforced: boolean;
  reason: string;
  trustScore: number;
  constraints: string[];
}

/** Policy configuration */
export interface PolicyConfig {
  name: string;
  version: string;
  enforce: boolean;
  defaultPolicy: PolicyDecision;
  rules: PolicyRule[];
}

/** Individual policy rule */
export interface PolicyRule {
  id: string;
  name: string;
  priority: number;
  match: PolicyMatch;
  decision: PolicyDecision;
  reason?: string;
}

/** Rule matching specification */
export interface PolicyMatch {
  tools?: string[];
  categories?: ToolCategory[];
  targetPatterns?: string[];
  targetPatternsAreRegex?: boolean;
  rateLimit?: RateLimitSpec;
  minTrust?: number;
}

/** Rate limit specification */
export interface RateLimitSpec {
  maxCount: number;
  windowMs: number;
}

/** Entity trust record */
export interface EntityTrust {
  entityId: string;
  entityType: EntityType;
  t3: T3Tensor;
  level: TrustLevel;
  interactionCount: number;
  successCount: number;
  failureCount: number;
  lastUpdated: string;
  createdAt: string;
}

/** Entity types */
export type EntityType = 'tool' | 'session' | 'agent' | 'policy' | 'user';

/** Witness event */
export interface WitnessEvent {
  witnessId: string;
  witnessedId: string;
  trustScore: number;
  trustLevel: TrustLevel;
  timestamp: string;
  depth: number;
}

/** Witnessing chain */
export interface WitnessingChain {
  entityId: string;
  t3Composite: number;
  trustLevel: TrustLevel;
  witnessedBy: WitnessNode[];
  hasWitnessed: WitnessNode[];
}

/** Witness node in chain */
export interface WitnessNode {
  entityId: string;
  t3Composite: number;
  trustLevel: TrustLevel;
  depth: number;
}

/** R6 Action record */
export interface R6Action {
  actionId: string;
  rules: R6Rules;
  role: R6Role;
  request: R6Request;
  reference: R6Reference;
  resource: R6Resource;
  result: R6Result;
  timestamp: string;
  contentHash: string;
}

export interface R6Rules {
  policyId: string;
  policyHash: string;
  matchedRule: string | null;
  decision: PolicyDecision;
}

export interface R6Role {
  sessionId: string;
  agentId: string | null;
  trustScore: number;
}

export interface R6Request {
  toolName: string;
  category: ToolCategory;
  parametersHash: string;
}

export interface R6Reference {
  previousHash: string | null;
  sequenceNumber: number;
}

export interface R6Resource {
  target: string | null;
  targetType: string;
}

export interface R6Result {
  success: boolean;
  enforced: boolean;
  blocked: boolean;
  error: string | null;
}

/** Audit chain state */
export interface AuditChain {
  sessionId: string;
  policyId: string;
  entries: string[];
  latestHash: string | null;
  sequenceNumber: number;
  createdAt: string;
}

/** Rate limit check result */
export interface RateLimitResult {
  allowed: boolean;
  currentCount: number;
  maxCount: number;
  resetInMs: number;
}

/** Hook context from claude-flow */
export interface GovernanceHookContext {
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  target?: string;
  agentId?: string;
  transcriptPath?: string;
  cwd?: string;
}

/** Hook decision output */
export interface GovernanceHookOutput {
  decision: 'allow' | 'deny' | 'block' | 'ask';
  reason?: string;
  continue: boolean;
  updatedInput?: Record<string, unknown>;
  trustScore?: number;
  policyHash?: string;
}
