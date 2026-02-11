/**
 * Coherence Scheduler & Economic Governor
 *
 * Detects drift in agent behavior and enforces resource budgets.
 *
 * CoherenceScheduler:
 * - Computes a coherence score from violation rate, rework, and intent drift
 * - Maps scores to privilege levels (full, restricted, read-only, suspended)
 * - Tracks score history and provides human-readable recommendations
 *
 * EconomicGovernor:
 * - Tracks token usage, tool calls, storage, and time
 * - Checks budgets and emits alerts when thresholds are crossed
 * - Estimates remaining capacity and costs
 *
 * @module @claude-flow/guidance/coherence
 */

import type { RunEvent, OptimizationMetrics } from './types.js';

// ============================================================================
// Coherence Types
// ============================================================================

/**
 * Coherence score computed from recent run metrics and events
 */
export interface CoherenceScore {
  /** Overall coherence (0-1, 1 = perfectly coherent) */
  overall: number;
  /** Violation component (0-1, lower violations = higher score) */
  violationComponent: number;
  /** Rework component (0-1, lower rework = higher score) */
  reworkComponent: number;
  /** Drift component (0-1, consistent intents = higher score) */
  driftComponent: number;
  /** Timestamp when this score was computed */
  timestamp: number;
  /** Number of events evaluated in the window */
  windowSize: number;
}

/**
 * Thresholds for privilege level determination
 */
export interface CoherenceThresholds {
  /** Below this overall score the agent is restricted to read-only */
  readOnlyThreshold: number;
  /** Below this overall score warnings are emitted */
  warningThreshold: number;
  /** Above this overall score the agent has full privileges */
  healthyThreshold: number;
  /** Above this overall score privilege escalation is allowed */
  privilegeEscalationThreshold: number;
}

/**
 * Privilege level derived from a coherence score
 */
export type PrivilegeLevel = 'full' | 'restricted' | 'read-only' | 'suspended';

// ============================================================================
// Economic Types
// ============================================================================

/**
 * Budget usage breakdown across all tracked dimensions
 */
export interface BudgetUsage {
  tokens: { used: number; limit: number; percentage: number };
  toolCalls: { used: number; limit: number; percentage: number };
  storage: { usedBytes: number; limitBytes: number; percentage: number };
  time: { usedMs: number; limitMs: number; percentage: number };
  cost: { totalUsd: number; limitUsd: number; percentage: number };
}

// ============================================================================
// Default Configurations
// ============================================================================

const DEFAULT_THRESHOLDS: CoherenceThresholds = {
  readOnlyThreshold: 0.3,
  warningThreshold: 0.5,
  healthyThreshold: 0.7,
  privilegeEscalationThreshold: 0.9,
};

const DEFAULT_ECONOMIC_CONFIG = {
  tokenLimit: 1_000_000,
  toolCallLimit: 10_000,
  storageLimit: 1_073_741_824, // 1 GiB
  timeLimit: 3_600_000, // 1 hour
  costPerToken: 0.000003, // $3 per million tokens
  costPerToolCall: 0.0001,
  costLimit: 10, // $10 USD
};

// ============================================================================
// Coherence Scheduler
// ============================================================================

export interface CoherenceSchedulerConfig {
  thresholds?: Partial<CoherenceThresholds>;
  windowSize?: number;
  checkIntervalMs?: number;
}

/**
 * Computes coherence scores from run metrics and events, determines privilege
 * levels, and provides recommendations when drift is detected.
 */
export class CoherenceScheduler {
  private readonly thresholds: CoherenceThresholds;
  private readonly windowSize: number;
  private readonly checkIntervalMs: number;
  private readonly scoreHistory: CoherenceScore[] = [];
  private static readonly MAX_HISTORY = 100;

