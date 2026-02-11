/**
 * Continue Gate - Long-Running Agent Control
 *
 * Evaluates whether a long-running agent should continue its next step.
 * Prevents runaway loops, budget exhaustion, and coherence degradation.
 *
 * Problem:
 * Current gates are tool-centric (PreToolUse, PreCommand, PreEdit).
 * Long-run loops are often internally generated — the agent keeps going
 * without a single obviously bad tool call. There is no gate for "should
 * this agent continue at all?"
 *
 * ContinueGate provides step-level evaluation with:
 * - Hard limits on consecutive steps without checkpoints
 * - Budget acceleration detection via linear regression
 * - Coherence threshold enforcement
 * - Uncertainty threshold enforcement
 * - Rework ratio tracking
 * - Automatic checkpoint intervals
 * - Cooldown between evaluations
 *
 * Decision types:
 * - continue: Agent may proceed to next step
 * - checkpoint: Agent must save state before continuing
 * - throttle: Agent should slow down or wait
 * - pause: Agent should stop and await human review
 * - stop: Agent must halt immediately
 *
 * @module @claude-flow/guidance/continue-gate
 */

import { randomUUID } from 'node:crypto';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for the ContinueGate
 */
export interface ContinueGateConfig {
  /** Hard limit on consecutive steps without checkpoint (default 100) */
  maxConsecutiveSteps: number;
  /** Maximum budget slope per step (cost acceleration threshold, default 0.02) */
  maxBudgetSlopePerStep: number;
  /** Minimum coherence score to continue (default 0.4) */
  minCoherenceForContinue: number;
  /** Maximum uncertainty score to continue (default 0.8) */
  maxUncertaintyForContinue: number;
  /** Maximum rework/total steps ratio (default 0.3) */
  maxReworkRatio: number;
  /** Force checkpoint every N steps (default 25) */
  checkpointIntervalSteps: number;
  /** Minimum time between evaluations in milliseconds (default 5000) */
  cooldownMs: number;
}

/**
 * Context for a single step evaluation
 */
export interface StepContext {
  /** Current step number in the run */
  stepNumber: number;
  /** Total tokens consumed so far */
  totalTokensUsed: number;
  /** Total tool calls made so far */
  totalToolCalls: number;
  /** Number of steps that redid previous work */
  reworkCount: number;
  /** Coherence score from CoherenceScheduler (0-1) */
  coherenceScore: number;
  /** Uncertainty score from UncertaintyAggregator (0-1) */
  uncertaintyScore: number;
  /** Elapsed time in milliseconds since run start */
  elapsedMs: number;
  /** Step number of the last checkpoint */
  lastCheckpointStep: number;
  /** Remaining budget across all dimensions */
  budgetRemaining: {
    tokens: number;
    toolCalls: number;
    timeMs: number;
  };
  /** Recent evaluation decisions (last 10) */
  recentDecisions: Array<{
    step: number;
    decision: 'allow' | 'deny' | 'warn';
  }>;
}

/**
 * Decision outcome from the continue gate
 */
export interface ContinueDecision {
  /** The decision type */
  decision: 'continue' | 'checkpoint' | 'throttle' | 'pause' | 'stop';
  /** Human-readable reasons for the decision */
  reasons: string[];
  /** Computed metrics for this evaluation */
  metrics: {
    /** Budget acceleration rate (tokens per step slope) */
    budgetSlope: number;
    /** Ratio of rework steps to total steps */
    reworkRatio: number;
    /** Steps until next required checkpoint */
    stepsUntilCheckpoint: number;
    /** Coherence health level */
    coherenceLevel: 'healthy' | 'degraded' | 'critical';
    /** Uncertainty level */
    uncertaintyLevel: 'low' | 'moderate' | 'high' | 'extreme';
  };
  /** Recommended action for the agent */
  recommendedAction?: string;
}

/**
 * Internal history record for tracking evaluations
 */
