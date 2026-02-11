/**
 * RuVector Training Service
 * Real WASM-accelerated pattern training using @ruvector packages
 *
 * Features:
 * - MicroLoRA: <1µs adaptation with rank-2 LoRA (2.3M ops/s)
 * - Pattern: Self-Optimizing Pattern Architecture (624k learn/s, 60k search/s)
 * - Flash Attention: CPU-optimized (9k ops/s)
 * - Trajectory Buffer: Learning from success/failure
 * - Contrastive Learning: InfoNCE loss
 *
 * Backward Compatible: All v1 APIs preserved, Pattern adds new capabilities
 *
 * Created with ❤️ by ruv.io
 */

import type {
  WasmMicroLoRA,
  WasmScopedLoRA,
  WasmTrajectoryBuffer,
} from '@ruvector/learning-wasm';

import type {
  FlashAttention,
  MoEAttention,
  HyperbolicAttention,
  AdamWOptimizer,
  InfoNceLoss,
  CurriculumScheduler,
  HardNegativeMiner,
  BenchmarkResult,
} from '@ruvector/attention';

// Pattern Engine type (from @ruvector/sona)
interface SonaEngineInstance {
  forceLearn(embedding: Float32Array, reward: number): void;
  findPatterns(embedding: number[], k: number): unknown[];
  tick(): void;
  getStats(): string;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  flush(): void;
}

// Lazy-loaded WASM modules
let microLoRA: WasmMicroLoRA | null = null;
let scopedLoRA: WasmScopedLoRA | null = null;
let trajectoryBuffer: WasmTrajectoryBuffer | null = null;
let flashAttention: FlashAttention | null = null;
let moeAttention: MoEAttention | null = null;
let hyperbolicAttention: HyperbolicAttention | null = null;
let optimizer: AdamWOptimizer | null = null;
let contrastiveLoss: InfoNceLoss | null = null;
let curriculum: CurriculumScheduler | null = null;
let hardMiner: HardNegativeMiner | null = null;

// Pattern engine (optional enhancement)
let sonaEngine: SonaEngineInstance | null = null;
let sonaAvailable = false;

// Training state
let initialized = false;
let totalAdaptations = 0;
let totalForwards = 0;
let totalSonaLearns = 0;
let totalSonaSearches = 0;
let lastBenchmark: BenchmarkResult[] | null = null;

export interface TrainingConfig {
  dim?: number;           // Embedding dimension (max 256)
  learningRate?: number;  // Learning rate
  alpha?: number;         // LoRA scaling factor
  trajectoryCapacity?: number;
  useFlashAttention?: boolean;
  useMoE?: boolean;
  useHyperbolic?: boolean;
  totalSteps?: number;    // For curriculum
  warmupSteps?: number;
  // Pattern options (v2 enhancement)
  useSona?: boolean;      // Enable Pattern self-optimizing neural architecture
  sonaRank?: number;      // Pattern LoRA rank (default: 4)
}

export interface TrainingResult {
  success: boolean;
  adaptationCount: bigint;
  forwardCount: bigint;
  deltaNorm: number;
  trajectoryStats?: {
    successRate: number;
    meanImprovement: number;
    bestImprovement: number;
    totalCount: bigint;
  };
  benchmark?: BenchmarkResult[];
}

/**
 * Initialize the RuVector training system
 */
