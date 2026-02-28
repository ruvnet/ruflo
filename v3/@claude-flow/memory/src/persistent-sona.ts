/**
 * PersistentSonaCoordinator - SONA learning with RVF persistence
 *
 * Wraps RvfLearningStore to provide an in-memory pattern bank with
 * brute-force cosine similarity, trajectory buffering, EWC tracking,
 * and automatic periodic persistence to disk.
 *
 * This is intentionally decoupled from the ruvector SONA classes:
 * it defines its own compatible types and delegates persistence to
 * RvfLearningStore.
 *
 * @module @claude-flow/memory/persistent-sona
 */

import {
  RvfLearningStore,
} from './rvf-learning-store.js';
import type {
  RvfLearningStoreConfig,
  PatternRecord,
  EwcRecord,
  TrajectoryRecord,
} from './rvf-learning-store.js';

// ===== Types =====

export interface PersistentSonaConfig {
  /** Path to the RVF learning store file */
  storePath: string;
  /** Cosine similarity threshold for pattern matching (default: 0.85) */
  patternThreshold?: number;
  /** Maximum buffered trajectories before oldest are evicted (default: 1000) */
  maxTrajectoryBuffer?: number;
  /** Auto-persist interval in ms (default: 30000) */
  autoPersistInterval?: number;
  /** Enable verbose logging (default: false) */
  verbose?: boolean;
}

// ===== Constants =====

const DEFAULT_PATTERN_THRESHOLD = 0.85;
const DEFAULT_MAX_TRAJECTORY_BUFFER = 1000;
const DEFAULT_AUTO_PERSIST_MS = 30_000;

// ===== Helpers =====

/**
 * Compute cosine similarity between two number arrays.
 * Returns 0 when either vector has zero magnitude.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;

  // Process in groups of 4 for better throughput
  let i = 0;
  for (; i + 3 < len; i += 4) {
    dot += a[i] * b[i] + a[i + 1] * b[i + 1] + a[i + 2] * b[i + 2] + a[i + 3] * b[i + 3];
    normA += a[i] * a[i] + a[i + 1] * a[i + 1] + a[i + 2] * a[i + 2] + a[i + 3] * a[i + 3];
    normB += b[i] * b[i] + b[i + 1] * b[i + 1] + b[i + 2] * b[i + 2] + b[i + 3] * b[i + 3];
  }
  for (; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ===== PersistentSonaCoordinator =====

/**
 * Coordinates SONA learning with persistent storage.
 *
 * @example
 * ```typescript
 * const sona = new PersistentSonaCoordinator({
 *   storePath: './data/sona-learning.rvls',
 * });
 * await sona.initialize();
 *
 * // Store a pattern
 * const id = sona.storePattern('query_response', embedding);
 *
 * // Find similar patterns
 * const matches = sona.findSimilarPatterns(queryEmbedding, 5);
 *
 * // Record a trajectory
 * sona.recordTrajectory({ id: 'traj-1', steps: [...], outcome: 'success', ... });
 *
 * // Periodic background learning
 * const result = sona.runBackgroundLoop();
 *
 * await sona.shutdown();
 * ```
 */
export class PersistentSonaCoordinator {
  private store: RvfLearningStore;
  private patterns: Map<string, PatternRecord> = new Map();
  private trajectoryBuffer: TrajectoryRecord[] = [];
  private ewcState: EwcRecord | null = null;
  private patternThreshold: number;
  private maxTrajectoryBuffer: number;
  private verbose: boolean;
  private initialized = false;

  constructor(config: PersistentSonaConfig) {
    this.patternThreshold = config.patternThreshold ?? DEFAULT_PATTERN_THRESHOLD;
    this.maxTrajectoryBuffer = config.maxTrajectoryBuffer ?? DEFAULT_MAX_TRAJECTORY_BUFFER;
    this.verbose = config.verbose ?? false;

    const storeConfig: RvfLearningStoreConfig = {
      storePath: config.storePath,
      autoPersistInterval: config.autoPersistInterval ?? DEFAULT_AUTO_PERSIST_MS,
      verbose: config.verbose,
    };

    this.store = new RvfLearningStore(storeConfig);
  }

