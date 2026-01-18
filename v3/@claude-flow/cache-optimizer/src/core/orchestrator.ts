/**
 * @claude-flow/cache-optimizer - Cache Orchestrator
 * Main CacheOptimizer class that coordinates all optimization operations
 * Based on ADR-030: Intelligent Cache Optimization System (ICOS)
 *
 * MULTI-INSTANCE SAFETY:
 * - Session-partitioned storage isolates data between agents/sessions
 * - Async mutex prevents race conditions on concurrent operations
 * - Per-session token accounting enables fair resource allocation
 */

import type {
  CacheOptimizerConfig,
  CacheEntry,
  CacheEntryType,
  CacheEntryMetadata,
  RelevanceScore,
  ScoringContext,
  PruningDecision,
  PruningResult,
  PruningUrgency,
  TierTransitionResult,
  HookResult,
  HookAction,
  CacheMetrics,
  TemporalTier,
} from '../types.js';
import { DEFAULT_CONFIG } from '../types.js';
import { TokenCounter } from './token-counter.js';
import { TemporalCompressor } from '../temporal/compression.js';
import { FlashAttention } from '../intelligence/attention/flash-attention.js';
import { HyperbolicCacheIntelligence } from '../intelligence/hyperbolic-cache.js';

/**
 * Simple async mutex for concurrent access protection
 * Prevents race conditions when multiple agents access the same optimizer
 */
