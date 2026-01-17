/**
 * @claude-flow/cache-optimizer - Token Counter
 * Accurate token counting and utilization tracking
 */

import type { CacheEntry, CacheMetrics, CacheEntryType, TemporalTier } from '../types.js';

// Token estimation constants (based on Claude tokenizer analysis)
const CHARS_PER_TOKEN_ENGLISH = 4.0;
const CHARS_PER_TOKEN_CODE = 3.5;
const CHARS_PER_TOKEN_JSON = 3.0;

/**
 * Token counting and utilization tracking
 */
export class TokenCounter {
  private contextWindowSize: number;
  private currentTokens: number = 0;
  private entriesByTier: Map<TemporalTier, Set<string>> = new Map();
  private entriesByType: Map<CacheEntryType, Set<string>> = new Map();
  private tokensByTier: Map<TemporalTier, number> = new Map();
  private tokensByType: Map<CacheEntryType, number> = new Map();
  private totalEntries: number = 0;
  private startTime: number = Date.now();

  // Metrics tracking
  private compactionsPrevented: number = 0;
  private pruningOperations: number = 0;
  private compressions: number = 0;
  private hits: number = 0;
  private accesses: number = 0;

  constructor(contextWindowSize: number = 200000) {
    this.contextWindowSize = contextWindowSize;
    this.initializeMaps();
  }

  private initializeMaps(): void {
    const tiers: TemporalTier[] = ['hot', 'warm', 'cold', 'archived'];
    for (const tier of tiers) {
      this.entriesByTier.set(tier, new Set());
      this.tokensByTier.set(tier, 0);
    }

    const types: CacheEntryType[] = [
      'system_prompt', 'claude_md', 'file_read', 'file_write',
      'tool_result', 'bash_output', 'user_message', 'assistant_message', 'mcp_context'
    ];
    for (const type of types) {
      this.entriesByType.set(type, new Set());
      this.tokensByType.set(type, 0);
    }
  }

  /**
   * Count tokens in a string using character-based estimation
   * Falls back to character count / 4 for standard text
   */
  countTokens(text: string, type: CacheEntryType = 'user_message'): number {
    if (!text) return 0;

    const length = text.length;

    // Use type-specific token estimation
    switch (type) {
      case 'file_read':
      case 'file_write':
        // Code tends to have more symbols, shorter tokens
        return Math.ceil(length / CHARS_PER_TOKEN_CODE);

      case 'tool_result':
      case 'mcp_context':
        // JSON/structured data
        return Math.ceil(length / CHARS_PER_TOKEN_JSON);

      default:
        // Standard English text
        return Math.ceil(length / CHARS_PER_TOKEN_ENGLISH);
    }
  }

  /**
   * Add entry to tracking
   */
  addEntry(entry: CacheEntry): void {
    const tokens = entry.compressed?.compressedTokens ?? entry.tokens;

    this.currentTokens += tokens;
    this.totalEntries++;

    // Track by tier
    const tierSet = this.entriesByTier.get(entry.tier);
    if (tierSet) {
      tierSet.add(entry.id);
    }
    this.tokensByTier.set(
      entry.tier,
      (this.tokensByTier.get(entry.tier) ?? 0) + tokens
    );

    // Track by type
    const typeSet = this.entriesByType.get(entry.type);
    if (typeSet) {
      typeSet.add(entry.id);
    }
    this.tokensByType.set(
      entry.type,
      (this.tokensByType.get(entry.type) ?? 0) + tokens
    );
  }

  /**
   * Remove entry from tracking
   */
  removeEntry(entry: CacheEntry): void {
    const tokens = entry.compressed?.compressedTokens ?? entry.tokens;

    this.currentTokens -= tokens;
    this.totalEntries--;

    // Remove from tier tracking
    const tierSet = this.entriesByTier.get(entry.tier);
    if (tierSet) {
      tierSet.delete(entry.id);
    }
    this.tokensByTier.set(
      entry.tier,
      Math.max(0, (this.tokensByTier.get(entry.tier) ?? 0) - tokens)
    );

    // Remove from type tracking
    const typeSet = this.entriesByType.get(entry.type);
    if (typeSet) {
      typeSet.delete(entry.id);
    }
    this.tokensByType.set(
      entry.type,
      Math.max(0, (this.tokensByType.get(entry.type) ?? 0) - tokens)
    );
  }

  /**
   * Update entry (e.g., after compression or tier change)
   */
  updateEntry(oldEntry: CacheEntry, newEntry: CacheEntry): void {
    this.removeEntry(oldEntry);
    this.addEntry(newEntry);
  }