  /**
   * Initialize by loading persisted state from the RVF store.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.store.initialize();

    // Rebuild in-memory state from store
    const patterns = await this.store.loadPatterns();
    for (const p of patterns) {
      this.patterns.set(p.id, p);
    }

    const ewc = await this.store.loadEwcState();
    this.ewcState = ewc;

    const trajectories = await this.store.getTrajectories();
    // getTrajectories returns newest-first, reverse for chronological buffer
    this.trajectoryBuffer = trajectories.reverse();

    this.initialized = true;
    this.log(
      `Initialized: ${this.patterns.size} patterns, ` +
      `${this.trajectoryBuffer.length} trajectories, ` +
      `EWC: ${this.ewcState ? 'yes' : 'no'}`,
    );
  }

  // ===== Pattern operations =====

  /**
   * Store a new pattern and return its ID.
   *
   * @param type - Pattern type (e.g. 'query_response', 'routing')
   * @param embedding - The pattern embedding vector
   * @param metadata - Optional extra metadata (currently unused, reserved)
   * @returns The generated pattern ID
   */
  storePattern(
    type: string,
    embedding: number[],
    metadata?: Record<string, unknown>,
  ): string {
    this.ensureInitialized();

    const id = generateId('pat');
    const record: PatternRecord = {
      id,
      type,
      embedding: [...embedding],
      successRate: 1.0,
      useCount: 0,
      lastUsed: new Date().toISOString(),
    };

    this.patterns.set(id, record);
    return id;
  }

