/**
 * Evolution Pipeline
 *
 * Every change to prompts, policies, tools, and code becomes a signed change
 * proposal that goes through simulation, replay comparison, and staged rollout.
 *
 * Pipeline stages:
 * 1. Propose - Create a signed ChangeProposal
 * 2. Simulate - Replay golden traces with baseline vs candidate config
 * 3. Compare  - Approve or reject based on divergence threshold
 * 4. Stage    - Create a staged rollout plan (canary -> partial -> full)
 * 5. Advance  - Progress through stages with metric gates
 * 6. Promote / Rollback - Apply permanently or revert
 *
 * @module @claude-flow/guidance/evolution
 */

import { createHash, createHmac, randomUUID } from 'node:crypto';

// ============================================================================
// Types
// ============================================================================

/**
 * The kind of change being proposed.
 */
export type ChangeProposalKind =
  | 'rule-modify'
  | 'rule-add'
  | 'rule-remove'
  | 'rule-promote'
  | 'policy-update'
  | 'tool-config'
  | 'budget-adjust';

/**
 * Lifecycle status of a change proposal.
 */
export type ProposalStatus =
  | 'draft'
  | 'signed'
  | 'simulating'
  | 'compared'
  | 'staged'
  | 'promoted'
  | 'rolled-back'
  | 'rejected';

/**
 * Risk assessment attached to a proposal.
 */
export interface RiskAssessment {
  level: 'low' | 'medium' | 'high';
  factors: string[];
}

/**
 * A signed change proposal describing a modification to the guidance system.
 */
export interface ChangeProposal {
  /** Unique identifier (UUID) */
  proposalId: string;
  /** What kind of change this is */
  kind: ChangeProposalKind;
  /** Short human-readable title */
  title: string;
  /** Longer description of the change */
  description: string;
  /** Agent or human ID that authored the proposal */
  author: string;
  /** Dot-path or identifier of what is being changed */
  targetPath: string;
  /** Before/after snapshot of the change */
  diff: { before: unknown; after: unknown };
  /** Why this change is being proposed */
  rationale: string;
  /** Risk assessment for the change */
  riskAssessment: RiskAssessment;
  /** HMAC-SHA256 signature of the proposal content */
  signature: string;
  /** Epoch ms when the proposal was created */
  createdAt: number;
  /** Current lifecycle status */
  status: ProposalStatus;
}

/**
 * A single decision point where baseline and candidate diverged.
 */
export interface DecisionDiff {
  /** Sequence number in the trace */
  seq: number;
  /** What the baseline decided */
  baseline: unknown;
  /** What the candidate decided */
  candidate: unknown;
  /** How severe the divergence is */
  severity: 'low' | 'medium' | 'high';
}

/**
 * Result of simulating a proposal against golden traces.
 */
export interface SimulationResult {
  /** Proposal that was simulated */
  proposalId: string;
  /** Hash of the trace produced by baseline config */
  baselineTraceHash: string;
  /** Hash of the trace produced by candidate config */
  candidateTraceHash: string;
  /** 0-1 score: 0 = identical, 1 = completely different */
  divergenceScore: number;
  /** Individual decision points where behaviour diverged */
  decisionDiffs: DecisionDiff[];
  /** Side-by-side metric comparison */
  metricsComparison: {
    baseline: Record<string, number>;
    candidate: Record<string, number>;
  };
  /** Whether the simulation passed acceptance criteria */
  passed: boolean;
  /** Human-readable reason for the verdict */
  reason: string;
}

/**
 * A single stage in a staged rollout.
 */
export interface RolloutStage {
  /** Stage name (e.g. 'canary', 'partial', 'full') */
  name: string;
  /** Percentage of traffic/agents this stage covers (0-100) */
  percentage: number;
  /** How long this stage should run before advancing (ms) */
  durationMs: number;
  /** Observed metrics during this stage */
  metrics: Record<string, number>;
  /** Maximum acceptable divergence before auto-rollback */
  divergenceThreshold: number;
  /** null = not evaluated yet, true = passed, false = failed */
  passed: boolean | null;
  /** Epoch ms when the stage started (null if not started) */
  startedAt: number | null;
  /** Epoch ms when the stage completed (null if not completed) */
  completedAt: number | null;
}

/**
 * A staged rollout plan for a change proposal.
 */
