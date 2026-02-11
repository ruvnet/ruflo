/**
 * Agentic-QE Plugin Interfaces
 *
 * Public interfaces for the Quality Engineering plugin's anti-corruption layer.
 * These interfaces define contracts between agentic-qe and Claude Flow V3 domains.
 *
 * Based on ADR-030: Agentic-QE Plugin Integration
 *
 * @module v3/plugins/agentic-qe/interfaces
 */

// =============================================================================
// Memory Bridge Interfaces
// =============================================================================

/**
 * Test pattern learned from successful test generation
 */
export interface TestPattern {
  /** Unique identifier */
  id: string;

  /** Type of test (unit, integration, e2e, etc.) */
  type: TestPatternType;

  /** Programming language */
  language: string;

  /** Test framework (vitest, jest, pytest, etc.) */
  framework: string;

  /** Natural language description */
  description: string;

  /** The pattern's code template or structure */
  code: string;

  /** Tags for categorization */
  tags: string[];

  /** Effectiveness score from usage (0-1) */
  effectiveness: number;

  /** Number of times this pattern has been used */
  usageCount: number;

  /** Creation timestamp */
  createdAt: number;

  /** Last used timestamp */
  lastUsedAt: number;

  /** Additional metadata */
  metadata: Record<string, unknown>;
}

export type TestPatternType =
  | 'unit'
  | 'integration'
  | 'e2e'
  | 'property'
  | 'mutation'
  | 'fuzz'
  | 'api'
  | 'performance'
  | 'security'
  | 'accessibility'
  | 'contract'
  | 'bdd';

/**
 * Filters for pattern search
 */
export interface PatternFilters {
  type?: TestPatternType;
  language?: string;
  framework?: string;
  tags?: string[];
  minEffectiveness?: number;
}

/**
 * Coverage gap detected during analysis
 */
export interface CoverageGap {
  /** Unique identifier */
  id: string;

  /** File path with gap */
  file: string;

  /** Type of gap (line, branch, function) */
  type: 'line' | 'branch' | 'function' | 'statement';

  /** Location information */
  location: {
    startLine: number;
    endLine: number;
    startColumn?: number;
    endColumn?: number;
  };

  /** Risk score (0-1, higher = more risky) */
  riskScore: number;

  /** Priority ranking */
  priority: 'critical' | 'high' | 'medium' | 'low';

  /** Reason for the gap */
  reason: string;

  /** Suggested test approach */
  suggestion: string;

  /** Detection timestamp */
  detectedAt: number;
}

/**
 * Learning trajectory for ReasoningBank integration
 */
export interface LearningTrajectory {
  /** Unique identifier */
  id: string;

  /** Type of task that generated this trajectory */
  taskType: string;

  /** Agent that performed the task */
  agentId: string;

  /** Whether the task succeeded */
  success: boolean;

  /** Reward signal for reinforcement learning */
  reward: number;

  /** Sequence of steps taken */
  steps: LearningStep[];

  /** Final verdict */
  verdict: 'success' | 'failure' | 'partial';

  /** Creation timestamp */
  createdAt: number;

  /** Duration in milliseconds */
  durationMs: number;

  /** Additional context */
  context: Record<string, unknown>;
}

/**
 * Single step in a learning trajectory
 */
export interface LearningStep {
  /** Step index */
  index: number;

  /** Action taken */
  action: string;

  /** Input to the action */
  input: Record<string, unknown>;

  /** Output from the action */
  output: Record<string, unknown>;

  /** Quality score for this step */
  quality: number;

  /** Timestamp */
  timestamp: number;
}

/**
 * Memory bridge interface for V3 memory integration
 */
export interface IQEMemoryBridge {
  /**
   * Initialize memory namespaces
   */
  initialize(): Promise<void>;

  /**
   * Store a test pattern with semantic embedding
   */
  storeTestPattern(pattern: TestPattern): Promise<string>;

  /**
   * Search for similar patterns using HNSW (150x faster)
   */
  searchSimilarPatterns(
    query: string,
    k?: number,
    filters?: PatternFilters
  ): Promise<TestPattern[]>;

  /**
   * Store a coverage gap
   */
  storeCoverageGap(gap: CoverageGap): Promise<string>;

