/**
 * @claude-flow/guidance - Guidance Control Plane
 *
 * Sits beside Claude Code (not inside it) to:
 * 1. Compile CLAUDE.md into constitution + shards + manifest
 * 2. Retrieve task-relevant shards at runtime via intent classification
 * 3. Enforce non-negotiables through hook gates
 * 4. Log every run to a ledger with evaluators
 * 5. Evolve the rule set through an optimizer loop
 *
 * Architecture:
 * - Root CLAUDE.md → Repo constitution (rare changes)
 * - CLAUDE.local.md → Overlay / experiment sandbox (frequent changes)
 * - Optimizer → Promotes winning local rules to root
 *
 * Integration with Claude Code:
 * - Headless mode (claude -p --output-format json) for automated testing
 * - Hook system for enforcement gates
 * - RuVector/HNSW for semantic shard retrieval
 *
 * @module @claude-flow/guidance
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// Core components
import { GuidanceCompiler, createCompiler } from './compiler.js';
import { ShardRetriever, createRetriever, HashEmbeddingProvider } from './retriever.js';
import { EnforcementGates, createGates } from './gates.js';
import { RunLedger, createLedger } from './ledger.js';
import { OptimizerLoop, createOptimizer } from './optimizer.js';
import { HeadlessRunner, createHeadlessRunner } from './headless.js';
import { DeterministicToolGateway, createToolGateway } from './gateway.js';

// Re-export all types
export type {
  // Core types
  RiskClass,
  ToolClass,
  TaskIntent,
  GuidanceRule,
  RuleShard,
  Constitution,
  RuleManifest,
  PolicyBundle,
  // Retrieval
  RetrievalRequest,
  RetrievalResult,
  // Gates
  GateDecision,
  GateResult,
  GateConfig,
  // Ledger
  RunEvent,
  Violation,
  EvaluatorResult,
  // Optimizer
  ViolationRanking,
  RuleChange,
  ABTestResult,
  OptimizationMetrics,
  RuleADR,
  // Control Plane
  GuidanceControlPlaneConfig,
  ControlPlaneStatus,
} from './types.js';

// Re-export components
export { GuidanceCompiler, createCompiler } from './compiler.js';
export type { CompilerConfig } from './compiler.js';
export { ShardRetriever, createRetriever, HashEmbeddingProvider } from './retriever.js';
export type { IEmbeddingProvider } from './retriever.js';
export { EnforcementGates, createGates } from './gates.js';
export {
  GuidanceHookProvider,
  createGuidanceHooks,
  gateResultsToHookResult,
} from './hooks.js';
export {
  RunLedger,
  createLedger,
  TestsPassEvaluator,
  ForbiddenCommandEvaluator,
  ForbiddenDependencyEvaluator,
  ViolationRateEvaluator,
  DiffQualityEvaluator,
} from './ledger.js';
export type { IEvaluator } from './ledger.js';
export { OptimizerLoop, createOptimizer } from './optimizer.js';
export type { OptimizerConfig } from './optimizer.js';
export {
  PersistentLedger,
  EventStore,
  createPersistentLedger,
  createEventStore,
} from './persistence.js';
export type { PersistenceConfig, StorageStats } from './persistence.js';
export {
  HeadlessRunner,
  createHeadlessRunner,
  ProcessExecutor,
  createComplianceSuite,
} from './headless.js';
export type {
  TestTask,
  TaskAssertion,
  TaskRunResult,
  HeadlessOutput,
  SuiteRunSummary,
  ICommandExecutor,
} from './headless.js';
export { DeterministicToolGateway, createToolGateway } from './gateway.js';
export type {
  ToolSchema,
  Budget,
  IdempotencyRecord,
  GatewayDecision,
  ToolGatewayConfig,
} from './gateway.js';
export { ArtifactLedger, createArtifactLedger } from './artifacts.js';
export type {
  ArtifactKind,
  Artifact,
  ArtifactLineage,
  ArtifactVerification,
  ArtifactSearchQuery,
  ArtifactStats,
  ArtifactLedgerConfig,
  RecordArtifactParams,
  SerializedArtifactLedger,
} from './artifacts.js';
export { EvolutionPipeline, createEvolutionPipeline } from './evolution.js';
export type {
  ChangeProposalKind,
  ProposalStatus,
  RiskAssessment,
  ChangeProposal,
  DecisionDiff,
  SimulationResult,
  RolloutStage,
  StagedRollout,
  EvolutionHistoryEntry,
  TraceEvaluator,
  EvolutionPipelineConfig,
} from './evolution.js';
export {
  ManifestValidator,
  ConformanceSuite,
  createManifestValidator,
  createConformanceSuite,
} from './manifest-validator.js';
export type {
  AgentCellManifest,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  GoldenTrace,
  GoldenTraceEvent,
  ConformanceResult,
} from './manifest-validator.js';
export { ProofChain, createProofChain } from './proof.js';
export type {
  ToolCallRecord,
  MemoryOperation,
  MemoryLineageEntry,
  ProofEnvelopeMetadata,
  ProofEnvelope,
  SerializedProofChain,
} from './proof.js';
export {
  MemoryWriteGate,
  createMemoryWriteGate,
  createMemoryEntry,
} from './memory-gate.js';
export type {
  MemoryAuthority,
  MemoryEntry,
  WriteDecision,
  MemoryWriteGateConfig,
} from './memory-gate.js';
export {
  CoherenceScheduler,
  EconomicGovernor,
  createCoherenceScheduler,
  createEconomicGovernor,
} from './coherence.js';
export type {
  CoherenceScore,
  CoherenceThresholds,
  PrivilegeLevel,
  BudgetUsage,
  CoherenceSchedulerConfig,
  EconomicGovernorConfig,
} from './coherence.js';
export { CapabilityAlgebra, createCapabilityAlgebra } from './capabilities.js';
export type {
  CapabilityScope,
  CapabilityConstraint,
  Attestation,
  Capability,
  CapabilityCheckResult,
} from './capabilities.js';
export {
  SimulatedRuntime,
  MemoryClerkCell,
  ConformanceRunner,
  createMemoryClerkCell,
  createConformanceRunner,
} from './conformance-kit.js';
export type {
  TraceEvent as CellTraceEvent,
  CellRunResult,
  CellRuntime,
  AgentCell,
  SimulatedRuntimeConfig,
  ConformanceTestResult,
  ReplayTestResult,
} from './conformance-kit.js';
export {
  RuvBotGuidanceBridge,
  AIDefenceGate,
  RuvBotMemoryAdapter,
  createRuvBotBridge,
  createAIDefenceGate,
  createRuvBotMemoryAdapter,
} from './ruvbot-integration.js';
export type {
  RuvBotInstance,
  RuvBotAIDefenceGuard,
  RuvBotMemory,
  AIDefenceThreat,
  AIDefenceResult,
  AIDefenceGateConfig,
  RuvBotBridgeConfig,
  RuvBotEvent,
} from './ruvbot-integration.js';
export { MetaGovernor, createMetaGovernor } from './meta-governance.js';
export type {
  InvariantCheckResult,
  GovernanceState,
  ConstitutionalInvariant,
  AmendmentChange,
  Amendment,
  OptimizerConstraint,
  OptimizerAction,
  OptimizerValidation,
  InvariantReport,
  MetaGovernanceConfig,
} from './meta-governance.js';
export {
  ThreatDetector,
  CollusionDetector,
  MemoryQuorum,
  createThreatDetector,
  createCollusionDetector,
  createMemoryQuorum,
} from './adversarial.js';
export type {
  ThreatCategory,
  ThreatSignal,
  DetectionPattern,
  CollusionReport,
  MemoryProposal,
  QuorumResult,
  ThreatDetectorConfig,
  CollusionDetectorConfig,
  MemoryQuorumConfig,
} from './adversarial.js';
export { ContinueGate, createContinueGate } from './continue-gate.js';
export type {
  ContinueGateConfig,
  StepContext,
  ContinueDecision,
} from './continue-gate.js';

// WASM Kernel exports
export {
  getKernel,
  isWasmAvailable,
  resetKernel,
} from './wasm-kernel.js';
export type {
  WasmKernel,
  BatchOp,
  BatchResult,
} from './wasm-kernel.js';
export {
  generateClaudeMd,
  generateClaudeLocalMd,
  generateSkillMd,
  generateAgentMd,
  generateAgentIndex,
  scaffold,
} from './generators.js';
export type {
  ProjectProfile,
  LocalProfile,
  SkillDefinition,
  AgentDefinition,
  ScaffoldOptions,
  ScaffoldResult,
} from './generators.js';
export {
  analyze,
  benchmark,
  autoOptimize,
  optimizeForSize,
  headlessBenchmark,
  validateEffect,
  abBenchmark,
  getDefaultABTasks,
  formatReport,
  formatBenchmark,
} from './analyzer.js';
export type {
  AnalysisResult,
  AnalysisMetrics,
  DimensionScore,
  Suggestion,
  BenchmarkResult,
  ContextSize,
  OptimizeOptions,
  HeadlessBenchmarkResult,
  HeadlessTaskResult,
  IHeadlessExecutor,
  IContentAwareExecutor,
  ValidationAssertion,
  ValidationTask,
  ValidationTaskResult,
  ValidationRun,
  CorrelationResult,
  ValidationReport,
  ABTaskClass,
  ABTask,
  ABGatePattern,
  ABTaskResult,
  ABMetrics,
  ABReport,
} from './analyzer.js';

export {
  TrustAccumulator,
  TrustLedger as TrustScoreLedger,
  TrustSystem,
  getTrustBasedRateLimit,
  createTrustAccumulator,
  createTrustSystem,
} from './trust.js';
export type {
  TrustTier,
  GateOutcome,
  TrustConfig,
  TrustRecord,
  TrustSnapshot,
} from './trust.js';
export {
  TruthAnchorStore,
  TruthResolver,
  createTruthAnchorStore,
  createTruthResolver,
} from './truth-anchors.js';
export type {
  TruthSourceKind,
  TruthAnchor,
  TruthAnchorConfig,
  AnchorParams,
  TruthAnchorQuery,
  VerifyAllResult,
  ConflictResolution,
} from './truth-anchors.js';
export {
  UncertaintyLedger,
  UncertaintyAggregator,
  createUncertaintyLedger,
  createUncertaintyAggregator,
} from './uncertainty.js';
export type {
  BeliefStatus,
  ConfidenceInterval,
  Belief,
  UncertaintyConfig,
} from './uncertainty.js';
export {
  TemporalStore,
  TemporalReasoner,
  createTemporalStore,
  createTemporalReasoner,
} from './temporal.js';
export type {
  TemporalStatus,
  ValidityWindow,
  TemporalAssertion,
  TemporalTimeline,
  TemporalChange,
  TemporalConfig,
} from './temporal.js';
export {
  AuthorityGate,
  IrreversibilityClassifier,
  createAuthorityGate,
  createIrreversibilityClassifier,
  isHigherAuthority,
  getAuthorityHierarchy,
} from './authority.js';
export type {
  AuthorityLevel,
  IrreversibilityClass,
  ProofLevel,
  AuthorityScope,
  HumanIntervention,
  AuthorityCheckResult,
  IrreversibilityResult,
  AuthorityGateConfig,
  IrreversibilityClassifierConfig,
} from './authority.js';

import type {
  PolicyBundle,
  GuidanceControlPlaneConfig,
  ControlPlaneStatus,
  RetrievalRequest,
  RetrievalResult,
  GateResult,
  RunEvent,
  EvaluatorResult,
  TaskIntent,
  Violation,
} from './types.js';

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: GuidanceControlPlaneConfig = {
  rootGuidancePath: './CLAUDE.md',
  localGuidancePath: './CLAUDE.local.md',
  gates: {},
  maxShardsPerTask: 5,
  optimizationCycleDays: 7,
  dataDir: './.claude-flow/guidance',
  headlessMode: false,
};

// ============================================================================
// Guidance Control Plane
// ============================================================================

/**
 * The main Guidance Control Plane
 *
 * Orchestrates all components:
 * - Compiler: CLAUDE.md → PolicyBundle
 * - Retriever: PolicyBundle → task-relevant shards
 * - Gates: enforcement hooks
 * - Ledger: run logging + evaluation
 * - Optimizer: rule evolution
 * - Headless: automated testing
 */