  constructor(config: CoherenceSchedulerConfig = {}) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...config.thresholds };
    this.windowSize = config.windowSize ?? 20;
    this.checkIntervalMs = config.checkIntervalMs ?? 30_000;
  }

  /**
   * Compute a coherence score from optimization metrics and recent events.
   *
   * Components:
   * - violationComponent: 1 - (violationRate / 10) clamped to [0, 1]
   * - reworkComponent: 1 - (reworkLines / 100) clamped to [0, 1]
   * - driftComponent: intent consistency (fewer unique intents relative to window = higher)
   * - overall: weighted average (0.4 * violation + 0.3 * rework + 0.3 * drift)
   */
  computeCoherence(
    metrics: OptimizationMetrics,
    recentEvents: RunEvent[],
  ): CoherenceScore {
    const window = recentEvents.slice(-this.windowSize);
    const windowLen = window.length;

    // Violation component: fewer violations per 10 tasks = better
    const violationComponent = clamp(1 - metrics.violationRate / 10, 0, 1);

    // Rework component: fewer rework lines on average = better
    const reworkComponent = clamp(1 - metrics.reworkLines / 100, 0, 1);

    // Drift component: consistent intents = better
    // A single unique intent across N events means perfect consistency
    let driftComponent: number;
    if (windowLen === 0) {
      driftComponent = 1; // No events, assume no drift
    } else {
      const uniqueIntents = new Set(window.map(e => e.intent)).size;
      // 1 unique intent / N events = score 1; N unique / N events = score approaches 0
      driftComponent = clamp(1 - (uniqueIntents - 1) / Math.max(windowLen - 1, 1), 0, 1);
    }

    const overall =
      0.4 * violationComponent +
      0.3 * reworkComponent +
      0.3 * driftComponent;

    const score: CoherenceScore = {
      overall,
      violationComponent,
      reworkComponent,
      driftComponent,
      timestamp: Date.now(),
      windowSize: windowLen,
    };

    this.scoreHistory.push(score);
    if (this.scoreHistory.length > CoherenceScheduler.MAX_HISTORY) {
      this.scoreHistory.shift();
    }

    return score;
  }

  /**
   * Determine the privilege level from a coherence score.
   *
   * - overall >= healthyThreshold (0.7): 'full'
   * - overall >= warningThreshold (0.5): 'restricted'
   * - overall >= readOnlyThreshold (0.3): 'read-only'
   * - below readOnlyThreshold: 'suspended'
   */
  getPrivilegeLevel(score: CoherenceScore): PrivilegeLevel {
    if (score.overall >= this.thresholds.healthyThreshold) {
      return 'full';
    }
    if (score.overall >= this.thresholds.warningThreshold) {
      return 'restricted';
    }
    if (score.overall >= this.thresholds.readOnlyThreshold) {
      return 'read-only';
    }
    return 'suspended';
  }

  /**
   * Return the last 100 coherence scores (most recent last).
   */
  getScoreHistory(): CoherenceScore[] {
    return [...this.scoreHistory];
  }

  /**
   * Whether the score indicates healthy coherence.
   */
  isHealthy(score: CoherenceScore): boolean {
    return score.overall >= this.thresholds.healthyThreshold;
  }

  /**
   * Whether the score indicates drift (below warning threshold).
   */
  isDrifting(score: CoherenceScore): boolean {
    return score.overall < this.thresholds.warningThreshold;
  }

  /**
   * Whether the score warrants restricting agent actions.
   */
  shouldRestrict(score: CoherenceScore): boolean {
    return score.overall < this.thresholds.warningThreshold;
  }

  /**
   * Produce a human-readable recommendation based on the coherence score.
   */
  getRecommendation(score: CoherenceScore): string {
    const level = this.getPrivilegeLevel(score);
    const parts: string[] = [];

    switch (level) {
      case 'full':
        parts.push(
          `Coherence is healthy at ${(score.overall * 100).toFixed(1)}%.`,
        );
        if (score.overall >= this.thresholds.privilegeEscalationThreshold) {
          parts.push('Privilege escalation is permitted.');
        }
        break;

      case 'restricted':
        parts.push(
          `Coherence is degraded at ${(score.overall * 100).toFixed(1)}%. Agent privileges are restricted.`,
        );
        break;

      case 'read-only':
        parts.push(
          `Coherence is critically low at ${(score.overall * 100).toFixed(1)}%. Agent is limited to read-only operations.`,
        );
        break;

      case 'suspended':
        parts.push(
          `Coherence has collapsed to ${(score.overall * 100).toFixed(1)}%. Agent operations are suspended.`,
        );
        break;
    }

    // Add component-specific advice
    if (score.violationComponent < 0.5) {
      parts.push(
        `High violation rate detected (component: ${(score.violationComponent * 100).toFixed(0)}%). Review and strengthen enforcement gates.`,
      );
    }
    if (score.reworkComponent < 0.5) {
      parts.push(
        `Excessive rework detected (component: ${(score.reworkComponent * 100).toFixed(0)}%). Consider more prescriptive guidance or smaller task scopes.`,
      );
    }
    if (score.driftComponent < 0.5) {
      parts.push(
        `Intent drift detected (component: ${(score.driftComponent * 100).toFixed(0)}%). Agent is switching between too many task types. Focus on a single objective.`,
      );
    }

    return parts.join(' ');
  }

  /**
   * Get the configured check interval in milliseconds.
   */
  get interval(): number {
    return this.checkIntervalMs;
  }

  /**
   * Get the configured thresholds.
   */
  getThresholds(): CoherenceThresholds {
    return { ...this.thresholds };
  }
}

