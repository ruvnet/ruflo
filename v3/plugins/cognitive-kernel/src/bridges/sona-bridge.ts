/**
 * Pattern Bridge
 *
 * Bridge to Pattern (Self-Optimizing Pattern Architecture) for continuous
 * learning with LoRA fine-tuning and EWC++ memory preservation.
 */

import type { SonaPattern } from '../types.js';

/**
 * WASM module status
 */
export type WasmModuleStatus = 'unloaded' | 'loading' | 'ready' | 'error';

/**
 * Pattern configuration
 */
export interface SonaConfig {
  /** Operating mode */
  mode: 'real-time' | 'balanced' | 'research' | 'edge' | 'batch';
  /** LoRA rank for fine-tuning */
  loraRank: number;
  /** Learning rate */
  learningRate: number;
  /** EWC++ lambda (memory preservation strength) */
  ewcLambda: number;
  /** Batch size for training */
  batchSize: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: SonaConfig = {
  mode: 'balanced',
  loraRank: 4,
  learningRate: 0.001,
  ewcLambda: 100,
  batchSize: 32,
};

/**
 * Pattern trajectory for learning
 */
export interface SonaTrajectory {
  id: string;
  domain: string;
  steps: SonaStep[];
  qualityScore: number;
  metadata?: Record<string, unknown>;
}

/**
 * Pattern learning step
 */
export interface SonaStep {
  stateBefore: Float32Array;
  action: string;
  stateAfter: Float32Array;
  reward: number;
  timestamp: number;
}

/**
 * LoRA weights
 */
export interface LoRAWeights {
  A: Map<string, Float32Array>;
  B: Map<string, Float32Array>;
  rank: number;
  alpha: number;
}

/**
 * EWC state
 */
export interface EWCState {
  fisher: Map<string, Float32Array>;
  means: Map<string, Float32Array>;
  lambda: number;
}

/**
 * Pattern prediction result
 */
export interface SonaPrediction {
  action: string;
  confidence: number;
  alternativeActions?: Array<{ action: string; confidence: number }>;
}

/**
 * Pattern WASM module interface
 */
interface SonaModule {
  // Core learning
  learn(trajectories: SonaTrajectory[], config: SonaConfig): number;
  predict(state: Float32Array): SonaPrediction;

  // Pattern management
  storePattern(pattern: SonaPattern): void;
  findPatterns(query: Float32Array, k: number): SonaPattern[];
  updatePatternSuccess(patternId: string, success: boolean): void;

  // LoRA operations
  applyLoRA(input: Float32Array, weights: LoRAWeights): Float32Array;
  updateLoRA(gradients: Float32Array, config: SonaConfig): LoRAWeights;

  // EWC operations
  computeFisher(trajectories: SonaTrajectory[]): Map<string, Float32Array>;
  consolidate(ewcState: EWCState): void;

  // Mode-specific optimizations
  setMode(mode: SonaConfig['mode']): void;
  getMode(): SonaConfig['mode'];
}

/**
 * Pattern Bridge implementation
 */
export class SonaBridge {
  readonly name = 'sona';
  readonly version = '0.1.0';

  private _status: WasmModuleStatus = 'unloaded';
  private _module: SonaModule | null = null;
  private config: SonaConfig;

  constructor(config?: Partial<SonaConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get status(): WasmModuleStatus {
    return this._status;
  }

  get initialized(): boolean {
    return this._status === 'ready';
  }

  async init(): Promise<void> {
    if (this._status === 'ready') return;
    if (this._status === 'loading') return;

    this._status = 'loading';

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wasmModule = await (import('@ruvector/sona' as any) as Promise<unknown>).catch(() => null);

      if (wasmModule) {
        this._module = wasmModule as unknown as SonaModule;
      } else {
        this._module = this.createMockModule();
      }

      this._module.setMode(this.config.mode);
      this._status = 'ready';
    } catch (error) {
      this._status = 'error';
      throw error;
    }
  }

  async destroy(): Promise<void> {
    this._module = null;
    this._status = 'unloaded';
  }

  isReady(): boolean {
    return this._status === 'ready';
  }

  getModule(): SonaModule | null {
    return this._module;
  }

  /**
   * Learn from trajectories
   * Returns improvement score (0-1)
   */
  learn(trajectories: SonaTrajectory[], config?: Partial<SonaConfig>): number {
    if (!this._module) throw new Error('Pattern module not initialized');
    const mergedConfig = { ...this.config, ...config };
    return this._module.learn(trajectories, mergedConfig);
  }

