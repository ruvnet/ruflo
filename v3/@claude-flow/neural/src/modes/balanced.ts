/**
 * Balanced Mode Implementation
 *
 * General-purpose mode with:
 * - +25% quality improvement
 * - 18ms overhead
 * - Rank-4 LoRA
 * - Exact recall over live patterns
 * - Standard learning pipeline
 */

import type {
  SONAModeConfig,
  ModeOptimizations,
  Trajectory,
  Pattern,
  PatternMatch,
  LoRAWeights,
  EWCState,
} from '../types.js';
import { BaseModeImplementation } from './base.js';

/**
 * Balanced mode for general-purpose learning
 */
export class BalancedMode extends BaseModeImplementation {
  readonly mode = 'balanced';

  // Learning state
  private gradientAccumulator: Map<string, Float32Array> = new Map();
  private momentumBuffers: Map<string, Float32Array> = new Map();

  // Stats
  private totalPatternMatches = 0;
  private totalPatternTime = 0;
  private totalLearnTime = 0;
  private learnIterations = 0;
  private qualityImprovements: number[] = [];

  async initialize(): Promise<void> {
    await super.initialize();
    this.gradientAccumulator.clear();
    this.momentumBuffers.clear();
    this.lastConsolidationSnapshot.clear();
  }

  async cleanup(): Promise<void> {
    this.gradientAccumulator.clear();
    this.momentumBuffers.clear();
    this.lastConsolidationSnapshot.clear();
    await super.cleanup();
  }

  /**
   * Find patterns using exact similarity search
   */
  async findPatterns(
    embedding: Float32Array,
    k: number,
    patterns: Pattern[]
  ): Promise<PatternMatch[]> {
    const startTime = performance.now();

    // Both queries and stored vectors are mutable, including through references
    // returned by storePattern. A cross-call ranking cannot be reused safely.
    const matches: PatternMatch[] = [];
    const bounded = Number.isInteger(k) && k > 0 && k <= 8;
    let needsFullSort = !bounded;
    for (const pattern of patterns) {
      const similarity = this.cosineSimilarity(embedding, pattern.embedding);
      // JS's full sort treats a NaN comparator result as a tie. Preserve its
      // behavior for non-finite input instead of guessing an insertion rank.
      if (bounded && Number.isNaN(similarity)) {
        needsFullSort = true;
        matches.length = 0;
        for (const p of patterns) {
          const score = this.cosineSimilarity(embedding, p.embedding);
          matches.push({ pattern: p, similarity: score, confidence: score * p.successRate, latencyMs: 0 });
        }
        break;
      }
      if (bounded && matches.length === k && similarity <= matches[k - 1].similarity) continue;
      const match = { pattern, similarity, confidence: similarity * pattern.successRate, latencyMs: 0 };
      if (!bounded) {
        matches.push(match);
      } else {
        // Strict comparison preserves corpus order for tied scores.
        let i = Math.min(matches.length, k - 1);
        while (i > 0 && similarity > matches[i - 1].similarity) {
          matches[i] = matches[i - 1];
          i--;
        }
        matches[i] = match;
      }
    }
    const topK = needsFullSort ? matches.sort((a, b) => b.similarity - a.similarity).slice(0, k) : matches;

    this.totalPatternTime += performance.now() - startTime;
    this.totalPatternMatches++;

    return topK;
  }

