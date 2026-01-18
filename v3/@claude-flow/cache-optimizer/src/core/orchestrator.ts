/**
 * @claude-flow/cache-optimizer - Cache Orchestrator
 * Main CacheOptimizer class that coordinates all optimization operations
 * Based on ADR-030: Intelligent Cache Optimization System (ICOS)
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

/**
 * Generate unique ID
 */
function generateId(): string {
  return `cache_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Main Cache Optimizer - Coordinates all cache optimization operations
 * Prevents compaction by maintaining optimal utilization through intelligent pruning
 */
export class CacheOptimizer {
  private config: CacheOptimizerConfig;
  private entries: Map<string, CacheEntry> = new Map();
  private tokenCounter: TokenCounter;
  private temporalCompressor: TemporalCompressor;
  private flashAttention: FlashAttention;
  private initialized: boolean = false;

  // LRU tracking
  private accessOrder: string[] = [];

  constructor(config: Partial<CacheOptimizerConfig> = {}) {
    this.config = this.mergeConfig(config);
    this.tokenCounter = new TokenCounter(this.config.contextWindowSize);
    this.temporalCompressor = new TemporalCompressor(this.config.temporal);
    this.flashAttention = new FlashAttention(this.config.intelligence.attention.flash);
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
   */
  async add(
    content: string,
    type: CacheEntryType,
    metadata: Partial<CacheEntryMetadata> = {}
  ): Promise<string> {
    const id = generateId();
    const now = Date.now();
    const tokens = this.tokenCounter.countTokens(content, type);

    const entry: CacheEntry = {
      id,
      type,
      content,
      tokens,
      timestamp: now,
      metadata: {
        source: metadata.source ?? 'unknown',
        sessionId: metadata.sessionId ?? 'default',
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
      await this.proactivePrune(tokens);
    }

    // Add to storage
    this.entries.set(id, entry);
    this.tokenCounter.addEntry(entry);
    this.updateAccessOrder(id);

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
   */
  async prune(decision?: PruningDecision): Promise<PruningResult> {
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

    // Execute pruning
    for (const id of decision.toPrune) {
      const entry = this.entries.get(id);
      if (entry) {
        tokensFreed += entry.compressed?.compressedTokens ?? entry.tokens;
        this.tokenCounter.removeEntry(entry);
        this.entries.delete(id);
        this.removeFromAccessOrder(id);
        prunedCount++;
      }
    }

    // Execute compression and demotion
    for (const id of decision.toCompress) {
      const entry = this.entries.get(id);
      if (entry && !decision.toPrune.includes(id)) {
        const oldTokens = entry.compressed?.compressedTokens ?? entry.tokens;
        const targetTier = this.getNextColdTier(entry.tier);

        const compressed = await this.temporalCompressor.compressEntry(entry, targetTier);
        if (compressed) {
          const oldEntry = { ...entry };
          entry.compressed = compressed;
          entry.tier = targetTier;
          this.tokenCounter.updateEntry(oldEntry, entry);
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
  async onPreCompact(trigger: 'auto' | 'manual'): Promise<HookResult> {
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
   */
  async delete(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) return false;

    this.tokenCounter.removeEntry(entry);
    this.entries.delete(id);
    this.removeFromAccessOrder(id);
    return true;
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

  private async proactivePrune(incomingTokens: number): Promise<void> {
    const context: ScoringContext = {
      currentQuery: '',
      activeFiles: [],
      activeTools: [],
      sessionId: 'proactive',
      timestamp: Date.now(),
    };

    const decision = await this.getPruningDecision(context);
    if (decision.urgency !== 'none') {
      await this.prune(decision);
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
}

/**
 * Create a new CacheOptimizer instance
 */
export function createCacheOptimizer(
  config?: Partial<CacheOptimizerConfig>
): CacheOptimizer {
  return new CacheOptimizer(config);
}
