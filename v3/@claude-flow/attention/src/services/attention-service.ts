/**
 * @claude-flow/attention - AttentionService
 *
 * Unified API for all 39 attention mechanisms with WASM acceleration
 * and intelligent mechanism selection.
 */

import type {
  AttentionInput,
  AttentionOutput,
  AttentionMetadata,
  AttentionMechanismType,
  AttentionBackend,
  AttentionConfig,
  AttentionServiceOptions,
  BenchmarkResult,
  BenchmarkComparison,
  FlashAttentionConfig,
  LinearAttentionConfig,
  MoEAttentionConfig,
  HyperbolicAttentionConfig,
} from '../types.js';

import { WASMBridge } from '../wasm/bridge.js';

/**
 * Main attention service providing unified access to all mechanisms
 */
export class AttentionService {
  private bridge: WASMBridge | null = null;
  private options: Required<AttentionServiceOptions>;
  private initialized = false;
  private cache = new Map<string, AttentionOutput>();

  constructor(options: AttentionServiceOptions = {}) {
    this.options = {
      backend: options.backend ?? 'auto',
      defaultMechanism: options.defaultMechanism ?? 'flash-attention-v2',
      fallbackMechanism: options.fallbackMechanism ?? 'linear-attention',
      longSequenceThreshold: options.longSequenceThreshold ?? 8192,
      precision: options.precision ?? 'fp32',
      enableCache: options.enableCache ?? true,
      maxCacheSize: options.maxCacheSize ?? 1000,
    };
  }

  /**
   * Initialize the attention service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.options.backend !== 'typescript') {
      this.bridge = await WASMBridge.init();
    }

    this.initialized = true;
  }

  /**
   * Ensure service is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Get the current backend being used
   */
  getBackend(): AttentionBackend {
    if (this.options.backend === 'typescript') {
      return 'typescript';
    }
    return this.bridge?.getBackend() ?? 'typescript';
  }

  /**
   * Check if WASM acceleration is available
   */
  isAccelerated(): boolean {
    return this.bridge?.isAccelerated() ?? false;
  }

