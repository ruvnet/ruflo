/**
 * Pattern (Self-Optimizing Pattern Architecture) Optimizer
 *
 * Processes trajectory outcomes to learn optimal routing patterns.
 * Integrates with Q-learning router and persistence layer.
 *
 * Features:
 * - Processes trajectory outcomes from hooksTrajectoryEnd
 * - Extracts keywords from tasks for pattern matching
 * - Maintains learned routing patterns with confidence scoring
 * - Persists patterns to .swarm/sona-patterns.json
 * - Integrates with Q-learning router for combined routing
 *
 * @module v3/cli/memory/sona-optimizer
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

// ============================================================================
// Types
// ============================================================================

/**
 * Trajectory outcome from hooks/intelligence/trajectory-end
 */
export interface TrajectoryOutcome {
  trajectoryId: string;
  task: string;
  agent: string;
  success: boolean;
  steps?: Array<{
    action: string;
    result: string;
    quality: number;
    timestamp: string;
  }>;
  feedback?: string;
  duration?: number;
}

/**
 * Learned routing pattern
 */
export interface LearnedPattern {
  /** Keywords extracted from task descriptions */
  keywords: string[];
  /** Agent that handled the task */
  agent: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Number of successful uses */
  successCount: number;
  /** Number of failed uses */
  failureCount: number;
  /** Last time pattern was used */
  lastUsed: number;
  /** Pattern creation time */
  createdAt: number;
}

/**
 * Routing suggestion result
 */
export interface RoutingSuggestion {
  /** Recommended agent */
  agent: string;
  /** Confidence in recommendation (0-1) */
  confidence: number;
  /** Whether Q-learning was used */
  usedQLearning: boolean;
  /** Source of recommendation */
  source: 'sona-pattern' | 'q-learning' | 'keyword-match' | 'default';
  /** Alternative agents with scores */
  alternatives: Array<{ agent: string; score: number }>;
  /** Matched keywords */
  matchedKeywords?: string[];
}

/**
 * Pattern optimizer statistics
 */
export interface PatternStats {
  /** Total patterns learned */
  totalPatterns: number;
  /** Successful routing decisions */
  successfulRoutings: number;
  /** Failed routing decisions */
  failedRoutings: number;
  /** Total trajectories processed */
  trajectoriesProcessed: number;
  /** Average confidence of patterns */
  avgConfidence: number;
  /** Q-learning integration status */
  qLearningEnabled: boolean;
  /** Time of last learning update */
  lastUpdate: number | null;
}

/**
 * Persisted state structure
 */
interface PersistedState {
  version: string;
  patterns: Record<string, LearnedPattern>;
  stats: {
    trajectoriesProcessed: number;
    successfulRoutings: number;
    failedRoutings: number;
    lastUpdate: number | null;
  };
  metadata: {
    createdAt: string;
    savedAt: string;
  };
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_PERSISTENCE_PATH = '.swarm/sona-patterns.json';
const PATTERN_VERSION = '1.0.0';
const MIN_CONFIDENCE = 0.1;
const MAX_CONFIDENCE = 0.99;
const CONFIDENCE_INCREMENT = 0.1;
const CONFIDENCE_DECREMENT = 0.15;
const DECAY_RATE = 0.01; // Per day
const MAX_PATTERNS = 1000;

/**
 * Common agent types for routing
 */
const AGENT_TYPES = [
  'coder',
  'tester',
  'reviewer',
  'architect',
  'researcher',
  'optimizer',
  'debugger',
  'documenter',
  'security-architect',
  'performance-engineer',
];

/**
 * Task keywords for pattern extraction
 */
const KEYWORD_CATEGORIES: Record<string, string[]> = {
  coder: [
    'implement', 'code', 'write', 'create', 'build', 'develop', 'add',
    'feature', 'function', 'class', 'module', 'api', 'endpoint',
  ],
  tester: [
    'test', 'spec', 'coverage', 'unit', 'integration', 'e2e', 'mock',
    'assert', 'expect', 'verify', 'validate', 'scenario',
  ],
  reviewer: [
    'review', 'check', 'audit', 'analyze', 'inspect', 'evaluate',
    'quality', 'standards', 'best-practices', 'lint',
  ],
  architect: [
    'architect', 'design', 'structure', 'pattern', 'system', 'schema',
    'database', 'infrastructure', 'scalability', 'architecture',
  ],
  researcher: [
    'research', 'investigate', 'explore', 'find', 'search', 'discover',
    'analyze', 'understand', 'learn', 'study',
  ],
  optimizer: [
    'optimize', 'performance', 'speed', 'memory', 'improve', 'enhance',
    'faster', 'efficient', 'reduce', 'benchmark',
  ],
  debugger: [
    'debug', 'fix', 'bug', 'error', 'issue', 'problem', 'crash',
    'exception', 'trace', 'diagnose', 'resolve',
  ],
  documenter: [
    'document', 'docs', 'readme', 'comment', 'explain', 'guide',
    'tutorial', 'api-docs', 'specification', 'jsdoc',
  ],
  'security-architect': [
    'security', 'auth', 'authentication', 'authorization', 'encrypt',
    'vulnerability', 'cve', 'secure', 'permission', 'role',
  ],
  'performance-engineer': [
    'profiling', 'bottleneck', 'latency', 'throughput', 'cache',
    'scale', 'load', 'stress', 'concurrent', 'parallel',
  ],
};

// ============================================================================
// PatternOptimizer Class
// ============================================================================

/**
 * Pattern Optimizer for adaptive routing based on trajectory outcomes
 *
 * Learns from past task outcomes to improve future routing decisions.
 * Integrates with Q-learning router for hybrid routing strategy.
 */
export class PatternOptimizer {
  private patterns: Map<string, LearnedPattern> = new Map();
  private trajectoriesProcessed = 0;
  private successfulRoutings = 0;
  private failedRoutings = 0;
  private lastUpdate: number | null = null;
  private persistencePath: string;
  private qLearningRouter: any = null;
  private qLearningEnabled = false;

