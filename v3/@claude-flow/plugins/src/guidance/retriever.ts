/**
 * Task Intent Classifier + Shard Retriever
 *
 * Stores rule shards in vector storage with embeddings and metadata.
 * At task start, retrieves the top N shards by semantic similarity
 * with hard filters by risk class and repo scope.
 *
 * Retrieval contract:
 * 1. Always include the constitution
 * 2. Retrieve up to 5 shards by semantic similarity
 * 3. Add hard filters by risk class and repo scope
 * 4. Contradiction check: prefer higher-priority rule ID
 *
 * @module @claude-flow/guidance/retriever
 */

import type {
  PolicyBundle,
  RuleShard,
  Constitution,
  TaskIntent,
  RiskClass,
  RetrievalRequest,
  RetrievalResult,
} from './types.js';

// ============================================================================
// Intent Classification
// ============================================================================

/** Intent detection patterns with confidence weights */
const INTENT_PATTERNS: Record<TaskIntent, Array<{ pattern: RegExp; weight: number }>> = {
  'bug-fix': [
    { pattern: /\b(fix|bug|broken|error|crash|issue|wrong|incorrect|fail)\b/i, weight: 0.8 },
    { pattern: /\b(not working|doesn't work|unexpected|regression)\b/i, weight: 0.9 },
  ],
  'feature': [
    { pattern: /\b(add|create|implement|build|new|introduce|develop)\b/i, weight: 0.5 },
    { pattern: /\b(feature|capability|functionality|support for)\b/i, weight: 0.9 },
    { pattern: /\b(user|page|profile|dashboard|form|widget|component|module)\b/i, weight: 0.3 },
  ],
  'refactor': [
    { pattern: /\b(refactor|restructure|reorganize|simplify|clean|extract|inline)\b/i, weight: 0.9 },
    { pattern: /\b(improve readability|reduce complexity|code quality)\b/i, weight: 0.8 },
  ],
  'security': [
    { pattern: /\b(security|auth|permission|access control|encrypt|secret|token)\b/i, weight: 0.9 },
    { pattern: /\b(cve|vulnerability|injection|xss|csrf|sanitize)\b/i, weight: 1.0 },
  ],
  'performance': [
    { pattern: /\b(performance|optimize|speed|slow|fast|cache|memory usage|latency)\b/i, weight: 0.9 },
    { pattern: /\b(bottleneck|profile|benchmark|throughput|efficient)\b/i, weight: 0.8 },
  ],
  'testing': [
    { pattern: /\b(tests?|specs?|coverage|mocks?|asserts?|tdd|unit tests?|integration tests?)\b/i, weight: 1.0 },
    { pattern: /\b(test suite|test case|test plan|quality assurance)\b/i, weight: 0.9 },
  ],
  'docs': [
    { pattern: /\b(document|readme|jsdoc|comment|explain|describe|tutorial)\b/i, weight: 0.8 },
    { pattern: /\b(api docs|documentation|usage guide|changelog)\b/i, weight: 0.9 },
  ],
  'deployment': [
    { pattern: /\b(deploy|release|publish|ci|cd|pipeline|docker|kubernetes)\b/i, weight: 0.9 },
    { pattern: /\b(staging|production|rollback|migration|version)\b/i, weight: 0.7 },
  ],
  'architecture': [
    { pattern: /\b(architect|design pattern|system design|structure|boundary)\b/i, weight: 0.8 },
    { pattern: /\b(module boundary|component architecture|layer|service mesh|domain model|aggregate root)\b/i, weight: 0.7 },
    { pattern: /\b(interface|api design|separation of concerns)\b/i, weight: 0.6 },
  ],
  'debug': [
    { pattern: /\b(debug|trace|log|diagnose|investigate|root cause)\b/i, weight: 0.9 },
    { pattern: /\b(stack trace|breakpoint|inspect|reproduction)\b/i, weight: 0.8 },
  ],
  'general': [
    { pattern: /./, weight: 0.1 },
  ],
};

// ============================================================================
// Embedding Interface
// ============================================================================

export interface IEmbeddingProvider {
  embed(text: string): Promise<Float32Array>;
  batchEmbed(texts: string[]): Promise<Float32Array[]>;
}

/**
 * Deterministic hash-based embedding provider — **test-only**.
 *
 * Produces fixed-dimension vectors from a simple character-hash → sin()
 * transform.  The resulting embeddings have no real semantic meaning;
 * they are stable and fast, which makes them useful for unit/integration
 * tests that need a concrete {@link IEmbeddingProvider} without loading
 * an ONNX model.
 *
 * **Do NOT use in production** — replace with a real model-backed
 * provider (e.g. the agentic-flow ONNX integration).
 */
export class HashEmbeddingProvider implements IEmbeddingProvider {
  private dimensions: number;
  private cache = new Map<string, Float32Array>();

  constructor(dimensions: number = 384) {
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<Float32Array> {
    const key = text.slice(0, 200);
    if (this.cache.has(key)) return this.cache.get(key)!;

    const embedding = this.hashEmbed(text);
    this.cache.set(key, embedding);
    return embedding;
  }

  async batchEmbed(texts: string[]): Promise<Float32Array[]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }

  private hashEmbed(text: string): Float32Array {
    const embedding = new Float32Array(this.dimensions);
    const normalized = text.toLowerCase().trim();

    for (let i = 0; i < this.dimensions; i++) {
      let hash = 0;
      for (let j = 0; j < normalized.length; j++) {
        hash = ((hash << 5) - hash + normalized.charCodeAt(j) * (i + 1)) | 0;
      }
      embedding[i] = (Math.sin(hash) + 1) / 2;
    }

    // L2 normalize
    let norm = 0;
    for (let i = 0; i < this.dimensions; i++) {
      norm += embedding[i] * embedding[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < this.dimensions; i++) {
        embedding[i] /= norm;
      }
    }

    return embedding;
  }
}

// ============================================================================
// Shard Retriever
// ============================================================================

export class ShardRetriever {
  private shards: RuleShard[] = [];
  private constitution: Constitution | null = null;
  private embeddingProvider: IEmbeddingProvider;
  private indexed = false;
  private globCache = new Map<string, RegExp>();

  constructor(embeddingProvider?: IEmbeddingProvider) {
    this.embeddingProvider = embeddingProvider ?? new HashEmbeddingProvider();
  }

  /**
   * Load a compiled policy bundle
   */
  async loadBundle(bundle: PolicyBundle): Promise<void> {
    this.constitution = bundle.constitution;
    this.shards = bundle.shards;
    this.indexed = false;
    await this.indexShards();
  }

  /**
   * Index all shards by generating embeddings
   */
  async indexShards(): Promise<void> {
    if (this.indexed) return;

    const texts = this.shards.map(s => s.compactText);
    const embeddings = await this.embeddingProvider.batchEmbed(texts);

    for (let i = 0; i < this.shards.length; i++) {
      this.shards[i].embedding = embeddings[i];
    }

    this.indexed = true;
  }

  /**
   * Classify task intent
   */
  classifyIntent(taskDescription: string): { intent: TaskIntent; confidence: number } {
    let bestIntent: TaskIntent = 'general';
    let bestScore = 0;

    for (const [intent, patterns] of Object.entries(INTENT_PATTERNS) as Array<[TaskIntent, Array<{ pattern: RegExp; weight: number }>]>) {
      if (intent === 'general') continue; // Skip general fallback during scoring

      let score = 0;
      for (const { pattern, weight } of patterns) {
        if (pattern.test(taskDescription)) {
          score += weight;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent;
      }
    }

    // Normalize confidence to 0-1
    const confidence = Math.min(bestScore / 3, 1);

    return { intent: bestIntent, confidence };
  }

  /**
   * Retrieve relevant shards for a task
   *
   * Contract:
   * 1. Always include the constitution
   * 2. Up to maxShards by semantic similarity
   * 3. Hard filters by risk class and repo scope
   * 4. Contradiction check: prefer higher priority
   */
  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    const startTime = performance.now();

    if (!this.constitution) {
      throw new Error('No policy bundle loaded. Call loadBundle() first.');
    }

    // Step 1: Classify intent
    const { intent: detectedIntent } = this.classifyIntent(request.taskDescription);
    const intent = request.intent ?? detectedIntent;

    // Step 2: Generate query embedding
    const queryEmbedding = await this.embeddingProvider.embed(request.taskDescription);

    // Step 3: Score all shards
    const maxShards = request.maxShards ?? 5;
    const scored = this.scoreShards(queryEmbedding, intent, request.riskFilter, request.repoScope);

    // Step 4: Select top N with contradiction resolution
    const selected = this.selectWithContradictionCheck(scored, maxShards);

    // Step 5: Build combined policy text
    const policyText = this.buildPolicyText(this.constitution, selected);

    const latencyMs = performance.now() - startTime;

    return {
      constitution: this.constitution,
      shards: selected,
      detectedIntent: intent,
      contradictionsResolved: this.countContradictions(selected),
      policyText,
      latencyMs,
    };
  }

  /**
   * Score all shards against the query
   */
  private scoreShards(
    queryEmbedding: Float32Array,
    intent: TaskIntent,
    riskFilter?: RiskClass[],
    repoScope?: string
  ): Array<{ shard: RuleShard; similarity: number; reason: string }> {
    const results: Array<{ shard: RuleShard; similarity: number; reason: string }> = [];

    for (const shard of this.shards) {
      // Hard filter: risk class
      if (riskFilter && riskFilter.length > 0) {
        if (!riskFilter.includes(shard.rule.riskClass)) continue;
      }

      // Hard filter: repo scope
      if (repoScope) {
        const matchesScope = shard.rule.repoScopes.some(scope =>
          scope === '**/*' || this.matchGlob(repoScope, scope)
        );
        if (!matchesScope) continue;
      }

      // Semantic similarity
      let similarity = 0;
      if (shard.embedding) {
        similarity = this.cosineSimilarity(queryEmbedding, shard.embedding);
      }

      // Intent boost: if shard matches detected intent, boost score
      const intentBoost = shard.rule.intents.includes(intent) ? 0.15 : 0;

      // Risk boost: critical/high rules get a boost
      const riskBoost = shard.rule.riskClass === 'critical' ? 0.1
        : shard.rule.riskClass === 'high' ? 0.05
        : 0;

      const finalScore = similarity + intentBoost + riskBoost;

      const reasons: string[] = [];
      if (similarity > 0.3) reasons.push(`semantic match (${(similarity * 100).toFixed(0)}%)`);
      if (intentBoost > 0) reasons.push(`intent match (${intent})`);
      if (riskBoost > 0) reasons.push(`risk priority (${shard.rule.riskClass})`);

      results.push({
        shard,
        similarity: finalScore,
        reason: reasons.join(', ') || 'general relevance',
      });
    }

    // Sort by combined score descending
    return results.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Select top N shards with contradiction checking
   * When two rules contradict, keep the one with higher priority
   */
  private selectWithContradictionCheck(
    scored: Array<{ shard: RuleShard; similarity: number; reason: string }>,
    maxShards: number
  ): Array<{ shard: RuleShard; similarity: number; reason: string }> {
    const selected: Array<{ shard: RuleShard; similarity: number; reason: string }> = [];
    const selectedDomains = new Map<string, number>(); // domain -> highest priority

    for (const item of scored) {
      if (selected.length >= maxShards) break;

      // Check for potential contradictions with already selected shards
      let dominated = false;
      for (const domain of item.shard.rule.domains) {
        const existingPriority = selectedDomains.get(domain);
        if (existingPriority !== undefined && existingPriority > item.shard.rule.priority) {
          // Higher priority rule already selected for this domain
          // Check if they're likely contradictory (similar domain, different intent)
          const existing = selected.find(s =>
            s.shard.rule.domains.includes(domain) &&
            s.shard.rule.priority > item.shard.rule.priority
          );
          if (existing && this.areContradictory(existing.shard.rule, item.shard.rule)) {
            dominated = true;
            break;
          }
        }
      }

      if (!dominated) {
        selected.push(item);
        for (const domain of item.shard.rule.domains) {
          const current = selectedDomains.get(domain) ?? 0;
          selectedDomains.set(domain, Math.max(current, item.shard.rule.priority));
        }
      }
    }

    return selected;
  }

  /**
   * Check if two rules are contradictory
   */
  private areContradictory(a: { text: string }, b: { text: string }): boolean {
    const negationPatterns = [
      { positive: /\bmust\b/i, negative: /\bnever\b|\bdo not\b|\bavoid\b/i },
      { positive: /\balways\b/i, negative: /\bnever\b|\bdon't\b/i },
      { positive: /\brequire\b/i, negative: /\bforbid\b|\bprohibit\b/i },
    ];

    for (const { positive, negative } of negationPatterns) {
      if ((positive.test(a.text) && negative.test(b.text)) ||
          (negative.test(a.text) && positive.test(b.text))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Count contradictions in selected set
   */
  private countContradictions(
    selected: Array<{ shard: RuleShard }>
  ): number {
    let count = 0;
    for (let i = 0; i < selected.length; i++) {
      for (let j = i + 1; j < selected.length; j++) {
        if (this.areContradictory(selected[i].shard.rule, selected[j].shard.rule)) {
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Build combined policy text for injection
   */
  private buildPolicyText(
    constitution: Constitution,
    shards: Array<{ shard: RuleShard; reason: string }>
  ): string {
    const parts: string[] = [];

    // Always include constitution
    parts.push(constitution.text);

    // Add retrieved shards
    if (shards.length > 0) {
      parts.push('');
      parts.push('## Task-Specific Rules');
      parts.push('');
      for (const { shard, reason } of shards) {
        parts.push(`- ${shard.compactText}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Simple glob matching (supports * and **).
   * Compiled regexes are cached per glob to avoid re-compiling on every call.
   */
  private matchGlob(path: string, glob: string): boolean {
    let re = this.globCache.get(glob);
    if (!re) {
      const pattern = glob
        .replace(/\*\*/g, '{{GLOBSTAR}}')
        .replace(/\*/g, '[^/]*')
        .replace(/{{GLOBSTAR}}/g, '.*')
        .replace(/\//g, '\\/');
      re = new RegExp(`^${pattern}$`);
      this.globCache.set(glob, re);
    }
    return re.test(path);
  }

  /**
   * Cosine similarity between two vectors
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;

    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? Math.max(0, Math.min(1, dot / denom)) : 0;
  }

  /**
   * Get current shard count
   */
  get shardCount(): number {
    return this.shards.length;
  }

  /**
   * Get constitution
   */
  getConstitution(): Constitution | null {
    return this.constitution;
  }
}

/**
 * Create a retriever instance
 */
export function createRetriever(embeddingProvider?: IEmbeddingProvider): ShardRetriever {
  return new ShardRetriever(embeddingProvider);
}
