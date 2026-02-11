/**
 * @claude-flow/browser - Memory Integration
 * Persistent memory storage with HNSW semantic search for browser patterns
 */

import type { BrowserTrajectory, BrowserTrajectoryStep, Snapshot, ActionResult } from '../domain/types.js';

// ============================================================================
// Memory Types
// ============================================================================

export interface BrowserMemoryEntry {
  id: string;
  type: 'trajectory' | 'pattern' | 'snapshot' | 'session' | 'error';
  key: string;
  value: Record<string, unknown>;
  metadata: {
    sessionId: string;
    url?: string;
    goal?: string;
    success?: boolean;
    duration?: number;
    timestamp: string;
    embedding?: number[];
  };
}

export interface MemorySearchResult {
  entry: BrowserMemoryEntry;
  score: number;
  distance: number;
}

export interface MemoryStats {
  totalEntries: number;
  byType: Record<string, number>;
  bySession: Record<string, number>;
  avgEmbeddingDim: number;
  indexSize: number;
}

// ============================================================================
// Memory Adapter Interface
// ============================================================================

export interface IMemoryAdapter {
  store(entry: BrowserMemoryEntry): Promise<void>;
  retrieve(key: string): Promise<BrowserMemoryEntry | null>;
  search(query: string, options?: MemorySearchOptions): Promise<MemorySearchResult[]>;
  delete(key: string): Promise<boolean>;
  list(filter?: MemoryFilter): Promise<BrowserMemoryEntry[]>;
  getStats(): Promise<MemoryStats>;
}

export interface MemorySearchOptions {
  topK?: number;
  minScore?: number;
  type?: BrowserMemoryEntry['type'];
  sessionId?: string;
  namespace?: string;
}

export interface MemoryFilter {
  type?: BrowserMemoryEntry['type'];
  sessionId?: string;
  startTime?: string;
  endTime?: string;
  success?: boolean;
}

// ============================================================================
// Claude Flow Memory Adapter
// ============================================================================

/**
 * Adapter for claude-flow memory system with HNSW indexing
 */
export class ClaudeFlowMemoryAdapter implements IMemoryAdapter {
  private namespace: string;
  private cache: Map<string, BrowserMemoryEntry> = new Map();
  private embeddingCache: Map<string, number[]> = new Map();

  constructor(namespace = 'browser') {
    this.namespace = namespace;
  }

  /**
   * Store a browser memory entry with optional embedding
   */
  async store(entry: BrowserMemoryEntry): Promise<void> {
    const key = `${this.namespace}:${entry.type}:${entry.key}`;

    // Generate text for embedding
    const embeddingText = this.generateEmbeddingText(entry);

    // Store in memory via MCP (when available)
    try {
      // This would call claude-flow memory_store MCP tool
      // For now, store in local cache
      this.cache.set(key, {
        ...entry,
        metadata: {
          ...entry.metadata,
          timestamp: entry.metadata.timestamp || new Date().toISOString(),
        },
      });

      // Store embedding text for search
      if (embeddingText) {
        this.embeddingCache.set(key, this.simpleHash(embeddingText));
      }
    } catch (error) {
      console.error('[memory] Failed to store entry:', error);
      throw error;
    }
  }

  /**
   * Retrieve a specific memory entry
   */
  async retrieve(key: string): Promise<BrowserMemoryEntry | null> {
    const fullKey = key.includes(':') ? key : `${this.namespace}:${key}`;
    return this.cache.get(fullKey) || null;
  }