  /**
   * Get coverage gaps for a file
   */
  getCoverageGaps(file: string): Promise<CoverageGap[]>;

  /**
   * Get prioritized coverage gaps
   */
  getPrioritizedGaps(limit?: number): Promise<CoverageGap[]>;

  /**
   * Store a learning trajectory for ReasoningBank
   */
  storeTrajectory(trajectory: LearningTrajectory): Promise<string>;

  /**
   * Search trajectories by similarity
   */
  searchTrajectories(
    query: string,
    k?: number,
    filters?: { taskType?: string; success?: boolean }
  ): Promise<LearningTrajectory[]>;

  /**
   * Clear temporary data (e.g., coverage data)
   */
  clearTemporaryData(): Promise<void>;

  /**
   * Get memory statistics
   */
  getStats(): Promise<QEMemoryStats>;
}

/**
 * Memory statistics for QE namespaces
 */
export interface QEMemoryStats {
  testPatterns: number;
  coverageGaps: number;
  learningTrajectories: number;
  codeKnowledge: number;
  securityFindings: number;
  totalMemoryBytes: number;
}

// =============================================================================
// Security Bridge Interfaces
// =============================================================================

/**
 * Validated path result
 */
export interface ValidatedPath {
  path: string;
  valid: boolean;
  error?: string;
  resolvedPath?: string;
}

/**
 * DAST probe definition
 */
export interface DASTProbe {
  /** Probe identifier */
  id: string;

  /** Probe type */
  type: 'xss' | 'sqli' | 'ssrf' | 'csrf' | 'auth' | 'header' | 'custom';

  /** Target endpoint */
  endpoint: string;

  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

  /** Request payload */
  payload?: Record<string, unknown>;

  /** Expected response indicators */
  indicators: string[];

  /** Maximum timeout */
  timeout: number;
}

/**
 * DAST scan result
 */
export interface DASTResult {
  /** Probe identifier */
  probeId: string;

  /** Whether vulnerability was detected */
  vulnerable: boolean;

  /** Severity if vulnerable */
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'info';

  /** Response status code */
  statusCode: number;

  /** Evidence of vulnerability */
  evidence?: string;

  /** Execution time */
  executionTimeMs: number;
}

/**
 * Audit event for compliance tracking
 */
export interface AuditEvent {
  /** Event type */
  type: 'scan_started' | 'scan_completed' | 'finding_detected' | 'remediation_applied';

  /** Actor who triggered the event */
  actor: string;

  /** Target of the action */
  target: string;

  /** Event details */
  details: Record<string, unknown>;

  /** Timestamp */
  timestamp: number;
}

/**
 * Signed audit entry
 */
export interface SignedAuditEntry {
  /** Unique identifier */
  id: string;

  /** The audit event */
  event: AuditEvent;

  /** Entry timestamp */
  timestamp: number;

  /** Actor who created the entry */
  actor: string;

  /** Cryptographic signature */
  signature: string;

  /** Whether signature is verifiable */
  verifiable: boolean;
}

/**
 * PII type classification
 */
export type PIIType =
  | 'email'
  | 'phone'
  | 'ssn'
  | 'credit_card'
  | 'api_key'
  | 'password'
  | 'address'
  | 'name'
  | 'dob'
  | 'ip_address';

/**
 * PII detection result
 */
export interface PIIDetection {
  /** Type of PII detected */
  type: PIIType;

  /** Location in the content */
  location: {
    start: number;
    end: number;
  };

  /** Confidence score (0-1) */
  confidence: number;

  /** The detected value (redacted) */
  redactedValue?: string;
}

/**
 * Security bridge interface for V3 security integration
 */
export interface IQESecurityBridge {
  /**
   * Validate a file path before security scan
   */
  validateScanTarget(path: string): Promise<ValidatedPath>;

  /**
   * Execute DAST probes with security constraints
   */
  executeDAST(target: string, probes: DASTProbe[]): Promise<DASTResult[]>;

  /**
   * Create a signed audit entry
   */
  createAuditEntry(event: AuditEvent): Promise<SignedAuditEntry>;

  /**
   * Detect PII in content
   */
  detectPII(content: string): Promise<PIIDetection[]>;

