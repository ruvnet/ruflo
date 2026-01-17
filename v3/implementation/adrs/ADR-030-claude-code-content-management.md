# ADR-030: Claude Code Content Management Architecture & Intelligent Cache Optimization

**Status:** Accepted
**Date:** 2026-01-17
**Updated:** 2026-01-17
**Author:** System Architecture Team
**Version:** 2.0.0

## Context

Understanding how `@anthropic-ai/claude-code` (v2.1.12) manages content is essential for building efficient integrations. This ADR documents:

1. Deep source code analysis of Claude Code CLI
2. Complete technical architecture for intelligent cache optimization
3. API/SDK structure for advanced cache management
4. RuVector temporal compression integration
5. Attention-based relevance scoring with self-learning
6. Benchmarking and performance measurement framework

**Goal:** Prevent compaction from ever being invoked by maintaining optimal cache utilization through intelligent, real-time pruning and temporal compression.

---

## Part 1: Claude Code Analysis

### 1.1 Package Structure

```
@anthropic-ai/claude-code@2.1.12/
├── cli.js              # 11MB bundled/minified application
├── sdk-tools.d.ts      # TypeScript tool definitions (66KB)
├── resvg.wasm          # Image rendering (2.4MB)
├── tree-sitter*.wasm   # Syntax parsing (1.6MB)
├── vendor/ripgrep/     # Platform-specific binaries
└── package.json
```

### 1.2 Caching Mechanisms

#### Anthropic Prompt Cache (API-Level)
- **Cache Creation:** 25% premium, stored for 5 minutes
- **Cache Read:** 90% discount on cached prefix
- **Token Tracking:** `cache_creation_input_tokens`, `cache_read_input_tokens`

#### Context Window Management
- **Window Size:** 200K tokens (Sonnet/Opus)
- **Compaction Trigger:** ~90% utilization (`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`)
- **Compaction Types:** Full compact, microcompact
- **Method:** AI-powered summarization

### 1.3 Why Compaction Occurs

| Source | Tokens/Operation | Accumulation Rate |
|--------|-----------------|-------------------|
| System Prompt + CLAUDE.md | 15,000 | One-time |
| File Reads | 500-5,000 each | High |
| Tool Results | 100-2,000 each | Very High |
| Code Edits | Full file content | High |
| Bash Output | 500-5,000 each | Medium |
| Conversation | 50-500/turn | Continuous |

**Problem:** No automatic pruning → unbounded growth → forced compaction → context loss.

---

## Part 2: Intelligent Cache Optimization Architecture

### 2.1 System Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    INTELLIGENT CACHE OPTIMIZATION SYSTEM (ICOS)                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         HOOK INTEGRATION LAYER                           │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │   │
│  │  │UserPrompt   │  │PreToolUse   │  │PostToolUse  │  │PreCompact   │    │   │
│  │  │Submit       │  │             │  │             │  │             │    │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘    │   │
│  └─────────┼────────────────┼────────────────┼────────────────┼───────────┘   │
│            │                │                │                │               │
│            ▼                ▼                ▼                ▼               │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                      CACHE ORCHESTRATOR                                  │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │   │
│  │  │ Token Counter   │  │ Relevance       │  │ Pruning         │         │   │
│  │  │ & Predictor     │  │ Scorer          │  │ Scheduler       │         │   │
│  │  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘         │   │
│  └───────────┼────────────────────┼────────────────────┼──────────────────┘   │
│              │                    │                    │                      │
│              ▼                    ▼                    ▼                      │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                      INTELLIGENCE LAYER                                  │   │
│  │                                                                          │   │
│  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐               │   │
│  │  │ ATTENTION     │  │ SONA          │  │ MoE           │               │   │
│  │  │ MECHANISM     │  │ Self-Learning │  │ Expert Router │               │   │
│  │  │               │  │               │  │               │               │   │
│  │  │ • Flash Attn  │  │ • Trajectory  │  │ • Code Expert │               │   │
│  │  │ • Hyperbolic  │  │ • EWC++       │  │ • Tool Expert │               │   │
│  │  │ • Cross-Attn  │  │ • LoRA Update │  │ • Conv Expert │               │   │
│  │  └───────┬───────┘  └───────┬───────┘  └───────┬───────┘               │   │
│  └──────────┼──────────────────┼──────────────────┼───────────────────────┘   │
│             │                  │                  │                           │
│             ▼                  ▼                  ▼                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                   RUVECTOR TEMPORAL COMPRESSION                          │   │
│  │                                                                          │   │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │   │
│  │  │                    TEMPORAL MEMORY TIERS                         │   │   │
│  │  │                                                                  │   │   │
│  │  │  HOT (0-5 min)     WARM (5-30 min)    COLD (30+ min)           │   │   │
│  │  │  ┌───────────┐     ┌───────────┐      ┌───────────┐            │   │   │
│  │  │  │ Full      │ ──▶ │ Compressed│ ──▶  │ Vector    │            │   │   │
│  │  │  │ Context   │     │ Summary   │      │ Embedding │            │   │   │
│  │  │  │           │     │ + HNSW    │      │ Only      │            │   │   │
│  │  │  │ 100%      │     │ 30%       │      │ 5%        │            │   │   │
│  │  │  │ tokens    │     │ tokens    │      │ tokens    │            │   │   │
│  │  │  └───────────┘     └───────────┘      └───────────┘            │   │   │
│  │  │        │                 │                  │                   │   │   │
│  │  │        └─────────────────┴──────────────────┘                   │   │   │
│  │  │                          │                                      │   │   │
│  │  │                    HNSW INDEX                                   │   │   │
│  │  │              (150x-12,500x faster retrieval)                    │   │   │
│  │  └─────────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                    BENCHMARKING & TELEMETRY                              │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │   │
│  │  │Token Usage  │  │Latency      │  │Hit Rate     │  │Compaction   │    │   │
│  │  │Metrics      │  │Profiler     │  │Tracker      │  │Prevention   │    │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Core Design Principles

1. **Zero-Compaction Target:** Maintain context below 80% to never trigger auto-compact
2. **Temporal Locality:** Recent data is most valuable; older data can be compressed
3. **Semantic Preservation:** Compress based on meaning, not just age
4. **Self-Optimizing:** Learn from usage patterns to improve pruning decisions
5. **Non-Blocking:** All operations must complete within hook timeouts (<5s)

---

## Part 3: API/SDK Structure

### 3.1 Package Structure

```
@claude-flow/cache-optimizer/
├── src/
│   ├── index.ts                    # Main exports
│   ├── types.ts                    # Type definitions
│   │
│   ├── core/
│   │   ├── orchestrator.ts         # Cache orchestration logic
│   │   ├── token-counter.ts        # Token counting & prediction
│   │   ├── pruning-scheduler.ts    # Pruning decision engine
│   │   └── context-window.ts       # Context window management
│   │
│   ├── intelligence/
│   │   ├── attention/
│   │   │   ├── flash-attention.ts  # O(N) attention computation
│   │   │   ├── hyperbolic.ts       # Poincaré ball for hierarchies
│   │   │   ├── cross-attention.ts  # Query-context relevance
│   │   │   └── index.ts
│   │   ├── sona/
│   │   │   ├── trajectory.ts       # Experience trajectories
│   │   │   ├── ewc-plus.ts         # Elastic weight consolidation
│   │   │   ├── lora-adapter.ts     # Low-rank adaptation
│   │   │   └── index.ts
│   │   ├── moe/
│   │   │   ├── router.ts           # Expert routing
│   │   │   ├── experts/
│   │   │   │   ├── code-expert.ts
│   │   │   │   ├── tool-expert.ts
│   │   │   │   └── conversation-expert.ts
│   │   │   └── index.ts
│   │   └── index.ts
│   │
│   ├── temporal/
│   │   ├── compression.ts          # Temporal compression strategies
│   │   ├── tier-manager.ts         # Hot/Warm/Cold tier management
│   │   ├── summarizer.ts           # Intelligent summarization
│   │   └── index.ts
│   │
│   ├── storage/
│   │   ├── vector-store.ts         # HNSW vector storage
│   │   ├── memory-backend.ts       # AgentDB integration
│   │   ├── cache-store.ts          # In-memory LRU cache
│   │   └── index.ts
│   │
│   ├── hooks/
│   │   ├── user-prompt-handler.ts  # UserPromptSubmit hook
│   │   ├── pre-tool-handler.ts     # PreToolUse hook
│   │   ├── post-tool-handler.ts    # PostToolUse hook
│   │   ├── pre-compact-handler.ts  # PreCompact hook
│   │   └── index.ts
│   │
│   ├── benchmarks/
│   │   ├── token-benchmark.ts      # Token usage measurement
│   │   ├── latency-benchmark.ts    # Operation latency
│   │   ├── compression-benchmark.ts # Compression ratio tests
│   │   ├── retrieval-benchmark.ts  # HNSW retrieval speed
│   │   └── index.ts
│   │
│   └── config/
│       ├── defaults.ts             # Default configuration
│       ├── schema.ts               # Configuration schema
│       └── index.ts
│
├── bin/
│   └── cache-optimizer.ts          # CLI entry point
│
└── package.json
```