// ============================================================================
// Economic Governor
// ============================================================================

export interface EconomicGovernorConfig {
  tokenLimit?: number;
  toolCallLimit?: number;
  storageLimit?: number;
  timeLimit?: number;
  costPerToken?: number;
  costPerToolCall?: number;
  costLimit?: number;
}

interface ToolCallRecord {
  toolName: string;
  durationMs: number;
  timestamp: number;
}

/**
 * Tracks resource consumption (tokens, tool calls, storage, time, cost)
 * and enforces budget limits with alerts.
 */
export class EconomicGovernor {
  private readonly config: Required<EconomicGovernorConfig>;
  private tokensUsed = 0;
  private toolCallsUsed = 0;
  private storageUsed = 0;
  private readonly toolCallLog: ToolCallRecord[] = [];
  private readonly startTime: number;
  private periodStart: number;

  private static readonly ALERT_THRESHOLDS = [0.75, 0.9, 0.95, 1.0];

  constructor(config: EconomicGovernorConfig = {}) {
    this.config = {
      tokenLimit: config.tokenLimit ?? DEFAULT_ECONOMIC_CONFIG.tokenLimit,
      toolCallLimit: config.toolCallLimit ?? DEFAULT_ECONOMIC_CONFIG.toolCallLimit,
      storageLimit: config.storageLimit ?? DEFAULT_ECONOMIC_CONFIG.storageLimit,
      timeLimit: config.timeLimit ?? DEFAULT_ECONOMIC_CONFIG.timeLimit,
      costPerToken: config.costPerToken ?? DEFAULT_ECONOMIC_CONFIG.costPerToken,
      costPerToolCall: config.costPerToolCall ?? DEFAULT_ECONOMIC_CONFIG.costPerToolCall,
      costLimit: config.costLimit ?? DEFAULT_ECONOMIC_CONFIG.costLimit,
    };

    this.startTime = Date.now();
    this.periodStart = Date.now();
  }

  /**
   * Record token consumption.
   */
  recordTokenUsage(count: number): void {
    this.tokensUsed += count;
  }

  /**
   * Record a tool call with its name and duration.
   */
  recordToolCall(toolName: string, durationMs: number): void {
    this.toolCallsUsed++;
    this.toolCallLog.push({
      toolName,
      durationMs,
      timestamp: Date.now(),
    });
  }

  /**
   * Record storage usage in bytes.
   */
  recordStorageUsage(bytes: number): void {
    this.storageUsed += bytes;
  }