export async function initializeTraining(config: TrainingConfig = {}): Promise<{
  success: boolean;
  features: string[];
  error?: string;
}> {
  const features: string[] = [];
  const dim = Math.min(config.dim || 256, 256); // Max 256 for WASM
  const lr = config.learningRate || 0.01;
  const alpha = config.alpha || 0.1;

  try {
    // Initialize MicroLoRA with direct WASM loading (Node.js compatible)
    const fs = await import('fs');
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);

    // Load WASM file directly instead of using fetch
    const wasmPath = require.resolve('@ruvector/learning-wasm/ruvector_learning_wasm_bg.wasm');
    const wasmBuffer = fs.readFileSync(wasmPath);

    const learningWasm = await import('@ruvector/learning-wasm');
    learningWasm.initSync({ module: wasmBuffer });

    microLoRA = new learningWasm.WasmMicroLoRA(dim, alpha, lr);
    features.push(`MicroLoRA (${dim}-dim, <1μs adaptation)`);

    // Initialize ScopedLoRA for per-operator learning
    scopedLoRA = new learningWasm.WasmScopedLoRA(dim, alpha, lr);
    scopedLoRA.set_category_fallback(true);
    features.push('ScopedLoRA (17 operators)');

    // Initialize trajectory buffer
    trajectoryBuffer = new learningWasm.WasmTrajectoryBuffer(
      config.trajectoryCapacity || 10000,
      dim
    );
    features.push('TrajectoryBuffer');

    // Initialize attention mechanisms
    const attention = await import('@ruvector/attention');

    if (config.useFlashAttention !== false) {
      flashAttention = new attention.FlashAttention(dim, 64);
      features.push('FlashAttention');
    }

    if (config.useMoE) {
      moeAttention = attention.MoEAttention.simple(dim, 8, 2);
      features.push('MoE (8 experts, top-2)');
    }

    if (config.useHyperbolic) {
      hyperbolicAttention = new attention.HyperbolicAttention(dim, 1.0);
      features.push('HyperbolicAttention');
    }

    // Initialize optimizer and loss
    optimizer = new attention.AdamWOptimizer(lr, 0.9, 0.999, 1e-8, 0.01);
    features.push('AdamW Optimizer');

    contrastiveLoss = new attention.InfoNceLoss(0.07);
    features.push('InfoNCE Loss');

    // Curriculum scheduler
    if (config.totalSteps) {
      curriculum = new attention.CurriculumScheduler(
        config.totalSteps,
        config.warmupSteps || Math.floor(config.totalSteps * 0.1)
      );
      features.push('Curriculum Learning');
    }

    // Hard negative mining - use string for MiningStrategy enum due to NAPI binding quirk
    try {
      // @ts-expect-error - MiningStrategy enum binding expects string not enum value
      hardMiner = new attention.HardNegativeMiner(5, 'semi_hard');
      features.push('Hard Negative Mining');
    } catch {
      // Mining not available, continue without it
    }

    // Initialize Pattern (optional, backward compatible)
    if (config.useSona !== false) {
      try {
        const sona = await import('@ruvector/sona');
        const sonaRank = config.sonaRank || 4;
        // SonaEngine constructor: (dim, rank, alpha, learningRate) - TypeScript types are wrong
        // @ts-expect-error - SonaEngine accepts 4 positional args but types say 1
        sonaEngine = new sona.SonaEngine(dim, sonaRank, alpha, lr) as SonaEngineInstance;
        sonaAvailable = true;
        features.push(`Pattern (${dim}-dim, rank-${sonaRank}, 624k learn/s)`);
      } catch (sonaError) {
        // Pattern not available, continue without it (backward compatible)
        sonaAvailable = false;
        // Only log if explicitly requested
        if (config.useSona === true) {
          console.warn('Pattern requested but not available:', sonaError);
        }
      }
    }

    initialized = true;
    return { success: true, features };
  } catch (error) {
    return {
      success: false,
      features,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Operator types for scoped LoRA (0-16)
 */
export const OperatorType = {
  GENERAL: 0,
  ATTENTION: 1,
  MLP: 2,
  EMBEDDING: 3,
  NORMALIZATION: 4,
  PROJECTION: 5,
  POOLING: 6,
  CONVOLUTION: 7,
  RECURRENT: 8,
  ROUTING: 9,
  MEMORY: 10,
  REASONING: 11,
  COORDINATION: 12,
  OPTIMIZATION: 13,
  SECURITY: 14,
  TESTING: 15,
  DEBUGGING: 16,
} as const;

/**
 * Train a pattern with MicroLoRA
 */
export async function trainPattern(
  embedding: Float32Array,
  gradient: Float32Array,
  operatorType?: number
): Promise<{ deltaNorm: number; adaptCount: bigint }> {
  if (!initialized || !microLoRA) {
    throw new Error('Training system not initialized');
  }

  // Use scoped LoRA if operator type specified
  if (operatorType !== undefined && scopedLoRA) {
    scopedLoRA.adapt_array(operatorType, gradient);
    return {
      deltaNorm: scopedLoRA.delta_norm(operatorType),
      adaptCount: scopedLoRA.adapt_count(operatorType),
    };
  }

  // Standard MicroLoRA adaptation
  microLoRA.adapt_array(gradient);
  totalAdaptations++;

  return {
    deltaNorm: microLoRA.delta_norm(),
    adaptCount: microLoRA.adapt_count(),
  };
}

/**
 * Forward pass through LoRA
 */
export function forward(
  input: Float32Array,
  operatorType?: number
): Float32Array {
  if (!initialized || !microLoRA) {
    throw new Error('Training system not initialized');
  }

  totalForwards++;

  if (operatorType !== undefined && scopedLoRA) {
    return scopedLoRA.forward_array(operatorType, input);
  }

  return microLoRA.forward_array(input);
}

/**
 * Reward-based adaptation (reinforcement learning)
 */
export function adaptWithReward(
  improvement: number,
  operatorType?: number
): void {
  if (!initialized) {
    throw new Error('Training system not initialized');
  }

  if (operatorType !== undefined && scopedLoRA) {
    scopedLoRA.adapt_with_reward(operatorType, improvement);
  } else if (microLoRA) {
    microLoRA.adapt_with_reward(improvement);
  }

  totalAdaptations++;
}

/**
 * Record a learning trajectory
 */
export function recordTrajectory(
  embedding: Float32Array,
  operatorType: number,
  attentionType: number,
  executionMs: number,
  baselineMs: number
): void {
  if (!trajectoryBuffer) {
    throw new Error('Trajectory buffer not initialized');
  }

  trajectoryBuffer.record(
    embedding,
    operatorType,
    attentionType,
    executionMs,
    baselineMs
  );
}

/**
 * Get trajectory statistics
 */
export function getTrajectoryStats(): {
  successRate: number;
  meanImprovement: number;
  bestImprovement: number;
  totalCount: bigint;
  highQualityCount: number;
  variance: number;
} | null {
  if (!trajectoryBuffer || trajectoryBuffer.is_empty()) {
    return null;
  }

  return {
    successRate: trajectoryBuffer.success_rate(),
    meanImprovement: trajectoryBuffer.mean_improvement(),
    bestImprovement: trajectoryBuffer.best_improvement(),
    totalCount: trajectoryBuffer.total_count(),
    highQualityCount: trajectoryBuffer.high_quality_count(0.1),
    variance: trajectoryBuffer.variance(),
  };
}

/**
 * Compute attention with Flash Attention (CPU-optimized faster)
 */
export function computeFlashAttention(
  query: Float32Array,
  keys: Float32Array[],
  values: Float32Array[]
): Float32Array {
  if (!flashAttention) {
    throw new Error('Flash attention not initialized');
  }

  return flashAttention.computeRaw(query, keys, values);
}

/**
 * Compute MoE routing
 */
export function computeMoEAttention(
  query: Float32Array,
  keys: Float32Array[],
  values: Float32Array[]
): Float32Array {
  if (!moeAttention) {
    throw new Error('MoE attention not initialized');
  }

  return moeAttention.computeRaw(query, keys, values);
}

/**
 * Compute hyperbolic attention (for hierarchical patterns)
 */
export function computeHyperbolicAttention(
  query: Float32Array,
  keys: Float32Array[],
  values: Float32Array[]
): Float32Array {
  if (!hyperbolicAttention) {
    throw new Error('Hyperbolic attention not initialized');
  }

  return hyperbolicAttention.computeRaw(query, keys, values);
}

/**
 * Compute contrastive loss for training
 */
export function computeContrastiveLoss(
  anchor: Float32Array,
  positives: Float32Array[],
  negatives: Float32Array[]
): { loss: number; gradient: Float32Array } {
  if (!contrastiveLoss) {
    throw new Error('Contrastive loss not initialized');
  }

  const loss = contrastiveLoss.compute(anchor, positives, negatives);
  const gradient = contrastiveLoss.backward(anchor, positives, negatives);

  return { loss, gradient };
}

/**
 * Optimizer step
 */
export function optimizerStep(
  params: Float32Array,
  gradients: Float32Array
): Float32Array {
  if (!optimizer) {
    throw new Error('Optimizer not initialized');
  }

  return optimizer.step(params, gradients);
}

/**
 * Get curriculum difficulty for current step
 */
export function getCurriculumDifficulty(step: number): number {
  if (!curriculum) {
    return 1.0; // Full difficulty if no curriculum
  }

  return curriculum.getDifficulty(step);
}

/**
 * Mine hard negatives for better training
 */
export function mineHardNegatives(
  anchor: Float32Array,
  candidates: Float32Array[]
): number[] {
  if (!hardMiner) {
    throw new Error('Hard negative miner not initialized');
  }

  return hardMiner.mine(anchor, candidates);
}

/**
 * Benchmark the training system
 */
export async function benchmarkTraining(
  dim?: number,
  iterations?: number
): Promise<BenchmarkResult[]> {
  const attention = await import('@ruvector/attention');
  lastBenchmark = attention.benchmarkAttention(dim || 256, 100, iterations || 1000);
  return lastBenchmark;
}

// ============================================
// Pattern Functions (v2 enhancement, optional)
// ============================================

/**
 * Check if Pattern is available
 */
export function isSonaAvailable(): boolean {
  return sonaAvailable && sonaEngine !== null;
}

/**
 * Force-learn a pattern with Pattern (1.6μs, 624k ops/s)
 * This is a one-shot learning mechanism for immediate pattern storage
 */
export function sonaForceLearn(
  embedding: Float32Array,
  reward: number
): void {
  if (!sonaEngine) {
    throw new Error('Pattern not initialized. Call initializeTraining with useSona: true');
  }

  sonaEngine.forceLearn(embedding, reward);
  totalSonaLearns++;
}

/**
 * Search for similar patterns with Pattern (16.7μs, 60k searches/s)
 * Returns the k most similar patterns from the pattern bank
 */
export function sonaFindPatterns(
  embedding: Float32Array,
  k: number = 5
): unknown[] {
  if (!sonaEngine) {
    throw new Error('Pattern not initialized. Call initializeTraining with useSona: true');
  }

  // Pattern requires Array, not Float32Array
  const embeddingArray = Array.from(embedding);
  totalSonaSearches++;
  return sonaEngine.findPatterns(embeddingArray, k);
}

/**
 * Process Pattern background tasks (0.13μs, 7.5M ticks/s)
 * Call periodically to process background learning and consolidation
 */
export function sonaTick(): void {
  if (!sonaEngine) {
    return; // Silent no-op if Pattern not available
  }

  sonaEngine.tick();
}

/**
 * Get Pattern statistics
 */
export function getSonaStats(): {
  available: boolean;
  enabled: boolean;
  stats: Record<string, unknown> | null;
  totalLearns: number;
  totalSearches: number;
} {
  if (!sonaEngine) {
    return {
      available: false,
      enabled: false,
      stats: null,
      totalLearns: totalSonaLearns,
      totalSearches: totalSonaSearches,
    };
  }

  try {
    const statsJson = sonaEngine.getStats();
    const stats = JSON.parse(statsJson);
    return {
      available: true,
      enabled: sonaEngine.isEnabled(),
      stats,
      totalLearns: totalSonaLearns,
      totalSearches: totalSonaSearches,
    };
  } catch {
    return {
      available: true,
      enabled: false,
      stats: null,
      totalLearns: totalSonaLearns,
      totalSearches: totalSonaSearches,
    };
  }
}

/**
 * Enable/disable Pattern learning
 */
export function setSonaEnabled(enabled: boolean): void {
  if (!sonaEngine) {
    return;
  }

  sonaEngine.setEnabled(enabled);
}

/**
 * Flush Pattern buffers (persist any pending patterns)
 */
export function sonaFlush(): void {
  if (!sonaEngine) {
    return;
  }

  sonaEngine.flush();
}

/**
 * Get training statistics
 */
export function getTrainingStats(): {
  initialized: boolean;
  totalAdaptations: number;
  totalForwards: number;
  microLoraStats?: {
    paramCount: number;
    adaptCount: bigint;
    forwardCount: bigint;
    deltaNorm: number;
  };
  scopedLoraStats?: {
    totalAdaptCount: bigint;
    totalForwardCount: bigint;
  };
  trajectoryStats?: ReturnType<typeof getTrajectoryStats>;
  sonaStats?: ReturnType<typeof getSonaStats>;
  lastBenchmark?: BenchmarkResult[];
} {
  const stats: ReturnType<typeof getTrainingStats> = {
    initialized,
    totalAdaptations,
    totalForwards,
  };

  if (microLoRA) {
    stats.microLoraStats = {
      paramCount: microLoRA.param_count(),
      adaptCount: microLoRA.adapt_count(),
      forwardCount: microLoRA.forward_count(),
      deltaNorm: microLoRA.delta_norm(),
    };
  }

  if (scopedLoRA) {
    stats.scopedLoraStats = {
      totalAdaptCount: scopedLoRA.total_adapt_count(),
      totalForwardCount: scopedLoRA.total_forward_count(),
    };
  }

  if (trajectoryBuffer && !trajectoryBuffer.is_empty()) {
    stats.trajectoryStats = getTrajectoryStats();
  }

  // Include Pattern stats if available
  if (sonaAvailable) {
    stats.sonaStats = getSonaStats();
  }

  if (lastBenchmark) {
    stats.lastBenchmark = lastBenchmark;
  }

  return stats;
}

/**
 * Reset the training system
 */
export function resetTraining(): void {
  if (microLoRA) microLoRA.reset();
  if (scopedLoRA) scopedLoRA.reset_all();
  if (trajectoryBuffer) trajectoryBuffer.reset();

  // Reset Pattern stats (engine doesn't have reset, just flush)
  if (sonaEngine) {
    sonaEngine.flush();
  }

  totalAdaptations = 0;
  totalForwards = 0;
  totalSonaLearns = 0;
  totalSonaSearches = 0;
}

/**
 * Export trained weights
 */
export function exportWeights(): {
  dim: number;
  deltaNorm: number;
  adaptCount: bigint;
  trajectoryStats: ReturnType<typeof getTrajectoryStats>;
} | null {
  if (!initialized || !microLoRA) {
    return null;
  }

  return {
    dim: microLoRA.dim(),
    deltaNorm: microLoRA.delta_norm(),
    adaptCount: microLoRA.adapt_count(),
    trajectoryStats: getTrajectoryStats(),
  };
}

/**
 * Cleanup resources
 */
export function cleanup(): void {
  if (microLoRA) {
    microLoRA.free();
    microLoRA = null;
  }
  if (scopedLoRA) {
    scopedLoRA.free();
    scopedLoRA = null;
  }
  if (trajectoryBuffer) {
    trajectoryBuffer.free();
    trajectoryBuffer = null;
  }

  // Cleanup Pattern
  if (sonaEngine) {
    sonaEngine.flush();
    sonaEngine = null;
    sonaAvailable = false;
  }

  flashAttention = null;
  moeAttention = null;
  hyperbolicAttention = null;
  optimizer = null;
  contrastiveLoss = null;
  curriculum = null;
  hardMiner = null;

  initialized = false;
  totalAdaptations = 0;
  totalForwards = 0;
  totalSonaLearns = 0;
  totalSonaSearches = 0;
  lastBenchmark = null;
}
