/**
 * Guidance Control Plane - Type Definitions
 *
 * Types for the guidance compiler, shard retriever, enforcement gates,
 * run ledger, evaluators, and optimizer loop.
 *
 * @module @claude-flow/guidance/types
 */

// ============================================================================
// Compiler Types
// ============================================================================

/**
 * Risk classification for rules
 */
export type RiskClass = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * Tool class a rule applies to
 */
export type ToolClass = 'edit' | 'bash' | 'read' | 'write' | 'mcp' | 'task' | 'all';

/**
 * Intent categories for task classification
 */
export type TaskIntent =
  | 'bug-fix'
  | 'feature'
  | 'refactor'
  | 'security'
  | 'performance'
  | 'testing'
  | 'docs'
  | 'deployment'
  | 'architecture'
  | 'debug'
  | 'general';

/**
 * A single guidance rule
 */
export interface GuidanceRule {
  /** Unique rule identifier (e.g., R001) */
  id: string;
  /** Human-readable rule text */
  text: string;
  /** Risk classification */
  riskClass: RiskClass;
  /** Which tool classes this rule applies to */
  toolClasses: ToolClass[];
  /** Task intents this rule is relevant for */
  intents: TaskIntent[];
  /** Repository path globs where this rule applies */
  repoScopes: string[];
  /** Domain tags (security, testing, architecture, etc.) */
  domains: string[];
  /** Priority (higher = takes precedence in contradictions) */
  priority: number;
  /** Source file this rule came from */
  source: 'root' | 'local' | 'optimizer';
  /** Whether this rule is part of the always-loaded constitution */
  isConstitution: boolean;
  /** Optional verifier function name or pattern */
  verifier?: string;
  /** Rule creation timestamp */
  createdAt: number;
  /** Last modification timestamp */
  updatedAt: number;
}

/**
 * A rule shard - a short snippet tagged for retrieval
 */
export interface RuleShard {
  /** The rule this shard represents */
  rule: GuidanceRule;
  /** Compact text form for injection into context */
  compactText: string;
  /** Embedding vector for semantic retrieval */
  embedding?: Float32Array;
}

/**
 * The constitution - always-loaded core rules
 */
export interface Constitution {
  /** Rules that must always be active */
  rules: GuidanceRule[];
  /** Compact text representation (30-60 lines) */
  text: string;
  /** Hash for change detection */
  hash: string;
}

/**
 * Machine-readable manifest of all rules
 */
export interface RuleManifest {
  /** All rule IDs with their triggers and verifiers */
  rules: Array<{
    id: string;
    triggers: string[];
    verifier: string | null;
    riskClass: RiskClass;
    priority: number;
    source: string;
  }>;
  /** Compilation timestamp */
  compiledAt: number;
  /** Source file hashes */
  sourceHashes: Record<string, string>;
  /** Total rule count */
  totalRules: number;
  /** Constitution rule count */
  constitutionRules: number;
  /** Shard rule count */
  shardRules: number;
}

/**
 * Compiled policy bundle output
 */
export interface PolicyBundle {
  /** The always-loaded constitution */
  constitution: Constitution;
  /** Task-scoped rule shards for retrieval */
  shards: RuleShard[];
  /** Machine-readable manifest */
  manifest: RuleManifest;
}

// ============================================================================
// Retriever Types
// ============================================================================

/**
 * Retrieval request
 */
export interface RetrievalRequest {
  /** Task description to match against */
  taskDescription: string;
  /** Optional intent override */
  intent?: TaskIntent;
  /** Optional risk class filter */
  riskFilter?: RiskClass[];
  /** Optional repo path filter */
  repoScope?: string;
  /** Maximum shards to retrieve */
  maxShards?: number;
}

/**
 * Retrieval result
 */
export interface RetrievalResult {
  /** The constitution (always included) */
  constitution: Constitution;
  /** Retrieved shards, ordered by relevance */
  shards: Array<{
    shard: RuleShard;
    similarity: number;
    reason: string;
  }>;
  /** Detected task intent */
  detectedIntent: TaskIntent;
  /** Whether any contradictions were found and resolved */
  contradictionsResolved: number;
  /** Combined policy text for injection */
  policyText: string;
  /** Retrieval latency in ms */
  latencyMs: number;
}

// ============================================================================
// Gate Types
// ============================================================================

/**
 * Gate decision
 */
export type GateDecision = 'allow' | 'block' | 'warn' | 'require-confirmation';

/**
 * Gate evaluation result
 */