export class GuidanceControlPlane {
  private config: GuidanceControlPlaneConfig;
  private compiler: GuidanceCompiler;
  private retriever: ShardRetriever;
  private gates: EnforcementGates;
  private ledger: RunLedger;
  private optimizer: OptimizerLoop;
  private headless: HeadlessRunner | null = null;

  private bundle: PolicyBundle | null = null;
  private initialized = false;

  constructor(config: Partial<GuidanceControlPlaneConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.compiler = createCompiler();
    this.retriever = createRetriever();
    this.gates = createGates(this.config.gates);
    this.ledger = createLedger();
    this.optimizer = createOptimizer();
  }

  /**
   * Initialize the control plane
   *
   * 1. Read and compile guidance files
   * 2. Load shards into retriever
   * 3. Configure gates
   * 4. Set up headless runner if enabled
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Step 1: Read guidance files
    const rootContent = await this.readGuidanceFile(this.config.rootGuidancePath);
    const localContent = this.config.localGuidancePath
      ? await this.readGuidanceFile(this.config.localGuidancePath)
      : undefined;

    if (!rootContent) {
      throw new Error(`Root guidance file not found: ${this.config.rootGuidancePath}`);
    }

    // Step 2: Compile
    this.bundle = this.compiler.compile(rootContent, localContent ?? undefined);

    // Step 3: Load into retriever
    await this.retriever.loadBundle(this.bundle);

    // Step 4: Set active rules on gates
    const allRules = [
      ...this.bundle.constitution.rules,
      ...this.bundle.shards.map(s => s.rule),
    ];
    this.gates.setActiveRules(allRules);

    // Step 5: Set up headless runner if enabled
    if (this.config.headlessMode) {
      this.headless = createHeadlessRunner(undefined, this.ledger, this.bundle.constitution.hash);
    }

    this.initialized = true;
  }

  /**
   * Compile guidance files (can be called independently)
   */
  async compile(rootContent: string, localContent?: string): Promise<PolicyBundle> {
    this.bundle = this.compiler.compile(rootContent, localContent);
    await this.retriever.loadBundle(this.bundle);

    const allRules = [
      ...this.bundle.constitution.rules,
      ...this.bundle.shards.map(s => s.rule),
    ];
    this.gates.setActiveRules(allRules);

    // Mark as initialized since we have a valid bundle
    this.initialized = true;

    return this.bundle;
  }

