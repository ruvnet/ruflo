/**
 * @claude-flow/cache-optimizer - Refinement & Auto-Tuning System
 *
 * Adaptive hyperparameter optimization and model refinement
 * using Bayesian optimization and performance feedback loops.
 */

import type { MetricSnapshot, LearningMetrics, TimeSeriesMetric } from './measurement.js';

// ============================================================================
// Types
// ============================================================================

export interface HyperparameterSpace {
  name: string;
  type: 'continuous' | 'discrete' | 'categorical';
  range: [number, number] | number[] | string[];
  current: number | string;
  scale?: 'linear' | 'log';
}

export interface TuningObjective {
  name: string;
  metric: keyof LearningMetrics | string;
  target: 'maximize' | 'minimize';
  weight: number;
  threshold?: number;
}

export interface TuningTrial {
  id: string;
  hyperparameters: Record<string, number | string>;
  score: number;
  metrics: Partial<LearningMetrics>;
  timestamp: number;
  duration: number;
}

export interface RefinementConfig {
  // Tuning strategy
  strategy: 'bayesian' | 'random' | 'grid' | 'hyperband';
  maxTrials: number;
  parallelTrials: number;

  // Convergence
  earlyStopPatience: number;        // stop if no improvement for N trials
  minImprovement: number;            // minimum improvement to continue
  convergenceWindow: number;         // trials to check for convergence

  // Exploration
  explorationRatio: number;          // 0-1, exploration vs exploitation
  warmupTrials: number;              // random trials before optimization

  // Constraints
  maxTrialDuration: number;          // ms per trial
  resourceBudget: {
    maxMemory: number;               // bytes
    maxCpuPercent: number;           // 0-100
  };

  // Auto-adjustment triggers
  triggers: {
    hitRateDropThreshold: number;    // trigger if hit rate drops by this %
    latencyIncreaseThreshold: number; // trigger if latency increases by this %
    periodicInterval: number;         // ms between periodic refinements
  };
}

export interface RefinementResult {
  bestTrial: TuningTrial;
  allTrials: TuningTrial[];
  convergenceReached: boolean;
  improvementPercent: number;
  recommendations: RefinementRecommendation[];
}

export interface RefinementRecommendation {
  parameter: string;
  currentValue: number | string;
  suggestedValue: number | string;
  expectedImprovement: number;
  confidence: number;
  reason: string;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: RefinementConfig = {
  strategy: 'bayesian',
  maxTrials: 50,
  parallelTrials: 1,
  earlyStopPatience: 10,
  minImprovement: 0.01,
  convergenceWindow: 5,
  explorationRatio: 0.3,
  warmupTrials: 5,
  maxTrialDuration: 30000,
  resourceBudget: {
    maxMemory: 256 * 1024 * 1024,
    maxCpuPercent: 50,
  },
  triggers: {
    hitRateDropThreshold: 0.1,
    latencyIncreaseThreshold: 0.5,
    periodicInterval: 3600000,
  },
};

// ============================================================================
// Bayesian Optimizer (Gaussian Process)
// ============================================================================

class GaussianProcess {
  private observations: Array<{ x: number[]; y: number }> = [];
  private lengthScale = 1.0;
  private noiseVariance = 0.01;

  addObservation(x: number[], y: number): void {
    this.observations.push({ x, y });
  }

  /**
   * Compute RBF kernel between two points
   */
  private rbfKernel(x1: number[], x2: number[]): number {
    let dist = 0;
    for (let i = 0; i < x1.length; i++) {
      dist += Math.pow(x1[i] - x2[i], 2);
    }
    return Math.exp(-dist / (2 * this.lengthScale * this.lengthScale));
  }

  /**
   * Compute kernel matrix for all observations
   */
  private computeKernel(): number[][] {
    const n = this.observations.length;
    const K = Array.from({ length: n }, () => Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        K[i][j] = this.rbfKernel(this.observations[i].x, this.observations[j].x);
        if (i === j) {
          K[i][j] += this.noiseVariance;
        }
      }
    }