  /**
   * Find the k most similar patterns above the configured threshold.
   * Uses brute-force cosine similarity (suitable for small pattern sets).
   */
  findSimilarPatterns(embedding: number[], k: number = 5): PatternRecord[] {
    this.ensureInitialized();

    const results: Array<{ record: PatternRecord; score: number }> = [];

    for (const record of this.patterns.values()) {
      const score = cosineSimilarity(embedding, record.embedding);
      if (score >= this.patternThreshold) {
        results.push({ record, score });
      }
    }

    // Sort descending by score and take top-k
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, k).map((r) => r.record);
  }

  /**
   * Record a pattern usage outcome. Updates the success rate using an
   * exponential moving average (alpha = 0.1).
   */
  recordPatternUsage(patternId: string, success: boolean): void {
    this.ensureInitialized();

    const pattern = this.patterns.get(patternId);
    if (!pattern) return;

    pattern.useCount++;
    pattern.lastUsed = new Date().toISOString();

    const alpha = 0.1;
    const outcome = success ? 1.0 : 0.0;
    pattern.successRate = alpha * outcome + (1 - alpha) * pattern.successRate;
  }

  /**
   * Remove patterns that have low success rates after sufficient usage.
   *
   * @returns The number of patterns pruned
   */
  prunePatterns(minSuccessRate: number = 0.3, minUseCount: number = 5): number {
    this.ensureInitialized();

    let pruned = 0;
    for (const [id, pattern] of this.patterns) {
      if (pattern.useCount >= minUseCount && pattern.successRate < minSuccessRate) {
        this.patterns.delete(id);
        pruned++;
      }
    }

    if (pruned > 0) {
      this.log(`Pruned ${pruned} low-performing patterns`);
    }

    return pruned;
  }

  // ===== Trajectory tracking =====

  /**
   * Buffer a completed trajectory for later processing.
   * When the buffer exceeds maxTrajectoryBuffer, the oldest entries
   * are evicted.
   */
  recordTrajectory(trajectory: TrajectoryRecord): void {
    this.ensureInitialized();

    this.trajectoryBuffer.push({ ...trajectory });

    while (this.trajectoryBuffer.length > this.maxTrajectoryBuffer) {
      this.trajectoryBuffer.shift();
    }
  }

  // ===== Learning loop =====

  /**
   * Process buffered trajectories to extract new patterns.
   * Successful and partial trajectories are mined for high-confidence
   * steps; new patterns are stored if they are sufficiently different
   * from existing ones.
   *
   * After processing, the trajectory buffer is cleared and low-performing
   * patterns are pruned.
   *
   * @returns Summary of the learning pass
   */
  runBackgroundLoop(): {
    patternsLearned: number;
    trajectoriesProcessed: number;
  } {
    this.ensureInitialized();

    let patternsLearned = 0;
    const trajectoriesProcessed = this.trajectoryBuffer.length;

    for (const traj of this.trajectoryBuffer) {
      if (traj.outcome === 'success' || traj.outcome === 'partial') {
        patternsLearned += this.extractPatternsFromTrajectory(traj);
      }
    }

    this.prunePatterns();
    this.trajectoryBuffer = [];

    this.log(
      `Background loop: ${patternsLearned} patterns learned, ` +
      `${trajectoriesProcessed} trajectories processed`,
    );

    return { patternsLearned, trajectoriesProcessed };
  }

  // ===== Persistence =====

  /**
   * Flush current in-memory state to the RVF store on disk.
   */
  async persist(): Promise<void> {
    const allPatterns = Array.from(this.patterns.values());
    await this.store.savePatterns(allPatterns);

    if (this.ewcState) {
      await this.store.saveEwcState(this.ewcState);
    }

    // Persist any buffered trajectories that have not yet been saved
    for (const traj of this.trajectoryBuffer) {
      await this.store.appendTrajectory(traj);
    }

    await this.store.persist();
  }

  /**
   * Persist state and shut down the store.
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    await this.persist();
    await this.store.close();
    this.initialized = false;
    this.log('Shutdown complete');
  }

  // ===== Stats =====

  /**
   * Return a summary of the coordinator's current state.
   */
  getStats(): {
    patterns: number;
    avgSuccessRate: number;
    trajectoriesBuffered: number;
    ewcTasksLearned: number;
  } {
    let totalSuccessRate = 0;
    let count = 0;
    for (const p of this.patterns.values()) {
      totalSuccessRate += p.successRate;
      count++;
    }

    return {
      patterns: this.patterns.size,
      avgSuccessRate: count > 0 ? totalSuccessRate / count : 0,
      trajectoriesBuffered: this.trajectoryBuffer.length,
      ewcTasksLearned: this.ewcState?.tasksLearned ?? 0,
    };
  }

  // ===== Private =====

  /**
   * Extract patterns from a trajectory's high-confidence steps.
   * A step produces a new pattern only if no sufficiently similar
   * pattern already exists.
   */
  private extractPatternsFromTrajectory(trajectory: TrajectoryRecord): number {
    let extracted = 0;

    for (const step of trajectory.steps) {
      if (step.confidence < this.patternThreshold) continue;

      const embedding = this.createHashEmbedding(step.input + step.output);
      const similar = this.findSimilarPatterns(embedding, 1);

      if (similar.length === 0) {
        this.storePattern(step.type, embedding);
        extracted++;
      }
    }

    return extracted;
  }

  /**
   * Deterministic hash-based embedding for pattern extraction.
   * This is a lightweight stand-in for a real embedding model,
   * matching the approach used in SonaCoordinator.
   */
  private createHashEmbedding(text: string, dim: number = 64): number[] {
    const embedding = new Array<number>(dim).fill(0);

    for (let i = 0; i < text.length; i++) {
      const idx = (text.charCodeAt(i) * (i + 1)) % dim;
      embedding[idx] += 0.1;
    }

    let norm = 0;
    for (let i = 0; i < dim; i++) {
      norm += embedding[i] * embedding[i];
    }
    norm = Math.sqrt(norm) || 1;

    for (let i = 0; i < dim; i++) {
      embedding[i] /= norm;
    }

    return embedding;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        'PersistentSonaCoordinator has not been initialized. Call initialize() first.',
      );
    }
  }

  private log(message: string): void {
    if (this.verbose) {
      // eslint-disable-next-line no-console
      console.log(`[PersistentSona] ${message}`);
    }
  }
}