interface EvaluationRecord {
  step: number;
  decision: ContinueDecision;
  timestamp: number;
  tokensUsed: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: ContinueGateConfig = {
  maxConsecutiveSteps: 100,
  maxBudgetSlopePerStep: 0.02,
  minCoherenceForContinue: 0.4,
  maxUncertaintyForContinue: 0.8,
  maxReworkRatio: 0.3,
  checkpointIntervalSteps: 25,
  cooldownMs: 5000,
};

const MAX_HISTORY_SIZE = 10000;
const SLOPE_WINDOW_SIZE = 10; // Number of recent steps to use for budget slope calculation

// ============================================================================
// ContinueGate
// ============================================================================

/**
 * Gate that evaluates whether a long-running agent should continue.
 *
 * Prevents runaway execution by checking:
 * - Step limits
 * - Budget exhaustion and acceleration
 * - Coherence degradation
 * - Uncertainty thresholds
 * - Rework ratios
 * - Checkpoint intervals
 *
 * Maintains history of evaluations and provides aggregate statistics.
 */
export class ContinueGate {
  private readonly config: ContinueGateConfig;
  private readonly history: EvaluationRecord[] = [];
  private lastEvaluationTime = 0;
  private readonly tokenHistory: Array<{ step: number; tokens: number }> = [];

