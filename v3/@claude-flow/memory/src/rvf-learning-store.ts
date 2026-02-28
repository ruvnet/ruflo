/**
 * RvfLearningStore - Persistent storage for SONA learning artifacts
 *
 * Stores patterns, LoRA adapters, EWC state, and trajectories in a
 * binary-header JSON-lines file format for fast append and rebuild.
 *
 * File format:
 *   4-byte magic "RVLS" + newline
 *   One JSON record per line: {"type":"pattern"|"lora"|"ewc"|"trajectory","data":{...}}
 *
 * @module @claude-flow/memory/rvf-learning-store
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ===== Types =====

export interface RvfLearningStoreConfig {
  /** Path to the persistence file */
  storePath: string;
  /** SONA embedding dimension (default: 64) */
  dimensions?: number;
  /** Auto-persist interval in ms (default: 30000) */
  autoPersistInterval?: number;
  /** Enable verbose logging (default: false) */
  verbose?: boolean;
}

export interface PatternRecord {
  id: string;
  type: string;
  embedding: number[];
  successRate: number;
  useCount: number;
  lastUsed: string;
}

export interface LoraRecord {
  id: string;
  config: Record<string, unknown>;
  weights: string;
  frozen: boolean;
  numParameters: number;
}

export interface EwcRecord {
  tasksLearned: number;
  protectionStrength: number;
  forgettingRate: number;
  taskWeights: Record<string, number[]>;
}

export interface TrajectoryRecord {
  id: string;
  steps: Array<{
    type: string;
    input: string;
    output: string;
    durationMs: number;
    confidence: number;
  }>;
  outcome: string;
  durationMs: number;
  timestamp: string;
}

type RecordType = 'pattern' | 'lora' | 'ewc' | 'trajectory';

interface StoreLine {
  type: RecordType;
  data: PatternRecord | LoraRecord | EwcRecord | TrajectoryRecord;
}

// ===== Constants =====

const MAGIC_HEADER = 'RVLS';
const DEFAULT_DIMENSIONS = 64;
const DEFAULT_AUTO_PERSIST_MS = 30_000;

// ===== Helpers =====