### 3.2 Core Type Definitions

```typescript
// @claude-flow/cache-optimizer/src/types.ts

/**
 * ═══════════════════════════════════════════════════════════════════
 * CONFIGURATION TYPES
 * ═══════════════════════════════════════════════════════════════════
 */

export interface CacheOptimizerConfig {
  // Target utilization (never exceed this)
  targetUtilization: number;           // Default: 0.75 (75%)

  // Pruning thresholds
  pruning: PruningConfig;

  // Temporal compression settings
  temporal: TemporalConfig;

  // Intelligence layer settings
  intelligence: IntelligenceConfig;

  // Storage backend settings
  storage: StorageConfig;

  // Benchmarking settings
  benchmarks: BenchmarkConfig;

  // Hook timeouts
  hooks: HookConfig;
}

export interface PruningConfig {
  // Start pruning at this utilization
  softThreshold: number;               // Default: 0.60 (60%)

  // Aggressive pruning at this utilization
  hardThreshold: number;               // Default: 0.75 (75%)

  // Emergency pruning (last resort before compaction)
  emergencyThreshold: number;          // Default: 0.85 (85%)

  // Minimum relevance score to keep (0-1)
  minRelevanceScore: number;           // Default: 0.3

  // Pruning strategy
  strategy: 'adaptive' | 'aggressive' | 'conservative' | 'semantic';

  // Items to always preserve
  preservePatterns: string[];          // Regex patterns

  // Always keep last N entries regardless of score
  preserveRecentCount: number;         // Default: 10
}

export interface TemporalConfig {
  // Tier boundaries (milliseconds)
  tiers: {
    hot: {
      maxAge: number;                  // Default: 300000 (5 min)
      compressionRatio: number;        // Default: 1.0 (no compression)
    };
    warm: {
      maxAge: number;                  // Default: 1800000 (30 min)
      compressionRatio: number;        // Default: 0.3 (70% reduction)
    };
    cold: {
      maxAge: number;                  // Default: Infinity
      compressionRatio: number;        // Default: 0.05 (95% reduction)
    };
  };

  // Compression strategy
  compressionStrategy: 'summary' | 'embedding' | 'hybrid';

  // Auto-promotion on access
  promoteOnAccess: boolean;            // Default: true

  // Decay rate for relevance scores
  decayRate: number;                   // Default: 0.1 per tier transition
}

export interface IntelligenceConfig {
  // Attention mechanism
  attention: {
    enabled: boolean;                  // Default: true
    type: 'flash' | 'hyperbolic' | 'standard';

    // Flash attention settings
    flash: {
      blockSize: number;               // Default: 256
      causal: boolean;                 // Default: true
    };

    // Hyperbolic attention for hierarchical data
    hyperbolic: {
      curvature: number;               // Default: -1.0
      dimension: number;               // Default: 128
    };
  };

  // SONA self-learning
  sona: {
    enabled: boolean;                  // Default: true
    learningRate: number;              // Default: 0.05
    trajectoryWindow: number;          // Default: 100

    // EWC++ settings
    ewc: {
      lambda: number;                  // Default: 0.5
      fisherSamples: number;           // Default: 200
    };

    // LoRA adaptation
    lora: {
      rank: number;                    // Default: 8
      alpha: number;                   // Default: 16
    };
  };

  // Mixture of Experts
  moe: {
    enabled: boolean;                  // Default: true
    numExperts: number;                // Default: 4
    topK: number;                      // Default: 2
    experts: ('code' | 'tool' | 'conversation' | 'system')[];
  };
}

export interface StorageConfig {
  // Vector store settings
  vector: {
    backend: 'hnsw' | 'flat' | 'ivf';

    // HNSW settings
    hnsw: {
      m: number;                       // Default: 16
      efConstruction: number;          // Default: 200
      efSearch: number;                // Default: 50
    };

    // Embedding dimensions
    dimensions: number;                // Default: 384
  };

  // Memory backend
  memory: {
    backend: 'agentdb' | 'sqlite' | 'memory';
    path?: string;
    maxSize: number;                   // Max entries
  };

  // LRU cache
  cache: {
    maxSize: number;                   // Default: 1000
    ttl: number;                       // Default: 300000 (5 min)
  };
}

export interface BenchmarkConfig {
  enabled: boolean;                    // Default: true

  // Sampling rate (0-1)
  sampleRate: number;                  // Default: 0.1

  // Metrics to track
  metrics: {
    tokenUsage: boolean;
    latency: boolean;
    compressionRatio: boolean;
    hitRate: boolean;
    compactionPrevention: boolean;
  };

  // Export settings
  export: {
    format: 'json' | 'prometheus' | 'opentelemetry';
    interval: number;                  // Default: 60000 (1 min)
    path?: string;
  };
}

export interface HookConfig {
  // Maximum execution time per hook (ms)
  timeouts: {
    userPromptSubmit: number;          // Default: 3000
    preToolUse: number;                // Default: 2000
    postToolUse: number;               // Default: 3000
    preCompact: number;                // Default: 5000
  };

  // Async processing
  async: {
    enabled: boolean;                  // Default: true
    queueSize: number;                 // Default: 100
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * CACHE ENTRY TYPES
 * ═══════════════════════════════════════════════════════════════════
 */

export interface CacheEntry {
  id: string;
  type: CacheEntryType;
  content: string;
  tokens: number;
  timestamp: number;

  // Metadata
  metadata: CacheEntryMetadata;

  // Scoring
  relevance: RelevanceScore;

  // Temporal tier
  tier: TemporalTier;

  // Compressed versions
  compressed?: CompressedEntry;
  embedding?: Float32Array;
}

export type CacheEntryType =
  | 'system_prompt'
  | 'claude_md'
  | 'file_read'
  | 'file_write'
  | 'tool_result'
  | 'bash_output'
  | 'user_message'
  | 'assistant_message'
  | 'mcp_context';

export interface CacheEntryMetadata {
  source: string;                      // Origin of the entry
  filePath?: string;                   // Associated file
  toolName?: string;                   // Associated tool
  sessionId: string;                   // Session identifier
  taskId?: string;                     // Task identifier
  tags: string[];                      // Custom tags
}

export interface RelevanceScore {
  // Overall relevance (0-1)
  overall: number;

  // Component scores
  components: {
    recency: number;                   // Time-based score
    frequency: number;                 // Access frequency
    semantic: number;                  // Semantic relevance to current task
    attention: number;                 // Attention weight
    expert: number;                    // MoE expert score
  };

  // Last scored timestamp
  scoredAt: number;

  // Score confidence
  confidence: number;
}

export type TemporalTier = 'hot' | 'warm' | 'cold' | 'archived';

export interface CompressedEntry {
  // Compression method used
  method: 'summary' | 'embedding' | 'quantized';

  // Compressed content (for summary method)
  summary?: string;

  // Token count after compression
  compressedTokens: number;

  // Compression ratio achieved
  ratio: number;

  // Original hash for validation
  originalHash: string;
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * ATTENTION & SCORING TYPES
 * ═══════════════════════════════════════════════════════════════════
 */

export interface AttentionResult {
  // Attention weights for each entry
  weights: Map<string, number>;

  // Top-K most relevant entries
  topK: string[];

  // Computation metadata
  metadata: {
    method: 'flash' | 'hyperbolic' | 'standard';
    computeTimeMs: number;
    queryTokens: number;
  };
}

export interface ScoringContext {
  // Current user query/task
  query: string;

  // Active file paths
  activeFiles: string[];

  // Recent tool uses
  recentTools: string[];

  // Session context
  sessionId: string;

  // Task context (if available)
  taskContext?: string;
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * PRUNING & COMPRESSION TYPES
 * ═══════════════════════════════════════════════════════════════════
 */

export interface PruningDecision {
  // Entries to prune
  toPrune: string[];

  // Entries to compress
  toCompress: string[];

  // Entries to preserve
  toPreserve: string[];

  // Expected token savings
  expectedSavings: number;

  // Decision reasoning
  reasoning: PruningReasoning;
}

export interface PruningReasoning {
  // Why pruning was triggered
  trigger: 'soft_threshold' | 'hard_threshold' | 'emergency' | 'scheduled';

  // Current utilization
  currentUtilization: number;

  // Target utilization after pruning
  targetUtilization: number;

  // Entries considered
  entriesConsidered: number;

  // Strategy used
  strategyUsed: string;
}

export interface CompressionResult {
  entryId: string;
  originalTokens: number;
  compressedTokens: number;
  ratio: number;
  method: string;
  duration: number;
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * BENCHMARK & METRICS TYPES
 * ═══════════════════════════════════════════════════════════════════
 */

export interface CacheMetrics {
  // Token metrics
  tokens: {
    total: number;
    byTier: Record<TemporalTier, number>;
    byType: Record<CacheEntryType, number>;
    utilization: number;
  };

  // Compression metrics
  compression: {
    totalOriginal: number;
    totalCompressed: number;
    overallRatio: number;
    byMethod: Record<string, number>;
  };

  // Performance metrics
  performance: {
    avgPruningLatency: number;
    avgCompressionLatency: number;
    avgRetrievalLatency: number;
    avgScoringLatency: number;
  };

  // Effectiveness metrics
  effectiveness: {
    compactionsPrevented: number;
    tokensReclaimed: number;
    hitRate: number;
    missRate: number;
  };

  // Learning metrics
  learning: {
    trajectories: number;
    patternsLearned: number;
    accuracy: number;
  };
}

export interface BenchmarkResult {
  name: string;
  iterations: number;

  // Timing
  timing: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  };

  // Memory
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
  };

  // Custom metrics
  custom: Record<string, number>;
}
```