export interface GateResult {
  /** The decision */
  decision: GateDecision;
  /** Gate that produced this result */
  gateName: string;
  /** Reason for the decision */
  reason: string;
  /** Rule IDs that triggered this gate */
  triggeredRules: string[];
  /** Suggested remediation */
  remediation?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Gate configuration
 */
export interface GateConfig {
  /** Enable destructive ops gate */
  destructiveOps: boolean;
  /** Enable tool allowlist gate */
  toolAllowlist: boolean;
  /** Enable diff size gate */
  diffSize: boolean;
  /** Enable secrets detection gate */
  secrets: boolean;
  /** Diff size threshold (lines) before requiring a plan */
  diffSizeThreshold: number;
  /** Allowed tools list (empty = all allowed) */
  allowedTools: string[];
  /** Custom secret patterns */
  secretPatterns: RegExp[];
  /** Destructive command patterns */
  destructivePatterns: RegExp[];
}

// ============================================================================
// Ledger Types
// ============================================================================

/**
 * Run event logged to the ledger
 */
export interface RunEvent {
  /** Unique event ID */
  eventId: string;
  /** Task ID this event belongs to */
  taskId: string;
  /** Hash of the guidance bundle used */
  guidanceHash: string;
  /** Rule IDs that were active during this run */
  retrievedRuleIds: string[];
  /** Tools used during the task */
  toolsUsed: string[];
  /** Files touched during the task */
  filesTouched: string[];
  /** Summary of diffs produced */
  diffSummary: {
    linesAdded: number;
    linesRemoved: number;
    filesChanged: number;
  };
  /** Tests run and their results */
  testResults: {
    ran: boolean;
    passed: number;
    failed: number;
    skipped: number;
  };
  /** Violations detected during the run */
  violations: Violation[];
  /** Whether the outcome was accepted */
  outcomeAccepted: boolean | null;
  /** Lines of rework needed */
  reworkLines: number;
  /** Task intent classification */
  intent: TaskIntent;
  /** Timestamp */
  timestamp: number;
  /** Duration in ms */
  durationMs: number;
  /** Session ID */
  sessionId?: string;
}

/**
 * A rule violation
 */
export interface Violation {
  /** Rule ID that was violated */
  ruleId: string;
  /** Violation description */
  description: string;
  /** Severity */
  severity: RiskClass;
  /** Where the violation occurred */
  location?: string;
  /** Whether it was auto-corrected */
  autoCorrected: boolean;
}

/**
 * Evaluator result
 */
export interface EvaluatorResult {
  /** Evaluator name */
  name: string;
  /** Pass or fail */
  passed: boolean;
  /** Details */
  details: string;
  /** Score (0-1) for subjective evaluators */
  score?: number;
}

// ============================================================================
// Optimizer Types
// ============================================================================

/**
 * Violation ranking entry
 */
export interface ViolationRanking {
  /** Rule ID */
  ruleId: string;
  /** Number of times violated */
  frequency: number;
  /** Estimated cost (rework lines) */
  cost: number;
  /** Combined score (frequency * cost) */
  score: number;
}

/**
 * Proposed rule change
 */
export interface RuleChange {
  /** Change ID */
  changeId: string;
  /** Target rule ID (or 'new' for new rules) */
  targetRuleId: string;
  /** Type of change */
  changeType: 'modify' | 'add' | 'remove' | 'promote' | 'demote';
  /** Original rule text (if modifying) */
  originalText?: string;
  /** Proposed new text */
  proposedText: string;
  /** Rationale */
  rationale: string;
  /** Violation ranking that triggered this */
  triggeringViolation: ViolationRanking;
}

/**
 * A/B test result for rule changes
 */
export interface ABTestResult {
  /** Change being tested */
  change: RuleChange;
  /** Metrics with the original rule */
  baseline: OptimizationMetrics;
  /** Metrics with the changed rule */
  candidate: OptimizationMetrics;
  /** Whether the change should be promoted */
  shouldPromote: boolean;
  /** Reason for decision */
  reason: string;
}

/**
 * Optimization metrics
 */
export interface OptimizationMetrics {
  /** Violations per 10 tasks */
  violationRate: number;
  /** Self-correction rate */
  selfCorrectionRate: number;
  /** Rework lines after first output */
  reworkLines: number;
  /** Clarifying questions per task */
  clarifyingQuestions: number;
  /** Number of tasks measured */
  taskCount: number;
}

/**
 * ADR (Architecture Decision Record) for rule changes
 */
export interface RuleADR {
  /** ADR number */
  number: number;
  /** Title */
  title: string;
  /** Decision */
  decision: string;
  /** Rationale */
  rationale: string;
  /** Change applied */
  change: RuleChange;
  /** A/B test results */
  testResult: ABTestResult;
  /** Date */
  date: number;
}

// ============================================================================
// Control Plane Types
// ============================================================================

/**
 * Guidance Control Plane configuration
 */
export interface GuidanceControlPlaneConfig {
  /** Path to root CLAUDE.md */
  rootGuidancePath: string;
  /** Path to CLAUDE.local.md (optional) */
  localGuidancePath?: string;
  /** Gate configuration */
  gates: Partial<GateConfig>;
  /** Maximum shards to retrieve per task */
  maxShardsPerTask: number;
  /** Optimization cycle (in days) */
  optimizationCycleDays: number;
  /** Data directory for ledger and state */
  dataDir: string;
  /** Enable headless mode integration */
  headlessMode: boolean;
}

/**
 * Control plane status
 */
export interface ControlPlaneStatus {
  /** Whether initialized */
  initialized: boolean;
  /** Constitution loaded */
  constitutionLoaded: boolean;
  /** Number of shards available */
  shardCount: number;
  /** Number of gates active */
  activeGates: number;
  /** Ledger event count */
  ledgerEventCount: number;
  /** Last optimization run */
  lastOptimizationRun: number | null;
  /** Metrics summary */
  metrics: OptimizationMetrics | null;
}