  /**
   * Check whether current usage is within budget limits.
   * Returns a summary with alerts for any limits that are near or exceeded.
   */
  checkBudget(): { withinBudget: boolean; usage: BudgetUsage; alerts: string[] } {
    const usage = this.getUsageSummary();
    const alerts: string[] = [];

    // Check each dimension against alert thresholds
    const dimensions: Array<{ name: string; percentage: number }> = [
      { name: 'tokens', percentage: usage.tokens.percentage },
      { name: 'tool calls', percentage: usage.toolCalls.percentage },
      { name: 'storage', percentage: usage.storage.percentage },
      { name: 'time', percentage: usage.time.percentage },
      { name: 'cost', percentage: usage.cost.percentage },
    ];

    let withinBudget = true;

    for (const dim of dimensions) {
      if (dim.percentage >= 100) {
        alerts.push(`BUDGET EXCEEDED: ${dim.name} at ${dim.percentage.toFixed(1)}% of limit`);
        withinBudget = false;
      } else if (dim.percentage >= 95) {
        alerts.push(`CRITICAL: ${dim.name} at ${dim.percentage.toFixed(1)}% of limit`);
      } else if (dim.percentage >= 90) {
        alerts.push(`WARNING: ${dim.name} at ${dim.percentage.toFixed(1)}% of limit`);
      } else if (dim.percentage >= 75) {
        alerts.push(`NOTICE: ${dim.name} at ${dim.percentage.toFixed(1)}% of limit`);
      }
    }

    return { withinBudget, usage, alerts };
  }

  /**
   * Get a full usage summary across all tracked dimensions.
   */
  getUsageSummary(): BudgetUsage {
    const elapsedMs = Date.now() - this.periodStart;
    const costEstimate = this.getCostEstimate();

    return {
      tokens: {
        used: this.tokensUsed,
        limit: this.config.tokenLimit,
        percentage: safePercentage(this.tokensUsed, this.config.tokenLimit),
      },
      toolCalls: {
        used: this.toolCallsUsed,
        limit: this.config.toolCallLimit,
        percentage: safePercentage(this.toolCallsUsed, this.config.toolCallLimit),
      },
      storage: {
        usedBytes: this.storageUsed,
        limitBytes: this.config.storageLimit,
        percentage: safePercentage(this.storageUsed, this.config.storageLimit),
      },
      time: {
        usedMs: elapsedMs,
        limitMs: this.config.timeLimit,
        percentage: safePercentage(elapsedMs, this.config.timeLimit),
      },
      cost: {
        totalUsd: costEstimate.totalCost,
        limitUsd: this.config.costLimit,
        percentage: safePercentage(costEstimate.totalCost, this.config.costLimit),
      },
    };
  }

  /**
   * Reset all counters for a new billing/tracking period.
   */
  resetPeriod(): void {
    this.tokensUsed = 0;
    this.toolCallsUsed = 0;
    this.storageUsed = 0;
    this.toolCallLog.length = 0;
    this.periodStart = Date.now();
  }

  /**
   * Estimate remaining capacity before hitting limits.
   */
  estimateRemainingCapacity(): {
    tokensRemaining: number;
    callsRemaining: number;
    timeRemainingMs: number;
  } {
    const elapsedMs = Date.now() - this.periodStart;

    return {
      tokensRemaining: Math.max(0, this.config.tokenLimit - this.tokensUsed),
      callsRemaining: Math.max(0, this.config.toolCallLimit - this.toolCallsUsed),
      timeRemainingMs: Math.max(0, this.config.timeLimit - elapsedMs),
    };
  }

  /**
   * Compute a cost estimate with a breakdown by category.
   */
  getCostEstimate(): { totalCost: number; breakdown: Record<string, number> } {
    const tokenCost = this.tokensUsed * this.config.costPerToken;
    const toolCallCost = this.toolCallsUsed * this.config.costPerToolCall;

    const breakdown: Record<string, number> = {
      tokens: tokenCost,
      toolCalls: toolCallCost,
    };

    return {
      totalCost: tokenCost + toolCallCost,
      breakdown,
    };
  }

  /**
   * Get the raw tool call log.
   */
  getToolCallLog(): ReadonlyArray<ToolCallRecord> {
    return this.toolCallLog;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a CoherenceScheduler with optional configuration.
 */
export function createCoherenceScheduler(
  config?: CoherenceSchedulerConfig,
): CoherenceScheduler {
  return new CoherenceScheduler(config);
}

/**
 * Create an EconomicGovernor with optional configuration.
 */
export function createEconomicGovernor(
  config?: EconomicGovernorConfig,
): EconomicGovernor {
  return new EconomicGovernor(config);
}

// ============================================================================
// Helpers
// ============================================================================

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function safePercentage(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return (used / limit) * 100;
}