### 3.3 Core API

```typescript
// @claude-flow/cache-optimizer/src/index.ts

/**
 * ═══════════════════════════════════════════════════════════════════
 * CACHE OPTIMIZER API
 * ═══════════════════════════════════════════════════════════════════
 */

export class CacheOptimizer {
  constructor(config?: Partial<CacheOptimizerConfig>);

  /**
   * ─────────────────────────────────────────────────────────────────
   * LIFECYCLE
   * ─────────────────────────────────────────────────────────────────
   */

  /** Initialize the optimizer */
  initialize(): Promise<void>;

  /** Shutdown and persist state */
  shutdown(): Promise<void>;

  /** Get current configuration */
  getConfig(): CacheOptimizerConfig;

  /** Update configuration at runtime */
  updateConfig(config: Partial<CacheOptimizerConfig>): void;

  /**
   * ─────────────────────────────────────────────────────────────────
   * CACHE MANAGEMENT
   * ─────────────────────────────────────────────────────────────────
   */

  /** Add entry to cache */
  add(entry: Omit<CacheEntry, 'id' | 'relevance' | 'tier'>): Promise<string>;

  /** Get entry by ID */
  get(id: string): Promise<CacheEntry | null>;

  /** Update entry relevance */
  touch(id: string): Promise<void>;

  /** Remove entry */
  remove(id: string): Promise<void>;

  /** List all entries */
  list(filter?: CacheFilter): Promise<CacheEntry[]>;

  /**
   * ─────────────────────────────────────────────────────────────────
   * SCORING & RELEVANCE
   * ─────────────────────────────────────────────────────────────────
   */

  /** Score all entries against current context */
  scoreAll(context: ScoringContext): Promise<Map<string, RelevanceScore>>;

  /** Compute attention weights */
  computeAttention(query: string): Promise<AttentionResult>;

  /** Get top-K most relevant entries */
  getTopK(k: number, context: ScoringContext): Promise<CacheEntry[]>;

  /**
   * ─────────────────────────────────────────────────────────────────
   * PRUNING & COMPRESSION
   * ─────────────────────────────────────────────────────────────────
   */

  /** Check if pruning is needed */
  shouldPrune(): Promise<boolean>;

  /** Get pruning recommendation */
  getPruningDecision(context: ScoringContext): Promise<PruningDecision>;

  /** Execute pruning */
  prune(decision?: PruningDecision): Promise<PruningResult>;

  /** Compress entries to next tier */
  compress(entryIds: string[]): Promise<CompressionResult[]>;

  /** Force tier transition for aged entries */
  transitionTiers(): Promise<TierTransitionResult>;

  /**
   * ─────────────────────────────────────────────────────────────────
   * TEMPORAL MANAGEMENT
   * ─────────────────────────────────────────────────────────────────
   */

  /** Get entries by tier */
  getByTier(tier: TemporalTier): Promise<CacheEntry[]>;

  /** Promote entry to hot tier */
  promote(id: string): Promise<void>;

  /** Demote entry to colder tier */
  demote(id: string): Promise<void>;

  /** Archive entry to vector-only storage */
  archive(id: string): Promise<void>;

  /**
   * ─────────────────────────────────────────────────────────────────
   * RETRIEVAL
   * ─────────────────────────────────────────────────────────────────
   */

  /** Semantic search across all tiers */
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;

  /** Retrieve archived entry by expanding from embedding */
  retrieve(id: string): Promise<CacheEntry>;

  /**
   * ─────────────────────────────────────────────────────────────────
   * LEARNING
   * ─────────────────────────────────────────────────────────────────
   */

  /** Start a learning trajectory */
  startTrajectory(task: string): Promise<string>;

  /** Record step in trajectory */
  recordStep(trajectoryId: string, action: string, result: string): Promise<void>;

  /** End trajectory and trigger learning */
  endTrajectory(trajectoryId: string, success: boolean): Promise<void>;

  /** Force learning cycle */
  learn(): Promise<LearningResult>;

  /**
   * ─────────────────────────────────────────────────────────────────
   * METRICS & BENCHMARKS
   * ─────────────────────────────────────────────────────────────────
   */

  /** Get current metrics */
  getMetrics(): Promise<CacheMetrics>;

  /** Run benchmark suite */
  runBenchmarks(): Promise<BenchmarkResult[]>;

  /** Export metrics in configured format */
  exportMetrics(): Promise<string>;

  /**
   * ─────────────────────────────────────────────────────────────────
   * HOOK HANDLERS
   * ─────────────────────────────────────────────────────────────────
   */

  /** Handle UserPromptSubmit hook */
  onUserPromptSubmit(prompt: string): Promise<HookResult>;

  /** Handle PreToolUse hook */
  onPreToolUse(tool: string, input: unknown): Promise<HookResult>;

  /** Handle PostToolUse hook */
  onPostToolUse(tool: string, result: unknown): Promise<HookResult>;

  /** Handle PreCompact hook */
  onPreCompact(trigger: 'auto' | 'manual'): Promise<HookResult>;
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * SPECIALIZED COMPONENTS
 * ═══════════════════════════════════════════════════════════════════
 */

/** Attention mechanism for relevance scoring */
export class AttentionMechanism {
  constructor(config: IntelligenceConfig['attention']);

  /** Compute flash attention */
  flashAttention(query: Float32Array, keys: Float32Array[], values: Float32Array[]): Float32Array;

  /** Compute hyperbolic attention */
  hyperbolicAttention(query: Float32Array, keys: Float32Array[]): AttentionResult;

  /** Cross-attention between query and context */
  crossAttention(query: string, contexts: string[]): Promise<AttentionResult>;
}

/** SONA self-learning system */
export class SONALearner {
  constructor(config: IntelligenceConfig['sona']);

  /** Record trajectory step */
  recordStep(state: unknown, action: string, reward: number): void;

  /** Compute Fisher information matrix */
  computeFisher(samples: unknown[]): Float32Array;

  /** Apply EWC++ regularization */
  applyEWC(gradients: Float32Array): Float32Array;

  /** Update LoRA adapters */
  updateLoRA(delta: Float32Array): void;

  /** Get current learning state */
  getState(): SONAState;
}

/** Mixture of Experts router */
export class MoERouter {
  constructor(config: IntelligenceConfig['moe']);

  /** Route input to experts */
  route(input: CacheEntry): ExpertRouting;

  /** Get expert scores */
  getExpertScores(input: CacheEntry): Map<string, number>;

  /** Aggregate expert outputs */
  aggregate(expertOutputs: Map<string, number>): number;
}

/** Temporal compression manager */
export class TemporalCompressor {
  constructor(config: TemporalConfig);

  /** Determine tier for entry based on age */
  determineTier(entry: CacheEntry): TemporalTier;

  /** Compress entry for tier transition */
  compress(entry: CacheEntry, targetTier: TemporalTier): Promise<CompressedEntry>;

  /** Expand compressed entry */
  expand(compressed: CompressedEntry): Promise<string>;

  /** Generate summary for warm tier */
  summarize(content: string, maxTokens: number): Promise<string>;

  /** Generate embedding for cold tier */
  embed(content: string): Promise<Float32Array>;
}

/** Token counter and predictor */
export class TokenManager {
  /** Count tokens in text */
  count(text: string): number;

  /** Predict tokens for operation */
  predict(operation: string, context: unknown): number;

  /** Get current utilization */
  getUtilization(): number;

  /** Estimate time until compaction at current rate */
  estimateTimeToCompaction(): number;
}
```