  constructor(options?: { persistencePath?: string }) {
    this.persistencePath = options?.persistencePath || DEFAULT_PERSISTENCE_PATH;
  }

  /**
   * Initialize the optimizer and load persisted state
   */
  async initialize(): Promise<{ success: boolean; patternsLoaded: number }> {
    // Load persisted patterns
    const loaded = this.loadFromDisk();

    // Try to load Q-learning router lazily
    try {
      const { QLearningRouter } = await import('../ruvector/q-learning-router.js');
      this.qLearningRouter = new QLearningRouter();
      await this.qLearningRouter.initialize();
      this.qLearningEnabled = true;
    } catch {
      // Q-learning not available, continue without it
      this.qLearningEnabled = false;
    }

    return {
      success: true,
      patternsLoaded: loaded ? this.patterns.size : 0,
    };
  }

  /**
   * Process a trajectory outcome and learn from it
   * Called by hooksTrajectoryEnd
   */
  processTrajectoryOutcome(outcome: TrajectoryOutcome): {
    learned: boolean;
    patternKey: string;
    confidence: number;
    keywordsExtracted: string[];
  } {
    const { task, agent, success } = outcome;

    // Extract keywords from task
    const keywords = this.extractKeywords(task);
    if (keywords.length === 0) {
      return {
        learned: false,
        patternKey: '',
        confidence: 0,
        keywordsExtracted: [],
      };
    }

    // Create pattern key from sorted keywords
    const patternKey = this.createPatternKey(keywords, agent);

    // Get or create pattern
    let pattern = this.patterns.get(patternKey);
    if (!pattern) {
      pattern = {
        keywords,
        agent,
        confidence: 0.5, // Start at neutral
        successCount: 0,
        failureCount: 0,
        lastUsed: Date.now(),
        createdAt: Date.now(),
      };
    }

    // Update pattern based on outcome
    if (success) {
      pattern.successCount++;
      pattern.confidence = Math.min(
        MAX_CONFIDENCE,
        pattern.confidence + CONFIDENCE_INCREMENT * (1 - pattern.confidence)
      );
      this.successfulRoutings++;
    } else {
      pattern.failureCount++;
      pattern.confidence = Math.max(
        MIN_CONFIDENCE,
        pattern.confidence - CONFIDENCE_DECREMENT * pattern.confidence
      );
      this.failedRoutings++;
    }

    pattern.lastUsed = Date.now();

    // Store pattern
    this.patterns.set(patternKey, pattern);
    this.trajectoriesProcessed++;
    this.lastUpdate = Date.now();

    // Prune old patterns if needed
    this.prunePatterns();

    // Update Q-learning router if available
    if (this.qLearningRouter) {
      const reward = success ? 1.0 : -0.5;
      this.qLearningRouter.update(task, agent, reward);
    }

    // Persist to disk (debounced)
    this.saveToDisk();

    return {
      learned: true,
      patternKey,
      confidence: pattern.confidence,
      keywordsExtracted: keywords,
    };
  }