  /**
   * Get current utilization (0-1)
   */
  getUtilization(): number {
    return this.currentTokens / this.contextWindowSize;
  }

  /**
   * Get tokens needed to reach target utilization
   */
  getTokensToFree(targetUtilization: number): number {
    const targetTokens = Math.floor(this.contextWindowSize * targetUtilization);
    return Math.max(0, this.currentTokens - targetTokens);
  }

  /**
   * Check if utilization is above threshold
   */
  isAboveThreshold(threshold: number): boolean {
    return this.getUtilization() > threshold;
  }

  /**
   * Get full metrics snapshot
   */
  getMetrics(averageRelevance: number = 0): CacheMetrics {
    const entriesByTier: Record<TemporalTier, number> = {
      hot: this.entriesByTier.get('hot')?.size ?? 0,
      warm: this.entriesByTier.get('warm')?.size ?? 0,
      cold: this.entriesByTier.get('cold')?.size ?? 0,
      archived: this.entriesByTier.get('archived')?.size ?? 0,
    };

    const tokensByTier: Record<TemporalTier, number> = {
      hot: this.tokensByTier.get('hot') ?? 0,
      warm: this.tokensByTier.get('warm') ?? 0,
      cold: this.tokensByTier.get('cold') ?? 0,
      archived: this.tokensByTier.get('archived') ?? 0,
    };

    const entriesByType: Record<CacheEntryType, number> = {
      system_prompt: this.entriesByType.get('system_prompt')?.size ?? 0,
      claude_md: this.entriesByType.get('claude_md')?.size ?? 0,
      file_read: this.entriesByType.get('file_read')?.size ?? 0,
      file_write: this.entriesByType.get('file_write')?.size ?? 0,
      tool_result: this.entriesByType.get('tool_result')?.size ?? 0,
      bash_output: this.entriesByType.get('bash_output')?.size ?? 0,
      user_message: this.entriesByType.get('user_message')?.size ?? 0,
      assistant_message: this.entriesByType.get('assistant_message')?.size ?? 0,
      mcp_context: this.entriesByType.get('mcp_context')?.size ?? 0,
    };

    return {
      currentTokens: this.currentTokens,
      contextWindowSize: this.contextWindowSize,
      utilization: this.getUtilization(),
      entriesByTier,
      tokensByTier,
      entriesByType,
      totalEntries: this.totalEntries,
      compactionsPrevented: this.compactionsPrevented,
      pruningOperations: this.pruningOperations,
      compressions: this.compressions,
      averageRelevance,
      hitRate: this.accesses > 0 ? this.hits / this.accesses : 0,
      uptimeMs: Date.now() - this.startTime,
    };
  }

  /**
   * Record a cache hit
   */
  recordHit(): void {
    this.hits++;
    this.accesses++;
  }

  /**
   * Record a cache miss
   */
  recordMiss(): void {
    this.accesses++;
  }

  /**
   * Record compaction prevention
   */
  recordCompactionPrevented(): void {
    this.compactionsPrevented++;
  }

  /**
   * Record pruning operation
   */
  recordPruning(): void {
    this.pruningOperations++;
  }

  /**
   * Record compression
   */
  recordCompression(): void {
    this.compressions++;
  }

  /**
   * Predict future utilization based on growth rate
   */
  predictUtilization(tokensToAdd: number): number {
    return (this.currentTokens + tokensToAdd) / this.contextWindowSize;
  }

  /**
   * Get breakdown of token usage by source
   */
  getTokenBreakdown(): { type: CacheEntryType; tokens: number; percentage: number }[] {
    const breakdown: { type: CacheEntryType; tokens: number; percentage: number }[] = [];

    for (const [type, tokens] of this.tokensByType.entries()) {
      if (tokens > 0) {
        breakdown.push({
          type,
          tokens,
          percentage: this.currentTokens > 0 ? tokens / this.currentTokens : 0,
        });
      }
    }

    return breakdown.sort((a, b) => b.tokens - a.tokens);
  }

  /**
   * Reset all counters
   */
  reset(): void {
    this.currentTokens = 0;
    this.totalEntries = 0;
    this.compactionsPrevented = 0;
    this.pruningOperations = 0;
    this.compressions = 0;
    this.hits = 0;
    this.accesses = 0;
    this.startTime = Date.now();
    this.initializeMaps();
  }
}

export function createTokenCounter(contextWindowSize?: number): TokenCounter {
  return new TokenCounter(contextWindowSize);
}