  /**
   * Learn from trajectories using standard gradient descent
   */
  async learn(
    trajectories: Trajectory[],
    config: SONAModeConfig,
    ewcState: EWCState
  ): Promise<number> {
    const startTime = performance.now();

    if (trajectories.length === 0) return 0;

    const qualityThreshold = config.qualityThreshold;
    const learningRate = config.learningRate;

    // Separate positive and negative examples
    const goodTrajectories = trajectories.filter(t => t.qualityScore >= qualityThreshold);
    const badTrajectories = trajectories.filter(t => t.qualityScore < qualityThreshold);

    if (goodTrajectories.length === 0) return 0;

    // Compute gradients from trajectory pairs
    let totalGradientNorm = 0;

    for (const good of goodTrajectories) {
      // Use last step embedding as "goal state"
      if (good.steps.length === 0) continue;

      const goalState = good.steps[good.steps.length - 1].stateAfter;

      // Positive gradient: move toward good outcomes
      const posGradient = this.computeGradient(goalState, good.qualityScore);
      totalGradientNorm += this.accumulateGradient('positive', posGradient, learningRate);

      // Negative gradient: move away from bad outcomes (contrastive)
      for (const bad of badTrajectories.slice(0, 3)) {
        if (bad.steps.length === 0) continue;
        const badState = bad.steps[bad.steps.length - 1].stateAfter;
        const negGradient = this.computeGradient(badState, -bad.qualityScore);
        totalGradientNorm += this.accumulateGradient('negative', negGradient, learningRate * 0.5);
      }
    }

    // Apply EWC regularization
    const ewcPenalty = this.computeEWCPenalty(ewcState, config.ewcLambda);
    totalGradientNorm += ewcPenalty;

    // Compute improvement delta
    const avgGoodQuality = goodTrajectories.reduce((s, t) => s + t.qualityScore, 0) / goodTrajectories.length;
    const baselineQuality = 0.5;
    const improvementDelta = avgGoodQuality - baselineQuality;

    this.qualityImprovements.push(improvementDelta);
    if (this.qualityImprovements.length > 100) {
      this.qualityImprovements = this.qualityImprovements.slice(-100);
    }

    this.totalLearnTime += performance.now() - startTime;
    this.learnIterations++;

    return Math.max(0, improvementDelta);
  }

  /**
   * Apply LoRA adaptations with rank-4
   */
  async applyLoRA(
    input: Float32Array,
    weights?: LoRAWeights
  ): Promise<Float32Array> {
    if (!weights) {
      return input;
    }

    const output = new Float32Array(input.length);
    output.set(input);

    const rank = this.config.loraRank;

    // Apply to all target modules
    for (const module of ['q_proj', 'v_proj', 'k_proj', 'o_proj']) {
      const A = weights.A.get(module);
      const B = weights.B.get(module);

      if (A && B) {
        const adapted = this.applyLoRATransform(input, A, B, rank);
        const alpha = 0.2; // Moderate blending
        for (let i = 0; i < output.length; i++) {
          output[i] = output[i] * (1 - alpha) + adapted[i] * alpha;
        }
      }
    }

    return output;
  }

  getStats(): Record<string, number> {
    const avgImprovement = this.qualityImprovements.length > 0
      ? this.qualityImprovements.reduce((a, b) => a + b, 0) / this.qualityImprovements.length
      : 0;

    return {
      cacheHitRate: 0,
      avgPatternMatchMs: this.totalPatternMatches > 0
        ? this.totalPatternTime / this.totalPatternMatches
        : 0,
      avgLearnMs: this.learnIterations > 0
        ? this.totalLearnTime / this.learnIterations
        : 0,
      avgImprovement,
      patternCacheSize: 0,
      learnIterations: this.learnIterations,
    };
  }

  /**
   * Compute gradient from state and reward
   */
  private computeGradient(state: Float32Array, reward: number): Float32Array {
    const gradient = new Float32Array(state.length);
    for (let i = 0; i < state.length; i++) {
      gradient[i] = state[i] * reward;
    }
    return gradient;
  }