  /**
   * Get routing suggestion based on learned patterns
   */
  getRoutingSuggestion(task: string): RoutingSuggestion {
    const keywords = this.extractKeywords(task);

    // Try Pattern pattern matching first
    const sonaResult = this.findBestPatternMatch(keywords);
    if (sonaResult && sonaResult.confidence >= 0.6) {
      return {
        agent: sonaResult.agent,
        confidence: sonaResult.confidence,
        usedQLearning: false,
        source: 'sona-pattern',
        alternatives: this.getAlternatives(keywords, sonaResult.agent),
        matchedKeywords: sonaResult.matchedKeywords,
      };
    }

    // Try Q-learning router if available
    if (this.qLearningRouter && this.qLearningEnabled) {
      try {
        const decision = this.qLearningRouter.route(task, false);
        if (decision.confidence >= 0.5) {
          return {
            agent: decision.route,
            confidence: decision.confidence,
            usedQLearning: true,
            source: 'q-learning',
            alternatives: decision.alternatives,
          };
        }
      } catch {
        // Q-learning failed, continue to fallback
      }
    }

    // Fallback to keyword-based heuristic
    const keywordMatch = this.matchKeywordsToAgent(keywords);
    if (keywordMatch) {
      return {
        agent: keywordMatch.agent,
        confidence: keywordMatch.confidence,
        usedQLearning: false,
        source: 'keyword-match',
        alternatives: this.getAlternatives(keywords, keywordMatch.agent),
        matchedKeywords: keywordMatch.matchedKeywords,
      };
    }

    // Default fallback
    return {
      agent: 'coder',
      confidence: 0.3,
      usedQLearning: false,
      source: 'default',
      alternatives: [
        { agent: 'researcher', score: 0.2 },
        { agent: 'architect', score: 0.15 },
      ],
    };
  }

  /**
   * Get optimizer statistics
   */
  getStats(): PatternStats {
    let totalConfidence = 0;
    for (const pattern of this.patterns.values()) {
      totalConfidence += pattern.confidence;
    }

    return {
      totalPatterns: this.patterns.size,
      successfulRoutings: this.successfulRoutings,
      failedRoutings: this.failedRoutings,
      trajectoriesProcessed: this.trajectoriesProcessed,
      avgConfidence: this.patterns.size > 0 ? totalConfidence / this.patterns.size : 0,
      qLearningEnabled: this.qLearningEnabled,
      lastUpdate: this.lastUpdate,
    };
  }

  /**
   * Apply temporal decay to pattern confidence
   * Reduces confidence of unused patterns
   */
  applyTemporalDecay(): number {
    const now = Date.now();
    let decayed = 0;

    for (const [key, pattern] of this.patterns) {
      const daysSinceUse = (now - pattern.lastUsed) / (1000 * 60 * 60 * 24);
      if (daysSinceUse > 1) {
        const decay = Math.exp(-DECAY_RATE * daysSinceUse);
        const newConfidence = pattern.confidence * decay;

        if (newConfidence < MIN_CONFIDENCE) {
          // Remove patterns with very low confidence
          this.patterns.delete(key);
        } else {
          pattern.confidence = newConfidence;
        }
        decayed++;
      }
    }

    if (decayed > 0) {
      this.saveToDisk();
    }

    return decayed;
  }

  /**
   * Reset all learned patterns
   */
  reset(): void {
    this.patterns.clear();
    this.trajectoriesProcessed = 0;
    this.successfulRoutings = 0;
    this.failedRoutings = 0;
    this.lastUpdate = null;

    if (this.qLearningRouter) {
      this.qLearningRouter.reset();
    }

    this.saveToDisk();
  }

  /**
   * Export patterns for analysis
   */
  exportPatterns(): Record<string, LearnedPattern> {
    const result: Record<string, LearnedPattern> = {};
    for (const [key, pattern] of this.patterns) {
      result[key] = { ...pattern };
    }
    return result;
  }

