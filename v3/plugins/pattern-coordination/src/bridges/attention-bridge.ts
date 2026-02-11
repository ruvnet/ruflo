/**
 * Attention Bridge
 *
 * Bridge to ruvector-attention-wasm for multi-head attention computation.
 * Enables agent-to-agent communication weighting and focus management.
 */

/**
 * WASM module status
 */
export type WasmModuleStatus = 'unloaded' | 'loading' | 'ready' | 'error';

/**
 * Attention configuration
 */
export interface AttentionConfig {
  /** Dimension of each attention head */
  headDim: number;
  /** Number of attention heads */
  numHeads: number;
  /** Sequence length */
  seqLength: number;
  /** Whether to use causal masking */
  causal: boolean;
  /** Dropout rate (0-1) */
  dropout: number;
  /** Temperature for softmax scaling */
  temperature: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: AttentionConfig = {
  headDim: 64,
  numHeads: 8,
  seqLength: 512,
  causal: false,
  dropout: 0,
  temperature: 1.0,
};

/**
 * Attention output
 */
export interface AttentionOutput {
  values: Float32Array;
  weights: Float32Array;
  attended: string[];
}

/**
 * WASM attention module interface
 */
interface AttentionModule {
  flashAttention(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array,
    config: AttentionConfig
  ): Float32Array;

  multiHeadAttention(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array,
    config: AttentionConfig
  ): Float32Array;

  selfAttention(
    input: Float32Array,
    config: AttentionConfig
  ): Float32Array;

  computeWeights(
    query: Float32Array,
    keys: Float32Array[],
    config: AttentionConfig
  ): Float32Array;
}

/**
 * Attention Bridge implementation
 */
export class AttentionBridge {
  readonly name = 'ruvector-attention-wasm';
  readonly version = '0.1.0';

  private _status: WasmModuleStatus = 'unloaded';
  private _module: AttentionModule | null = null;
  private config: AttentionConfig;

  constructor(config?: Partial<AttentionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get status(): WasmModuleStatus {
    return this._status;
  }

  get initialized(): boolean {
    return this._status === 'ready';
  }

  async init(): Promise<void> {
    if (this._status === 'ready') return;
    if (this._status === 'loading') return;

    this._status = 'loading';

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wasmModule = await (import('@ruvector/attention-wasm' as any) as Promise<unknown>).catch(() => null);

      if (wasmModule) {
        this._module = wasmModule as unknown as AttentionModule;
      } else {
        this._module = this.createMockModule();
      }

      this._status = 'ready';
    } catch (error) {
      this._status = 'error';
      throw error;
    }
  }

  async destroy(): Promise<void> {
    this._module = null;
    this._status = 'unloaded';
  }

  isReady(): boolean {
    return this._status === 'ready';
  }

  getModule(): AttentionModule | null {
    return this._module;
  }

  /**
   * Compute flash attention (optimized for long sequences)
   * Achieves CPU-optimized over standard attention
   */
  flashAttention(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array,
    config?: Partial<AttentionConfig>
  ): Float32Array {
    if (!this._module) throw new Error('Attention module not initialized');
    const mergedConfig = { ...this.config, ...config };
    return this._module.flashAttention(query, key, value, mergedConfig);
  }

  /**
   * Compute multi-head attention
   */
  multiHeadAttention(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array,
    config?: Partial<AttentionConfig>
  ): Float32Array {
    if (!this._module) throw new Error('Attention module not initialized');
    const mergedConfig = { ...this.config, ...config };
    return this._module.multiHeadAttention(query, key, value, mergedConfig);
  }

  /**
   * Compute self-attention
   */
  selfAttention(
    input: Float32Array,
    config?: Partial<AttentionConfig>
  ): Float32Array {
    if (!this._module) throw new Error('Attention module not initialized');
    const mergedConfig = { ...this.config, ...config };
    return this._module.selfAttention(input, mergedConfig);
  }

  /**
   * Compute attention weights for agent-to-agent communication
   * Returns normalized weights indicating how much each key should be attended to
   */
  computeWeights(
    query: Float32Array,
    keys: Float32Array[],
    config?: Partial<AttentionConfig>
  ): number[] {
    if (!this._module) throw new Error('Attention module not initialized');
    const mergedConfig = { ...this.config, ...config };
    const weightsArray = this._module.computeWeights(query, keys, mergedConfig);
    return Array.from(weightsArray);
  }