  /**
   * Compute attention using the configured mechanism
   */
  async forward(
    input: AttentionInput,
    config?: AttentionConfig
  ): Promise<AttentionOutput> {
    await this.ensureInitialized();

    // Check cache if enabled
    if (this.options.enableCache) {
      const cacheKey = this.computeCacheKey(input, config);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // Select mechanism based on sequence length
    const seqLen = this.getSequenceLength(input);
    const mechanism = this.selectMechanism(seqLen, config);

    // Route to appropriate implementation
    let output: AttentionOutput;
    try {
      output = await this.computeAttention(input, mechanism, config);
    } catch (error) {
      // Fallback to alternative mechanism
      console.warn(
        `[@claude-flow/attention] ${mechanism} failed, falling back to ${this.options.fallbackMechanism}`
      );
      output = await this.computeAttention(
        input,
        this.options.fallbackMechanism,
        config
      );
    }

    // Cache result
    if (this.options.enableCache) {
      const cacheKey = this.computeCacheKey(input, config);
      this.cache.set(cacheKey, output);
      this.pruneCache();
    }

    return output;
  }

  /**
   * Compute attention with specific mechanism
   */
  async compute(
    input: AttentionInput,
    mechanism: AttentionMechanismType,
    config?: AttentionConfig
  ): Promise<AttentionOutput> {
    await this.ensureInitialized();
    return this.computeAttention(input, mechanism, config);
  }

  /**
   * Internal attention computation
   */
  private async computeAttention(
    input: AttentionInput,
    mechanism: AttentionMechanismType,
    config?: AttentionConfig
  ): Promise<AttentionOutput> {
    const query = this.toFloat32Array(input.query);
    const keys = this.toFloat32Array(input.key);
    const values = this.toFloat32Array(input.value);

    // Use WASM bridge if available
    if (this.bridge) {
      return this.bridge.forward(input, mechanism);
    }

    // TypeScript fallback based on mechanism category
    return this.computeTypeScriptFallback(query, keys, values, mechanism, config);
  }

  /**
   * TypeScript fallback implementations
   */
  private computeTypeScriptFallback(
    query: Float32Array,
    keys: Float32Array,
    values: Float32Array,
    mechanism: AttentionMechanismType,
    config?: AttentionConfig
  ): AttentionOutput {
    const startTime = performance.now();
    const dim = query.length;
    const seqLen = keys.length / dim;

    let output: Float32Array;

    switch (mechanism) {
      case 'flash-attention-v2':
      case 'flash-attention-v3':
      case 'flash-decoding':
        output = this.flashAttentionTS(query, keys, values, seqLen, dim, config);
        break;

      case 'linear-attention':
      case 'performer-attention':
      case 'cosformer-attention':
      case 'linformer-attention':
        output = this.linearAttentionTS(query, keys, values, seqLen, dim, config);
        break;

      case 'bigbird-attention':
      case 'longformer-attention':
      case 'local-attention':
      case 'strided-attention':
        output = this.sparseAttentionTS(query, keys, values, seqLen, dim, config);
        break;

      case 'moe-attention':
      case 'soft-moe-attention':
      case 'switch-attention':
      case 'expert-choice-attention':
        output = this.moeAttentionTS(query, keys, values, seqLen, dim, config);
        break;

      default:
        // Standard dot-product attention for all other types
        output = this.dotProductAttentionTS(query, keys, values, seqLen, dim);
    }

    const latencyMs = performance.now() - startTime;

    return {
      output,
      metadata: {
        mechanism,
        backend: 'typescript',
        latencyMs,
        memoryBytes: output.byteLength,
        sequenceLength: seqLen,
        wasmAccelerated: false,
      },
    };
  }

  /**
   * Standard dot-product attention (TypeScript)
   */
  private dotProductAttentionTS(
    query: Float32Array,
    keys: Float32Array,
    values: Float32Array,
    seqLen: number,
    dim: number
  ): Float32Array {
    const scale = 1 / Math.sqrt(dim);
    const output = new Float32Array(dim);
    const scores = new Float32Array(seqLen);

    // Compute attention scores
    for (let i = 0; i < seqLen; i++) {
      let score = 0;
      for (let j = 0; j < dim; j++) {
        score += query[j] * keys[i * dim + j];
      }
      scores[i] = score * scale;
    }

    // Softmax
    const maxScore = Math.max(...scores);
    let sumExp = 0;
    for (let i = 0; i < seqLen; i++) {
      scores[i] = Math.exp(scores[i] - maxScore);
      sumExp += scores[i];
    }
    for (let i = 0; i < seqLen; i++) {
      scores[i] /= sumExp;
    }

    // Weighted sum
    for (let i = 0; i < seqLen; i++) {
      for (let j = 0; j < dim; j++) {
        output[j] += scores[i] * values[i * dim + j];
      }
    }

    return output;
  }

  /**
   * Flash Attention (TypeScript) - Block-wise for memory efficiency
   */
  private flashAttentionTS(
    query: Float32Array,
    keys: Float32Array,
    values: Float32Array,
    seqLen: number,
    dim: number,
    config?: AttentionConfig
  ): Float32Array {
    const flashConfig = config as FlashAttentionConfig | undefined;
    const blockSize = flashConfig?.blockSizeQ ?? 64;
    const scale = 1 / Math.sqrt(dim);
    const causal = flashConfig?.causal ?? false;
    const output = new Float32Array(dim);
    const numBlocks = Math.ceil(seqLen / blockSize);

    let maxScore = -Infinity;
    let sumExp = 0;
    const weightedSum = new Float32Array(dim);

    for (let blockIdx = 0; blockIdx < numBlocks; blockIdx++) {
      const blockStart = blockIdx * blockSize;
      const blockEnd = Math.min(blockStart + blockSize, seqLen);

      const blockScores = new Float32Array(blockEnd - blockStart);
      for (let i = blockStart; i < blockEnd; i++) {
        if (causal && i > seqLen - 1) {
          blockScores[i - blockStart] = -Infinity;
          continue;
        }
        let score = 0;
        for (let j = 0; j < dim; j++) {
          score += query[j] * keys[i * dim + j];
        }
        blockScores[i - blockStart] = score * scale;
      }

      const blockMax = Math.max(...blockScores);
      if (blockMax > maxScore) {
        const rescale = Math.exp(maxScore - blockMax);
        sumExp *= rescale;
        for (let j = 0; j < dim; j++) {
          weightedSum[j] *= rescale;
        }
        maxScore = blockMax;
      }

      for (let i = blockStart; i < blockEnd; i++) {
        const localIdx = i - blockStart;
        const weight = Math.exp(blockScores[localIdx] - maxScore);
        sumExp += weight;
        for (let j = 0; j < dim; j++) {
          weightedSum[j] += weight * values[i * dim + j];
        }
      }
    }

    for (let j = 0; j < dim; j++) {
      output[j] = weightedSum[j] / sumExp;
    }

    return output;
  }

  /**
   * Linear Attention (TypeScript) - O(n) complexity
   */
  private linearAttentionTS(
    query: Float32Array,
    keys: Float32Array,
    values: Float32Array,
    seqLen: number,
    dim: number,
    config?: AttentionConfig
  ): Float32Array {
    const output = new Float32Array(dim);
    const applyFeatureMap = (x: number): number => (x > 0 ? x + 1 : Math.exp(x));

    // Transform query
    const phiQ = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      phiQ[i] = applyFeatureMap(query[i]);
    }

    // Compute KV sum and K sum
    const kvSum = new Float32Array(dim * dim);
    const kSum = new Float32Array(dim);

    for (let i = 0; i < seqLen; i++) {
      const phiK = new Float32Array(dim);
      for (let j = 0; j < dim; j++) {
        phiK[j] = applyFeatureMap(keys[i * dim + j]);
        kSum[j] += phiK[j];
      }

      for (let j = 0; j < dim; j++) {
        for (let k = 0; k < dim; k++) {
          kvSum[j * dim + k] += phiK[j] * values[i * dim + k];
        }
      }
    }

    // Compute output
    let denom = 0;
    for (let i = 0; i < dim; i++) {
      denom += phiQ[i] * kSum[i];
    }

    for (let j = 0; j < dim; j++) {
      let num = 0;
      for (let i = 0; i < dim; i++) {
        num += phiQ[i] * kvSum[i * dim + j];
      }
      output[j] = num / (denom + 1e-6);
    }

    return output;
  }