  /**
   * Import patterns (for migration or testing)
   */
  importPatterns(patterns: Record<string, LearnedPattern>): number {
    let imported = 0;
    for (const [key, pattern] of Object.entries(patterns)) {
      if (this.validatePattern(pattern)) {
        this.patterns.set(key, pattern);
        imported++;
      }
    }
    this.saveToDisk();
    return imported;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Extract meaningful keywords from task description
   */
  private extractKeywords(task: string): string[] {
    if (!task || typeof task !== 'string') {
      return [];
    }

    const lower = task.toLowerCase();
    const words = lower.split(/[\s\-_.,;:!?'"()\[\]{}]+/).filter(w => w.length > 2);

    // Extract keywords that match our categories
    const keywords = new Set<string>();

    for (const categoryKeywords of Object.values(KEYWORD_CATEGORIES)) {
      for (const keyword of categoryKeywords) {
        if (lower.includes(keyword)) {
          keywords.add(keyword);
        }
      }
    }

    // Add any significant words not in categories
    for (const word of words) {
      if (word.length >= 4 && !this.isStopWord(word)) {
        keywords.add(word);
      }
    }

    return Array.from(keywords).slice(0, 10); // Limit to 10 keywords
  }

  /**
   * Check if word is a stop word
   */
  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'been',
      'will', 'would', 'could', 'should', 'into', 'then', 'than', 'when',
      'where', 'which', 'there', 'their', 'what', 'about', 'more', 'some',
      'also', 'just', 'only', 'other', 'very', 'after', 'most', 'such',
    ]);
    return stopWords.has(word);
  }

  /**
   * Create a unique pattern key from keywords and agent
   */
  private createPatternKey(keywords: string[], agent: string): string {
    const sortedKeywords = [...keywords].sort();
    return `${agent}:${sortedKeywords.join('+')}`;
  }

  /**
   * Find the best matching pattern for given keywords
   */
  private findBestPatternMatch(keywords: string[]): {
    agent: string;
    confidence: number;
    matchedKeywords: string[];
  } | null {
    if (keywords.length === 0 || this.patterns.size === 0) {
      return null;
    }

    let bestMatch: { agent: string; confidence: number; matchedKeywords: string[] } | null = null;
    let bestScore = 0;

    for (const pattern of this.patterns.values()) {
      const matchedKeywords = pattern.keywords.filter(k => keywords.includes(k));
      const matchRatio = matchedKeywords.length / Math.max(pattern.keywords.length, keywords.length);

      // Combine match ratio with confidence
      const score = matchRatio * pattern.confidence;

      if (score > bestScore && matchedKeywords.length >= 1) {
        bestScore = score;
        bestMatch = {
          agent: pattern.agent,
          confidence: pattern.confidence * matchRatio,
          matchedKeywords,
        };
      }
    }

    return bestMatch;
  }

  /**
   * Match keywords to agent using category heuristics
   */
  private matchKeywordsToAgent(keywords: string[]): {
    agent: string;
    confidence: number;
    matchedKeywords: string[];
  } | null {
    const scores: Record<string, { score: number; matched: string[] }> = {};

    for (const [agent, categoryKeywords] of Object.entries(KEYWORD_CATEGORIES)) {
      const matched = keywords.filter(k => categoryKeywords.includes(k));
      if (matched.length > 0) {
        scores[agent] = {
          score: matched.length / categoryKeywords.length,
          matched,
        };
      }
    }

    // Find best scoring agent
    let bestAgent = '';
    let bestScore = 0;
    let bestMatched: string[] = [];

    for (const [agent, data] of Object.entries(scores)) {
      if (data.score > bestScore) {
        bestScore = data.score;
        bestAgent = agent;
        bestMatched = data.matched;
      }
    }

    if (bestAgent && bestScore > 0) {
      return {
        agent: bestAgent,
        confidence: Math.min(0.7, 0.3 + bestScore),
        matchedKeywords: bestMatched,
      };
    }

    return null;
  }

  /**
   * Get alternative agent suggestions
   */
  private getAlternatives(
    keywords: string[],
    excludeAgent: string
  ): Array<{ agent: string; score: number }> {
    const alternatives: Array<{ agent: string; score: number }> = [];

    for (const [agent, categoryKeywords] of Object.entries(KEYWORD_CATEGORIES)) {
      if (agent === excludeAgent) continue;

      const matched = keywords.filter(k => categoryKeywords.includes(k));
      if (matched.length > 0) {
        alternatives.push({
          agent,
          score: matched.length / Math.max(keywords.length, 1) * 0.5,
        });
      }
    }

    return alternatives
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }

  /**
   * Prune old/low-confidence patterns if over limit
   */
  private prunePatterns(): void {
    if (this.patterns.size <= MAX_PATTERNS) {
      return;
    }

    // Sort patterns by score (confidence * recency)
    const entries = Array.from(this.patterns.entries()).map(([key, pattern]) => {
      const ageInDays = (Date.now() - pattern.lastUsed) / (1000 * 60 * 60 * 24);
      const recency = Math.exp(-0.1 * ageInDays);
      const score = pattern.confidence * recency;
      return { key, pattern, score };
    });

    entries.sort((a, b) => a.score - b.score);

    // Remove lowest-scoring patterns
    const toRemove = entries.slice(0, entries.length - Math.floor(MAX_PATTERNS * 0.8));
    for (const { key } of toRemove) {
      this.patterns.delete(key);
    }
  }