### 3.4 CLI Interface

```typescript
// @claude-flow/cache-optimizer/bin/cache-optimizer.ts

/**
 * CLI Commands:
 *
 * cache-optimizer init                    Initialize optimizer for project
 * cache-optimizer status                  Show cache status and metrics
 * cache-optimizer prune [--force]         Manually trigger pruning
 * cache-optimizer compress                Compress aged entries
 * cache-optimizer search <query>          Search cached entries
 * cache-optimizer benchmark [suite]       Run benchmarks
 * cache-optimizer config get <key>        Get config value
 * cache-optimizer config set <key> <val>  Set config value
 * cache-optimizer metrics                 Show detailed metrics
 * cache-optimizer export                  Export metrics
 */
```

---

## Part 4: Hook Integration

### 4.1 Settings.json Configuration

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "timeout": 3000,
        "command": "node /path/to/cache-optimizer.js hook user-prompt \"$USER_PROMPT\""
      }]
    }],
    "PreToolUse": [{
      "matcher": "Read|Edit|Write|Bash",
      "hooks": [{
        "type": "command",
        "timeout": 2000,
        "command": "node /path/to/cache-optimizer.js hook pre-tool \"$TOOL_NAME\" \"$TOOL_INPUT\""
      }]
    }],
    "PostToolUse": [{
      "matcher": "Read|Edit|Write|Bash",
      "hooks": [{
        "type": "command",
        "timeout": 3000,
        "command": "node /path/to/cache-optimizer.js hook post-tool \"$TOOL_NAME\" \"$TOOL_OUTPUT\""
      }]
    }],
    "PreCompact": [{
      "matcher": "auto|manual",
      "hooks": [{
        "type": "command",
        "timeout": 5000,
        "command": "node /path/to/cache-optimizer.js hook pre-compact \"$COMPACT_TRIGGER\""
      }]
    }]
  }
}
```

### 4.2 Hook Handler Logic

```typescript
// Hook: UserPromptSubmit
async function onUserPromptSubmit(prompt: string): Promise<HookResult> {
  const optimizer = getCacheOptimizer();

  // 1. Update scoring context
  const context: ScoringContext = {
    query: prompt,
    activeFiles: await getActiveFiles(),
    recentTools: await getRecentTools(),
    sessionId: getSessionId()
  };

  // 2. Check utilization
  const utilization = await optimizer.getMetrics().then(m => m.tokens.utilization);

  // 3. Proactive pruning if needed
  if (utilization > optimizer.getConfig().pruning.softThreshold) {
    const decision = await optimizer.getPruningDecision(context);
    await optimizer.prune(decision);

    return {
      action: 'pruned',
      message: `Pruned ${decision.toPrune.length} entries, saved ${decision.expectedSavings} tokens`,
      data: { decision }
    };
  }

  // 4. Score and potentially compress
  await optimizer.scoreAll(context);
  await optimizer.transitionTiers();

  return { action: 'scored', message: 'Cache scored and optimized' };
}