    return K;
  }

  /**
   * Simple Cholesky decomposition for small matrices
   */
  private cholesky(A: number[][]): number[][] {
    const n = A.length;
    const L = Array.from({ length: n }, () => Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = 0;
        for (let k = 0; k < j; k++) {
          sum += L[i][k] * L[j][k];
        }
        if (i === j) {
          L[i][j] = Math.sqrt(Math.max(A[i][i] - sum, 1e-10));
        } else {
          L[i][j] = (A[i][j] - sum) / L[j][j];
        }
      }
    }

    return L;
  }

  /**
   * Solve L * x = b using forward substitution
   */
  private solveTriangular(L: number[][], b: number[], lower = true): number[] {
    const n = L.length;
    const x = Array(n).fill(0);

    if (lower) {
      for (let i = 0; i < n; i++) {
        let sum = b[i];
        for (let j = 0; j < i; j++) {
          sum -= L[i][j] * x[j];
        }
        x[i] = sum / L[i][i];
      }
    } else {
      for (let i = n - 1; i >= 0; i--) {
        let sum = b[i];
        for (let j = i + 1; j < n; j++) {
          sum -= L[j][i] * x[j];
        }
        x[i] = sum / L[i][i];
      }
    }

    return x;
  }

  /**
   * Predict mean and variance at a new point
   */
  predict(x: number[]): { mean: number; variance: number } {
    if (this.observations.length === 0) {
      return { mean: 0, variance: 1 };
    }

    // Compute k* (kernel between x and all observations)
    const kStar = this.observations.map(obs => this.rbfKernel(x, obs.x));

    // Compute K (kernel matrix)
    const K = this.computeKernel();

    // Cholesky decomposition
    const L = this.cholesky(K);

    // Solve for alpha = K^-1 * y
    const y = this.observations.map(obs => obs.y);
    const alpha = this.solveTriangular(L, y);
    const alpha2 = this.solveTriangular(L, alpha, false);

    // Mean: k*^T * alpha
    const mean = kStar.reduce((sum, k, i) => sum + k * alpha2[i], 0);

    // Variance: k(x,x) - k*^T * K^-1 * k*
    const v = this.solveTriangular(L, kStar);
    const variance = 1 - v.reduce((sum, vi) => sum + vi * vi, 0);

    return { mean, variance: Math.max(variance, 1e-10) };
  }

  /**
   * Expected Improvement acquisition function
   */
  expectedImprovement(x: number[], bestY: number): number {
    const { mean, variance } = this.predict(x);
    const std = Math.sqrt(variance);

    if (std < 1e-10) return 0;

    const z = (mean - bestY) / std;
    const phi = this.standardNormalCDF(z);
    const pdf = this.standardNormalPDF(z);

    return (mean - bestY) * phi + std * pdf;
  }

  private standardNormalCDF(x: number): number {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2);

    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return 0.5 * (1.0 + sign * y);
  }

  private standardNormalPDF(x: number): number {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  }
}

// ============================================================================
// Refinement Engine
// ============================================================================

export class RefinementEngine {
  private config: RefinementConfig;
  private hyperparameters: HyperparameterSpace[] = [];
  private objectives: TuningObjective[] = [];
  private trials: TuningTrial[] = [];
  private gp: GaussianProcess;
  private bestScore = -Infinity;
  private lastRefinementTime = 0;
  private trialsSinceImprovement = 0;

  constructor(config: Partial<RefinementConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.gp = new GaussianProcess();
  }

  // --------------------------------------------------------------------------
  // Configuration
  // --------------------------------------------------------------------------

  /**
   * Define hyperparameter search space
   */
  defineHyperparameters(params: HyperparameterSpace[]): void {
    this.hyperparameters = params;
  }

  /**
   * Define tuning objectives
   */
  defineObjectives(objectives: TuningObjective[]): void {
    this.objectives = objectives;
  }