  /**
   * Validate pattern structure
   */
  private validatePattern(pattern: unknown): pattern is LearnedPattern {
    if (!pattern || typeof pattern !== 'object') return false;
    const p = pattern as Record<string, unknown>;
    return (
      Array.isArray(p.keywords) &&
      typeof p.agent === 'string' &&
      typeof p.confidence === 'number' &&
      typeof p.successCount === 'number' &&
      typeof p.failureCount === 'number'
    );
  }

  /**
   * Load patterns from disk
   */
  private loadFromDisk(): boolean {
    try {
      const fullPath = join(process.cwd(), this.persistencePath);
      if (!existsSync(fullPath)) {
        return false;
      }

      const data = readFileSync(fullPath, 'utf-8');
      const state: PersistedState = JSON.parse(data);

      // Validate version
      if (!state.version || !state.version.startsWith('1.')) {
        console.error('[Pattern] Incompatible state version, starting fresh');
        return false;
      }

      // Load patterns
      this.patterns.clear();
      for (const [key, pattern] of Object.entries(state.patterns)) {
        if (this.validatePattern(pattern)) {
          this.patterns.set(key, pattern);
        }
      }

      // Load stats
      if (state.stats) {
        this.trajectoriesProcessed = state.stats.trajectoriesProcessed || 0;
        this.successfulRoutings = state.stats.successfulRoutings || 0;
        this.failedRoutings = state.stats.failedRoutings || 0;
        this.lastUpdate = state.stats.lastUpdate || null;
      }

      return true;
    } catch (err) {
      console.error(`[Pattern] Failed to load state: ${err}`);
      return false;
    }
  }

  /**
   * Save patterns to disk
   */
  private saveToDisk(): boolean {
    try {
      const fullPath = join(process.cwd(), this.persistencePath);
      const dir = dirname(fullPath);

      // Ensure directory exists
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const state: PersistedState = {
        version: PATTERN_VERSION,
        patterns: this.exportPatterns(),
        stats: {
          trajectoriesProcessed: this.trajectoriesProcessed,
          successfulRoutings: this.successfulRoutings,
          failedRoutings: this.failedRoutings,
          lastUpdate: this.lastUpdate,
        },
        metadata: {
          createdAt: new Date().toISOString(),
          savedAt: new Date().toISOString(),
        },
      };

      writeFileSync(fullPath, JSON.stringify(state, null, 2));
      return true;
    } catch (err) {
      console.error(`[Pattern] Failed to save state: ${err}`);
      return false;
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let sonaOptimizerInstance: PatternOptimizer | null = null;
let initializationPromise: Promise<PatternOptimizer> | null = null;

/**
 * Get the singleton PatternOptimizer instance
 * Uses lazy initialization to avoid circular imports
 */
export async function getPatternOptimizer(): Promise<PatternOptimizer> {
  if (sonaOptimizerInstance) {
    return sonaOptimizerInstance;
  }

  // Prevent multiple concurrent initializations
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    const optimizer = new PatternOptimizer();
    await optimizer.initialize();
    sonaOptimizerInstance = optimizer;
    return optimizer;
  })();

  return initializationPromise;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetPatternOptimizer(): void {
  if (sonaOptimizerInstance) {
    sonaOptimizerInstance.reset();
  }
  sonaOptimizerInstance = null;
  initializationPromise = null;
}

/**
 * Process a trajectory outcome (convenience function)
 */
export async function processTrajectory(outcome: TrajectoryOutcome): Promise<{
  learned: boolean;
  patternKey: string;
  confidence: number;
  keywordsExtracted: string[];
}> {
  const optimizer = await getPatternOptimizer();
  return optimizer.processTrajectoryOutcome(outcome);
}

/**
 * Get routing suggestion (convenience function)
 */
export async function getSuggestion(task: string): Promise<RoutingSuggestion> {
  const optimizer = await getPatternOptimizer();
  return optimizer.getRoutingSuggestion(task);
}

/**
 * Get Pattern statistics (convenience function)
 */
export async function getPatternStats(): Promise<PatternStats> {
  const optimizer = await getPatternOptimizer();
  return optimizer.getStats();
}

export default {
  PatternOptimizer,
  getPatternOptimizer,
  resetPatternOptimizer,
  processTrajectory,
  getSuggestion,
  getPatternStats,
};