  /**
   * Sparse Attention (TypeScript) - Local windowed attention
   */
  private sparseAttentionTS(
    query: Float32Array,
    keys: Float32Array,
    values: Float32Array,
    seqLen: number,
    dim: number,
    config?: AttentionConfig
  ): Float32Array {
    const windowSize = 256; // Local attention window
    const scale = 1 / Math.sqrt(dim);
    const output = new Float32Array(dim);

    // Only attend to nearby tokens within window
    const halfWindow = Math.floor(windowSize / 2);
    const validStart = Math.max(0, seqLen - halfWindow);
    const validEnd = Math.min(seqLen, seqLen + halfWindow);

    const scores = new Float32Array(validEnd - validStart);
    for (let i = validStart; i < validEnd; i++) {
      let score = 0;
      for (let j = 0; j < dim; j++) {
        score += query[j] * keys[i * dim + j];
      }
      scores[i - validStart] = score * scale;
    }

    // Softmax over window
    const maxScore = Math.max(...scores);
    let sumExp = 0;
    for (let i = 0; i < scores.length; i++) {
      scores[i] = Math.exp(scores[i] - maxScore);
      sumExp += scores[i];
    }
    for (let i = 0; i < scores.length; i++) {
      scores[i] /= sumExp;
    }

    // Weighted sum
    for (let i = 0; i < scores.length; i++) {
      const globalIdx = validStart + i;
      for (let j = 0; j < dim; j++) {
        output[j] += scores[i] * values[globalIdx * dim + j];
      }
    }

    return output;
  }