  /**
   * Retrieve relevant guidance for a task
   *
   * This is the main entry point called at task start.
   * Returns the constitution + relevant shards.
   */
  async retrieveForTask(request: RetrievalRequest): Promise<RetrievalResult> {
    this.ensureInitialized();
    return this.retriever.retrieve({
      ...request,
      maxShards: request.maxShards ?? this.config.maxShardsPerTask,
    });
  }

  /**
   * Evaluate a command through enforcement gates
   */
  evaluateCommand(command: string): GateResult[] {
    return this.gates.evaluateCommand(command);
  }

  /**
   * Evaluate a tool use through enforcement gates
   */
  evaluateToolUse(toolName: string, params: Record<string, unknown>): GateResult[] {
    return this.gates.evaluateToolUse(toolName, params);
  }

  /**
   * Evaluate a file edit through enforcement gates
   */
  evaluateEdit(filePath: string, content: string, diffLines: number): GateResult[] {
    return this.gates.evaluateEdit(filePath, content, diffLines);
  }

  /**
   * Start a run event for tracking
   */
  startRun(taskId: string, intent: TaskIntent): RunEvent {
    this.ensureInitialized();
    const event = this.ledger.createEvent(
      taskId,
      intent,
      this.bundle?.constitution.hash ?? 'unknown'
    );
    return event;
  }