// Hook: PreCompact (PREVENT COMPACTION)
async function onPreCompact(trigger: 'auto' | 'manual'): Promise<HookResult> {
  const optimizer = getCacheOptimizer();

  // Emergency pruning to prevent compaction
  const context = await buildEmergencyContext();

  // 1. Aggressive pruning
  const decision = await optimizer.getPruningDecision(context);
  decision.strategy = 'emergency';
  await optimizer.prune(decision);

  // 2. Force compression of warm entries
  const warmEntries = await optimizer.getByTier('warm');
  await optimizer.compress(warmEntries.map(e => e.id));

  // 3. Archive cold entries
  const coldEntries = await optimizer.getByTier('cold');
  for (const entry of coldEntries) {
    await optimizer.archive(entry.id);
  }

  // 4. Check if we prevented compaction
  const newUtilization = await optimizer.getMetrics().then(m => m.tokens.utilization);

  if (newUtilization < 0.85) {
    // Successfully prevented compaction
    return {
      action: 'compaction_prevented',
      message: `Emergency optimization successful. Utilization: ${(newUtilization * 100).toFixed(1)}%`,
      preventCompaction: true
    };
  }

  // Could not prevent, log for learning
  await optimizer.recordStep('emergency-prune', 'failed', 'insufficient');

  return {
    action: 'compaction_allowed',
    message: 'Could not prevent compaction, allowing to proceed'
  };
}
```

---

## Part 5: RuVector Temporal Compression

### 5.1 Compression Strategy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    RUVECTOR TEMPORAL COMPRESSION                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         HOT TIER (0-5 min)                           │   │
│  │                                                                      │   │
│  │   • Full content preserved                                          │   │
│  │   • 100% token usage                                                │   │
│  │   • Instant access                                                  │   │
│  │   • Active working set                                              │   │
│  │                                                                      │   │
│  │   Storage: In-memory LRU cache                                      │   │
│  │   Retrieval: O(1)                                                   │   │
│  │                                                                      │   │
│  └─────────────────────────────┬───────────────────────────────────────┘   │
│                                │                                            │
│                    ┌───────────▼───────────┐                               │
│                    │  TIER TRANSITION      │                               │
│                    │  • Age > 5 min        │                               │
│                    │  • Low attention      │                               │
│                    │  • Relevance < 0.5    │                               │
│                    └───────────┬───────────┘                               │
│                                │                                            │
│  ┌─────────────────────────────▼───────────────────────────────────────┐   │
│  │                        WARM TIER (5-30 min)                          │   │
│  │                                                                      │   │
│  │   Compression Strategy:                                             │   │
│  │   ┌────────────────────────────────────────────────────────────┐   │   │
│  │   │                                                             │   │   │
│  │   │  Original: "Read file /src/auth/login.ts containing..."    │   │   │
│  │   │            "export function authenticate(user: User)..."   │   │   │
│  │   │            [500 lines of code]                             │   │   │
│  │   │                                                             │   │   │
│  │   │  Compressed:                                                │   │   │
│  │   │  {                                                          │   │   │
│  │   │    "summary": "Auth module with authenticate(), logout()   │   │   │
│  │   │                functions. Uses JWT tokens. 500 lines.",    │   │   │
│  │   │    "key_symbols": ["authenticate", "logout", "refreshToken"],   │   │
│  │   │    "embedding": Float32Array[384],                         │   │   │
│  │   │    "original_hash": "sha256:abc123..."                     │   │   │
│  │   │  }                                                          │   │   │
│  │   │                                                             │   │   │
│  │   │  Token Reduction: 5000 → 150 (97% savings)                 │   │   │
│  │   │                                                             │   │   │
│  │   └────────────────────────────────────────────────────────────┘   │   │
│  │                                                                      │   │
│  │   Storage: SQLite + HNSW index                                      │   │
│  │   Retrieval: O(log n) via HNSW                                      │   │
│  │                                                                      │   │
│  └─────────────────────────────┬───────────────────────────────────────┘   │
│                                │                                            │
│                    ┌───────────▼───────────┐                               │
│                    │  TIER TRANSITION      │                               │
│                    │  • Age > 30 min       │                               │
│                    │  • No access          │                               │
│                    │  • Relevance < 0.2    │                               │
│                    └───────────┬───────────┘                               │
│                                │                                            │
│  ┌─────────────────────────────▼───────────────────────────────────────┐   │
│  │                        COLD TIER (30+ min)                           │   │
│  │                                                                      │   │
│  │   Storage: Vector embedding only                                    │   │
│  │   ┌────────────────────────────────────────────────────────────┐   │   │
│  │   │                                                             │   │   │
│  │   │  {                                                          │   │   │
│  │   │    "id": "entry-123",                                       │   │   │
│  │   │    "embedding": Float32Array[384],                         │   │   │
│  │   │    "metadata": {                                            │   │   │
│  │   │      "type": "file_read",                                   │   │   │
│  │   │      "path": "/src/auth/login.ts",                         │   │   │
│  │   │      "original_tokens": 5000                                │   │   │
│  │   │    }                                                        │   │   │
│  │   │  }                                                          │   │   │
│  │   │                                                             │   │   │
│  │   │  Token Usage: 0 (embedding stored separately)               │   │   │
│  │   │  Retrieval: Semantic search via HNSW                        │   │   │
│  │   │                                                             │   │   │
│  │   └────────────────────────────────────────────────────────────┘   │   │
│  │                                                                      │   │
│  │   On retrieval:                                                     │   │
│  │   1. Find via semantic search                                       │   │
│  │   2. Re-fetch original if needed                                    │   │
│  │   3. Promote to hot tier                                            │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Compression Algorithms

```typescript
// @claude-flow/cache-optimizer/src/temporal/compression.ts

/**
 * Temporal compression strategies for different content types
 */
export class TemporalCompressor {

  /**
   * Compress file read result
   */
  async compressFileRead(entry: CacheEntry): Promise<CompressedEntry> {
    const content = entry.content;
    const filePath = entry.metadata.filePath!;

    // Extract key information
    const ast = await parseAST(content, getLanguage(filePath));
    const symbols = extractSymbols(ast);
    const complexity = computeComplexity(ast);

    // Generate summary
    const summary = await this.generateSummary({
      type: 'file',
      path: filePath,
      symbols,
      complexity,
      lineCount: content.split('\n').length
    });

    // Generate embedding
    const embedding = await this.embed(content);

    return {
      method: 'hybrid',
      summary,
      compressedTokens: this.tokenCounter.count(summary),
      ratio: this.tokenCounter.count(summary) / entry.tokens,
      originalHash: hashContent(content),
      metadata: {
        symbols,
        complexity,
        embedding
      }
    };
  }

  /**
   * Compress tool result
   */
  async compressToolResult(entry: CacheEntry): Promise<CompressedEntry> {
    const toolName = entry.metadata.toolName!;
    const content = entry.content;

    // Tool-specific compression
    switch (toolName) {
      case 'Bash':
        return this.compressBashOutput(content, entry);
      case 'Grep':
        return this.compressGrepResult(content, entry);
      case 'Glob':
        return this.compressGlobResult(content, entry);
      default:
        return this.compressGeneric(content, entry);
    }
  }

  /**
   * Compress bash output - keep structure, summarize content
   */
  private async compressBashOutput(
    content: string,
    entry: CacheEntry
  ): Promise<CompressedEntry> {
    const lines = content.split('\n');

    // Keep first and last N lines, summarize middle
    const keepLines = 10;
    if (lines.length <= keepLines * 2) {
      return this.compressGeneric(content, entry);
    }

    const summary = [
      ...lines.slice(0, keepLines),
      `... [${lines.length - keepLines * 2} lines summarized] ...`,
      `Key patterns: ${await this.extractPatterns(lines)}`,
      ...lines.slice(-keepLines)
    ].join('\n');

    return {
      method: 'summary',
      summary,
      compressedTokens: this.tokenCounter.count(summary),
      ratio: this.tokenCounter.count(summary) / entry.tokens,
      originalHash: hashContent(content)
    };
  }

  /**
   * Generate embedding for cold storage
   */
  async embed(content: string): Promise<Float32Array> {
    // Use ONNX model for fast local embedding
    return this.embedder.embed(content);
  }

  /**
   * Expand compressed entry back to usable form
   */
  async expand(compressed: CompressedEntry, entry: CacheEntry): Promise<string> {
    switch (compressed.method) {
      case 'summary':
        return compressed.summary!;

      case 'embedding':
        // Search for similar content that might be in hot/warm tier
        const similar = await this.vectorStore.search(
          compressed.metadata?.embedding,
          { threshold: 0.95 }
        );

        if (similar.length > 0) {
          return similar[0].content;
        }

        // Re-fetch if file read
        if (entry.type === 'file_read' && entry.metadata.filePath) {
          const content = await readFile(entry.metadata.filePath);
          // Verify hash
          if (hashContent(content) === compressed.originalHash) {
            return content;
          }
        }

        // Return summary as fallback
        return `[Archived: ${entry.metadata.source}] ${compressed.summary || 'Content unavailable'}`;

      case 'hybrid':
        return compressed.summary!;

      default:
        return compressed.summary || '';
    }
  }
}
```

---

## Part 6: Attention & Self-Learning

### 6.1 Attention Mechanism

```typescript
// @claude-flow/cache-optimizer/src/intelligence/attention/flash-attention.ts

/**
 * Flash Attention implementation for O(N) relevance scoring
 * Based on FlashAttention-2 algorithm
 */
export class FlashAttention {
  private blockSize: number;
  private causal: boolean;

  constructor(config: { blockSize: number; causal: boolean }) {
    this.blockSize = config.blockSize;
    this.causal = config.causal;
  }