  /**
   * Compute attention-weighted aggregation of agent states
   */
  aggregateWithAttention(
    query: Float32Array,
    agentStates: Float32Array[],
    agentValues: Float32Array[]
  ): Float32Array {
    if (agentStates.length === 0 || agentValues.length === 0) {
      return new Float32Array(0);
    }

    // Compute attention weights
    const weights = this.computeWeights(query, agentStates);

    // Aggregate values using attention weights
    const dim = agentValues[0]?.length ?? 0;
    const result = new Float32Array(dim);

    for (let d = 0; d < dim; d++) {
      let sum = 0;
      for (let i = 0; i < agentValues.length; i++) {
        sum += (weights[i] ?? 0) * (agentValues[i]?.[d] ?? 0);
      }
      result[d] = sum;
    }

    return result;
  }

  /**
   * Find top-k most relevant agents based on attention
   */
  findMostRelevant(
    query: Float32Array,
    agentStates: Float32Array[],
    k: number
  ): Array<{ index: number; weight: number }> {
    const weights = this.computeWeights(query, agentStates);

    const indexed = weights.map((weight, index) => ({ index, weight }));
    indexed.sort((a, b) => b.weight - a.weight);

    return indexed.slice(0, k);
  }

  /**
   * Create mock module for development without WASM
   */
  private createMockModule(): AttentionModule {
    return {
      flashAttention(
        query: Float32Array,
        key: Float32Array,
        value: Float32Array,
        config: AttentionConfig
      ): Float32Array {
        const seqLen = config.seqLength;
        const headDim = config.headDim;
        const scale = 1 / Math.sqrt(headDim) / config.temperature;

        // Simplified attention computation
        const output = new Float32Array(seqLen * headDim);

        for (let i = 0; i < seqLen; i++) {
          // Compute attention scores
          const scores = new Float32Array(seqLen);
          let maxScore = -Infinity;

          for (let j = 0; j < seqLen; j++) {
            if (config.causal && j > i) {
              scores[j] = -Infinity;
              continue;
            }

            let score = 0;
            for (let d = 0; d < headDim; d++) {
              score += (query[i * headDim + d] ?? 0) * (key[j * headDim + d] ?? 0);
            }
            scores[j] = score * scale;
            maxScore = Math.max(maxScore, scores[j] ?? -Infinity);
          }

          // Softmax
          let expSum = 0;
          for (let j = 0; j < seqLen; j++) {
            if (scores[j] !== -Infinity) {
              scores[j] = Math.exp((scores[j] ?? 0) - maxScore);
              expSum += scores[j] ?? 0;
            } else {
              scores[j] = 0;
            }
          }

          for (let j = 0; j < seqLen; j++) {
            scores[j] = (scores[j] ?? 0) / expSum;
          }

          // Apply attention to values
          for (let d = 0; d < headDim; d++) {
            let sum = 0;
            for (let j = 0; j < seqLen; j++) {
              sum += (scores[j] ?? 0) * (value[j * headDim + d] ?? 0);
            }
            output[i * headDim + d] = sum;
          }
        }

        return output;
      },

      multiHeadAttention(
        query: Float32Array,
        key: Float32Array,
        value: Float32Array,
        config: AttentionConfig
      ): Float32Array {
        // For simplicity, just use flash attention
        return this.flashAttention(query, key, value, config);
      },

      selfAttention(
        input: Float32Array,
        config: AttentionConfig
      ): Float32Array {
        return this.flashAttention(input, input, input, config);
      },

      computeWeights(
        query: Float32Array,
        keys: Float32Array[],
        config: AttentionConfig
      ): Float32Array {
        const n = keys.length;
        if (n === 0) return new Float32Array(0);

        const scale = 1 / Math.sqrt(query.length) / config.temperature;
        const scores = new Float32Array(n);
        let maxScore = -Infinity;

        // Compute dot products
        for (let i = 0; i < n; i++) {
          const key = keys[i];
          if (!key) continue;

          let score = 0;
          for (let d = 0; d < Math.min(query.length, key.length); d++) {
            score += (query[d] ?? 0) * (key[d] ?? 0);
          }
          scores[i] = score * scale;
          maxScore = Math.max(maxScore, scores[i] ?? -Infinity);
        }

        // Softmax
        let expSum = 0;
        for (let i = 0; i < n; i++) {
          scores[i] = Math.exp((scores[i] ?? 0) - maxScore);
          expSum += scores[i] ?? 0;
        }

        for (let i = 0; i < n; i++) {
          scores[i] = (scores[i] ?? 0) / expSum;
        }

        return scores;
      },
    };
  }
}

/**
 * Create a new attention bridge
 */
export function createAttentionBridge(config?: Partial<AttentionConfig>): AttentionBridge {
  return new AttentionBridge(config);
}

export default AttentionBridge;