  /**
   * Validate input against security schemas
   */
  validateInput<T>(input: unknown, schema: string): Promise<{ valid: boolean; errors?: string[]; value?: T }>;

  /**
   * Sanitize error message for safe display
   */
  sanitizeError(error: Error): Error;

  /**
   * Get security policy for a context
   */
  getSecurityPolicy(context: string): SecurityPolicy;
}

/**
 * Security policy configuration
 */
export interface SecurityPolicy {
  /** Security level */
  level: 'low' | 'medium' | 'high' | 'critical';

  /** Network access policy */
  networkPolicy: 'unrestricted' | 'restricted' | 'blocked';

  /** File system policy */
  fileSystemPolicy: 'full' | 'workspace-only' | 'readonly' | 'none';

  /** Allowed commands */
  allowedCommands: string[];

  /** Blocked paths */
  blockedPaths: string[];

  /** Maximum execution time */
  maxExecutionTime: number;

  /** Maximum memory */
  maxMemory: number;
}

// =============================================================================
// Core Bridge Interfaces
// =============================================================================

/**
 * Test suite definition
 */
export interface TestSuite {
  /** Unique identifier */
  id: string;

  /** Suite name */
  name: string;

  /** Test framework */
  framework: string;

  /** Individual test cases */
  testCases: TestCase[];

  /** Estimated duration in ms */
  estimatedDuration: number;

  /** Configuration */
  config: TestSuiteConfig;
}

/**
 * Test case definition
 */
export interface TestCase {
  /** Test identifier */
  id: string;

  /** Test name */
  name: string;

  /** Test file path */
  filePath: string;

  /** Test function or describe block */
  testBlock: string;

  /** Tags */
  tags: string[];

  /** Estimated duration */
  estimatedDuration: number;
}

/**
 * Test suite configuration
 */
export interface TestSuiteConfig {
  /** Run tests in parallel */
  parallel: boolean;

  /** Maximum parallel workers */
  maxWorkers: number;

  /** Retry count for flaky tests */
  retryCount: number;

  /** Timeout per test */
  testTimeout: number;

  /** Coverage collection */
  collectCoverage: boolean;

  /** Watch mode */
  watch: boolean;
}

/**
 * Executor configuration
 */
export interface ExecutorConfig {
  /** Enable parallel execution */
  parallel: boolean;

  /** Maximum workers */
  maxWorkers: number;

  /** Retry count */
  retryCount: number;

  /** Timeout in ms */
  timeout: number;

  /** Environment variables */
  env?: Record<string, string>;
}

/**
 * Agent handle for managing spawned agents
 */
export interface AgentHandle {
  /** Agent identifier */
  id: string;

  /** Agent type */
  type: string;

  /** Agent name */
  name: string;

  /** Current status */
  status: 'spawning' | 'ready' | 'busy' | 'error' | 'terminated';

  /** Terminate the agent */
  terminate(): Promise<void>;

  /** Send a message to the agent */
  send(message: Record<string, unknown>): Promise<void>;
}

/**
 * Task handle for managing created tasks
 */
export interface TaskHandle {
  /** Task identifier */
  id: string;

  /** Task type */
  type: string;

  /** Current status */
  status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

  /** Wait for task completion */
  wait(): Promise<TaskResult>;

  /** Cancel the task */
  cancel(): Promise<void>;

  /** Get task progress */
  getProgress(): Promise<TaskProgress>;
}

/**
 * Task result
 */
export interface TaskResult {
  /** Task identifier */
  taskId: string;

  /** Whether task succeeded */
  success: boolean;

  /** Result data */
  data?: Record<string, unknown>;

  /** Error if failed */
  error?: string;

  /** Duration in ms */
  durationMs: number;
}

/**
 * Task progress
 */
export interface TaskProgress {
  /** Completion percentage (0-100) */
  percentage: number;

  /** Current step */
  currentStep: string;

  /** Total steps */
  totalSteps: number;

  /** Completed steps */
  completedSteps: number;

  /** Estimated remaining time in ms */
  estimatedRemainingMs: number;
}

/**
 * Quality gate definition
 */
export interface QualityGate {
  /** Gate identifier */
  id: string;

  /** Gate name */
  name: string;

  /** Evaluation criteria */
  criteria: QualityGateCriteria;