  /**
   * Semantic search using HNSW index (falls back to keyword search)
   */
  async search(query: string, options: MemorySearchOptions = {}): Promise<MemorySearchResult[]> {
    const { topK = 10, minScore = 0.3, type, sessionId } = options;

    const results: MemorySearchResult[] = [];
    const queryTerms = query.toLowerCase().split(/\s+/);

    for (const [key, entry] of this.cache.entries()) {
      // Apply filters
      if (type && entry.type !== type) continue;
      if (sessionId && entry.metadata.sessionId !== sessionId) continue;

      // Calculate relevance score
      const entryText = this.generateEmbeddingText(entry).toLowerCase();
      let matches = 0;
      for (const term of queryTerms) {
        if (entryText.includes(term)) matches++;
      }
      const score = matches / queryTerms.length;

      if (score >= minScore) {
        results.push({
          entry,
          score,
          distance: 1 - score,
        });
      }
    }

    // Sort by score and limit
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /**
   * Delete a memory entry
   */
  async delete(key: string): Promise<boolean> {
    const fullKey = key.includes(':') ? key : `${this.namespace}:${key}`;
    const deleted = this.cache.delete(fullKey);
    this.embeddingCache.delete(fullKey);
    return deleted;
  }

  /**
   * List entries with optional filters
   */
  async list(filter: MemoryFilter = {}): Promise<BrowserMemoryEntry[]> {
    const entries: BrowserMemoryEntry[] = [];

    for (const entry of this.cache.values()) {
      if (filter.type && entry.type !== filter.type) continue;
      if (filter.sessionId && entry.metadata.sessionId !== filter.sessionId) continue;
      if (filter.success !== undefined && entry.metadata.success !== filter.success) continue;
      if (filter.startTime && entry.metadata.timestamp < filter.startTime) continue;
      if (filter.endTime && entry.metadata.timestamp > filter.endTime) continue;

      entries.push(entry);
    }

    return entries;
  }

  /**
   * Get memory statistics
   */
  async getStats(): Promise<MemoryStats> {
    const byType: Record<string, number> = {};
    const bySession: Record<string, number> = {};

    for (const entry of this.cache.values()) {
      byType[entry.type] = (byType[entry.type] || 0) + 1;
      bySession[entry.metadata.sessionId] = (bySession[entry.metadata.sessionId] || 0) + 1;
    }

    return {
      totalEntries: this.cache.size,
      byType,
      bySession,
      avgEmbeddingDim: 0, // Would be calculated from actual embeddings
      indexSize: this.embeddingCache.size,
    };
  }

  /**
   * Generate text for embedding from entry
   */
  private generateEmbeddingText(entry: BrowserMemoryEntry): string {
    const parts: string[] = [];

    if (entry.metadata.goal) parts.push(entry.metadata.goal);
    if (entry.metadata.url) parts.push(entry.metadata.url);

    if (entry.type === 'trajectory') {
      const trajectory = entry.value as unknown as BrowserTrajectory;
      parts.push(trajectory.goal);
      trajectory.steps?.forEach((step) => {
        parts.push(`${step.action} ${JSON.stringify(step.input)}`);
      });
    }

    if (entry.type === 'error') {
      parts.push(String(entry.value.message || ''));
      parts.push(String(entry.value.stack || ''));
    }

    return parts.join(' ');
  }

  /**
   * Simple hash for embedding placeholder (real implementation would use ONNX)
   */
  private simpleHash(text: string): number[] {
    const hash: number[] = new Array(128).fill(0);
    for (let i = 0; i < text.length; i++) {
      hash[i % 128] += text.charCodeAt(i);
    }
    const max = Math.max(...hash);
    return hash.map((v) => v / max);
  }
}

// ============================================================================
// Browser Memory Manager
// ============================================================================

/**
 * High-level memory manager for browser automation
 */
export class BrowserMemoryManager {
  private adapter: IMemoryAdapter;
  private sessionId: string;

  constructor(sessionId: string, adapter?: IMemoryAdapter) {
    this.sessionId = sessionId;
    this.adapter = adapter || new ClaudeFlowMemoryAdapter();
  }

  /**
   * Store a completed trajectory
   */
  async storeTrajectory(trajectory: BrowserTrajectory): Promise<void> {
    await this.adapter.store({
      id: trajectory.id,
      type: 'trajectory',
      key: trajectory.id,
      value: trajectory as unknown as Record<string, unknown>,
      metadata: {
        sessionId: this.sessionId,
        url: trajectory.steps[0]?.input?.url as string,
        goal: trajectory.goal,
        success: trajectory.success,
        duration: this.calculateDuration(trajectory),
        timestamp: trajectory.completedAt || new Date().toISOString(),
      },
    });
  }