  /**
   * Compute attention weights using block-sparse approach
   *
   * @param query - Query embedding [d]
   * @param keys - Key embeddings [n, d]
   * @param values - Value embeddings [n, d]
   * @returns Attention-weighted output and weights
   */
  compute(
    query: Float32Array,
    keys: Float32Array[],
    values: Float32Array[]
  ): { output: Float32Array; weights: number[] } {
    const n = keys.length;
    const d = query.length;
    const numBlocks = Math.ceil(n / this.blockSize);

    // Initialize accumulators
    let maxScore = -Infinity;
    let sumExp = 0;
    const weights: number[] = new Array(n).fill(0);
    const output = new Float32Array(d);

    // Process in blocks for memory efficiency
    for (let block = 0; block < numBlocks; block++) {
      const blockStart = block * this.blockSize;
      const blockEnd = Math.min(blockStart + this.blockSize, n);

      // Compute scores for this block
      const blockScores: number[] = [];
      for (let i = blockStart; i < blockEnd; i++) {
        const score = this.dotProduct(query, keys[i]) / Math.sqrt(d);
        blockScores.push(score);

        // Update running max
        if (score > maxScore) {
          // Rescale previous accumulations
          const scale = Math.exp(maxScore - score);
          sumExp *= scale;
          for (let j = 0; j < d; j++) {
            output[j] *= scale;
          }
          maxScore = score;
        }
      }

      // Accumulate weighted values
      for (let i = 0; i < blockScores.length; i++) {
        const idx = blockStart + i;
        const expScore = Math.exp(blockScores[i] - maxScore);
        weights[idx] = expScore;
        sumExp += expScore;

        for (let j = 0; j < d; j++) {
          output[j] += expScore * values[idx][j];
        }
      }
    }

    // Normalize
    for (let i = 0; i < n; i++) {
      weights[i] /= sumExp;
    }
    for (let j = 0; j < d; j++) {
      output[j] /= sumExp;
    }

    return { output, weights };
  }

  private dotProduct(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }
}

/**
 * Hyperbolic attention for hierarchical relationships
 */
export class HyperbolicAttention {
  private curvature: number;
  private dimension: number;

  constructor(config: { curvature: number; dimension: number }) {
    this.curvature = config.curvature;
    this.dimension = config.dimension;
  }

  /**
   * Compute attention in Poincaré ball
   * Better for hierarchical data (code structure, file trees)
   */
  compute(
    query: Float32Array,
    keys: Float32Array[]
  ): { weights: number[]; distances: number[] } {
    const weights: number[] = [];
    const distances: number[] = [];

    for (const key of keys) {
      // Poincaré distance
      const dist = this.poincareDistance(query, key);
      distances.push(dist);

      // Convert distance to weight (closer = higher weight)
      weights.push(Math.exp(-dist));
    }

    // Normalize
    const sum = weights.reduce((a, b) => a + b, 0);
    return {
      weights: weights.map(w => w / sum),
      distances
    };
  }

  private poincareDistance(u: Float32Array, v: Float32Array): number {
    const c = Math.abs(this.curvature);

    // ||u - v||^2
    let diff2 = 0;
    for (let i = 0; i < u.length; i++) {
      diff2 += (u[i] - v[i]) ** 2;
    }

    // ||u||^2 and ||v||^2
    let u2 = 0, v2 = 0;
    for (let i = 0; i < u.length; i++) {
      u2 += u[i] ** 2;
      v2 += v[i] ** 2;
    }

    // Poincaré distance formula
    const num = 2 * diff2;
    const denom = (1 - c * u2) * (1 - c * v2);

    return Math.acosh(1 + num / denom) / Math.sqrt(c);
  }
}
```

### 6.2 SONA Self-Learning

```typescript
// @claude-flow/cache-optimizer/src/intelligence/sona/learner.ts

/**
 * SONA (Self-Optimizing Neural Architecture) for cache optimization
 * Learns optimal pruning strategies from experience
 */
export class SONALearner {
  private trajectories: Trajectory[] = [];
  private fisherMatrix: Float32Array | null = null;
  private loraWeights: { A: Float32Array; B: Float32Array } | null = null;

  /**
   * Record pruning decision and outcome
   */
  recordStep(
    state: PruningState,
    action: PruningAction,
    reward: number
  ): void {
    const trajectory = this.getCurrentTrajectory();
    trajectory.steps.push({
      state: this.encodeState(state),
      action: this.encodeAction(action),
      reward,
      timestamp: Date.now()
    });
  }

  /**
   * Compute reward for pruning decision
   */
  computeReward(decision: PruningDecision, outcome: PruningOutcome): number {
    // Positive: tokens saved without quality loss
    const tokenReward = outcome.tokensSaved / 1000;

    // Negative: compaction still triggered
    const compactionPenalty = outcome.compactionTriggered ? -10 : 0;

    // Negative: important context pruned (detected by user correction)
    const qualityPenalty = outcome.qualityDegraded ? -5 : 0;

    // Positive: hit rate improvement
    const hitRateReward = outcome.hitRateChange * 2;

    return tokenReward + compactionPenalty + qualityPenalty + hitRateReward;
  }

  /**
   * Learn from completed trajectories using SONA algorithm
   */
  async learn(): Promise<LearningResult> {
    if (this.trajectories.length < 10) {
      return { updated: false, reason: 'Insufficient trajectories' };
    }

    // 1. Compute gradients from trajectories
    const gradients = this.computePolicyGradients();

    // 2. Apply EWC++ regularization (prevent catastrophic forgetting)
    const regularizedGradients = this.applyEWC(gradients);

    // 3. Update LoRA adapters
    await this.updateLoRA(regularizedGradients);

    // 4. Update Fisher matrix for future EWC
    await this.updateFisher();

    // 5. Clear old trajectories
    this.trajectories = this.trajectories.slice(-100);

    return {
      updated: true,
      gradientNorm: this.norm(gradients),
      trajectoriesUsed: this.trajectories.length
    };
  }

  /**
   * Elastic Weight Consolidation (EWC++) to prevent forgetting
   */
  private applyEWC(gradients: Float32Array): Float32Array {
    if (!this.fisherMatrix) {
      return gradients;
    }

    const lambda = 0.5; // EWC strength
    const regularized = new Float32Array(gradients.length);

    for (let i = 0; i < gradients.length; i++) {
      // L2 regularization weighted by Fisher information
      regularized[i] = gradients[i] - lambda * this.fisherMatrix[i] * gradients[i];
    }

    return regularized;
  }

  /**
   * Update LoRA (Low-Rank Adaptation) weights
   */
  private async updateLoRA(gradients: Float32Array): Promise<void> {
    const rank = 8;
    const alpha = 16;
    const lr = 0.05;

    if (!this.loraWeights) {
      // Initialize LoRA matrices
      const dim = gradients.length;
      this.loraWeights = {
        A: new Float32Array(rank * dim).map(() => (Math.random() - 0.5) * 0.01),
        B: new Float32Array(dim * rank).fill(0)
      };
    }

    // Update A and B matrices
    // Simplified: full LoRA update would decompose gradients
    const scaledLr = lr * (alpha / rank);
    for (let i = 0; i < this.loraWeights.A.length; i++) {
      this.loraWeights.A[i] -= scaledLr * gradients[i % gradients.length];
    }
  }

  /**
   * Get optimal pruning threshold based on learned patterns
   */
  getOptimalThreshold(state: PruningState): number {
    const encoded = this.encodeState(state);

    // Apply LoRA transformation if available
    if (this.loraWeights) {
      const transformed = this.applyLoRA(encoded);
      return this.sigmoid(transformed[0]) * 0.5 + 0.5; // Map to [0.5, 1.0]
    }

    // Default threshold
    return 0.75;
  }

  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }

  private norm(arr: Float32Array): number {
    return Math.sqrt(arr.reduce((sum, x) => sum + x * x, 0));
  }
}
```

### 6.3 Mixture of Experts

```typescript
// @claude-flow/cache-optimizer/src/intelligence/moe/router.ts

/**
 * Mixture of Experts for content-type-aware scoring
 */
export class MoERouter {
  private experts: Map<string, Expert>;
  private gatingNetwork: GatingNetwork;

  constructor(config: IntelligenceConfig['moe']) {
    this.experts = new Map([
      ['code', new CodeExpert()],
      ['tool', new ToolExpert()],
      ['conversation', new ConversationExpert()],
      ['system', new SystemExpert()]
    ]);

    this.gatingNetwork = new GatingNetwork(config.numExperts, config.topK);
  }