  /**
   * Mixture of Experts Attention (TypeScript)
   */
  private moeAttentionTS(
    query: Float32Array,
    keys: Float32Array,
    values: Float32Array,
    seqLen: number,
    dim: number,
    config?: AttentionConfig
  ): Float32Array {
    const moeConfig = config as MoEAttentionConfig | undefined;
    const numExperts = moeConfig?.numExperts ?? 8;
    const topK = moeConfig?.topK ?? 2;

    // Compute router logits (simplified: use query norm)
    const routerLogits = new Float32Array(numExperts);
    for (let e = 0; e < numExperts; e++) {
      let logit = 0;
      for (let j = 0; j < dim; j++) {
        // Simple hash-based routing
        logit += query[j] * Math.sin((e + 1) * (j + 1) * 0.1);
      }
      routerLogits[e] = logit;
    }

    // Top-k selection
    const expertIndices: number[] = [];
    const expertWeights: number[] = [];
    for (let k = 0; k < topK; k++) {
      let maxIdx = 0;
      let maxVal = -Infinity;
      for (let e = 0; e < numExperts; e++) {
        if (routerLogits[e] > maxVal && !expertIndices.includes(e)) {
          maxVal = routerLogits[e];
          maxIdx = e;
        }
      }
      expertIndices.push(maxIdx);
      expertWeights.push(maxVal);
    }

    // Softmax expert weights
    const maxWeight = Math.max(...expertWeights);
    let sumExp = 0;
    for (let k = 0; k < topK; k++) {
      expertWeights[k] = Math.exp(expertWeights[k] - maxWeight);
      sumExp += expertWeights[k];
    }
    for (let k = 0; k < topK; k++) {
      expertWeights[k] /= sumExp;
    }

    // Compute attention per expert and combine
    const output = new Float32Array(dim);
    for (let k = 0; k < topK; k++) {
      const expertOut = this.dotProductAttentionTS(query, keys, values, seqLen, dim);
      // Add expert-specific bias
      for (let j = 0; j < dim; j++) {
        output[j] += expertWeights[k] * expertOut[j];
      }
    }

    return output;
  }

  /**
   * Select optimal mechanism based on sequence length
   */
  private selectMechanism(
    seqLen: number,
    config?: AttentionConfig
  ): AttentionMechanismType {
    // Use specified mechanism if in config
    if (config && 'mechanism' in config) {
      return (config as any).mechanism;
    }

    // Auto-select based on sequence length
    if (seqLen > this.options.longSequenceThreshold) {
      return 'linear-attention';
    }
    if (seqLen > 2048) {
      return 'flash-attention-v2';
    }
    return this.options.defaultMechanism;
  }

  /**
   * Get sequence length from input
   */
  private getSequenceLength(input: AttentionInput): number {
    if (Array.isArray(input.key)) {
      if (Array.isArray(input.key[0])) {
        return input.key.length;
      }
      return input.key.length / (Array.isArray(input.query) ? input.query.length : 1);
    }
    return input.key.length / this.getQueryDim(input);
  }

  /**
   * Get query dimension
   */
  private getQueryDim(input: AttentionInput): number {
    if (input.query instanceof Float32Array) {
      return input.query.length;
    }
    if (Array.isArray(input.query) && Array.isArray(input.query[0])) {
      return (input.query[0] as number[]).length;
    }
    return (input.query as number[]).length;
  }

  /**
   * Convert various input types to Float32Array
   */
  private toFloat32Array(
    input: Float32Array | number[] | number[][]
  ): Float32Array {
    if (input instanceof Float32Array) {
      return input;
    }
    if (Array.isArray(input) && Array.isArray(input[0])) {
      const flat = (input as number[][]).flat();
      return new Float32Array(flat);
    }
    return new Float32Array(input as number[]);
  }

  /**
   * Compute cache key for input
   */
  private computeCacheKey(input: AttentionInput, config?: AttentionConfig): string {
    const queryHash = this.hashArray(this.toFloat32Array(input.query));
    const keyHash = this.hashArray(this.toFloat32Array(input.key));
    return `${queryHash}-${keyHash}-${JSON.stringify(config ?? {})}`;
  }

  /**
   * Simple hash function for arrays
   */
  private hashArray(arr: Float32Array): string {
    let hash = 0;
    for (let i = 0; i < Math.min(arr.length, 100); i++) {
      hash = ((hash << 5) - hash + arr[i]) | 0;
    }
    return hash.toString(16);
  }