  /**
   * Get default hyperparameters for cache optimization
   */
  static getDefaultHyperparameters(): HyperparameterSpace[] {
    return [
      // GNN hyperparameters
      {
        name: 'gnn.hidden_dim',
        type: 'discrete',
        range: [32, 64, 128, 256],
        current: 64,
      },
      {
        name: 'gnn.num_layers',
        type: 'discrete',
        range: [1, 2, 3, 4],
        current: 2,
      },
      {
        name: 'gnn.learning_rate',
        type: 'continuous',
        range: [0.0001, 0.1],
        current: 0.001,
        scale: 'log',
      },
      {
        name: 'gnn.dropout',
        type: 'continuous',
        range: [0, 0.5],
        current: 0.1,
      },

      // GRNN hyperparameters
      {
        name: 'grnn.hidden_size',
        type: 'discrete',
        range: [32, 64, 128],
        current: 64,
      },
      {
        name: 'grnn.sequence_length',
        type: 'discrete',
        range: [10, 20, 50, 100],
        current: 50,
      },
      {
        name: 'grnn.learning_rate',
        type: 'continuous',
        range: [0.0001, 0.01],
        current: 0.001,
        scale: 'log',
      },
      {
        name: 'grnn.ewc_lambda',
        type: 'continuous',
        range: [0.1, 100],
        current: 1.0,
        scale: 'log',
      },

      // Cache hyperparameters
      {
        name: 'cache.relevance_threshold',
        type: 'continuous',
        range: [0.1, 0.9],
        current: 0.5,
      },
      {
        name: 'cache.tier_hot_threshold',
        type: 'continuous',
        range: [0.5, 0.95],
        current: 0.8,
      },
      {
        name: 'cache.compression_level',
        type: 'discrete',
        range: [0, 1, 2, 3],
        current: 1,
      },
    ];
  }

  /**
   * Get default objectives
   */
  static getDefaultObjectives(): TuningObjective[] {
    return [
      {
        name: 'hit_rate',
        metric: 'cache.hitRate',
        target: 'maximize',
        weight: 0.4,
        threshold: 0.7,
      },
      {
        name: 'latency',
        metric: 'health.inferenceLatency',
        target: 'minimize',
        weight: 0.3,
        threshold: 50,
      },
      {
        name: 'token_savings',
        metric: 'cache.tokenSavings',
        target: 'maximize',
        weight: 0.2,
      },
      {
        name: 'accuracy',
        metric: 'grnn.predictionAccuracy',
        target: 'maximize',
        weight: 0.1,
      },
    ];
  }

  // --------------------------------------------------------------------------
  // Sampling Strategies
  // --------------------------------------------------------------------------

  /**
   * Sample hyperparameters based on strategy
   */
  sampleHyperparameters(): Record<string, number | string> {
    const trialNum = this.trials.length;

    // Warmup with random sampling
    if (trialNum < this.config.warmupTrials) {
      return this.randomSample();
    }

    // Use strategy
    switch (this.config.strategy) {
      case 'bayesian':
        return this.bayesianSample();
      case 'random':
        return this.randomSample();
      case 'grid':
        return this.gridSample(trialNum);
      default:
        return this.randomSample();
    }
  }

  private randomSample(): Record<string, number | string> {
    const sample: Record<string, number | string> = {};

    for (const param of this.hyperparameters) {
      if (param.type === 'continuous') {
        const [min, max] = param.range as [number, number];
        if (param.scale === 'log') {
          const logMin = Math.log(min);
          const logMax = Math.log(max);
          sample[param.name] = Math.exp(logMin + Math.random() * (logMax - logMin));
        } else {
          sample[param.name] = min + Math.random() * (max - min);
        }
      } else if (param.type === 'discrete') {
        const values = param.range as number[];
        sample[param.name] = values[Math.floor(Math.random() * values.length)];
      } else if (param.type === 'categorical') {
        const values = param.range as string[];
        sample[param.name] = values[Math.floor(Math.random() * values.length)];
      }
    }

    return sample;
  }