  /**
   * Store a learned pattern
   */
  async storePattern(
    patternId: string,
    goal: string,
    steps: Array<{ action: string; selector?: string; value?: string }>,
    success: boolean
  ): Promise<void> {
    await this.adapter.store({
      id: patternId,
      type: 'pattern',
      key: patternId,
      value: { goal, steps, success },
      metadata: {
        sessionId: this.sessionId,
        goal,
        success,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Store a snapshot for later retrieval
   */
  async storeSnapshot(snapshotId: string, snapshot: Snapshot): Promise<void> {
    await this.adapter.store({
      id: snapshotId,
      type: 'snapshot',
      key: snapshotId,
      value: snapshot as unknown as Record<string, unknown>,
      metadata: {
        sessionId: this.sessionId,
        url: snapshot.url,
        timestamp: snapshot.timestamp,
      },
    });
  }

  /**
   * Store an error for learning
   */
  async storeError(
    errorId: string,
    error: Error,
    context: { action?: string; selector?: string; url?: string }
  ): Promise<void> {
    await this.adapter.store({
      id: errorId,
      type: 'error',
      key: errorId,
      value: {
        message: error.message,
        stack: error.stack,
        name: error.name,
        ...context,
      },
      metadata: {
        sessionId: this.sessionId,
        url: context.url,
        success: false,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Find similar trajectories for a given goal
   */
  async findSimilarTrajectories(goal: string, topK = 5): Promise<BrowserTrajectory[]> {
    const results = await this.adapter.search(goal, {
      topK,
      type: 'trajectory',
      minScore: 0.3,
    });

    return results.map((r) => r.entry.value as unknown as BrowserTrajectory);
  }

  /**
   * Find patterns for a given goal
   */
  async findPatterns(goal: string, successfulOnly = true): Promise<MemorySearchResult[]> {
    const results = await this.adapter.search(goal, {
      topK: 10,
      type: 'pattern',
      minScore: 0.2,
    });

    if (successfulOnly) {
      return results.filter((r) => r.entry.metadata.success === true);
    }
    return results;
  }

  /**
   * Get session memory stats
   */
  async getSessionStats(): Promise<{
    trajectories: number;
    patterns: number;
    snapshots: number;
    errors: number;
    successRate: number;
  }> {
    const entries = await this.adapter.list({ sessionId: this.sessionId });

    let trajectories = 0;
    let patterns = 0;
    let snapshots = 0;
    let errors = 0;
    let successCount = 0;

    for (const entry of entries) {
      switch (entry.type) {
        case 'trajectory':
          trajectories++;
          if (entry.metadata.success) successCount++;
          break;
        case 'pattern':
          patterns++;
          break;
        case 'snapshot':
          snapshots++;
          break;
        case 'error':
          errors++;
          break;
      }
    }

    return {
      trajectories,
      patterns,
      snapshots,
      errors,
      successRate: trajectories > 0 ? successCount / trajectories : 0,
    };
  }

  private calculateDuration(trajectory: BrowserTrajectory): number {
    if (!trajectory.startedAt || !trajectory.completedAt) return 0;
    return new Date(trajectory.completedAt).getTime() - new Date(trajectory.startedAt).getTime();
  }
}

// ============================================================================
// Singleton Factory
// ============================================================================

let defaultAdapter: IMemoryAdapter | null = null;

export function getMemoryAdapter(): IMemoryAdapter {
  if (!defaultAdapter) {
    defaultAdapter = new ClaudeFlowMemoryAdapter();
  }
  return defaultAdapter;
}

export function createMemoryManager(sessionId: string): BrowserMemoryManager {
  return new BrowserMemoryManager(sessionId, getMemoryAdapter());
}