  constructor(config: Partial<ContinueGateConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Evaluate whether the agent should continue.
   *
   * Applies decision logic in priority order:
   * 1. Coherence below threshold → stop
   * 2. Step limit exceeded → stop
   * 3. Budget exhausted → stop
   * 4. High rework ratio → pause
   * 5. High uncertainty → pause
   * 6. Budget acceleration → throttle
   * 7. Checkpoint interval reached → checkpoint
   * 8. Otherwise → continue
   *
   * @param context - Current step context
   * @returns Decision with reasons and metrics
   */
  evaluate(context: StepContext): ContinueDecision {
    const now = Date.now();
    const reasons: string[] = [];

    // Track token usage for slope calculation
    this.tokenHistory.push({
      step: context.stepNumber,
      tokens: context.totalTokensUsed,
    });
    if (this.tokenHistory.length > SLOPE_WINDOW_SIZE) {
      this.tokenHistory.shift();
    }

    // Compute metrics
    const budgetSlope = this.computeBudgetSlope();
    const reworkRatio = context.stepNumber > 0
      ? context.reworkCount / context.stepNumber
      : 0;
    const stepsUntilCheckpoint =
      this.config.checkpointIntervalSteps -
      (context.stepNumber - context.lastCheckpointStep);
    const coherenceLevel = this.getCoherenceLevel(context.coherenceScore);
    const uncertaintyLevel = this.getUncertaintyLevel(context.uncertaintyScore);

    const metrics = {
      budgetSlope,
      reworkRatio,
      stepsUntilCheckpoint,
      coherenceLevel,
      uncertaintyLevel,
    };

    // Decision logic (priority order)

    // 1. Coherence below threshold → stop
    if (context.coherenceScore < this.config.minCoherenceForContinue) {
      reasons.push(
        `Coherence below threshold (${context.coherenceScore.toFixed(2)} < ${this.config.minCoherenceForContinue})`,
      );
      return this.createDecision('stop', reasons, metrics, 'Halt execution and review coherence issues');
    }

    // 2. Step limit exceeded → stop
    if (
      context.stepNumber >= this.config.maxConsecutiveSteps &&
      context.stepNumber - context.lastCheckpointStep >= this.config.checkpointIntervalSteps
    ) {
      reasons.push(
        `Step limit exceeded (${context.stepNumber} >= ${this.config.maxConsecutiveSteps}) without recent checkpoint`,
      );
      return this.createDecision('stop', reasons, metrics, 'Create checkpoint and review progress');
    }

    // 3. Budget exhausted → stop
    if (
      context.budgetRemaining.tokens <= 0 ||
      context.budgetRemaining.toolCalls <= 0 ||
      context.budgetRemaining.timeMs <= 0
    ) {
      const exhausted: string[] = [];
      if (context.budgetRemaining.tokens <= 0) exhausted.push('tokens');
      if (context.budgetRemaining.toolCalls <= 0) exhausted.push('tool calls');
      if (context.budgetRemaining.timeMs <= 0) exhausted.push('time');

      reasons.push(`Budget exhausted: ${exhausted.join(', ')}`);
      return this.createDecision('stop', reasons, metrics, 'Increase budget or simplify task scope');
    }

    // 4. High rework ratio → pause
    if (reworkRatio > this.config.maxReworkRatio) {
      reasons.push(
        `Rework ratio too high (${(reworkRatio * 100).toFixed(1)}% > ${(this.config.maxReworkRatio * 100).toFixed(1)}%)`,
      );
      return this.createDecision(
        'pause',
        reasons,
        metrics,
        'Review recent work for repeated errors or unclear objectives',
      );
    }

    // 5. High uncertainty → pause
    if (context.uncertaintyScore > this.config.maxUncertaintyForContinue) {
      reasons.push(
        `Uncertainty too high (${context.uncertaintyScore.toFixed(2)} > ${this.config.maxUncertaintyForContinue})`,
      );
      return this.createDecision(
        'pause',
        reasons,
        metrics,
        'Resolve uncertain beliefs or gather more evidence before continuing',
      );
    }

    // 6. Budget acceleration → throttle
    if (budgetSlope > this.config.maxBudgetSlopePerStep) {
      reasons.push(
        `Budget acceleration detected (slope: ${budgetSlope.toFixed(4)} > ${this.config.maxBudgetSlopePerStep})`,
      );
      return this.createDecision(
        'throttle',
        reasons,
        metrics,
        'Slow down execution or optimize token usage',
      );
    }

    // 7. Checkpoint interval reached → checkpoint
    if (stepsUntilCheckpoint <= 0) {
      reasons.push(
        `Checkpoint interval reached (${context.stepNumber - context.lastCheckpointStep} >= ${this.config.checkpointIntervalSteps})`,
      );
      return this.createDecision('checkpoint', reasons, metrics, 'Save current state before continuing');
    }

    // 8. Otherwise → continue
    reasons.push('All checks passed');
    return this.createDecision('continue', reasons, metrics);
  }

  /**
   * Evaluate and record the decision in history.
   *
   * This method also checks the cooldown period — if called too soon
   * after the last evaluation, it returns a 'continue' decision without
   * full evaluation to prevent excessive overhead.
   *
   * @param context - Current step context
   * @returns Decision with reasons and metrics
   */
  evaluateWithHistory(context: StepContext): ContinueDecision {
    const now = Date.now();

    // Cooldown check — but always evaluate critical stop conditions
    // to prevent agents from timing steps to bypass safety checks
    if (now - this.lastEvaluationTime < this.config.cooldownMs) {
      // Even during cooldown, check hard-stop conditions
      if (context.coherenceScore < this.config.minCoherenceForContinue) {
        return this.createDecision('stop',
          ['Coherence below threshold (checked during cooldown)'],
          { budgetSlope: 0, reworkRatio: 0, stepsUntilCheckpoint: 0, coherenceLevel: 'critical', uncertaintyLevel: 'low' },
          'Halt execution and review coherence issues');
      }
      if (context.budgetRemaining.tokens <= 0 || context.budgetRemaining.toolCalls <= 0 || context.budgetRemaining.timeMs <= 0) {
        return this.createDecision('stop',
          ['Budget exhausted (checked during cooldown)'],
          { budgetSlope: 0, reworkRatio: 0, stepsUntilCheckpoint: 0, coherenceLevel: 'healthy', uncertaintyLevel: 'low' },
          'Increase budget or simplify task scope');
      }

      // Non-critical checks can be skipped during cooldown
      return {
        decision: 'continue',
        reasons: ['Cooldown period active; skipping full evaluation'],
        metrics: {
          budgetSlope: 0,
          reworkRatio: 0,
          stepsUntilCheckpoint: 0,
          coherenceLevel: this.getCoherenceLevel(context.coherenceScore),
          uncertaintyLevel: this.getUncertaintyLevel(context.uncertaintyScore),
        },
      };
    }

    this.lastEvaluationTime = now;

    const decision = this.evaluate(context);

    // Record in history
    const record: EvaluationRecord = {
      step: context.stepNumber,
      decision,
      timestamp: now,
      tokensUsed: context.totalTokensUsed,
    };

    this.history.push(record);

    // Evict oldest if exceeding max size
    if (this.history.length > MAX_HISTORY_SIZE) {
      this.history.shift();
    }

    return decision;
  }

  /**
   * Get the full evaluation history.
   *
   * Returns up to MAX_HISTORY_SIZE most recent evaluations.
   *
   * @returns Array of evaluation records ordered oldest to newest
   */
  getHistory(): Array<{ step: number; decision: ContinueDecision; timestamp: number }> {
    return this.history.map(r => ({
      step: r.step,
      decision: { ...r.decision },
      timestamp: r.timestamp,
    }));
  }

  /**
   * Get aggregate statistics across all evaluations.
   *
   * @returns Statistics including total evaluations, decision counts, and average budget slope
   */
  getStats(): {
    totalEvaluations: number;
    decisions: Record<string, number>;
    averageBudgetSlope: number;
  } {
    const decisions: Record<string, number> = {
      continue: 0,
      checkpoint: 0,
      throttle: 0,
      pause: 0,
      stop: 0,
    };

    let totalSlope = 0;
    let slopeCount = 0;

    for (const record of this.history) {
      decisions[record.decision.decision]++;
      totalSlope += record.decision.metrics.budgetSlope;
      slopeCount++;
    }

    return {
      totalEvaluations: this.history.length,
      decisions,
      averageBudgetSlope: slopeCount > 0 ? totalSlope / slopeCount : 0,
    };
  }

  /**
   * Reset all internal state.
   *
   * Clears history, token tracking, and last evaluation time.
   */
  reset(): void {
    this.history.length = 0;
    this.tokenHistory.length = 0;
    this.lastEvaluationTime = 0;
  }

  /**
   * Get the current configuration.
   */
  getConfig(): ContinueGateConfig {
    return { ...this.config };
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  /**
   * Compute the budget slope (rate of token consumption per step)
   * using linear regression on the last N steps.
   *
   * Returns the slope coefficient (tokens per step). A positive slope
   * indicates increasing token usage. A slope above the configured
   * threshold indicates budget acceleration.
   */
  private computeBudgetSlope(): number {
    if (this.tokenHistory.length < 2) {
      // Need at least 2 points for regression
      return 0;
    }

    const n = this.tokenHistory.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;

    for (const point of this.tokenHistory) {
      const x = point.step;
      const y = point.tokens;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
    }

    // Linear regression: slope = (n*sumXY - sumX*sumY) / (n*sumXX - sumX*sumX)
    const denominator = n * sumXX - sumX * sumX;
    if (denominator === 0) {
      // All x values are the same (shouldn't happen, but guard)
      return 0;
    }

    const slope = (n * sumXY - sumX * sumY) / denominator;

    return slope;
  }

  /**
   * Map coherence score to a health level.
   */
  private getCoherenceLevel(score: number): 'healthy' | 'degraded' | 'critical' {
    if (score >= 0.7) return 'healthy';
    if (score >= 0.4) return 'degraded';
    return 'critical';
  }

  /**
   * Map uncertainty score to a level.
   */
  private getUncertaintyLevel(score: number): 'low' | 'moderate' | 'high' | 'extreme' {
    if (score <= 0.3) return 'low';
    if (score <= 0.6) return 'moderate';
    if (score <= 0.8) return 'high';
    return 'extreme';
  }

  /**
   * Create a standardized decision object.
   */
  private createDecision(
    decision: 'continue' | 'checkpoint' | 'throttle' | 'pause' | 'stop',
    reasons: string[],
    metrics: ContinueDecision['metrics'],
    recommendedAction?: string,
  ): ContinueDecision {
    return {
      decision,
      reasons,
      metrics,
      recommendedAction,
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a ContinueGate instance with optional configuration.
 *
 * @param config - Partial configuration; unspecified values use defaults
 * @returns A fresh ContinueGate instance
 */
export function createContinueGate(config?: Partial<ContinueGateConfig>): ContinueGate {
  return new ContinueGate(config);
}