  private bayesianSample(): Record<string, number | string> {
    // Exploration vs exploitation
    if (Math.random() < this.config.explorationRatio) {
      return this.randomSample();
    }

    // Find best point via EI maximization (simplified grid search over candidates)
    const numCandidates = 100;
    let bestEI = -Infinity;
    let bestSample = this.randomSample();

    for (let i = 0; i < numCandidates; i++) {
      const candidate = this.randomSample();
      const x = this.encodeHyperparameters(candidate);
      const ei = this.gp.expectedImprovement(x, this.bestScore);

      if (ei > bestEI) {
        bestEI = ei;
        bestSample = candidate;
      }
    }

    return bestSample;
  }

  private gridSample(trialNum: number): Record<string, number | string> {
    const sample: Record<string, number | string> = {};
    let remaining = trialNum;

    for (let i = this.hyperparameters.length - 1; i >= 0; i--) {
      const param = this.hyperparameters[i];
      const values = this.getParameterValues(param);
      const idx = remaining % values.length;
      sample[param.name] = values[idx];
      remaining = Math.floor(remaining / values.length);
    }

    return sample;
  }

  private getParameterValues(param: HyperparameterSpace): (number | string)[] {
    if (param.type === 'discrete' || param.type === 'categorical') {
      return param.range as (number | string)[];
    }

    // For continuous, create 5 grid points
    const [min, max] = param.range as [number, number];
    const values: number[] = [];

    for (let i = 0; i < 5; i++) {
      if (param.scale === 'log') {
        const logMin = Math.log(min);
        const logMax = Math.log(max);
        values.push(Math.exp(logMin + (i / 4) * (logMax - logMin)));
      } else {
        values.push(min + (i / 4) * (max - min));
      }
    }

    return values;
  }

  private encodeHyperparameters(params: Record<string, number | string>): number[] {
    return this.hyperparameters.map(hp => {
      const value = params[hp.name];

      if (hp.type === 'categorical') {
        const idx = (hp.range as string[]).indexOf(value as string);
        return idx / (hp.range.length - 1);
      }

      const numValue = value as number;
      const [min, max] = hp.range as [number, number];

      if (hp.scale === 'log') {
        return (Math.log(numValue) - Math.log(min)) / (Math.log(max) - Math.log(min));
      }

      return (numValue - min) / (max - min);
    });
  }

  // --------------------------------------------------------------------------
  // Trial Evaluation
  // --------------------------------------------------------------------------

