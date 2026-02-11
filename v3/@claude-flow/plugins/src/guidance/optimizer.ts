/**
 * Optimizer Loop
 *
 * Weekly loop that edits guidance like code:
 * 1. Rank top violations by frequency and cost
 * 2. For the top 3, propose one rule change each
 * 3. Run the fixed task suite with and without the change
 * 4. Promote only if risk does not increase and rework decreases
 * 5. Record the decision in an ADR note
 *
 * Promotion rule: Local rules that win twice become root rules.
 *
 * @module @claude-flow/guidance/optimizer
 */

import { randomUUID } from 'node:crypto';
import type {
  PolicyBundle,
  GuidanceRule,
  ViolationRanking,
  RuleChange,
  ABTestResult,
  OptimizationMetrics,
  RuleADR,
} from './types.js';
import type { RunLedger } from './ledger.js';

// ============================================================================
// Optimizer Configuration
// ============================================================================

export interface OptimizerConfig {
  /** Number of top violations to address per cycle */
  topViolationsPerCycle: number;
  /** Minimum events required before optimization */
  minEventsForOptimization: number;
  /** Required improvement threshold for promotion (0-1) */
  improvementThreshold: number;
  /** Maximum risk increase tolerance (0-1) */
  maxRiskIncrease: number;
  /** Number of consecutive wins needed for promotion to root */
  promotionWins: number;
  /** ADR storage path */
  adrPath: string;
}

const DEFAULT_CONFIG: OptimizerConfig = {
  topViolationsPerCycle: 3,
  minEventsForOptimization: 10,
  improvementThreshold: 0.1,
  maxRiskIncrease: 0.05,
  promotionWins: 2,
  adrPath: './docs/adrs',
};

// ============================================================================
// Optimizer Loop
// ============================================================================

export class OptimizerLoop {
  private config: OptimizerConfig;
  private proposedChanges: RuleChange[] = [];
  private testResults: ABTestResult[] = [];
  private adrs: RuleADR[] = [];
  private promotionTracker = new Map<string, number>(); // ruleId -> win count
  private lastOptimizationRun: number | null = null;