  /** Required for release */
  required: boolean;

  /** Gate weight in overall score */
  weight: number;
}

/**
 * Quality gate criteria
 */
export interface QualityGateCriteria {
  /** Metric to evaluate */
  metric: string;

  /** Comparison operator */
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';

  /** Threshold value */
  threshold: number;
}

/**
 * Quality metrics
 */
export interface QualityMetrics {
  /** Code coverage percentage */
  coveragePercent: number;

  /** Number of passing tests */
  testsPassed: number;

  /** Number of failing tests */
  testsFailed: number;

  /** Number of skipped tests */
  testsSkipped: number;

  /** Number of security issues */
  securityIssues: number;

  /** Code complexity score */
  complexityScore: number;

  /** Technical debt minutes */
  technicalDebtMinutes: number;

  /** Custom metrics */
  custom: Record<string, number>;
}

/**
 * Workflow result
 */
export interface WorkflowResult {
  /** Workflow identifier */
  workflowId: string;

  /** Whether workflow succeeded */
  success: boolean;

  /** Step results */
  stepResults: StepResult[];

  /** Overall duration */
  durationMs: number;

  /** Final output */
  output?: Record<string, unknown>;
}

/**
 * Step result
 */
export interface StepResult {
  /** Step name */
  name: string;

  /** Whether step passed */
  passed: boolean;

  /** Step output */
  output?: Record<string, unknown>;

  /** Error if failed */
  error?: string;

  /** Duration */
  durationMs: number;
}

/**
 * Task priority
 */
export type Priority = 'critical' | 'high' | 'normal' | 'low';

/**
 * Core bridge interface for V3 core services
 */
export interface IQECoreBridge {
  /**
   * Spawn a test execution agent
   */
  spawnTestExecutor(testSuite: TestSuite, config: ExecutorConfig): Promise<AgentHandle>;

  /**
   * Create a test execution task
   */
  createTestTask(testSuite: TestSuite, priority: Priority): Promise<TaskHandle>;

  /**
   * Execute a quality gate workflow
   */
  executeQualityGateWorkflow(gates: QualityGate[], metrics: QualityMetrics): Promise<WorkflowResult>;

  /**
   * Get configuration value
   */
  getConfig<T>(key: string): Promise<T | undefined>;

  /**
   * List available agents by type
   */
  listAgents(filter?: { type?: string; status?: string }): Promise<AgentHandle[]>;

  /**
   * Get agent by ID
   */
  getAgent(agentId: string): Promise<AgentHandle | null>;
}

// =============================================================================
// Hive Bridge Interfaces
// =============================================================================

/**
 * Hive Mind role
 */
export type HiveRole = 'queen' | 'worker' | 'specialist' | 'scout';

/**
 * QE swarm task
 */
export interface QESwarmTask {
  /** Task identifier */
  id: string;

  /** Required agent types */
  agents: string[];

  /** Task priority */
  priority: 'low' | 'normal' | 'high' | 'critical';

  /** Task payload */
  payload: Record<string, unknown>;

  /** Task type */
  type: string;

  /** Timeout in ms */
  timeout: number;
}

/**
 * QE swarm result
 */
export interface QESwarmResult {
  /** Task identifier */
  taskId: string;

  /** Results from each agent */
  agentResults: AgentTaskResult[];

  /** Number of completed agents */
  completedAgents: number;

  /** Total agents assigned */
  totalAgents: number;

  /** Overall success */
  success: boolean;

  /** Aggregated output */
  aggregatedOutput?: Record<string, unknown>;
}

/**
 * Individual agent task result
 */
export interface AgentTaskResult {
  /** Agent identifier */
  agentId: string;

  /** Whether agent succeeded */
  success: boolean;

  /** Agent output */
  output: Record<string, unknown>;

  /** Error if failed */
  error?: string;

  /** Duration */
  durationMs: number;
}

/**
 * Consensus result
 */
export interface VotingResult {
  /** Whether consensus was reached */
  accepted: boolean;

  /** Reason if rejected */
  reason?: string;

  /** Votes for */
  votesFor: number;

  /** Votes against */
  votesAgainst: number;

  /** Total voters */
  totalVoters: number;
}

/**
 * Hive bridge interface for V3 Hive Mind coordination
 */