export interface StagedRollout {
  /** Unique rollout identifier */
  rolloutId: string;
  /** The proposal being rolled out */
  proposalId: string;
  /** Ordered stages (canary -> partial -> full) */
  stages: RolloutStage[];
  /** Index of the current stage (0-based) */
  currentStage: number;
  /** Overall rollout status */
  status: 'in-progress' | 'completed' | 'rolled-back';
  /** Epoch ms when the rollout started */
  startedAt: number;
  /** Epoch ms when the rollout completed (null if still running) */
  completedAt: number | null;
}

/**
 * History entry combining proposal, optional simulation, optional rollout,
 * and final outcome.
 */
export interface EvolutionHistoryEntry {
  proposal: ChangeProposal;
  simulation?: SimulationResult;
  rollout?: StagedRollout;
  outcome: ProposalStatus;
}

/**
 * Evaluator function for simulation: given a golden trace and a config variant,
 * produce a trace hash and metrics.
 */
export type TraceEvaluator = (
  trace: unknown,
  config: 'baseline' | 'candidate',
) => { traceHash: string; metrics: Record<string, number>; decisions: unknown[] };

// ============================================================================
// Configuration
// ============================================================================

export interface EvolutionPipelineConfig {
  /** HMAC signing key for proposals */
  signingKey?: string;
  /** Maximum divergence score (0-1) to approve a change */
  maxDivergence?: number;
  /** Default rollout stages */
  stages?: RolloutStage[];
}

const DEFAULT_MAX_DIVERGENCE = 0.3;

const DEFAULT_STAGES: RolloutStage[] = [
  {
    name: 'canary',
    percentage: 5,
    durationMs: 60_000,
    metrics: {},
    divergenceThreshold: 0.2,
    passed: null,
    startedAt: null,
    completedAt: null,
  },
  {
    name: 'partial',
    percentage: 50,
    durationMs: 300_000,
    metrics: {},
    divergenceThreshold: 0.25,
    passed: null,
    startedAt: null,
    completedAt: null,
  },
  {
    name: 'full',
    percentage: 100,
    durationMs: 600_000,
    metrics: {},
    divergenceThreshold: 0.3,
    passed: null,
    startedAt: null,
    completedAt: null,
  },
];

// ============================================================================
// EvolutionPipeline
// ============================================================================

/**
 * The Evolution Pipeline manages the lifecycle of change proposals through
 * signing, simulation, comparison, staged rollout, and promotion or rollback.
 */
export class EvolutionPipeline {
  private readonly signingKey: string;
  private readonly maxDivergence: number;
  private readonly defaultStages: RolloutStage[];

  private proposals = new Map<string, ChangeProposal>();
  private simulations = new Map<string, SimulationResult>();
  private rollouts = new Map<string, StagedRollout>();

  constructor(config: EvolutionPipelineConfig = {}) {
    if (!config.signingKey) {
      throw new Error('EvolutionPipeline requires an explicit signingKey — hardcoded defaults are not secure');
    }
    this.signingKey = config.signingKey;
    this.maxDivergence = config.maxDivergence ?? DEFAULT_MAX_DIVERGENCE;
    this.defaultStages = config.stages ?? DEFAULT_STAGES;
  }

  // ==========================================================================
  // Propose
  // ==========================================================================

  /**
   * Create and sign a new change proposal.
   */
  propose(params: {
    kind: ChangeProposalKind;
    title: string;
    description: string;
    author: string;
    targetPath: string;
    diff: { before: unknown; after: unknown };
    rationale: string;
    riskAssessment: RiskAssessment;
  }): ChangeProposal {
    const proposalId = randomUUID();
    const createdAt = Date.now();

    const proposal: ChangeProposal = {
      proposalId,
      kind: params.kind,
      title: params.title,
      description: params.description,
      author: params.author,
      targetPath: params.targetPath,
      diff: params.diff,
      rationale: params.rationale,
      riskAssessment: params.riskAssessment,
      signature: '', // placeholder, signed below
      createdAt,
      status: 'draft',
    };

    proposal.signature = this.signProposal(proposal);
    proposal.status = 'signed';

    this.proposals.set(proposalId, proposal);
    return proposal;
  }

  // ==========================================================================
  // Simulate
  // ==========================================================================