  /**
   * Predict next action
   */
  predict(state: Float32Array): SonaPrediction {
    if (!this._module) throw new Error('Pattern module not initialized');
    return this._module.predict(state);
  }

  /**
   * Store a pattern
   */
  storePattern(pattern: SonaPattern): void {
    if (!this._module) throw new Error('Pattern module not initialized');
    this._module.storePattern(pattern);
  }

  /**
   * Find similar patterns
   */
  findPatterns(query: Float32Array, k: number): SonaPattern[] {
    if (!this._module) throw new Error('Pattern module not initialized');
    return this._module.findPatterns(query, k);
  }

  /**
   * Update pattern success rate
   */
  updatePatternSuccess(patternId: string, success: boolean): void {
    if (!this._module) throw new Error('Pattern module not initialized');
    this._module.updatePatternSuccess(patternId, success);
  }

  /**
   * Apply LoRA transformation
   */
  applyLoRA(input: Float32Array, weights: LoRAWeights): Float32Array {
    if (!this._module) throw new Error('Pattern module not initialized');
    return this._module.applyLoRA(input, weights);
  }

  /**
   * Update LoRA weights from gradients
   */
  updateLoRA(gradients: Float32Array, config?: Partial<SonaConfig>): LoRAWeights {
    if (!this._module) throw new Error('Pattern module not initialized');
    const mergedConfig = { ...this.config, ...config };
    return this._module.updateLoRA(gradients, mergedConfig);
  }

  /**
   * Compute Fisher information matrix
   */
  computeFisher(trajectories: SonaTrajectory[]): Map<string, Float32Array> {
    if (!this._module) throw new Error('Pattern module not initialized');
    return this._module.computeFisher(trajectories);
  }

  /**
   * Consolidate memory with EWC++
   */
  consolidate(ewcState: EWCState): void {
    if (!this._module) throw new Error('Pattern module not initialized');
    this._module.consolidate(ewcState);
  }

  /**
   * Set operating mode
   */
  setMode(mode: SonaConfig['mode']): void {
    if (!this._module) throw new Error('Pattern module not initialized');
    this._module.setMode(mode);
    this.config.mode = mode;
  }

  /**
   * Get current mode
   */
  getMode(): SonaConfig['mode'] {
    return this._module?.getMode() ?? this.config.mode;
  }