  constructor(config: Partial<OptimizerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run a full optimization cycle
   *
   * Steps:
   * 1. Rank violations
   * 2. Propose changes for top N
   * 3. Evaluate changes against baseline
   * 4. Promote winners, record ADRs
   */
  async runCycle(
    ledger: RunLedger,
    currentBundle: PolicyBundle
  ): Promise<{
    rankings: ViolationRanking[];
    changes: RuleChange[];
    results: ABTestResult[];
    adrs: RuleADR[];
    promoted: string[];
    demoted: string[];
  }> {
    this.lastOptimizationRun = Date.now();

    // Step 1: Rank violations
    const rankings = ledger.rankViolations();

    if (rankings.length === 0) {
      return { rankings: [], changes: [], results: [], adrs: [], promoted: [], demoted: [] };
    }

    // Step 2: Propose changes for top violations
    const topViolations = rankings.slice(0, this.config.topViolationsPerCycle);
    const changes = this.proposeChanges(topViolations, currentBundle);
    this.proposedChanges.push(...changes);

    // Step 3: Evaluate each change
    const baselineMetrics = ledger.computeMetrics();
    const results: ABTestResult[] = [];

    for (const change of changes) {
      const result = this.evaluateChange(change, baselineMetrics, ledger);
      results.push(result);
      this.testResults.push(result);
    }

    // Step 4: Promote winners, record ADRs
    const promoted: string[] = [];
    const demoted: string[] = [];
    const newAdrs: RuleADR[] = [];

    for (const result of results) {
      const adr = this.recordADR(result);
      newAdrs.push(adr);
      this.adrs.push(adr);

      if (result.shouldPromote) {
        // Track wins for promotion from local to root
        const ruleId = result.change.targetRuleId;
        const wins = (this.promotionTracker.get(ruleId) ?? 0) + 1;
        this.promotionTracker.set(ruleId, wins);

        if (wins >= this.config.promotionWins) {
          promoted.push(ruleId);
        }
      } else {
        // Demote if change failed
        const ruleId = result.change.targetRuleId;
        this.promotionTracker.set(ruleId, 0);
        if (result.change.changeType === 'promote') {
          demoted.push(ruleId);
        }
      }
    }

    return {
      rankings,
      changes,
      results,
      adrs: newAdrs,
      promoted,
      demoted,
    };
  }

  /**
   * Propose rule changes for top violations
   */
  proposeChanges(
    violations: ViolationRanking[],
    bundle: PolicyBundle
  ): RuleChange[] {
    const changes: RuleChange[] = [];

    for (const violation of violations) {
      // Find the rule
      const rule = this.findRule(violation.ruleId, bundle);

      if (rule) {
        // Existing rule that's being violated too often
        changes.push(this.proposeRuleModification(rule, violation));
      } else {
        // No rule exists for this violation type - propose new rule
        changes.push(this.proposeNewRule(violation));
      }
    }

    return changes;
  }

  /**
   * Propose modification to an existing rule
   */
  private proposeRuleModification(
    rule: GuidanceRule,
    violation: ViolationRanking
  ): RuleChange {
    // Analyze violation pattern to suggest improvement
    let proposedText = rule.text;
    let changeType: RuleChange['changeType'] = 'modify';

    if (violation.frequency > 5) {
      // Rule is violated frequently - make it more specific or add enforcement
      proposedText = `${rule.text}. This rule requires automated enforcement via gates.`;
    } else if (violation.cost > 50) {
      // Violations are expensive - elevate priority
      proposedText = `[HIGH PRIORITY] ${rule.text}. Violations of this rule are costly (avg ${violation.cost.toFixed(0)} rework lines).`;
    }

    // If rule is local and performing well, propose promotion
    if (rule.source === 'local') {
      const wins = this.promotionTracker.get(rule.id) ?? 0;
      if (wins >= this.config.promotionWins - 1) {
        changeType = 'promote';
      }
    }

    return {
      changeId: randomUUID(),
      targetRuleId: rule.id,
      changeType,
      originalText: rule.text,
      proposedText,
      rationale: `Violated ${violation.frequency} times with avg cost of ${violation.cost.toFixed(0)} rework lines (score: ${violation.score.toFixed(1)})`,
      triggeringViolation: violation,
    };
  }

  /**
   * Propose a new rule for unhandled violations
   */
  private proposeNewRule(violation: ViolationRanking): RuleChange {
    return {
      changeId: randomUUID(),
      targetRuleId: violation.ruleId,
      changeType: 'add',
      proposedText: `[${violation.ruleId}] Enforce compliance for pattern "${violation.ruleId}". Auto-generated from ${violation.frequency} violations with avg cost ${violation.cost.toFixed(0)} lines.`,
      rationale: `No existing rule covers violations classified as "${violation.ruleId}". ${violation.frequency} occurrences detected.`,
      triggeringViolation: violation,
    };
  }

  /**
   * Evaluate a proposed change against baseline metrics
   */
  evaluateChange(
    change: RuleChange,
    baseline: OptimizationMetrics,
    ledger: RunLedger
  ): ABTestResult {
    // Get events that would be affected by this rule
    const events = ledger.getEvents();
    const affectedEvents = events.filter(e =>
      e.violations.some(v => v.ruleId === change.targetRuleId) ||
      e.retrievedRuleIds.includes(change.targetRuleId)
    );

    // Compute "candidate" metrics: simulate the effect of the change
    // For now, estimate based on the violation pattern
    const candidateMetrics = this.simulateChangeEffect(change, baseline, affectedEvents.length);

    // Decision logic:
    // 1. Risk must not increase (violation rate stays same or drops)
    // 2. Rework must decrease
    const riskIncrease = candidateMetrics.violationRate - baseline.violationRate;
    const reworkDecrease = baseline.reworkLines - candidateMetrics.reworkLines;

    const shouldPromote =
      riskIncrease <= this.config.maxRiskIncrease &&
      reworkDecrease > 0 &&
      (reworkDecrease / Math.max(baseline.reworkLines, 1)) >= this.config.improvementThreshold;

    const reason = shouldPromote
      ? `Rework decreased by ${reworkDecrease.toFixed(1)} lines (${((reworkDecrease / Math.max(baseline.reworkLines, 1)) * 100).toFixed(1)}%) without increasing risk`
      : riskIncrease > this.config.maxRiskIncrease
        ? `Risk increased by ${riskIncrease.toFixed(2)} (exceeds threshold ${this.config.maxRiskIncrease})`
        : `Insufficient rework improvement (${((reworkDecrease / Math.max(baseline.reworkLines, 1)) * 100).toFixed(1)}% < ${(this.config.improvementThreshold * 100).toFixed(0)}% required)`;

    return {
      change,
      baseline,
      candidate: candidateMetrics,
      shouldPromote,
      reason,
    };
  }

  /**
   * Heuristic estimation of how a rule change would affect metrics.
   *
   * This does NOT run a real A/B test against live traffic — it applies
   * fixed multipliers per change-type to the baseline numbers.  The
   * percentages (e.g. 40% for modify, 60% for add) are conservative
   * estimates, not measured values.  Results should be treated as
   * directional guidance, not ground truth.
   */
  private simulateChangeEffect(
    change: RuleChange,
    baseline: OptimizationMetrics,
    affectedEventCount: number
  ): OptimizationMetrics {
    const affectedRatio = baseline.taskCount > 0
      ? affectedEventCount / baseline.taskCount
      : 0;

    // Conservative estimates based on change type
    let violationReduction = 0;
    let reworkReduction = 0;

    switch (change.changeType) {
      case 'modify':
        // Modifying a rule typically reduces its specific violations by 30-50%
        violationReduction = affectedRatio * 0.4;
        reworkReduction = change.triggeringViolation.cost * 0.3;
        break;
      case 'add':
        // Adding a new rule typically catches 50-70% of unhandled violations
        violationReduction = affectedRatio * 0.6;
        reworkReduction = change.triggeringViolation.cost * 0.5;
        break;
      case 'promote':
        // Promoting to root means it's always active, catching 80%+
        violationReduction = affectedRatio * 0.8;
        reworkReduction = change.triggeringViolation.cost * 0.6;
        break;
      case 'remove':
        // Removing a bad rule might increase violations temporarily
        violationReduction = -affectedRatio * 0.2;
        reworkReduction = -change.triggeringViolation.cost * 0.1;
        break;
      default:
        break;
    }

    return {
      violationRate: Math.max(0, baseline.violationRate * (1 - violationReduction)),
      selfCorrectionRate: Math.min(1, baseline.selfCorrectionRate + violationReduction * 0.1),
      reworkLines: Math.max(0, baseline.reworkLines - reworkReduction),
      clarifyingQuestions: baseline.clarifyingQuestions,
      taskCount: baseline.taskCount,
    };
  }

  /**
   * Record an ADR for a rule change decision
   */
  private recordADR(result: ABTestResult): RuleADR {
    const adrNumber = this.adrs.length + 1;

    return {
      number: adrNumber,
      title: `${result.shouldPromote ? 'Promote' : 'Reject'}: ${result.change.changeType} rule ${result.change.targetRuleId}`,
      decision: result.shouldPromote
        ? `Apply ${result.change.changeType} to rule ${result.change.targetRuleId}`
        : `Reject proposed ${result.change.changeType} for rule ${result.change.targetRuleId}`,
      rationale: result.reason,
      change: result.change,
      testResult: result,
      date: Date.now(),
    };
  }

  /**
   * Find a rule in the policy bundle
   */
  private findRule(ruleId: string, bundle: PolicyBundle): GuidanceRule | undefined {
    const constitutionRule = bundle.constitution.rules.find(r => r.id === ruleId);
    if (constitutionRule) return constitutionRule;

    const shardRule = bundle.shards.find(s => s.rule.id === ruleId);
    return shardRule?.rule;
  }

  /**
   * Apply promoted changes to a policy bundle
   */
  applyPromotions(
    bundle: PolicyBundle,
    promoted: string[],
    changes: RuleChange[]
  ): PolicyBundle {
    // Clone the bundle
    const newConstitution = { ...bundle.constitution, rules: [...bundle.constitution.rules] };
    const newShards = [...bundle.shards];

    for (const ruleId of promoted) {
      const change = changes.find(c => c.targetRuleId === ruleId);
      if (!change) continue;

      // Find the shard to promote
      const shardIdx = newShards.findIndex(s => s.rule.id === ruleId);
      if (shardIdx >= 0) {
        const shard = newShards[shardIdx];
        const promotedRule: GuidanceRule = {
          ...shard.rule,
          source: 'root',
          isConstitution: true,
          priority: shard.rule.priority + 100,
          text: change.proposedText || shard.rule.text,
          updatedAt: Date.now(),
        };

        // Add to constitution
        newConstitution.rules.push(promotedRule);

        // Remove from shards
        newShards.splice(shardIdx, 1);
      }
    }

    return {
      constitution: newConstitution,
      shards: newShards,
      manifest: bundle.manifest, // Manifest would need recompilation
    };
  }

  // ===== Getters =====

  get lastRun(): number | null {
    return this.lastOptimizationRun;
  }

  getADRs(): RuleADR[] {
    return [...this.adrs];
  }

  getProposedChanges(): RuleChange[] {
    return [...this.proposedChanges];
  }

  getTestResults(): ABTestResult[] {
    return [...this.testResults];
  }

  getPromotionTracker(): Map<string, number> {
    return new Map(this.promotionTracker);
  }
}

/**
 * Create an optimizer instance
 */
export function createOptimizer(config?: Partial<OptimizerConfig>): OptimizerLoop {
  return new OptimizerLoop(config);
}