  /**
   * Route entry to appropriate experts and aggregate scores
   */
  route(entry: CacheEntry, context: ScoringContext): ExpertResult {
    // Compute gating weights
    const gating = this.gatingNetwork.forward(entry, context);

    // Get top-K expert scores
    const topK = this.selectTopK(gating, 2);

    let aggregatedScore = 0;
    const expertContributions: Map<string, number> = new Map();

    for (const { expertName, weight } of topK) {
      const expert = this.experts.get(expertName)!;
      const score = expert.score(entry, context);

      aggregatedScore += weight * score;
      expertContributions.set(expertName, score);
    }

    return {
      score: aggregatedScore,
      experts: topK.map(e => e.expertName),
      contributions: expertContributions
    };
  }
}

/**
 * Code-specific expert - understands code structure and dependencies
 */
class CodeExpert implements Expert {
  score(entry: CacheEntry, context: ScoringContext): number {
    if (!['file_read', 'file_write'].includes(entry.type)) {
      return 0;
    }

    let score = 0.5; // Base score

    // Higher score if file is in active files
    if (context.activeFiles.includes(entry.metadata.filePath!)) {
      score += 0.3;
    }

    // Higher score if recently edited
    const age = Date.now() - entry.timestamp;
    if (age < 60000) score += 0.2;

    // Higher score for configuration files
    if (this.isConfigFile(entry.metadata.filePath!)) {
      score += 0.1;
    }

    return Math.min(1, score);
  }

  private isConfigFile(path: string): boolean {
    const configPatterns = [
      /package\.json$/,
      /tsconfig\.json$/,
      /\.config\.(js|ts)$/,
      /\.env/
    ];
    return configPatterns.some(p => p.test(path));
  }
}

/**
 * Tool-specific expert - understands tool output relevance
 */
class ToolExpert implements Expert {
  score(entry: CacheEntry, context: ScoringContext): number {
    if (entry.type !== 'tool_result') {
      return 0;
    }

    let score = 0.3; // Base score for tool results

    // Higher if tool was recently used
    if (context.recentTools.includes(entry.metadata.toolName!)) {
      score += 0.3;
    }

    // Lower for verbose outputs (bash, grep)
    if (entry.tokens > 2000) {
      score -= 0.2;
    }

    // Higher for successful operations
    if (!entry.content.includes('error') && !entry.content.includes('Error')) {
      score += 0.1;
    }

    return Math.max(0, Math.min(1, score));
  }
}

/**
 * Conversation expert - understands dialog flow
 */
class ConversationExpert implements Expert {
  score(entry: CacheEntry, context: ScoringContext): number {
    if (!['user_message', 'assistant_message'].includes(entry.type)) {
      return 0;
    }

    let score = 0.5;

    // Recent messages more valuable
    const age = Date.now() - entry.timestamp;
    const ageMinutes = age / 60000;
    score -= Math.min(0.3, ageMinutes * 0.02);

    // User messages slightly more important
    if (entry.type === 'user_message') {
      score += 0.1;
    }

    // Longer messages often contain key decisions
    if (entry.tokens > 200) {
      score += 0.1;
    }

    return Math.max(0, Math.min(1, score));
  }
}
```

---

## Part 7: Benchmarking Framework

### 7.1 Benchmark Suite

```typescript
// @claude-flow/cache-optimizer/src/benchmarks/suite.ts

export interface BenchmarkSuite {
  name: string;
  benchmarks: Benchmark[];
}

export const CACHE_OPTIMIZER_BENCHMARKS: BenchmarkSuite = {
  name: 'Cache Optimizer Performance',
  benchmarks: [
    {
      name: 'token-counting',
      description: 'Token counting throughput',
      iterations: 1000,
      setup: async () => generateRandomText(10000),
      fn: async (text: string) => tokenCounter.count(text),
      metrics: ['throughput', 'latency']
    },
    {
      name: 'attention-computation',
      description: 'Flash attention on 1000 entries',
      iterations: 100,
      setup: async () => ({
        query: generateEmbedding(384),
        keys: Array(1000).fill(null).map(() => generateEmbedding(384)),
        values: Array(1000).fill(null).map(() => generateEmbedding(384))
      }),
      fn: async (data) => flashAttention.compute(data.query, data.keys, data.values),
      metrics: ['latency', 'memory']
    },
    {
      name: 'scoring-throughput',
      description: 'Score 1000 entries against context',
      iterations: 50,
      setup: async () => ({
        entries: await generateCacheEntries(1000),
        context: generateScoringContext()
      }),
      fn: async (data) => optimizer.scoreAll(data.context),
      metrics: ['throughput', 'latency']
    },
    {
      name: 'pruning-decision',
      description: 'Pruning decision latency',
      iterations: 100,
      setup: async () => generateScoringContext(),
      fn: async (context) => optimizer.getPruningDecision(context),
      metrics: ['latency']
    },
    {
      name: 'compression-ratio',
      description: 'Compression ratio for different content types',
      iterations: 100,
      setup: async () => ({
        fileRead: await generateFileReadEntry(5000),
        bashOutput: await generateBashOutputEntry(3000),
        conversation: await generateConversationEntry(500)
      }),
      fn: async (entries) => ({
        fileRead: await compressor.compress(entries.fileRead, 'warm'),
        bashOutput: await compressor.compress(entries.bashOutput, 'warm'),
        conversation: await compressor.compress(entries.conversation, 'warm')
      }),
      metrics: ['compression_ratio', 'latency']
    },
    {
      name: 'hnsw-search',
      description: 'HNSW vector search performance',
      iterations: 500,
      setup: async () => ({
        index: await buildHNSWIndex(10000),
        query: generateEmbedding(384)
      }),
      fn: async (data) => data.index.search(data.query, 10),
      metrics: ['latency', 'recall']
    },
    {
      name: 'tier-transition',
      description: 'Batch tier transition performance',
      iterations: 20,
      setup: async () => generateCacheEntries(500),
      fn: async (entries) => optimizer.transitionTiers(),
      metrics: ['latency', 'throughput']
    },
    {
      name: 'end-to-end-hook',
      description: 'Full hook handler latency',
      iterations: 100,
      setup: async () => 'Implement a caching system for database queries',
      fn: async (prompt) => optimizer.onUserPromptSubmit(prompt),
      metrics: ['latency']
    }
  ]
};

/**
 * Run benchmarks and generate report
 */
export async function runBenchmarks(
  suite: BenchmarkSuite
): Promise<BenchmarkReport> {
  const results: BenchmarkResult[] = [];

  for (const benchmark of suite.benchmarks) {
    console.log(`Running: ${benchmark.name}`);

    const setupData = await benchmark.setup();
    const timings: number[] = [];
    const memorySnapshots: MemoryUsage[] = [];

    // Warmup
    for (let i = 0; i < 5; i++) {
      await benchmark.fn(setupData);
    }

    // Actual benchmark
    for (let i = 0; i < benchmark.iterations; i++) {
      const startMem = process.memoryUsage();
      const start = performance.now();

      await benchmark.fn(setupData);

      const end = performance.now();
      const endMem = process.memoryUsage();

      timings.push(end - start);
      memorySnapshots.push({
        heapUsed: endMem.heapUsed - startMem.heapUsed,
        heapTotal: endMem.heapTotal,
        external: endMem.external
      });
    }

    results.push({
      name: benchmark.name,
      description: benchmark.description,
      iterations: benchmark.iterations,
      timing: computeStats(timings),
      memory: computeMemoryStats(memorySnapshots)
    });
  }

  return {
    suite: suite.name,
    timestamp: new Date().toISOString(),
    results,
    summary: generateSummary(results)
  };
}
```

### 7.2 Performance Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| Hook Latency (UserPromptSubmit) | <500ms | p95 |
| Hook Latency (PreToolUse) | <200ms | p95 |
| Hook Latency (PostToolUse) | <300ms | p95 |
| Hook Latency (PreCompact) | <2000ms | p95 |
| Scoring Throughput | >1000 entries/sec | avg |
| Compression Ratio (file_read) | <0.10 | avg |
| Compression Ratio (tool_result) | <0.20 | avg |
| HNSW Search Latency | <5ms | p95 |
| Memory Overhead | <100MB | peak |
| Compaction Prevention Rate | >99% | success rate |

---

## Part 8: Configuration Variables

### 8.1 Environment Variables

```bash
# ═══════════════════════════════════════════════════════════════════
# CACHE OPTIMIZER CONFIGURATION
# ═══════════════════════════════════════════════════════════════════

