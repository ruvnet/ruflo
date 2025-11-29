/**
 * TruthDBAdapter - Persistence Layer for Verification Results
 *
 * Bridges the VerificationHookManager to AgentDB for persistent storage
 * of truth scores, validation results, and verification contexts.
 *
 * Storage: .agentdb/truth-scores.db (physically segregated from main memory)
 *
 * @module verification/truth-db-adapter
 */

import { AgentDBBackend } from '../memory/backends/agentdb.js';

/**
 * Document structure for persisted truth scores
 */
export interface TruthScoreDocument {
  taskId: string;
  sessionId: string;
  timestamp: number;
  phase: string;
  accuracyScore: number;
  confidenceScore: number;
  passed: boolean;
  checksPassed: string[];
  checksFailed: string[];
  errorCount: number;
  metadata: Record<string, unknown>;
}

/**
 * Snapshot document for rollback capability
 */
export interface SnapshotDocument {
  snapshotId: string;
  taskId: string;
  timestamp: number;
  phase: string;
  state: unknown;
  metadata: Record<string, unknown>;
}

/**
 * TruthDBAdapter - Persistent storage adapter for verification contexts
 *
 * Uses AgentDB with physical segregation to avoid polluting main memory.
 */
export class TruthDBAdapter {
  private backend: AgentDBBackend;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    // Physical segregation - separate DB file from main memory
    this.backend = new AgentDBBackend({
      dbPath: '.agentdb/truth-scores.db',
      enableHNSW: true,
      quantization: 'scalar'
    });
  }

  /**
   * Initialize the database connection
   * Safe to call multiple times - will only initialize once
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) {
      return true;
    }

    if (this.initPromise) {
      await this.initPromise;
      return this.initialized;
    }

    this.initPromise = this._doInitialize();
    await this.initPromise;
    return this.initialized;
  }

  private async _doInitialize(): Promise<void> {
    try {
      await this.backend.initialize();
      this.initialized = true;
      console.error(`[${new Date().toISOString()}] INFO [TruthDBAdapter] Initialized at .agentdb/truth-scores.db`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ERROR [TruthDBAdapter] Initialization failed:`, (error as Error).message);
      // Don't throw - allow graceful degradation
      this.initialized = false;
    }
  }

  /**
   * Check if adapter is ready for operations
   */
  isReady(): boolean {
    return this.initialized;
  }

  /**
   * Save a verification context to persistent storage
   *
   * @param taskId - Unique task identifier
   * @param data - Verification context data to persist
   */
  async saveContext(taskId: string, data: TruthScoreDocument): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.initialized) {
      console.warn(`[TruthDBAdapter] Not initialized, skipping save for ${taskId}`);
      return;
    }

    const key = `truth:${taskId}`;
    const embedding = this.generateEmbedding(data);

    try {
      await this.backend.storeVector(key, embedding, {
        ...data,
        _type: 'truth_score',
        _storedAt: Date.now(),
        _version: 1
      });
    } catch (error) {
      console.error(`[TruthDBAdapter] Failed to save context ${taskId}:`, (error as Error).message);
      throw error;
    }
  }

  /**
   * Retrieve a verification context by task ID
   *
   * @param taskId - Unique task identifier
   * @returns The stored document or null if not found
   */
  async getContext(taskId: string): Promise<TruthScoreDocument | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.initialized) {
      return null;
    }

    const key = `truth:${taskId}`;

    try {
      const result = await this.backend.getVector(key);
      if (!result || !result.metadata) {
        return null;
      }
      return result.metadata as TruthScoreDocument;
    } catch (error) {
      console.error(`[TruthDBAdapter] Failed to get context ${taskId}:`, (error as Error).message);
      return null;
    }
  }

  /**
   * Delete a verification context
   *
   * @param taskId - Unique task identifier
   * @returns true if deleted, false otherwise
   */
  async deleteContext(taskId: string): Promise<boolean> {
    if (!this.initialized) {
      return false;
    }

    const key = `truth:${taskId}`;

    try {
      return await this.backend.deleteVector(key);
    } catch (error) {
      console.error(`[TruthDBAdapter] Failed to delete ${taskId}:`, (error as Error).message);
      return false;
    }
  }

  /**
   * Save a state snapshot for rollback capability
   *
   * @param taskId - Parent task identifier
   * @param snapshot - Snapshot data to persist
   */
  async saveSnapshot(taskId: string, snapshot: SnapshotDocument): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.initialized) {
      return;
    }

    const key = `snapshot:${taskId}:${snapshot.snapshotId}`;
    const embedding = this.generateSnapshotEmbedding(snapshot);

    try {
      await this.backend.storeVector(key, embedding, {
        ...snapshot,
        _type: 'snapshot',
        _storedAt: Date.now()
      });
    } catch (error) {
      console.error(`[TruthDBAdapter] Failed to save snapshot:`, (error as Error).message);
    }
  }

  /**
   * Get all snapshots for a task (for rollback)
   *
   * @param taskId - Task identifier to get snapshots for
   * @returns Array of snapshots sorted by timestamp
   */
  async getSnapshots(taskId: string): Promise<SnapshotDocument[]> {
    if (!this.initialized) {
      return [];
    }

    try {
      // Use search to find all snapshots for this task
      const queryEmbedding = this.generateSnapshotEmbedding({
        snapshotId: '',
        taskId,
        timestamp: Date.now(),
        phase: 'query',
        state: null,
        metadata: {}
      });

      const results = await this.backend.search(queryEmbedding, {
        k: 100,
        filter: { taskId, _type: 'snapshot' }
      });

      return results
        .map(r => r.metadata as SnapshotDocument)
        .filter(s => s && s.snapshotId)
        .sort((a, b) => a.timestamp - b.timestamp);
    } catch (error) {
      console.error(`[TruthDBAdapter] Failed to get snapshots for ${taskId}:`, (error as Error).message);
      return [];
    }
  }

  /**
   * Search for similar verification contexts (semantic search)
   *
   * @param query - Query document for similarity search
   * @param k - Number of results to return
   * @returns Array of similar documents
   */
  async searchSimilar(query: Partial<TruthScoreDocument>, k: number = 10): Promise<TruthScoreDocument[]> {
    if (!this.initialized) {
      return [];
    }

    try {
      const embedding = this.generateEmbedding(query as TruthScoreDocument);
      const results = await this.backend.search(embedding, { k });
      return results
        .map(r => r.metadata as TruthScoreDocument)
        .filter(d => d && d._type === 'truth_score');
    } catch (error) {
      console.error(`[TruthDBAdapter] Search failed:`, (error as Error).message);
      return [];
    }
  }

  /**
   * Get database statistics
   */
  async getStats(): Promise<{
    initialized: boolean;
    vectorCount?: number;
    dbPath?: string;
    error?: string;
  }> {
    if (!this.initialized) {
      return { initialized: false, error: 'Not initialized' };
    }

    try {
      const stats = await this.backend.getStats();
      return {
        initialized: true,
        vectorCount: stats.vectorCount,
        dbPath: '.agentdb/truth-scores.db'
      };
    } catch (error) {
      return {
        initialized: true,
        error: (error as Error).message
      };
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.initialized) {
      await this.backend.close();
      this.initialized = false;
    }
  }

  // ===== Private Methods =====

  /**
   * Generate embedding vector for truth score documents
   *
   * Creates a numerical representation for HNSW semantic search.
   * Uses feature-based embedding (128 dimensions).
   */
  private generateEmbedding(doc: TruthScoreDocument): number[] {
    const embedding = new Array(128).fill(0);

    // Accuracy features (dims 0-15)
    embedding[0] = doc.accuracyScore ?? 0;
    embedding[1] = doc.confidenceScore ?? 0;
    embedding[2] = doc.passed ? 1 : 0;
    embedding[3] = Math.min((doc.errorCount ?? 0) / 10, 1); // Normalized
    embedding[4] = Math.min((doc.checksPassed?.length ?? 0) / 20, 1);
    embedding[5] = Math.min((doc.checksFailed?.length ?? 0) / 20, 1);

    // Temporal features (dims 16-31)
    const timestamp = doc.timestamp ?? Date.now();
    const dayNorm = (timestamp % 86400000) / 86400000; // Time of day
    embedding[16] = dayNorm;
    embedding[17] = Math.sin(dayNorm * 2 * Math.PI); // Cyclic encoding
    embedding[18] = Math.cos(dayNorm * 2 * Math.PI);

    // Phase encoding (dims 32-47)
    const phases = ['pre-task', 'execution', 'post-task', 'validation', 'complete', 'failed'];
    const phaseIndex = phases.indexOf(doc.phase ?? 'pre-task');
    if (phaseIndex >= 0 && phaseIndex < 16) {
      embedding[32 + phaseIndex] = 1;
    }

    // Task ID hash for grouping (dims 48-63)
    if (doc.taskId) {
      const hash = this.hashString(doc.taskId);
      for (let i = 0; i < 16; i++) {
        embedding[48 + i] = ((hash >> i) & 1) ? 0.5 : -0.5;
      }
    }

    // Session ID hash (dims 64-79)
    if (doc.sessionId) {
      const hash = this.hashString(doc.sessionId);
      for (let i = 0; i < 16; i++) {
        embedding[64 + i] = ((hash >> i) & 1) ? 0.5 : -0.5;
      }
    }

    return embedding;
  }

  /**
   * Generate embedding for snapshots
   */
  private generateSnapshotEmbedding(snapshot: SnapshotDocument): number[] {
    const embedding = new Array(128).fill(0);

    // Temporal features
    const timestamp = snapshot.timestamp ?? Date.now();
    embedding[0] = (timestamp % 86400000) / 86400000;

    // Phase encoding
    const phases = ['pre-task', 'execution', 'post-task', 'validation', 'complete', 'failed'];
    const phaseIndex = phases.indexOf(snapshot.phase ?? 'pre-task');
    if (phaseIndex >= 0 && phaseIndex < 16) {
      embedding[32 + phaseIndex] = 1;
    }

    // Task ID hash
    if (snapshot.taskId) {
      const hash = this.hashString(snapshot.taskId);
      for (let i = 0; i < 16; i++) {
        embedding[48 + i] = ((hash >> i) & 1) ? 0.5 : -0.5;
      }
    }

    // Snapshot ID hash
    if (snapshot.snapshotId) {
      const hash = this.hashString(snapshot.snapshotId);
      for (let i = 0; i < 16; i++) {
        embedding[80 + i] = ((hash >> i) & 1) ? 0.5 : -0.5;
      }
    }

    return embedding;
  }

  /**
   * Simple string hash function
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}

// Export singleton instance
export const truthDBAdapter = new TruthDBAdapter();