  /**
   * Evaluate a trial and compute objective score
   */
  evaluateTrial(
    hyperparameters: Record<string, number | string>,
    metrics: MetricSnapshot
  ): TuningTrial {
    const startTime = Date.now();

    // Compute weighted objective score
    let totalScore = 0;
    let totalWeight = 0;

    for (const objective of this.objectives) {
      const metricValue = this.extractMetricValue(metrics.metrics, objective.metric);
      if (metricValue === undefined) continue;

      let normalizedValue = metricValue;

      // Normalize based on threshold if available
      if (objective.threshold !== undefined) {
        normalizedValue = metricValue / objective.threshold;
      }

      // Flip for minimization objectives
      if (objective.target === 'minimize') {
        normalizedValue = 1 / (1 + normalizedValue);
      }

      totalScore += normalizedValue * objective.weight;
      totalWeight += objective.weight;
    }

    const score = totalWeight > 0 ? totalScore / totalWeight : 0;

    const trial: TuningTrial = {
      id: `trial_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      hyperparameters,
      score,
      metrics: metrics.metrics,
      timestamp: Date.now(),
      duration: Date.now() - startTime,
    };

    // Update GP model
    const x = this.encodeHyperparameters(hyperparameters);
    this.gp.addObservation(x, score);

    // Track best score
    if (score > this.bestScore) {
      this.bestScore = score;
      this.trialsSinceImprovement = 0;
    } else {
      this.trialsSinceImprovement++;
    }

    this.trials.push(trial);
    return trial;
  }

  private extractMetricValue(metrics: LearningMetrics, path: string): number | undefined {
    const parts = path.split('.');
    let current: unknown = metrics;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    // Handle TimeSeriesMetric
    if (typeof current === 'object' && current !== null && 'aggregations' in current) {
      return (current as TimeSeriesMetric).aggregations.mean;
    }

    return typeof current === 'number' ? current : undefined;
  }

  // --------------------------------------------------------------------------
  // Refinement Execution
  // --------------------------------------------------------------------------

  /**
   * Check if refinement should be triggered
   */
  shouldTriggerRefinement(currentMetrics: MetricSnapshot, previousMetrics?: MetricSnapshot): boolean {
    const now = Date.now();
    const { triggers } = this.config;

    // Periodic trigger
    if (now - this.lastRefinementTime > triggers.periodicInterval) {
      return true;
    }

    if (!previousMetrics) return false;

    // Hit rate drop trigger
    const currentHitRate = currentMetrics.metrics.cache.hitRate.aggregations.mean;
    const previousHitRate = previousMetrics.metrics.cache.hitRate.aggregations.mean;
    if (previousHitRate > 0 && (previousHitRate - currentHitRate) / previousHitRate > triggers.hitRateDropThreshold) {
      return true;
    }

    // Latency increase trigger
    const currentLatency = currentMetrics.metrics.health.inferenceLatency.aggregations.mean;
    const previousLatency = previousMetrics.metrics.health.inferenceLatency.aggregations.mean;
    if (previousLatency > 0 && (currentLatency - previousLatency) / previousLatency > triggers.latencyIncreaseThreshold) {
      return true;
    }

    return false;
  }

  /**
   * Check if optimization has converged
   */
  hasConverged(): boolean {
    if (this.trials.length < this.config.convergenceWindow) return false;

    // Check if no improvement for patience window
    if (this.trialsSinceImprovement >= this.config.earlyStopPatience) {
      return true;
    }

    // Check if improvement is below threshold
    const recentTrials = this.trials.slice(-this.config.convergenceWindow);
    const scores = recentTrials.map(t => t.score);
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);

    if (maxScore - minScore < this.config.minImprovement) {
      return true;
    }

    return false;
  }

  /**
   * Run refinement optimization
   */
  async runRefinement(
    evaluator: (params: Record<string, number | string>) => Promise<MetricSnapshot>
  ): Promise<RefinementResult> {
    this.lastRefinementTime = Date.now();

    for (let i = 0; i < this.config.maxTrials; i++) {
      if (this.hasConverged()) break;

      const hyperparameters = this.sampleHyperparameters();
      const metrics = await evaluator(hyperparameters);
      this.evaluateTrial(hyperparameters, metrics);
    }

    return this.getResult();
  }

  /**
   * Get refinement result
   */
  getResult(): RefinementResult {
    const bestTrial = this.trials.reduce(
      (best, trial) => trial.score > best.score ? trial : best,
      this.trials[0]
    );

    const firstTrial = this.trials[0];
    const improvementPercent = firstTrial
      ? ((bestTrial.score - firstTrial.score) / Math.max(firstTrial.score, 0.001)) * 100
      : 0;

    const recommendations = this.generateRecommendations(bestTrial);

    return {
      bestTrial,
      allTrials: this.trials,
      convergenceReached: this.hasConverged(),
      improvementPercent,
      recommendations,
    };
  }

  /**
   * Generate refinement recommendations
   */
  private generateRecommendations(bestTrial: TuningTrial): RefinementRecommendation[] {
    const recommendations: RefinementRecommendation[] = [];

    for (const param of this.hyperparameters) {
      const currentValue = param.current;
      const suggestedValue = bestTrial.hyperparameters[param.name];

      if (currentValue === suggestedValue) continue;

      // Estimate expected improvement
      const currentTrials = this.trials.filter(t =>
        t.hyperparameters[param.name] === currentValue
      );
      const suggestedTrials = this.trials.filter(t =>
        t.hyperparameters[param.name] === suggestedValue
      );

      const currentAvgScore = currentTrials.length > 0
        ? currentTrials.reduce((sum, t) => sum + t.score, 0) / currentTrials.length
        : 0;
      const suggestedAvgScore = suggestedTrials.length > 0
        ? suggestedTrials.reduce((sum, t) => sum + t.score, 0) / suggestedTrials.length
        : 0;

      const expectedImprovement = suggestedAvgScore - currentAvgScore;
      const confidence = Math.min(suggestedTrials.length / 5, 1);

      if (expectedImprovement > 0.01) {
        recommendations.push({
          parameter: param.name,
          currentValue,
          suggestedValue,
          expectedImprovement,
          confidence,
          reason: this.getRecommendationReason(param.name, currentValue, suggestedValue),
        });
      }
    }

    // Sort by expected improvement
    return recommendations.sort((a, b) => b.expectedImprovement - a.expectedImprovement);
  }

  private getRecommendationReason(
    param: string,
    current: number | string,
    suggested: number | string
  ): string {
    const parts = param.split('.');
    const component = parts[0];
    const name = parts[1];

    if (component === 'gnn') {
      if (name === 'hidden_dim') {
        return suggested > current
          ? 'Larger hidden dimension captures more complex patterns'
          : 'Smaller hidden dimension reduces overfitting';
      }
      if (name === 'learning_rate') {
        return suggested > current
          ? 'Higher learning rate enables faster adaptation'
          : 'Lower learning rate improves stability';
      }
    }

    if (component === 'grnn') {
      if (name === 'ewc_lambda') {
        return suggested > current
          ? 'Stronger EWC regularization prevents forgetting'
          : 'Weaker EWC allows more adaptation to new patterns';
      }
    }

    if (component === 'cache') {
      if (name === 'relevance_threshold') {
        return suggested > current
          ? 'Higher threshold improves precision'
          : 'Lower threshold improves recall';
      }
    }

    return `Optimized based on ${this.trials.length} trials`;
  }

  // --------------------------------------------------------------------------
  // Utilities
  // --------------------------------------------------------------------------

  /**
   * Get current best hyperparameters
   */
  getBestHyperparameters(): Record<string, number | string> | null {
    if (this.trials.length === 0) return null;

    const bestTrial = this.trials.reduce(
      (best, trial) => trial.score > best.score ? trial : best
    );

    return bestTrial.hyperparameters;
  }

  /**
   * Reset refinement state
   */
  reset(): void {
    this.trials = [];
    this.gp = new GaussianProcess();
    this.bestScore = -Infinity;
    this.trialsSinceImprovement = 0;
  }

  /**
   * Export refinement history
   */
  exportHistory(): {
    trials: TuningTrial[];
    bestScore: number;
    hyperparameters: HyperparameterSpace[];
    objectives: TuningObjective[];
  } {
    return {
      trials: this.trials,
      bestScore: this.bestScore,
      hyperparameters: this.hyperparameters,
      objectives: this.objectives,
    };
  }

  /**
   * Import refinement history
   */
  importHistory(data: ReturnType<typeof this.exportHistory>): void {
    this.trials = data.trials;
    this.bestScore = data.bestScore;
    this.hyperparameters = data.hyperparameters;
    this.objectives = data.objectives;

    // Rebuild GP model
    this.gp = new GaussianProcess();
    for (const trial of this.trials) {
      const x = this.encodeHyperparameters(trial.hyperparameters);
      this.gp.addObservation(x, trial.score);
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createRefinementEngine(
  config?: Partial<RefinementConfig>
): RefinementEngine {
  const engine = new RefinementEngine(config);
  engine.defineHyperparameters(RefinementEngine.getDefaultHyperparameters());
  engine.defineObjectives(RefinementEngine.getDefaultObjectives());
  return engine;
}