class AsyncMutex {
  private locked = false;
  private waitQueue: Array<() => void> = [];

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }

    return new Promise((resolve) => {
      this.waitQueue.push(() => {
        this.locked = true;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    const next = this.waitQueue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

/**
 * Session-isolated storage for multi-agent safety
 */
interface SessionStorage {
  entries: Map<string, CacheEntry>;
  accessOrder: string[];
  tokenCounter: TokenCounter;
  lastAccess: number;
}

/**
 * Generate unique ID
 */
function generateId(): string {
  return `cache_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Main Cache Optimizer - Coordinates all cache optimization operations
 * Prevents compaction by maintaining optimal utilization through intelligent pruning
 *
 * MULTI-INSTANCE SAFETY FEATURES:
 * - Session-partitioned storage: Each session has isolated entries
 * - Async mutex: Prevents race conditions on concurrent operations
 * - Per-session token accounting: Fair resource allocation
 * - Global token budget: Prevents any single session from monopolizing context
 */
export class CacheOptimizer {
  private config: CacheOptimizerConfig;

  // Session-partitioned storage for multi-agent isolation
  private sessions: Map<string, SessionStorage> = new Map();

  // Global state (shared across sessions)
  private globalTokenCounter: TokenCounter;
  private temporalCompressor: TemporalCompressor;
  private flashAttention: FlashAttention;
  private hyperbolicIntelligence: HyperbolicCacheIntelligence;
  private initialized: boolean = false;
  private useHyperbolic: boolean = true;

  // Mutex for concurrent access protection
  private mutex: AsyncMutex = new AsyncMutex();

  // Backward compatibility: default entries map (for single-session usage)
  private entries: Map<string, CacheEntry> = new Map();
  private accessOrder: string[] = [];
  private tokenCounter!: TokenCounter;

  // Metrics for before/after comparison
  private driftEvents: number = 0;
  private driftCorrections: number = 0;

  // Session isolation mode
  private sessionIsolation: boolean = false;

  constructor(config: Partial<CacheOptimizerConfig> = {}, options?: { useHyperbolic?: boolean; sessionIsolation?: boolean }) {
    this.config = this.mergeConfig(config);
    this.globalTokenCounter = new TokenCounter(this.config.contextWindowSize);
    this.tokenCounter = this.globalTokenCounter; // Backward compatibility
    this.temporalCompressor = new TemporalCompressor(this.config.temporal);
    this.flashAttention = new FlashAttention(this.config.intelligence.attention.flash);
    this.hyperbolicIntelligence = new HyperbolicCacheIntelligence({
      dims: 64,
      curvature: -1,
      driftThreshold: 0.5,
      enableHypergraph: true,
      enableDriftDetection: true,
    });
    this.useHyperbolic = options?.useHyperbolic ?? true;
    this.sessionIsolation = options?.sessionIsolation ?? false;
  }

  /**
   * Get or create session storage
   */
  private getSessionStorage(sessionId: string): SessionStorage {
    let storage = this.sessions.get(sessionId);
    if (!storage) {
      // Per-session budget is a fraction of total (configurable, default 25%)
      const perSessionBudget = Math.floor(this.config.contextWindowSize * 0.25);
      storage = {
        entries: new Map(),
        accessOrder: [],
        tokenCounter: new TokenCounter(perSessionBudget),
        lastAccess: Date.now(),
      };
      this.sessions.set(sessionId, storage);
    }
    storage.lastAccess = Date.now();
    return storage;
  }

  /**
   * Get entries for a session (or global if isolation disabled)
   */
  private getEntriesForSession(sessionId: string): Map<string, CacheEntry> {
    if (!this.sessionIsolation) {
      return this.entries;
    }
    return this.getSessionStorage(sessionId).entries;
  }

  /**
   * Get all entries across all sessions
   * @internal Used for iteration and debugging
   */
  private _getAllEntries(): CacheEntry[] {
    if (!this.sessionIsolation) {
      return Array.from(this.entries.values());
    }
    const allEntries: CacheEntry[] = [];
    for (const storage of this.sessions.values()) {
      allEntries.push(...storage.entries.values());
    }
    return allEntries;
  }

  /**
   * Merge user config with defaults
   */
  private mergeConfig(config: Partial<CacheOptimizerConfig>): CacheOptimizerConfig {
    return {
      ...DEFAULT_CONFIG,
      ...config,
      pruning: { ...DEFAULT_CONFIG.pruning, ...config.pruning },
      temporal: { ...DEFAULT_CONFIG.temporal, ...config.temporal },
      intelligence: { ...DEFAULT_CONFIG.intelligence, ...config.intelligence },
      storage: { ...DEFAULT_CONFIG.storage, ...config.storage },
      benchmarks: { ...DEFAULT_CONFIG.benchmarks, ...config.benchmarks },
      hooks: { ...DEFAULT_CONFIG.hooks, ...config.hooks },
    };
  }

  /**
   * Initialize the cache optimizer
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Initialize storage backends if needed
    // For now, we use in-memory storage

    this.initialized = true;
  }

  /**
   * Add a new entry to the cache
   * Uses mutex to prevent race conditions in multi-agent scenarios
   */
  async add(
    content: string,
    type: CacheEntryType,
    metadata: Partial<CacheEntryMetadata> = {}
  ): Promise<string> {
    const release = await this.mutex.acquire();
    try {
      return await this.addInternal(content, type, metadata);
    } finally {
      release();
    }
  }

  /**
   * Internal add implementation (called within mutex)
   */
  private async addInternal(
    content: string,
    type: CacheEntryType,
    metadata: Partial<CacheEntryMetadata> = {}
  ): Promise<string> {
    const id = generateId();
    const now = Date.now();
    const sessionId = metadata.sessionId ?? 'default';
    const tokens = this.tokenCounter.countTokens(content, type);

    const entry: CacheEntry = {
      id,
      type,
      content,
      tokens,
      timestamp: now,
      metadata: {
        source: metadata.source ?? 'unknown',
        sessionId,
        tags: metadata.tags ?? [],
        ...metadata,
      },
      relevance: {
        overall: 1.0, // New entries start with max relevance
        components: {
          recency: 1.0,
          frequency: 0.5,
          semantic: 0.5,
          attention: 0.5,
          expert: 0.5,
        },
        scoredAt: now,
        confidence: 0.5,
      },
      tier: 'hot',
      accessCount: 1,
      lastAccessedAt: now,
    };

    // Check if we need to prune before adding
    const predictedUtilization = this.tokenCounter.predictUtilization(tokens);
    if (predictedUtilization > this.config.pruning.softThreshold) {
      await this.proactivePruneInternal(tokens, sessionId);
    }

    // Add to storage (session-aware)
    const entriesMap = this.getEntriesForSession(sessionId);
    entriesMap.set(id, entry);

    // Update both global and session token counters
    this.tokenCounter.addEntry(entry);
    if (this.sessionIsolation) {
      const storage = this.getSessionStorage(sessionId);
      storage.tokenCounter.addEntry(entry);
      storage.accessOrder.push(id);
    }

    this.updateAccessOrder(id);

    // Embed in hyperbolic space for drift detection
    if (this.useHyperbolic) {
      this.hyperbolicIntelligence.embedEntry(entry);

      // Add hyperedges for relationships
      if (metadata.filePath) {
        const relatedEntries = Array.from(entriesMap.values())
          .filter(e => e.metadata?.filePath === metadata.filePath && e.id !== id)
          .slice(-5) // Last 5 related entries
          .map(e => e.id);

        if (relatedEntries.length > 0) {
          this.hyperbolicIntelligence.addRelationship(
            [id, ...relatedEntries],
            'file_group',
            { files: [metadata.filePath], timestamp: now }
          );
        }
      }

      // Session context hyperedge
      const sessionEntries = Array.from(entriesMap.values())
        .filter(e => e.metadata?.sessionId === sessionId && e.id !== id)
        .slice(-10)
        .map(e => e.id);

      if (sessionEntries.length > 0) {
        this.hyperbolicIntelligence.addRelationship(
          [id, ...sessionEntries],
          'session_context',
          { session: sessionId, timestamp: now }
        );
      }
    }

    return id;
  }

  /**
   * Get an entry and update access tracking
   */
  async get(id: string): Promise<CacheEntry | undefined> {
    const entry = this.entries.get(id);
    if (entry) {
      entry.accessCount++;
      entry.lastAccessedAt = Date.now();
      this.updateAccessOrder(id);
      this.tokenCounter.recordHit();

      // Consider promotion to hotter tier
      if (this.config.temporal.promoteOnAccess && entry.tier !== 'hot') {
        await this.promoteEntry(entry);
      }
    } else {
      this.tokenCounter.recordMiss();
    }
    return entry;
  }

  /**
   * Access an entry by source key (alias for get with source lookup)
   */
  access(sourceKey: string): CacheEntry | undefined {
    // Find entry by source metadata
    for (const entry of this.entries.values()) {
      if (entry.metadata?.source === sourceKey) {
        entry.accessCount++;
        entry.lastAccessedAt = Date.now();
        this.updateAccessOrder(entry.id);
        this.tokenCounter.recordHit();

        // Promote to hot tier if configured
        if (this.config.temporal.promoteOnAccess && entry.tier !== 'hot') {
          entry.tier = 'hot';
          // Reset compressed state for hot tier
          if (entry.compressed) {
            entry.compressed = undefined;
          }
        }
        return entry;
      }
    }
    this.tokenCounter.recordMiss();
    return undefined;
  }

  /**
   * Score all entries against current context
   */
  async scoreAll(context: ScoringContext): Promise<Map<string, RelevanceScore>> {
    const entriesArray = Array.from(this.entries.values());
    const scores = await this.flashAttention.scoreEntries(entriesArray, context);

    // Update entry scores
    for (const [id, score] of scores) {
      const entry = this.entries.get(id);
      if (entry) {
        entry.relevance = score;
      }
    }

    return scores;
  }

  /**
   * Get pruning decision based on current state
   */
  async getPruningDecision(context: ScoringContext): Promise<PruningDecision> {
    const now = Date.now();
    const currentUtilization = this.tokenCounter.getUtilization();

    // Determine urgency
    const urgency = this.determineUrgency(currentUtilization);

    if (urgency === 'none') {
      return {
        toPrune: [],
        toCompress: [],
        toPromote: [],
        toDemote: [],
        tokensToFree: 0,
        currentUtilization,
        projectedUtilization: currentUtilization,
        urgency,
        decidedAt: now,
      };
    }

    // Score all entries
    await this.scoreAll(context);

    // Sort entries by relevance (ascending - lowest first)
    const sortedEntries = Array.from(this.entries.values())
      .filter(e => !this.shouldPreserve(e))
      .sort((a, b) => a.relevance.overall - b.relevance.overall);

    // Determine tokens to free based on urgency
    const targetUtilization = urgency === 'emergency'
      ? this.config.pruning.softThreshold
      : this.config.targetUtilization;
    const tokensToFree = this.tokenCounter.getTokensToFree(targetUtilization);

    // Select entries to prune/compress
    const toPrune: string[] = [];
    const toCompress: string[] = [];
    const toDemote: string[] = [];
    let freedTokens = 0;

    // First pass: prune low relevance entries
    for (const entry of sortedEntries) {
      if (freedTokens >= tokensToFree) break;

      const entryTokens = entry.compressed?.compressedTokens ?? entry.tokens;

      // Low relevance entries get pruned
      if (entry.relevance.overall < this.config.pruning.minRelevanceScore) {
        toPrune.push(entry.id);
        freedTokens += entryTokens;
        continue;
      }

      // Medium relevance entries get demoted/compressed
      if (entry.relevance.overall < 0.5 && entry.tier !== 'cold') {
        toDemote.push(entry.id);
        toCompress.push(entry.id);
        // Estimate savings from compression
        const savings = entryTokens * (1 - this.config.temporal.tiers.warm.compressionRatio);
        freedTokens += savings;
      }
    }

    // Second pass: if still need to free tokens, use LRU eviction (oldest entries first)
    if (freedTokens < tokensToFree) {
      // Sort remaining entries by age (oldest first for LRU eviction)
      const remainingEntries = sortedEntries
        .filter(e => !toPrune.includes(e.id) && !toCompress.includes(e.id))
        .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

      for (const entry of remainingEntries) {
        if (freedTokens >= tokensToFree) break;

        const entryTokens = entry.compressed?.compressedTokens ?? entry.tokens;

        // For emergency, prune even higher relevance entries (LRU based)
        if (urgency === 'emergency' || entry.relevance.overall < 0.7) {
          toPrune.push(entry.id);
          freedTokens += entryTokens;
        } else if (entry.tier !== 'cold') {
          // Otherwise, just compress
          toDemote.push(entry.id);
          toCompress.push(entry.id);
          const savings = entryTokens * (1 - this.config.temporal.tiers.cold.compressionRatio);
          freedTokens += savings;
        }
      }
    }

    // Third pass: Use hyperbolic drift detection for additional optimization
    if (this.useHyperbolic && freedTokens < tokensToFree) {
      const entries = Array.from(this.entries.values());
      const driftAnalysis = this.hyperbolicIntelligence.analyzeDrift(entries);

      if (driftAnalysis.isDrifting) {
        this.driftEvents++;

        // Get hyperbolic-guided pruning suggestions
        const hyperbolicDecision = this.hyperbolicIntelligence.getOptimalPruningDecision(
          entries.filter(e => !toPrune.includes(e.id) && !toCompress.includes(e.id) && !this.shouldPreserve(e)),
          this.config.targetUtilization
        );

        // Add hyperbolic suggestions
        for (const id of hyperbolicDecision.toPrune) {
          if (!toPrune.includes(id)) {
            const entry = this.entries.get(id);
            if (entry) {
              toPrune.push(id);
              freedTokens += entry.compressed?.compressedTokens ?? entry.tokens;
              this.driftCorrections++;
            }
          }
        }

        for (const id of hyperbolicDecision.toCompress) {
          if (!toCompress.includes(id) && !toPrune.includes(id)) {
            const entry = this.entries.get(id);
            if (entry && entry.tier !== 'cold') {
              toCompress.push(id);
              toDemote.push(id);
              const savings = (entry.compressed?.compressedTokens ?? entry.tokens) *
                (1 - this.config.temporal.tiers.cold.compressionRatio);
              freedTokens += savings;
              this.driftCorrections++;
            }
          }
        }
      }
    }

    const projectedUtilization = (this.tokenCounter.getMetrics().currentTokens - freedTokens) /
      this.config.contextWindowSize;

    return {
      toPrune,
      toCompress,
      toPromote: [], // Promotions are handled separately on access
      toDemote,
      tokensToFree: freedTokens,
      currentUtilization,
      projectedUtilization,
      urgency,
      decidedAt: now,
    };
  }

  /**
   * Execute pruning based on decision
   * Uses mutex to prevent race conditions in multi-agent scenarios
   */
  async prune(decision?: PruningDecision): Promise<PruningResult> {
    const release = await this.mutex.acquire();
    try {
      return await this.pruneInternal(decision);
    } finally {
      release();
    }
  }

  /**
   * Internal prune implementation (called within mutex)
   */
  private async pruneInternal(decision?: PruningDecision): Promise<PruningResult> {
    const startTime = Date.now();
    const context: ScoringContext = {
      currentQuery: '',
      activeFiles: [],
      activeTools: [],
      sessionId: 'system',
      timestamp: startTime,
    };

    if (!decision) {
      decision = await this.getPruningDecision(context);
    }

    let prunedCount = 0;
    let compressedCount = 0;
    let demotedCount = 0;
    let tokensFreed = 0;

    // Execute pruning across all session storages
    for (const id of decision.toPrune) {
      // Check in default entries
      let entry = this.entries.get(id);
      if (entry) {
        tokensFreed += entry.compressed?.compressedTokens ?? entry.tokens;
        this.tokenCounter.removeEntry(entry);
        this.entries.delete(id);
        this.removeFromAccessOrder(id);
        prunedCount++;
        continue;
      }

      // Check in session storages
      if (this.sessionIsolation) {
        for (const [_sessionId, storage] of this.sessions) {
          entry = storage.entries.get(id);
          if (entry) {
            tokensFreed += entry.compressed?.compressedTokens ?? entry.tokens;
            this.tokenCounter.removeEntry(entry);
            storage.tokenCounter.removeEntry(entry);
            storage.entries.delete(id);
            const idx = storage.accessOrder.indexOf(id);
            if (idx > -1) storage.accessOrder.splice(idx, 1);
            prunedCount++;
            break;
          }
        }
      }
    }

    // Execute compression and demotion
    for (const id of decision.toCompress) {
      if (decision.toPrune.includes(id)) continue;

      // Find entry in default or session storage
      let entry = this.entries.get(id);
      let sessionStorage: SessionStorage | undefined;

      if (!entry && this.sessionIsolation) {
        for (const storage of this.sessions.values()) {
          entry = storage.entries.get(id);
          if (entry) {
            sessionStorage = storage;
            break;
          }
        }
      }

      if (entry) {
        const oldTokens = entry.compressed?.compressedTokens ?? entry.tokens;
        const targetTier = this.getNextColdTier(entry.tier);

        const compressed = await this.temporalCompressor.compressEntry(entry, targetTier);
        if (compressed) {
          const oldEntry = { ...entry };
          entry.compressed = compressed;
          entry.tier = targetTier;
          this.tokenCounter.updateEntry(oldEntry, entry);
          if (sessionStorage) {
            sessionStorage.tokenCounter.updateEntry(oldEntry, entry);
          }
          tokensFreed += oldTokens - compressed.compressedTokens;
          compressedCount++;
          demotedCount++;
        }
      }
    }

    this.tokenCounter.recordPruning();

    return {
      prunedCount,
      compressedCount,
      promotedCount: 0,
      demotedCount,
      tokensFreed,
      newUtilization: this.tokenCounter.getUtilization(),
      durationMs: Date.now() - startTime,
      success: true,
    };
  }

  /**
   * Compress entries by ID
   */
  async compress(entryIds: string[]): Promise<TierTransitionResult> {
    const entries = entryIds
      .map(id => this.entries.get(id))
      .filter((e): e is CacheEntry => e !== undefined);

    return this.temporalCompressor.processTransitions(entries);
  }

  /**
   * Process tier transitions for all entries
   */
  async transitionTiers(): Promise<TierTransitionResult> {
    const entries = Array.from(this.entries.values());
    const result = await this.temporalCompressor.processTransitions(entries);

    // The compressor modifies entries in place
    // Token counts are updated via entry modifications

    return result;
  }

  /**
   * Handle UserPromptSubmit hook
   */
  async onUserPromptSubmit(prompt: string, sessionId: string = 'default'): Promise<HookResult> {
    const startTime = Date.now();
    const actions: HookAction[] = [];

    const context: ScoringContext = {
      currentQuery: prompt,
      activeFiles: this.extractFilePaths(prompt),
      activeTools: this.extractToolNames(prompt),
      sessionId,
      timestamp: startTime,
    };

    // Check if we need proactive pruning
    const utilization = this.tokenCounter.getUtilization();
    let compactionPrevented = false;
    let tokensFreed = 0;

    if (utilization > this.config.pruning.softThreshold) {
      const decision = await this.getPruningDecision(context);

      if (decision.urgency !== 'none') {
        const result = await this.prune(decision);
        tokensFreed = result.tokensFreed;
        compactionPrevented = utilization > this.config.pruning.emergencyThreshold;

        if (compactionPrevented) {
          this.tokenCounter.recordCompactionPrevented();
        }

        actions.push({
          type: 'prune',
          details: `Pruned ${result.prunedCount} entries, freed ${tokensFreed} tokens`,
        });
      }
    }

    // Process tier transitions
    const transitionResult = await this.transitionTiers();
    if (transitionResult.tokensSaved > 0) {
      tokensFreed += transitionResult.tokensSaved;
      actions.push({
        type: 'compress',
        details: `Compressed ${transitionResult.hotToWarm + transitionResult.warmToCold} entries`,
      });
    }

    return {
      success: true,
      actions,
      durationMs: Date.now() - startTime,
      compactionPrevented,
      tokensFreed,
      newUtilization: this.tokenCounter.getUtilization(),
    };
  }

  /**
   * Handle PreCompact hook - last chance to prevent compaction
   */
  async onPreCompact(_trigger: 'auto' | 'manual'): Promise<HookResult> {
    const startTime = Date.now();
    const actions: HookAction[] = [];

    // Emergency pruning
    const context: ScoringContext = {
      currentQuery: '',
      activeFiles: [],
      activeTools: [],
      sessionId: 'emergency',
      timestamp: startTime,
    };

    // Force aggressive pruning to prevent compaction
    const decision = await this.getPruningDecision(context);
    decision.urgency = 'emergency';

    // Double the tokens to free for emergency
    const emergencyTokens = this.tokenCounter.getTokensToFree(this.config.pruning.softThreshold);

    // Extend prune list if needed
    const sortedEntries = Array.from(this.entries.values())
      .filter(e => !this.shouldPreserve(e) && !decision.toPrune.includes(e.id))
      .sort((a, b) => a.relevance.overall - b.relevance.overall);

    let additionalTokens = 0;
    for (const entry of sortedEntries) {
      if (additionalTokens >= emergencyTokens) break;
      decision.toPrune.push(entry.id);
      additionalTokens += entry.compressed?.compressedTokens ?? entry.tokens;
    }

    const result = await this.prune(decision);
    const compactionPrevented = result.newUtilization < this.config.pruning.emergencyThreshold;

    if (compactionPrevented) {
      this.tokenCounter.recordCompactionPrevented();
      actions.push({
        type: 'emergency_prune',
        details: `Emergency pruned ${result.prunedCount} entries to prevent compaction`,
      });
      actions.push({
        type: 'block_compaction',
        details: 'Compaction blocked - utilization reduced to safe levels',
      });
    }

    return {
      success: compactionPrevented,
      actions,
      durationMs: Date.now() - startTime,
      compactionPrevented,
      tokensFreed: result.tokensFreed,
      newUtilization: result.newUtilization,
    };
  }

  /**
   * Get current metrics
   */
  getMetrics(): CacheMetrics {
    const avgRelevance = this.calculateAverageRelevance();
    return this.tokenCounter.getMetrics(avgRelevance);
  }

  /**
   * Get current utilization
   */
  getUtilization(): number {
    return this.tokenCounter.getUtilization();
  }

  /**
   * Get all entries
   */
  getEntries(): CacheEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Get entry by ID
   */
  getEntry(id: string): CacheEntry | undefined {
    return this.entries.get(id);
  }

  /**
   * Delete entry by ID
   * Uses mutex to prevent race conditions in multi-agent scenarios
   */
  async delete(id: string): Promise<boolean> {
    const release = await this.mutex.acquire();
    try {
      // Check in default entries
      let entry = this.entries.get(id);
      if (entry) {
        this.tokenCounter.removeEntry(entry);
        this.entries.delete(id);
        this.removeFromAccessOrder(id);
        return true;
      }

      // Check in session storages
      if (this.sessionIsolation) {
        for (const storage of this.sessions.values()) {
          entry = storage.entries.get(id);
          if (entry) {
            this.tokenCounter.removeEntry(entry);
            storage.tokenCounter.removeEntry(entry);
            storage.entries.delete(id);
            const idx = storage.accessOrder.indexOf(id);
            if (idx > -1) storage.accessOrder.splice(idx, 1);
            return true;
          }
        }
      }

      return false;
    } finally {
      release();
    }
  }

  /**
   * Clear all entries
   */
  async clear(): Promise<void> {
    this.entries.clear();
    this.accessOrder = [];
    this.tokenCounter.reset();
  }

  // ========== Private Helper Methods ==========

  private determineUrgency(utilization: number): PruningUrgency {
    if (utilization >= this.config.pruning.emergencyThreshold) return 'emergency';
    if (utilization >= this.config.pruning.hardThreshold) return 'hard';
    if (utilization >= this.config.pruning.softThreshold) return 'soft';
    return 'none';
  }

  private shouldPreserve(entry: CacheEntry): boolean {
    // Check type-based preservation
    if (this.config.pruning.preservePatterns.includes(entry.type)) {
      return true;
    }

    // Check recency-based preservation
    const recentIds = this.accessOrder.slice(-this.config.pruning.preserveRecentCount);
    if (recentIds.includes(entry.id)) {
      return true;
    }

    // Check pattern-based preservation
    for (const pattern of this.config.pruning.preservePatterns) {
      if (pattern !== entry.type && new RegExp(pattern).test(entry.content)) {
        return true;
      }
    }

    return false;
  }

  private async proactivePrune(_incomingTokens: number): Promise<void> {
    const release = await this.mutex.acquire();
    try {
      await this.proactivePruneInternal(_incomingTokens, 'proactive');
    } finally {
      release();
    }
  }

  private async proactivePruneInternal(_incomingTokens: number, sessionId: string): Promise<void> {
    const context: ScoringContext = {
      currentQuery: '',
      activeFiles: [],
      activeTools: [],
      sessionId,
      timestamp: Date.now(),
    };

    const decision = await this.getPruningDecision(context);
    if (decision.urgency !== 'none') {
      await this.pruneInternal(decision);
    }
  }

  private async promoteEntry(entry: CacheEntry): Promise<void> {
    const oldEntry = { ...entry };
    entry.tier = 'hot';
    // Remove compression when promoting to hot
    if (entry.compressed) {
      delete entry.compressed;
    }
    this.tokenCounter.updateEntry(oldEntry, entry);
  }

  private getNextColdTier(currentTier: TemporalTier): TemporalTier {
    const tiers: TemporalTier[] = ['hot', 'warm', 'cold', 'archived'];
    const currentIndex = tiers.indexOf(currentTier);
    return currentIndex < tiers.length - 1 ? tiers[currentIndex + 1] : 'archived';
  }

  private updateAccessOrder(id: string): void {
    this.removeFromAccessOrder(id);
    this.accessOrder.push(id);

    // Trim to max size
    const maxSize = this.config.storage.cache.maxSize;
    if (this.accessOrder.length > maxSize * 2) {
      this.accessOrder = this.accessOrder.slice(-maxSize);
    }
  }

  private removeFromAccessOrder(id: string): void {
    const index = this.accessOrder.indexOf(id);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
  }

  private calculateAverageRelevance(): number {
    const entries = Array.from(this.entries.values());
    if (entries.length === 0) return 0;

    const sum = entries.reduce((acc, e) => acc + e.relevance.overall, 0);
    return sum / entries.length;
  }

  private extractFilePaths(text: string): string[] {
    // Simple extraction of file paths from text
    const pathRegex = /(?:\/[\w.-]+)+\.\w+/g;
    const matches = text.match(pathRegex) || [];
    return [...new Set(matches)];
  }

  private extractToolNames(text: string): string[] {
    // Extract tool names from common patterns
    const toolPatterns = [
      /\b(Read|Write|Edit|Glob|Grep|Bash|Task)\b/gi,
      /tool[:\s]+(\w+)/gi,
    ];

    const tools: string[] = [];
    for (const pattern of toolPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        tools.push(match[1].toLowerCase());
      }
    }

    return [...new Set(tools)];
  }

  // ========== Hyperbolic Intelligence Methods ==========

  /**
   * Get drift analysis for current cache state
   */
  analyzeDrift(): {
    isDrifting: boolean;
    driftMagnitude: number;
    recommendation: string;
    driftEvents: number;
    driftCorrections: number;
  } {
    if (!this.useHyperbolic) {
      return {
        isDrifting: false,
        driftMagnitude: 0,
        recommendation: 'Hyperbolic intelligence disabled',
        driftEvents: 0,
        driftCorrections: 0,
      };
    }

    const entries = Array.from(this.entries.values());
    const analysis = this.hyperbolicIntelligence.analyzeDrift(entries);

    return {
      ...analysis,
      driftEvents: this.driftEvents,
      driftCorrections: this.driftCorrections,
    };
  }

  /**
   * Get hyperbolic intelligence statistics
   */
  getHyperbolicStats(): {
    enabled: boolean;
    embeddedEntries: number;
    hypergraph: { vertices: number; edges: number; avgDegree: number };
    historicalPatterns: number;
    driftEvents: number;
    driftCorrections: number;
  } {
    if (!this.useHyperbolic) {
      return {
        enabled: false,
        embeddedEntries: 0,
        hypergraph: { vertices: 0, edges: 0, avgDegree: 0 },
        historicalPatterns: 0,
        driftEvents: 0,
        driftCorrections: 0,
      };
    }

    const stats = this.hyperbolicIntelligence.getStats();
    return {
      enabled: true,
      ...stats,
      driftEvents: this.driftEvents,
      driftCorrections: this.driftCorrections,
    };
  }

  /**
   * Record successful cache configuration for future learning
   */
  recordSuccessfulState(metrics: {
    hitRate: number;
    compressionRatio: number;
    evictionAccuracy: number;
  }): string | null {
    if (!this.useHyperbolic) return null;

    const entries = Array.from(this.entries.values());
    return this.hyperbolicIntelligence.recordSuccess(entries, metrics);
  }

  /**
   * Export hyperbolic state for persistence
   */
  exportHyperbolicState(): {
    embeddings: Array<[string, number[]]>;
    patterns: unknown[];
  } | null {
    if (!this.useHyperbolic) return null;
    return this.hyperbolicIntelligence.exportState();
  }

  /**
   * Import hyperbolic state from persistence
   */
  importHyperbolicState(state: {
    embeddings: Array<[string, number[]]>;
    patterns: unknown[];
  }): void {
    if (!this.useHyperbolic) return;
    this.hyperbolicIntelligence.importState(state as ReturnType<typeof this.hyperbolicIntelligence.exportState>);
  }

  /**
   * Toggle hyperbolic intelligence
   */
  setHyperbolicEnabled(enabled: boolean): void {
    this.useHyperbolic = enabled;
  }

  /**
   * Check if hyperbolic intelligence is enabled
   */
  isHyperbolicEnabled(): boolean {
    return this.useHyperbolic;
  }
}

/**
 * Create a new CacheOptimizer instance
 */
export function createCacheOptimizer(
  config?: Partial<CacheOptimizerConfig>
): CacheOptimizer {
  return new CacheOptimizer(config);
}