export interface IQEHiveBridge {
  /**
   * Register QE Queen with Hive Mind
   */
  registerQueen(): Promise<void>;

  /**
   * Spawn a QE worker and join to hive
   */
  spawnQEWorker(agentType: string, context: string): Promise<string>;

  /**
   * Coordinate a QE swarm task
   */
  coordinateQESwarm(task: QESwarmTask): Promise<QESwarmResult>;

  /**
   * Execute operation with Byzantine fault tolerance
   */
  executeWithBFT<T>(operation: () => Promise<T>, replicaCount?: number): Promise<T>;

  /**
   * Propose task allocation via consensus
   */
  proposeTaskAllocation(task: QESwarmTask, requiredAgents: string[]): Promise<VotingResult>;

  /**
   * Broadcast result to hive
   */
  broadcastResult(taskId: string, result: QESwarmResult): Promise<void>;

  /**
   * Store QE state in hive memory
   */
  storeQEState(key: string, value: unknown): Promise<void>;

  /**
   * Retrieve QE state from hive memory
   */
  getQEState<T>(key: string): Promise<T | null>;

  /**
   * Get queen identifier
   */
  getQueenId(): string;

  /**
   * Leave the hive (cleanup)
   */
  leave(): Promise<void>;
}

// =============================================================================
// Model Routing Adapter Interfaces
// =============================================================================

/**
 * QE task for model routing
 */
export interface QETask {
  /** Task category */
  category: string;

  /** Task description */
  description: string;

  /** Target file path (optional) */
  targetPath?: string;

  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * Model tier
 */
export type ModelTier = 1 | 2 | 3;

/**
 * Model selection
 */
export type ModelSelection = 'haiku' | 'sonnet' | 'opus';

/**
 * Route result from model routing
 */
export interface QERouteResult {
  /** Selected model tier */
  tier: ModelTier;

  /** Selected model */
  model: ModelSelection;

  /** QE category */
  qeCategory: string;

  /** QE complexity score (0-1) */
  qeComplexity: number;

  /** Recommended agents for this task */
  recommendedAgents: string[];

  /** Estimated cost */
  costEstimate: number;

  /** Whether Agent Booster can handle this */
  agentBoosterAvailable: boolean;

  /** Agent Booster intent if available */
  agentBoosterIntent?: string;

  /** Explanation of routing decision */
  explanation: string;
}

/**
 * Model routing adapter interface for TinyDancer <-> ADR-026 alignment
 */
export interface IQEModelRoutingAdapter {
  /**
   * Route a QE task to the appropriate model tier
   */
  routeQETask(task: QETask): Promise<QERouteResult>;

  /**
   * Get complexity score for a category
   */
  getCategoryComplexity(category: string): number;

  /**
   * Get recommended agents for a tier and category
   */
  getRecommendedAgents(category: string, tier: ModelTier): string[];

  /**
   * Estimate cost for a task
   */
  estimateCost(task: QETask, tier: ModelTier): number;

  /**
   * Check if Agent Booster can handle the task
   */
  canUseAgentBooster(task: QETask): { available: boolean; intent?: string };
}

// =============================================================================
// Plugin Context Interface
// =============================================================================

/**
 * QE Plugin context for dependency injection
 */
export interface QEPluginContext {
  /** Memory bridge */
  memory: IQEMemoryBridge;

  /** Security bridge */
  security: IQESecurityBridge;

  /** Core bridge */
  core: IQECoreBridge;

  /** Hive bridge */
  hive: IQEHiveBridge;

  /** Model routing adapter */
  modelRouter: IQEModelRoutingAdapter;

  /** Logger */
  logger: QELogger;

  /** Configuration */
  config: QEPluginConfig;
}

/**
 * QE logger interface
 */
export interface QELogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * QE plugin configuration
 */
export interface QEPluginConfig {
  /** Plugin namespace */
  namespace: string;

  /** Default timeout */
  defaultTimeout: number;

  /** Enable learning */
  enableLearning: boolean;

  /** Max concurrent tests */
  maxConcurrentTests: number;

  /** Coverage target */
  coverageTarget: number;

  /** Security level */
  securityLevel: 'low' | 'medium' | 'high' | 'critical';
}