  /**
   * Run golden traces through both baseline and candidate configs to measure
   * divergence. The evaluator is called once per golden trace per config.
   */
  simulate(
    proposalId: string,
    goldenTraces: unknown[],
    evaluator: TraceEvaluator,
  ): SimulationResult {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal not found: ${proposalId}`);
    }

    proposal.status = 'simulating';

    // Evaluate each trace against both configs
    const baselineResults = goldenTraces.map(t => evaluator(t, 'baseline'));
    const candidateResults = goldenTraces.map(t => evaluator(t, 'candidate'));

    // Compute composite trace hashes
    const baselineTraceHash = this.hashTraceResults(baselineResults.map(r => r.traceHash));
    const candidateTraceHash = this.hashTraceResults(candidateResults.map(r => r.traceHash));

    // Compute decision diffs
    const decisionDiffs: DecisionDiff[] = [];
    for (let i = 0; i < goldenTraces.length; i++) {
      const bDecisions = baselineResults[i].decisions;
      const cDecisions = candidateResults[i].decisions;
      const maxLen = Math.max(bDecisions.length, cDecisions.length);

      for (let seq = 0; seq < maxLen; seq++) {
        const bVal = seq < bDecisions.length ? bDecisions[seq] : undefined;
        const cVal = seq < cDecisions.length ? cDecisions[seq] : undefined;

        if (JSON.stringify(bVal) !== JSON.stringify(cVal)) {
          decisionDiffs.push({
            seq,
            baseline: bVal,
            candidate: cVal,
            severity: this.classifyDiffSeverity(bVal, cVal),
          });
        }
      }
    }

    // Aggregate metrics
    const baselineMetrics = this.aggregateMetrics(baselineResults.map(r => r.metrics));
    const candidateMetrics = this.aggregateMetrics(candidateResults.map(r => r.metrics));

    // Compute divergence score (0-1)
    const divergenceScore = this.computeDivergenceScore(
      baselineTraceHash,
      candidateTraceHash,
      decisionDiffs,
      goldenTraces.length,
    );

    const passed = divergenceScore <= this.maxDivergence;
    const reason = passed
      ? `Divergence ${divergenceScore.toFixed(3)} is within threshold ${this.maxDivergence}`
      : `Divergence ${divergenceScore.toFixed(3)} exceeds threshold ${this.maxDivergence}`;

    const result: SimulationResult = {
      proposalId,
      baselineTraceHash,
      candidateTraceHash,
      divergenceScore,
      decisionDiffs,
      metricsComparison: {
        baseline: baselineMetrics,
        candidate: candidateMetrics,
      },
      passed,
      reason,
    };

    this.simulations.set(proposalId, result);
    return result;
  }

  // ==========================================================================
  // Compare
  // ==========================================================================

  /**
   * Compare a simulation result against acceptance criteria.
   *
   * Checks:
   * 1. Divergence is below threshold
   * 2. No regression in key metrics (candidate >= baseline)
   */
  compare(
    proposalId: string,
    simulationResult: SimulationResult,
  ): { approved: boolean; reason: string } {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal not found: ${proposalId}`);
    }

    // Check divergence threshold
    if (simulationResult.divergenceScore > this.maxDivergence) {
      proposal.status = 'rejected';
      return {
        approved: false,
        reason: `Divergence ${simulationResult.divergenceScore.toFixed(3)} exceeds threshold ${this.maxDivergence}`,
      };
    }

    // Check for metric regressions
    const { baseline, candidate } = simulationResult.metricsComparison;
    const regressions: string[] = [];

    for (const key of Object.keys(baseline)) {
      if (candidate[key] !== undefined && candidate[key] < baseline[key]) {
        const pctDrop = ((baseline[key] - candidate[key]) / Math.max(baseline[key], 1)) * 100;
        // Only flag significant regressions (> 5%)
        if (pctDrop > 5) {
          regressions.push(`${key} regressed by ${pctDrop.toFixed(1)}%`);
        }
      }
    }

    if (regressions.length > 0) {
      proposal.status = 'rejected';
      return {
        approved: false,
        reason: `Metric regressions detected: ${regressions.join('; ')}`,
      };
    }

    proposal.status = 'compared';
    return {
      approved: true,
      reason: `Divergence ${simulationResult.divergenceScore.toFixed(3)} within threshold, no metric regressions`,
    };
  }

  // ==========================================================================
  // Stage
  // ==========================================================================

  /**
   * Create a staged rollout plan for a proposal.
   */
  stage(proposalId: string): StagedRollout {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal not found: ${proposalId}`);
    }

    const now = Date.now();

    // Deep-clone default stages so each rollout has independent state
    const stages: RolloutStage[] = this.defaultStages.map(s => ({
      ...s,
      metrics: { ...s.metrics },
      passed: null,
      startedAt: null,
      completedAt: null,
    }));

    // Start the first stage immediately
    stages[0].startedAt = now;

    const rollout: StagedRollout = {
      rolloutId: randomUUID(),
      proposalId,
      stages,
      currentStage: 0,
      status: 'in-progress',
      startedAt: now,
      completedAt: null,
    };

    proposal.status = 'staged';
    this.rollouts.set(rollout.rolloutId, rollout);
    return rollout;
  }

  // ==========================================================================
  // Advance Stage
  // ==========================================================================

  /**
   * Advance to the next rollout stage or auto-rollback.
   *
   * If `stageMetrics.divergence` exceeds the current stage's threshold,
   * the rollout is automatically rolled back.
   */
  advanceStage(
    rolloutId: string,
    stageMetrics: Record<string, number>,
  ): { advanced: boolean; rolledBack: boolean; reason: string } {
    const rollout = this.rollouts.get(rolloutId);
    if (!rollout) {
      throw new Error(`Rollout not found: ${rolloutId}`);
    }

    if (rollout.status !== 'in-progress') {
      return {
        advanced: false,
        rolledBack: false,
        reason: `Rollout is ${rollout.status}, not in-progress`,
      };
    }

    const current = rollout.stages[rollout.currentStage];
    const now = Date.now();

    // Record metrics on the current stage
    current.metrics = { ...stageMetrics };

    // Check divergence against threshold
    const divergence = stageMetrics.divergence ?? 0;
    if (divergence > current.divergenceThreshold) {
      // Auto-rollback
      current.passed = false;
      current.completedAt = now;
      this.rollback(rolloutId, `Stage "${current.name}" divergence ${divergence.toFixed(3)} exceeded threshold ${current.divergenceThreshold}`);
      return {
        advanced: false,
        rolledBack: true,
        reason: `Auto-rollback: divergence ${divergence.toFixed(3)} exceeded threshold ${current.divergenceThreshold} at stage "${current.name}"`,
      };
    }

    // Current stage passed
    current.passed = true;
    current.completedAt = now;

    // Check if there are more stages
    if (rollout.currentStage < rollout.stages.length - 1) {
      rollout.currentStage += 1;
      rollout.stages[rollout.currentStage].startedAt = now;
      return {
        advanced: true,
        rolledBack: false,
        reason: `Advanced to stage "${rollout.stages[rollout.currentStage].name}"`,
      };
    }

    // All stages complete - auto-promote
    rollout.status = 'completed';
    rollout.completedAt = now;
    const proposal = this.proposals.get(rollout.proposalId);
    if (proposal) {
      proposal.status = 'promoted';
    }

    return {
      advanced: true,
      rolledBack: false,
      reason: 'All stages completed successfully; proposal promoted',
    };
  }

  // ==========================================================================
  // Rollback
  // ==========================================================================

  /**
   * Roll back a staged rollout.
   */
  rollback(rolloutId: string, reason: string): void {
    const rollout = this.rollouts.get(rolloutId);
    if (!rollout) {
      throw new Error(`Rollout not found: ${rolloutId}`);
    }

    rollout.status = 'rolled-back';
    rollout.completedAt = Date.now();

    const proposal = this.proposals.get(rollout.proposalId);
    if (proposal) {
      proposal.status = 'rolled-back';
    }
  }

  // ==========================================================================
  // Promote
  // ==========================================================================

  /**
   * Promote a rollout, permanently applying the change.
   */
  promote(rolloutId: string): void {
    const rollout = this.rollouts.get(rolloutId);
    if (!rollout) {
      throw new Error(`Rollout not found: ${rolloutId}`);
    }

    rollout.status = 'completed';
    rollout.completedAt = Date.now();

    const proposal = this.proposals.get(rollout.proposalId);
    if (proposal) {
      proposal.status = 'promoted';
    }
  }

  // ==========================================================================
  // Queries
  // ==========================================================================

  /**
   * Get a proposal by ID.
   */
  getProposal(id: string): ChangeProposal | undefined {
    return this.proposals.get(id);
  }

  /**
   * Get all proposals, optionally filtered by status.
   */
  getProposals(status?: ProposalStatus): ChangeProposal[] {
    const all = Array.from(this.proposals.values());
    if (status === undefined) {
      return all;
    }
    return all.filter(p => p.status === status);
  }

  /**
   * Get a rollout by ID.
   */
  getRollout(id: string): StagedRollout | undefined {
    return this.rollouts.get(id);
  }

  /**
   * Get the full evolution history across all proposals.
   */
  getHistory(): EvolutionHistoryEntry[] {
    return Array.from(this.proposals.values()).map(proposal => ({
      proposal,
      simulation: this.simulations.get(proposal.proposalId),
      rollout: this.findRolloutByProposal(proposal.proposalId),
      outcome: proposal.status,
    }));
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Produce an HMAC-SHA256 signature for a proposal.
   *
   * The signature covers every field except `signature` and `status`.
   */
  private signProposal(proposal: ChangeProposal): string {
    const body = {
      proposalId: proposal.proposalId,
      kind: proposal.kind,
      title: proposal.title,
      description: proposal.description,
      author: proposal.author,
      targetPath: proposal.targetPath,
      diff: proposal.diff,
      rationale: proposal.rationale,
      riskAssessment: proposal.riskAssessment,
      createdAt: proposal.createdAt,
    };
    const payload = JSON.stringify(body);
    return createHmac('sha256', this.signingKey).update(payload).digest('hex');
  }

  /**
   * Compute a composite hash from an array of trace hashes.
   */
  private hashTraceResults(traceHashes: string[]): string {
    const payload = traceHashes.join(':');
    return createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Classify how severe a single decision diff is.
   */
  private classifyDiffSeverity(
    baseline: unknown,
    candidate: unknown,
  ): 'low' | 'medium' | 'high' {
    // If one is undefined (extra/missing decision), it is high
    if (baseline === undefined || candidate === undefined) {
      return 'high';
    }

    const bStr = JSON.stringify(baseline);
    const cStr = JSON.stringify(candidate);

    // Very different lengths suggest structural changes
    if (Math.abs(bStr.length - cStr.length) > bStr.length * 0.5) {
      return 'high';
    }

    // Moderate difference
    if (bStr.length > 0 && Math.abs(bStr.length - cStr.length) > bStr.length * 0.2) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Compute an overall divergence score (0-1).
   */
  private computeDivergenceScore(
    baselineHash: string,
    candidateHash: string,
    diffs: DecisionDiff[],
    traceCount: number,
  ): number {
    // If hashes are identical, divergence = 0
    if (baselineHash === candidateHash) {
      return 0;
    }

    // If there are no golden traces, treat as fully divergent
    if (traceCount === 0) {
      return 1;
    }

    // Weight diffs by severity
    const severityWeights: Record<string, number> = {
      low: 0.1,
      medium: 0.4,
      high: 1.0,
    };

    const totalWeight = diffs.reduce(
      (sum, d) => sum + (severityWeights[d.severity] ?? 0.5),
      0,
    );

    // Normalize: max possible weight is traceCount * maxDecisionsPerTrace
    // Use a heuristic cap to keep score in [0, 1]
    const maxExpected = traceCount * 5; // assume ~5 decisions per trace at max weight
    const raw = totalWeight / Math.max(maxExpected, 1);

    return Math.min(1, Math.max(0, raw));
  }

  /**
   * Aggregate an array of metric records into averages.
   */
  private aggregateMetrics(records: Record<string, number>[]): Record<string, number> {
    if (records.length === 0) return {};

    const sums: Record<string, number> = {};
    const counts: Record<string, number> = {};

    for (const record of records) {
      for (const [key, value] of Object.entries(record)) {
        sums[key] = (sums[key] ?? 0) + value;
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }

    const result: Record<string, number> = {};
    for (const key of Object.keys(sums)) {
      result[key] = sums[key] / counts[key];
    }
    return result;
  }

  /**
   * Find the rollout associated with a proposal.
   */
  private findRolloutByProposal(proposalId: string): StagedRollout | undefined {
    for (const rollout of this.rollouts.values()) {
      if (rollout.proposalId === proposalId) {
        return rollout;
      }
    }
    return undefined;
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an EvolutionPipeline instance.
 */
export function createEvolutionPipeline(
  config?: EvolutionPipelineConfig,
): EvolutionPipeline {
  return new EvolutionPipeline(config);
}