  /**
   * Record a violation during a run
   */
  recordViolation(event: RunEvent, violation: Violation): void {
    event.violations.push(violation);
  }

  /**
   * Finalize a run and evaluate it
   */
  async finalizeRun(event: RunEvent): Promise<EvaluatorResult[]> {
    this.ledger.finalizeEvent(event);
    return this.ledger.evaluate(event);
  }

  /**
   * Run the optimization cycle
   */
  async optimize(): Promise<{
    promoted: string[];
    demoted: string[];
    adrsCreated: number;
  }> {
    this.ensureInitialized();

    if (this.ledger.eventCount < 10) {
      return { promoted: [], demoted: [], adrsCreated: 0 };
    }

    const result = await this.optimizer.runCycle(this.ledger, this.bundle!);

    // Apply promotions
    if (result.promoted.length > 0) {
      this.bundle = this.optimizer.applyPromotions(
        this.bundle!,
        result.promoted,
        result.changes
      );
      await this.retriever.loadBundle(this.bundle);
    }

    return {
      promoted: result.promoted,
      demoted: result.demoted,
      adrsCreated: result.adrs.length,
    };
  }

  /**
   * Get control plane status
   */
  getStatus(): ControlPlaneStatus {
    return {
      initialized: this.initialized,
      constitutionLoaded: this.bundle?.constitution != null,
      shardCount: this.retriever.shardCount,
      activeGates: this.gates.getActiveGateCount(),
      ledgerEventCount: this.ledger.eventCount,
      lastOptimizationRun: this.optimizer.lastRun,
      metrics: this.ledger.eventCount > 0
        ? this.ledger.computeMetrics()
        : null,
    };
  }