  /**
   * Prune cache to max size
   */
  private pruneCache(): void {
    if (this.cache.size > this.options.maxCacheSize) {
      const keysToDelete = Array.from(this.cache.keys()).slice(
        0,
        this.cache.size - this.options.maxCacheSize
      );
      for (const key of keysToDelete) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear the attention cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * List all supported attention mechanisms
   */
  listMechanisms(): AttentionMechanismType[] {
    return [
      // Multi-Head Attention
      'standard-mha',
      'rotary-mha',
      'alibi-mha',
      'grouped-query-attention',
      'multi-query-attention',
      'differential-attention',
      'mixture-attention',
      // Self-Attention
      'causal-self-attention',
      'bidirectional-self-attention',
      'relative-position-attention',
      'disentangled-attention',
      'talking-heads-attention',
      'synthesizer-attention',
      // Cross-Attention
      'cross-attention',
      'perceiver-attention',
      'gated-cross-attention',
      'memory-attention',
      'hierarchical-cross-attention',
      // Sparse
      'bigbird-attention',
      'longformer-attention',
      'local-attention',
      'strided-attention',
      'sparse-transformer-attention',
      'star-attention',
      'blockwise-attention',
      'random-attention',
      // Linear
      'linear-attention',
      'performer-attention',
      'cosformer-attention',
      'rfa-attention',
      'nystrom-attention',
      'linformer-attention',
      // Flash
      'flash-attention-v2',
      'flash-attention-v3',
      'flash-decoding',
      // MoE
      'moe-attention',
      'soft-moe-attention',
      'switch-attention',
      'expert-choice-attention',
    ];
  }

  /**
   * Get information about a specific mechanism
   */
  getMechanismInfo(mechanism: AttentionMechanismType): {
    name: string;
    category: string;
    complexity: string;
    wasmSupported: boolean;
  } {
    const info: Record<AttentionMechanismType, { category: string; complexity: string }> = {
      'standard-mha': { category: 'multi-head', complexity: 'O(n²d)' },
      'rotary-mha': { category: 'multi-head', complexity: 'O(n²d)' },
      'alibi-mha': { category: 'multi-head', complexity: 'O(n²d)' },
      'grouped-query-attention': { category: 'multi-head', complexity: 'O(n²d/g)' },
      'multi-query-attention': { category: 'multi-head', complexity: 'O(n²d/h)' },
      'differential-attention': { category: 'multi-head', complexity: 'O(n²d)' },
      'mixture-attention': { category: 'multi-head', complexity: 'O(kn²d)' },
      'causal-self-attention': { category: 'self-attention', complexity: 'O(n²d)' },
      'bidirectional-self-attention': { category: 'self-attention', complexity: 'O(n²d)' },
      'relative-position-attention': { category: 'self-attention', complexity: 'O(n²d)' },
      'disentangled-attention': { category: 'self-attention', complexity: 'O(n²d)' },
      'talking-heads-attention': { category: 'self-attention', complexity: 'O(n²d)' },
      'synthesizer-attention': { category: 'self-attention', complexity: 'O(nd)' },
      'cross-attention': { category: 'cross-attention', complexity: 'O(nmd)' },
      'perceiver-attention': { category: 'cross-attention', complexity: 'O(lnd)' },
      'gated-cross-attention': { category: 'cross-attention', complexity: 'O(nmd)' },
      'memory-attention': { category: 'cross-attention', complexity: 'O(nmd)' },
      'hierarchical-cross-attention': { category: 'cross-attention', complexity: 'O(nmd)' },
      'bigbird-attention': { category: 'sparse', complexity: 'O(n√n)' },
      'longformer-attention': { category: 'sparse', complexity: 'O(nw)' },
      'local-attention': { category: 'sparse', complexity: 'O(nw)' },
      'strided-attention': { category: 'sparse', complexity: 'O(n√n)' },
      'sparse-transformer-attention': { category: 'sparse', complexity: 'O(n√n)' },
      'star-attention': { category: 'sparse', complexity: 'O(n)' },
      'blockwise-attention': { category: 'sparse', complexity: 'O(nb²)' },
      'random-attention': { category: 'sparse', complexity: 'O(nr)' },
      'linear-attention': { category: 'linear', complexity: 'O(nd²)' },
      'performer-attention': { category: 'linear', complexity: 'O(ndr)' },
      'cosformer-attention': { category: 'linear', complexity: 'O(nd)' },
      'rfa-attention': { category: 'linear', complexity: 'O(ndr)' },
      'nystrom-attention': { category: 'linear', complexity: 'O(nm)' },
      'linformer-attention': { category: 'linear', complexity: 'O(nk)' },
      'flash-attention-v2': { category: 'flash', complexity: 'O(n²d)' },
      'flash-attention-v3': { category: 'flash', complexity: 'O(n²d)' },
      'flash-decoding': { category: 'flash', complexity: 'O(n²d)' },
      'moe-attention': { category: 'moe', complexity: 'O(kn²d/e)' },
      'soft-moe-attention': { category: 'moe', complexity: 'O(n²d)' },
      'switch-attention': { category: 'moe', complexity: 'O(n²d/e)' },
      'expert-choice-attention': { category: 'moe', complexity: 'O(cn²d)' },
    };

    const mechanismInfo = info[mechanism];
    const wasmMechanisms: AttentionMechanismType[] = [
      'standard-mha',
      'flash-attention-v2',
      'flash-attention-v3',
      'linear-attention',
    ];

    return {
      name: mechanism.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      category: mechanismInfo.category,
      complexity: mechanismInfo.complexity,
      wasmSupported: wasmMechanisms.includes(mechanism),
    };
  }

  /**
   * Benchmark a specific mechanism
   */
  async benchmark(
    mechanism: AttentionMechanismType,
    options: {
      sequenceLength?: number;
      batchSize?: number;
      iterations?: number;
      dim?: number;
    } = {}
  ): Promise<BenchmarkResult> {
    await this.ensureInitialized();

    const seqLen = options.sequenceLength ?? 512;
    const batchSize = options.batchSize ?? 1;
    const iterations = options.iterations ?? 100;
    const dim = options.dim ?? 384;

    // Generate random test data
    const query = new Float32Array(dim);
    const keys = new Float32Array(seqLen * dim);
    const values = new Float32Array(seqLen * dim);
    for (let i = 0; i < query.length; i++) query[i] = Math.random();
    for (let i = 0; i < keys.length; i++) keys[i] = Math.random();
    for (let i = 0; i < values.length; i++) values[i] = Math.random();

    const latencies: number[] = [];

    // Warmup
    for (let i = 0; i < 10; i++) {
      await this.compute({ query, key: keys, value: values }, mechanism);
    }

    // Benchmark
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await this.compute({ query, key: keys, value: values }, mechanism);
      latencies.push(performance.now() - start);
    }

    latencies.sort((a, b) => a - b);
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

    return {
      mechanism,
      backend: this.getBackend(),
      sequenceLength: seqLen,
      batchSize,
      latencyMs: avgLatency,
      latencyP50Ms: latencies[Math.floor(latencies.length * 0.5)],
      latencyP95Ms: latencies[Math.floor(latencies.length * 0.95)],
      latencyP99Ms: latencies[Math.floor(latencies.length * 0.99)],
      throughputOpsPerSec: 1000 / avgLatency,
      memoryBytes: (query.byteLength + keys.byteLength + values.byteLength) * 2,
      iterations,
    };
  }

  /**
   * Compare multiple mechanisms
   */
  async compareMechanisms(
    mechanisms: AttentionMechanismType[],
    options?: {
      sequenceLength?: number;
      iterations?: number;
    }
  ): Promise<BenchmarkComparison> {
    const results: BenchmarkResult[] = [];

    for (const mechanism of mechanisms) {
      const result = await this.benchmark(mechanism, options);
      results.push(result);
    }

    // Use standard MHA as baseline
    const baseline = results.find((r) => r.mechanism === 'standard-mha') ?? results[0];

    const speedupFactors = new Map<AttentionMechanismType, number>();
    for (const result of results) {
      speedupFactors.set(result.mechanism, baseline.latencyMs / result.latencyMs);
    }

    // Generate recommendations
    const recommendations: string[] = [];
    const fastest = results.reduce((a, b) =>
      a.latencyMs < b.latencyMs ? a : b
    );
    recommendations.push(
      `Fastest mechanism: ${fastest.mechanism} (${fastest.latencyMs.toFixed(2)}ms)`
    );

    if (options?.sequenceLength && options.sequenceLength > 4096) {
      recommendations.push(
        'For long sequences (>4096), consider linear-attention or flash-attention-v2'
      );
    }

    return {
      baseline,
      results,
      speedupFactors,
      recommendations,
    };
  }
}

/**
 * Create a pre-configured attention service
 */
export async function createAttentionService(
  options?: AttentionServiceOptions
): Promise<AttentionService> {
  const service = new AttentionService(options);
  await service.initialize();
  return service;
}