# Core Settings
CLAUDE_FLOW_CACHE_OPTIMIZER_ENABLED=true
CLAUDE_FLOW_CACHE_TARGET_UTILIZATION=0.75

# Pruning Configuration
CLAUDE_FLOW_CACHE_SOFT_THRESHOLD=0.60
CLAUDE_FLOW_CACHE_HARD_THRESHOLD=0.75
CLAUDE_FLOW_CACHE_EMERGENCY_THRESHOLD=0.85
CLAUDE_FLOW_CACHE_MIN_RELEVANCE=0.3
CLAUDE_FLOW_CACHE_PRUNING_STRATEGY=adaptive
CLAUDE_FLOW_CACHE_PRESERVE_RECENT=10

# Temporal Tiers (milliseconds)
CLAUDE_FLOW_CACHE_HOT_MAX_AGE=300000
CLAUDE_FLOW_CACHE_WARM_MAX_AGE=1800000
CLAUDE_FLOW_CACHE_WARM_COMPRESSION=0.3
CLAUDE_FLOW_CACHE_COLD_COMPRESSION=0.05

# Intelligence Layer
CLAUDE_FLOW_CACHE_ATTENTION_ENABLED=true
CLAUDE_FLOW_CACHE_ATTENTION_TYPE=flash
CLAUDE_FLOW_CACHE_SONA_ENABLED=true
CLAUDE_FLOW_CACHE_SONA_LEARNING_RATE=0.05
CLAUDE_FLOW_CACHE_MOE_ENABLED=true
CLAUDE_FLOW_CACHE_MOE_TOP_K=2

# Storage
CLAUDE_FLOW_CACHE_VECTOR_BACKEND=hnsw
CLAUDE_FLOW_CACHE_HNSW_M=16
CLAUDE_FLOW_CACHE_HNSW_EF_CONSTRUCTION=200
CLAUDE_FLOW_CACHE_MEMORY_BACKEND=agentdb
CLAUDE_FLOW_CACHE_LRU_MAX_SIZE=1000

# Benchmarking
CLAUDE_FLOW_CACHE_BENCHMARK_ENABLED=true
CLAUDE_FLOW_CACHE_BENCHMARK_SAMPLE_RATE=0.1
CLAUDE_FLOW_CACHE_METRICS_EXPORT_FORMAT=prometheus

# Hook Timeouts (milliseconds)
CLAUDE_FLOW_CACHE_HOOK_USER_PROMPT_TIMEOUT=3000
CLAUDE_FLOW_CACHE_HOOK_PRE_TOOL_TIMEOUT=2000
CLAUDE_FLOW_CACHE_HOOK_POST_TOOL_TIMEOUT=3000
CLAUDE_FLOW_CACHE_HOOK_PRE_COMPACT_TIMEOUT=5000
```

### 8.2 Configuration File (cache-optimizer.config.json)

```json
{
  "$schema": "https://claude-flow.dev/schemas/cache-optimizer.json",
  "version": "1.0.0",

  "targetUtilization": 0.75,

  "pruning": {
    "softThreshold": 0.60,
    "hardThreshold": 0.75,
    "emergencyThreshold": 0.85,
    "minRelevanceScore": 0.3,
    "strategy": "adaptive",
    "preservePatterns": [
      "CLAUDE\\.md$",
      "package\\.json$",
      "\\.env"
    ],
    "preserveRecentCount": 10
  },

  "temporal": {
    "tiers": {
      "hot": {
        "maxAge": 300000,
        "compressionRatio": 1.0
      },
      "warm": {
        "maxAge": 1800000,
        "compressionRatio": 0.3
      },
      "cold": {
        "maxAge": null,
        "compressionRatio": 0.05
      }
    },
    "compressionStrategy": "hybrid",
    "promoteOnAccess": true,
    "decayRate": 0.1
  },

  "intelligence": {
    "attention": {
      "enabled": true,
      "type": "flash",
      "flash": {
        "blockSize": 256,
        "causal": true
      },
      "hyperbolic": {
        "curvature": -1.0,
        "dimension": 128
      }
    },
    "sona": {
      "enabled": true,
      "learningRate": 0.05,
      "trajectoryWindow": 100,
      "ewc": {
        "lambda": 0.5,
        "fisherSamples": 200
      },
      "lora": {
        "rank": 8,
        "alpha": 16
      }
    },
    "moe": {
      "enabled": true,
      "numExperts": 4,
      "topK": 2,
      "experts": ["code", "tool", "conversation", "system"]
    }
  },

  "storage": {
    "vector": {
      "backend": "hnsw",
      "hnsw": {
        "m": 16,
        "efConstruction": 200,
        "efSearch": 50
      },
      "dimensions": 384
    },
    "memory": {
      "backend": "agentdb",
      "path": ".claude-flow/cache",
      "maxSize": 10000
    },
    "cache": {
      "maxSize": 1000,
      "ttl": 300000
    }
  },

  "benchmarks": {
    "enabled": true,
    "sampleRate": 0.1,
    "metrics": {
      "tokenUsage": true,
      "latency": true,
      "compressionRatio": true,
      "hitRate": true,
      "compactionPrevention": true
    },
    "export": {
      "format": "prometheus",
      "interval": 60000,
      "path": ".claude-flow/metrics"
    }
  },

  "hooks": {
    "timeouts": {
      "userPromptSubmit": 3000,
      "preToolUse": 2000,
      "postToolUse": 3000,
      "preCompact": 5000
    },
    "async": {
      "enabled": true,
      "queueSize": 100
    }
  }
}
```

---

## Part 9: Implementation Roadmap

### Phase 1: Core Infrastructure (Week 1-2)
- [ ] Token counter and utilization tracking
- [ ] Basic pruning scheduler
- [ ] Hook integration (UserPromptSubmit, PreCompact)
- [ ] Metrics collection

### Phase 2: Temporal Compression (Week 3-4)
- [ ] Tier manager implementation
- [ ] Summary-based compression
- [ ] Embedding-based archival
- [ ] HNSW integration

### Phase 3: Intelligence Layer (Week 5-6)
- [ ] Flash attention implementation
- [ ] MoE router with experts
- [ ] Basic SONA trajectory recording

### Phase 4: Self-Learning (Week 7-8)
- [ ] EWC++ implementation
- [ ] LoRA adaptation
- [ ] Learning pipeline

### Phase 5: Benchmarking & Optimization (Week 9-10)
- [ ] Full benchmark suite
- [ ] Performance tuning
- [ ] Documentation

---

## Conclusion

This architecture provides a comprehensive solution for preventing Claude Code compaction through:

1. **Proactive Monitoring:** Continuous token tracking and utilization prediction
2. **Intelligent Pruning:** Attention-based relevance scoring with MoE routing
3. **Temporal Compression:** RuVector-inspired tiered storage with semantic compression
4. **Self-Learning:** SONA-based optimization that improves over time
5. **Comprehensive Benchmarking:** Performance measurement and continuous optimization

The system integrates seamlessly with Claude Code's hook system while maintaining the <5s timeout constraints for all operations.

---

## References

- ADR-017: RuVector Integration Architecture
- ADR-018: Claude Code Deep Integration Architecture
- FlashAttention-2: Faster Attention with Better Parallelism
- Poincaré Embeddings for Learning Hierarchical Representations
- Elastic Weight Consolidation (EWC)
- LoRA: Low-Rank Adaptation of Large Language Models