  /**
   * Get the current policy bundle
   */
  getBundle(): PolicyBundle | null {
    return this.bundle;
  }

  /**
   * Get the run ledger
   */
  getLedger(): RunLedger {
    return this.ledger;
  }

  /**
   * Get the optimizer
   */
  getOptimizer(): OptimizerLoop {
    return this.optimizer;
  }

  /**
   * Get the headless runner
   */
  getHeadlessRunner(): HeadlessRunner | null {
    return this.headless;
  }

  /**
   * Get metrics for benefit tracking
   */
  getMetrics(): {
    violationRatePer10Tasks: number;
    selfCorrectionRate: number;
    reworkLinesAvg: number;
    clarifyingQuestionsAvg: number;
    taskCount: number;
    topViolations: Array<{ ruleId: string; frequency: number; cost: number }>;
  } {
    const metrics = this.ledger.computeMetrics();
    const rankings = this.ledger.rankViolations();

    return {
      violationRatePer10Tasks: metrics.violationRate,
      selfCorrectionRate: metrics.selfCorrectionRate,
      reworkLinesAvg: metrics.reworkLines,
      clarifyingQuestionsAvg: metrics.clarifyingQuestions,
      taskCount: metrics.taskCount,
      topViolations: rankings.slice(0, 5).map(r => ({
        ruleId: r.ruleId,
        frequency: r.frequency,
        cost: r.cost,
      })),
    };
  }

  // ===== Private =====

  private async readGuidanceFile(path: string): Promise<string | null> {
    try {
      if (existsSync(path)) {
        return await readFile(path, 'utf-8');
      }
      return null;
    } catch {
      return null;
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('GuidanceControlPlane not initialized. Call initialize() first.');
    }
  }
}

/**
 * Create a guidance control plane instance
 */
export function createGuidanceControlPlane(
  config?: Partial<GuidanceControlPlaneConfig>
): GuidanceControlPlane {
  return new GuidanceControlPlane(config);
}

/**
 * Quick setup: create and initialize the control plane
 */
export async function initializeGuidanceControlPlane(
  config?: Partial<GuidanceControlPlaneConfig>
): Promise<GuidanceControlPlane> {
  const plane = new GuidanceControlPlane(config);
  await plane.initialize();
  return plane;
}

export default GuidanceControlPlane;