  /**
   * Create mock module for development
   */
  private createMockModule(): SonaModule {
    const patterns = new Map<string, SonaPattern>();
    let currentMode: SonaConfig['mode'] = 'balanced';
    let loraWeights: LoRAWeights = {
      A: new Map(),
      B: new Map(),
      rank: 4,
      alpha: 0.1,
    };

    const self = this;

    return {
      learn(trajectories: SonaTrajectory[], config: SonaConfig): number {
        if (trajectories.length === 0) return 0;

        const goodTrajectories = trajectories.filter(t => t.qualityScore >= 0.5);
        if (goodTrajectories.length === 0) return 0;

        // Extract patterns from good trajectories
        for (const trajectory of goodTrajectories) {
          if (trajectory.steps.length > 0) {
            const lastStep = trajectory.steps[trajectory.steps.length - 1];
            if (lastStep) {
              const patternId = `pattern_${patterns.size}_${Date.now()}`;

              patterns.set(patternId, {
                id: patternId,
                embedding: new Float32Array(lastStep.stateAfter),
                successRate: trajectory.qualityScore,
                usageCount: 1,
                domain: trajectory.domain,
              });
            }
          }
        }

        const avgQuality = goodTrajectories.reduce((s, t) => s + t.qualityScore, 0) / goodTrajectories.length;
        return Math.max(0, avgQuality - 0.5);
      },

      predict(state: Float32Array): SonaPrediction {
        // Find most similar pattern
        let bestPattern: SonaPattern | null = null;
        let bestSim = -1;
        const alternatives: Array<{ action: string; confidence: number }> = [];

        for (const pattern of patterns.values()) {
          const sim = cosineSimilarity(state, pattern.embedding);
          if (sim > bestSim) {
            if (bestPattern) {
              alternatives.push({
                action: bestPattern.domain,
                confidence: bestSim * bestPattern.successRate,
              });
            }
            bestSim = sim;
            bestPattern = pattern;
          } else if (sim > 0.3) {
            alternatives.push({
              action: pattern.domain,
              confidence: sim * pattern.successRate,
            });
          }
        }

        // Sort alternatives by confidence
        alternatives.sort((a, b) => b.confidence - a.confidence);

        if (bestPattern && bestSim > 0.5) {
          return {
            action: bestPattern.domain,
            confidence: bestSim * bestPattern.successRate,
            alternativeActions: alternatives.slice(0, 3),
          };
        }

        return {
          action: 'explore',
          confidence: 0.3,
          alternativeActions: alternatives.slice(0, 3),
        };
      },

      storePattern(pattern: SonaPattern): void {
        patterns.set(pattern.id, pattern);
      },

      findPatterns(query: Float32Array, k: number): SonaPattern[] {
        const results: Array<{ pattern: SonaPattern; sim: number }> = [];

        for (const pattern of patterns.values()) {
          const sim = cosineSimilarity(query, pattern.embedding);
          results.push({ pattern, sim });
        }

        results.sort((a, b) => b.sim - a.sim);
        return results.slice(0, k).map(r => r.pattern);
      },

      updatePatternSuccess(patternId: string, success: boolean): void {
        const pattern = patterns.get(patternId);
        if (pattern) {
          pattern.usageCount++;
          const alpha = 1 / pattern.usageCount;
          pattern.successRate = pattern.successRate * (1 - alpha) + (success ? 1 : 0) * alpha;
        }
      },

      applyLoRA(input: Float32Array, weights: LoRAWeights): Float32Array {
        const output = new Float32Array(input.length);
        output.set(input);

        // Apply LoRA: output = input + alpha * B @ A @ input
        for (const [module, A] of weights.A) {
          const B = weights.B.get(module);
          if (!B) continue;

          // Simplified LoRA application
          let intermediate = 0;
          for (let i = 0; i < Math.min(input.length, A.length); i++) {
            intermediate += (A[i] ?? 0) * (input[i] ?? 0);
          }

          for (let i = 0; i < Math.min(output.length, B.length); i++) {
            output[i] = (output[i] ?? 0) + weights.alpha * (B[i] ?? 0) * intermediate;
          }
        }

        return output;
      },

      updateLoRA(gradients: Float32Array, config: SonaConfig): LoRAWeights {
        const dim = gradients.length;
        const rank = config.loraRank;

        const A = new Float32Array(rank * dim);
        const B = new Float32Array(dim * rank);

        // Initialize with small random values scaled by gradients
        for (let i = 0; i < A.length; i++) {
          A[i] = (Math.random() - 0.5) * 0.01 * ((gradients[i % dim] ?? 0) || 1);
        }
        for (let i = 0; i < B.length; i++) {
          B[i] = (Math.random() - 0.5) * 0.01 * ((gradients[i % dim] ?? 0) || 1);
        }

        loraWeights.A.set('default', A);
        loraWeights.B.set('default', B);
        loraWeights.rank = rank;

        return loraWeights;
      },

      computeFisher(trajectories: SonaTrajectory[]): Map<string, Float32Array> {
        const fisher = new Map<string, Float32Array>();

        for (const trajectory of trajectories) {
          for (const step of trajectory.steps) {
            const key = trajectory.domain;
            let f = fisher.get(key);

            if (!f) {
              f = new Float32Array(step.stateAfter.length);
              fisher.set(key, f);
            }

            // Approximate Fisher information
            for (let i = 0; i < step.stateAfter.length; i++) {
              const grad = (step.stateAfter[i] ?? 0) * step.reward;
              f[i] = (f[i] ?? 0) + grad * grad;
            }
          }
        }

        // Normalize
        for (const f of fisher.values()) {
          const sum = f.reduce((s, v) => s + v, 0);
          if (sum > 0) {
            for (let i = 0; i < f.length; i++) {
              f[i] = (f[i] ?? 0) / sum;
            }
          }
        }

        return fisher;
      },

      consolidate(ewcState: EWCState): void {
        // Apply EWC penalty to prevent catastrophic forgetting
        // Store current state as reference for future updates
        // This is a placeholder - actual implementation would modify learning gradients
      },

      setMode(mode: SonaConfig['mode']): void {
        currentMode = mode;
      },

      getMode(): SonaConfig['mode'] {
        return currentMode;
      },
    };
  }
}

/**
 * Cosine similarity helper
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) * (a[i] ?? 0);
    normB += (b[i] ?? 0) * (b[i] ?? 0);
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Create a new Pattern bridge
 */
export function createSonaBridge(config?: Partial<SonaConfig>): SonaBridge {
  return new SonaBridge(config);
}

export default SonaBridge;