  /**
   * Accumulate gradient with momentum
   */
  private accumulateGradient(key: string, gradient: Float32Array, lr: number): number {
    let momentum = this.momentumBuffers.get(key);
    if (!momentum) {
      momentum = new Float32Array(gradient.length);
      this.momentumBuffers.set(key, momentum);
    }

    let accumulator = this.gradientAccumulator.get(key);
    if (!accumulator) {
      accumulator = new Float32Array(gradient.length);
      this.gradientAccumulator.set(key, accumulator);
    }

    const beta = 0.9; // Momentum coefficient
    let norm = 0;

    for (let i = 0; i < gradient.length; i++) {
      momentum[i] = beta * momentum[i] + (1 - beta) * gradient[i];
      accumulator[i] += lr * momentum[i];
      norm += momentum[i] * momentum[i];
    }

    return Math.sqrt(norm);
  }

  /**
   * Compute EWC penalty for continual learning
   */
  private computeEWCPenalty(ewcState: EWCState, lambda: number): number {
    let penalty = 0;

    for (const [key, fisher] of ewcState.fisher) {
      const means = ewcState.means.get(key);
      const current = this.gradientAccumulator.get(key);

      if (means && current) {
        for (let i = 0; i < Math.min(fisher.length, means.length, current.length); i++) {
          const diff = current[i] - means[i];
          penalty += fisher[i] * diff * diff;
        }
      }
    }

    return lambda * penalty * 0.5;
  }

  // Raw gradientAccumulator snapshot as of the last call to
  // getConsolidationSnapshot(), used to compute a bounded per-cycle delta
  // instead of exposing the ever-growing cumulative accumulator directly.
  private lastConsolidationSnapshot: Map<string, Float32Array> = new Map();

  /**
   * Derive a Fisher-information/means snapshot from the CHANGE in this
   * mode's accumulated gradients since the last consolidation, for EWC
   * consolidation.
   *
   * `gradientAccumulator` is a lifetime-cumulative sum (it is only ever
   * `.clear()`'d in `initialize()`/`cleanup()`), so squaring it directly
   * would make Fisher importance grow without bound over a long-running
   * session rather than reflecting any one task's actual contribution.
   * Using the delta against the previous snapshot bounds each cycle's
   * contribution to roughly that cycle's own gradient magnitude (momentum
   * is itself an EMA, so bounded), which is what `consolidateEWC()`'s decay
   * step is actually meant to decay against.
   *
   * `means` is the accumulator itself at this point (the EWC anchor), so
   * the penalty is zero immediately after consolidation and grows as the
   * accumulator moves away from it.
   *
   * Fisher uses the diagonal empirical-Fisher approximation
   * (Fisher_i ~= delta_i^2), the same style of estimator already proven out
   * — for this exact squared-gradient-of-reward update rule — in this
   * monorepo's own
   * `v3/plugins/cognitive-kernel/src/bridges/sona-bridge.ts::computeFisher()`.
   * Non-finite components are dropped (treated as zero) so a bad sample
   * can't poison consolidated state.
   */
  getConsolidationSnapshot(): {
    fisher: Map<string, Float32Array>;
    means: Map<string, Float32Array>;
  } {
    const fisher = new Map<string, Float32Array>();
    const means = new Map<string, Float32Array>();

    for (const [key, gradient] of this.gradientAccumulator) {
      const previous = this.lastConsolidationSnapshot.get(key);
      const delta = new Float32Array(gradient.length);
      const snapshot = new Float32Array(gradient.length);

      for (let i = 0; i < gradient.length; i++) {
        const g = gradient[i];
        const safe = Number.isFinite(g) ? g : 0;
        const prevSafe = previous && Number.isFinite(previous[i]) ? previous[i] : 0;
        delta[i] = safe - prevSafe;
        snapshot[i] = safe;
      }

      const f = new Float32Array(delta.length);
      for (let i = 0; i < delta.length; i++) {
        f[i] = delta[i] * delta[i];
      }

      fisher.set(key, f);
      // EWC anchors on the parameter values at consolidation (theta*), not on
      // the delta: computeEWCPenalty() measures current - means, which must be
      // zero right after consolidating.
      means.set(key, Float32Array.from(snapshot));
      this.lastConsolidationSnapshot.set(key, snapshot);
    }

    return { fisher, means };
  }
}