function ensureDirectory(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ===== RvfLearningStore =====

/**
 * Persistent store for SONA learning artifacts.
 *
 * Maintains in-memory maps for fast reads and flushes to a JSON-lines
 * file with a binary header on persist(). On initialize(), the file is
 * read line-by-line to rebuild state.
 *
 * @example
 * ```typescript
 * const store = new RvfLearningStore({ storePath: './data/learning.rvls' });
 * await store.initialize();
 *
 * await store.savePatterns([{ id: 'p1', type: 'query_response', ... }]);
 * await store.persist();
 * await store.close();
 * ```
 */
export class RvfLearningStore {
  private config: Required<RvfLearningStoreConfig>;
  private patterns: Map<string, PatternRecord> = new Map();
  private loraAdapters: Map<string, LoraRecord> = new Map();
  private ewcState: EwcRecord | null = null;
  private trajectories: TrajectoryRecord[] = [];
  private dirty = false;
  private initialized = false;
  private autoPersistTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: RvfLearningStoreConfig) {
    this.config = {
      storePath: config.storePath,
      dimensions: config.dimensions ?? DEFAULT_DIMENSIONS,
      autoPersistInterval: config.autoPersistInterval ?? DEFAULT_AUTO_PERSIST_MS,
      verbose: config.verbose ?? false,
    };
  }

  /**
   * Initialize the store by loading any existing data from disk.
   * Creates the parent directory if it does not exist.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    ensureDirectory(this.config.storePath);

    if (fs.existsSync(this.config.storePath)) {
      await this.loadFromDisk();
    }

    if (this.config.autoPersistInterval > 0) {
      this.autoPersistTimer = setInterval(
        () => void this.persist().catch(() => {}),
        this.config.autoPersistInterval,
      );
      // Allow the process to exit even if the timer is active
      if (this.autoPersistTimer.unref) {
        this.autoPersistTimer.unref();
      }
    }

    this.initialized = true;
    this.log('Store initialized');
  }

  // ===== Pattern operations =====

  /**
   * Save or update patterns. Existing patterns with matching IDs are
   * overwritten; new patterns are added.
   *
   * @returns The number of patterns stored
   */
  async savePatterns(patterns: PatternRecord[]): Promise<number> {
    this.ensureInitialized();
    let count = 0;
    for (const pattern of patterns) {
      this.patterns.set(pattern.id, { ...pattern });
      count++;
    }
    this.dirty = true;
    return count;
  }

  /** Load all patterns currently held in memory */
  async loadPatterns(): Promise<PatternRecord[]> {
    this.ensureInitialized();
    return Array.from(this.patterns.values());
  }

  /** Return the number of stored patterns */
  async getPatternCount(): Promise<number> {
    this.ensureInitialized();
    return this.patterns.size;
  }

  // ===== LoRA operations =====

  /** Save or update a LoRA adapter record */
  async saveLoraAdapter(record: LoraRecord): Promise<void> {
    this.ensureInitialized();
    this.loraAdapters.set(record.id, { ...record });
    this.dirty = true;
  }

  /** Load all LoRA adapter records */
  async loadLoraAdapters(): Promise<LoraRecord[]> {
    this.ensureInitialized();
    return Array.from(this.loraAdapters.values());
  }

  /** Delete a LoRA adapter by ID */
  async deleteLoraAdapter(id: string): Promise<boolean> {
    this.ensureInitialized();
    const existed = this.loraAdapters.delete(id);
    if (existed) this.dirty = true;
    return existed;
  }

  // ===== EWC operations =====

  /** Save EWC state (replaces any existing state) */
  async saveEwcState(record: EwcRecord): Promise<void> {
    this.ensureInitialized();
    this.ewcState = { ...record };
    this.dirty = true;
  }

  /** Load the EWC state, or null if none has been stored */
  async loadEwcState(): Promise<EwcRecord | null> {
    this.ensureInitialized();
    return this.ewcState ? { ...this.ewcState } : null;
  }

  // ===== Trajectory operations =====

  /** Append a trajectory record (append-only, never overwritten) */
  async appendTrajectory(record: TrajectoryRecord): Promise<void> {
    this.ensureInitialized();
    this.trajectories.push({ ...record });
    this.dirty = true;
  }

  /**
   * Return stored trajectories, newest first.
   * @param limit Maximum number to return (default: all)
   */
  async getTrajectories(limit?: number): Promise<TrajectoryRecord[]> {
    this.ensureInitialized();
    const sorted = [...this.trajectories].reverse();
    return limit !== undefined ? sorted.slice(0, limit) : sorted;
  }

  /** Return the number of stored trajectories */
  async getTrajectoryCount(): Promise<number> {
    this.ensureInitialized();
    return this.trajectories.length;
  }

  // ===== Lifecycle =====

  /**
   * Flush all in-memory state to disk. The entire file is rewritten
   * to ensure consistency (patterns may have been updated in-place).
   */
  async persist(): Promise<void> {
    if (!this.dirty) return;

    ensureDirectory(this.config.storePath);

    const lines: string[] = [MAGIC_HEADER];

    // Patterns
    for (const pattern of this.patterns.values()) {
      lines.push(JSON.stringify({ type: 'pattern', data: pattern }));
    }

    // LoRA adapters
    for (const lora of this.loraAdapters.values()) {
      lines.push(JSON.stringify({ type: 'lora', data: lora }));
    }

    // EWC state
    if (this.ewcState) {
      lines.push(JSON.stringify({ type: 'ewc', data: this.ewcState }));
    }

    // Trajectories
    for (const traj of this.trajectories) {
      lines.push(JSON.stringify({ type: 'trajectory', data: traj }));
    }

    const content = lines.join('\n') + '\n';
    const tmpPath = this.config.storePath + '.tmp';

    await fs.promises.writeFile(tmpPath, content, 'utf-8');
    await fs.promises.rename(tmpPath, this.config.storePath);

    this.dirty = false;
    this.log(`Persisted: ${this.patterns.size} patterns, ${this.loraAdapters.size} LoRA, ${this.trajectories.length} trajectories`);
  }

  /** Persist and release resources */
  async close(): Promise<void> {
    if (this.autoPersistTimer) {
      clearInterval(this.autoPersistTimer);
      this.autoPersistTimer = null;
    }

    if (this.dirty) {
      await this.persist();
    }

    this.initialized = false;
    this.log('Store closed');
  }

  // ===== Stats =====

  /** Return summary statistics about the store */
  async getStats(): Promise<{
    patterns: number;
    loraAdapters: number;
    trajectories: number;
    hasEwcState: boolean;
    fileSizeBytes: number;
  }> {
    this.ensureInitialized();

    let fileSizeBytes = 0;
    try {
      const stat = await fs.promises.stat(this.config.storePath);
      fileSizeBytes = stat.size;
    } catch {
      // File may not exist yet if nothing has been persisted
    }

    return {
      patterns: this.patterns.size,
      loraAdapters: this.loraAdapters.size,
      trajectories: this.trajectories.length,
      hasEwcState: this.ewcState !== null,
      fileSizeBytes,
    };
  }

  // ===== Private =====

  private async loadFromDisk(): Promise<void> {
    let content: string;
    try {
      content = await fs.promises.readFile(this.config.storePath, 'utf-8');
    } catch {
      return;
    }

    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length === 0) return;

    // Verify magic header
    if (lines[0] !== MAGIC_HEADER) {
      this.log(`Warning: invalid magic header "${lines[0]}", expected "${MAGIC_HEADER}"`);
      return;
    }

    let parsed = 0;
    let errors = 0;

    for (let i = 1; i < lines.length; i++) {
      try {
        const record = JSON.parse(lines[i]) as StoreLine;
        this.applyRecord(record);
        parsed++;
      } catch {
        errors++;
        this.log(`Warning: failed to parse line ${i + 1}`);
      }
    }

    this.log(`Loaded from disk: ${parsed} records, ${errors} errors`);
  }

  private applyRecord(record: StoreLine): void {
    switch (record.type) {
      case 'pattern': {
        const p = record.data as PatternRecord;
        this.patterns.set(p.id, p);
        break;
      }
      case 'lora': {
        const l = record.data as LoraRecord;
        this.loraAdapters.set(l.id, l);
        break;
      }
      case 'ewc': {
        this.ewcState = record.data as EwcRecord;
        break;
      }
      case 'trajectory': {
        this.trajectories.push(record.data as TrajectoryRecord);
        break;
      }
      default:
        this.log(`Warning: unknown record type "${record.type}"`);
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('RvfLearningStore has not been initialized. Call initialize() first.');
    }
  }

  private log(message: string): void {
    if (this.config.verbose) {
      // eslint-disable-next-line no-console
      console.log(`[RvfLearningStore] ${message}`);
    }
  }
}
