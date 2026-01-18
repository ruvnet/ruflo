/**
 * @claude-flow/cache-optimizer - Fast GRNN (Gated Recurrent Neural Network)
 *
 * Temporal sequence learning for cache access pattern prediction.
 * Implements a lightweight GRNN optimized for real-time inference.
 *
 * Features:
 * - O(n) sequence processing
 * - Gated updates for selective memory
 * - EWC++ integration for continual learning
 * - Fast inference (<1ms for typical sequences)
 */

import type { CacheEntry, CacheEntryType, TemporalTier } from '../../types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Temporal event representing a cache access
 */
export interface TemporalEvent {
  /** Entry ID */
  entryId: string;
  /** Event type */
  eventType: EventType;
  /** Entry type */
  entryType: CacheEntryType;
  /** Timestamp */
  timestamp: number;
  /** Relevance at time of event */
  relevance: number;
  /** Tier at time of event */
  tier: TemporalTier;
  /** Token count */
  tokens: number;
  /** Context features */
  context: {
    sessionId: string;
    filePath?: string;
    toolName?: string;
  };
}

/**
 * Event types for temporal tracking
 */
export type EventType =
  | 'access'    // Entry was accessed
  | 'create'    // Entry was created
  | 'update'    // Entry was updated
  | 'promote'   // Entry was promoted to hotter tier
  | 'demote'    // Entry was demoted to colder tier
  | 'compress'  // Entry was compressed
  | 'prune';    // Entry was pruned

/**
 * GRNN configuration
 */
export interface GRNNConfig {
  /** Hidden state dimension */
  hiddenDim: number;
  /** Input feature dimension */
  inputDim: number;
  /** Number of GRU layers */
  numLayers: number;
  /** Dropout rate */
  dropout: number;
  /** Learning rate */
  learningRate: number;
  /** Sequence window size */
  windowSize: number;
  /** EWC++ lambda for continual learning */
  ewcLambda: number;
}

/**
 * Hidden state of the GRNN
 */
export interface GRNNState {
  /** Hidden vectors for each layer */
  hidden: number[][];
  /** Cell state (for LSTM-like extensions) */
  cell?: number[][];
  /** Timestamp of last update */
  lastUpdate: number;
  /** Sequence position */
  position: number;
}

/**
 * Prediction result from GRNN
 */
export interface GRNNPrediction {
  /** Predicted next entry types (probability distribution) */
  nextEntryType: Map<CacheEntryType, number>;
  /** Predicted access probability for existing entries */
  accessProbability: Map<string, number>;
  /** Predicted optimal pruning candidates */
  pruningCandidates: string[];
  /** Predicted tier transitions */
  tierTransitions: Map<string, TemporalTier>;
  /** Confidence in predictions */
  confidence: number;
  /** Inference time (ms) */
  inferenceTimeMs: number;
}

/**
 * Training metrics
 */
export interface TrainingMetrics {
  /** Loss value */
  loss: number;
  /** Accuracy */
  accuracy: number;
  /** Number of training steps */
  steps: number;
  /** Gradient norm */
  gradientNorm: number;
  /** EWC penalty */
  ewcPenalty: number;
  /** Learning rate (current) */
  currentLearningRate: number;
}

/**
 * Fisher Information for EWC++
 */
export interface FisherInformation {
  /** Diagonal Fisher matrix for each parameter group */
  diagonal: Map<string, number[]>;
  /** Optimal parameters from previous task */
  optimalParams: Map<string, number[]>;
  /** Number of samples used */
  sampleCount: number;
  /** Last computation timestamp */
  computedAt: number;
}

/**
 * GRNN weights structure for persistence
 */
export interface GRNNWeights {
  updateGate: number[][];
  resetGate: number[][];
  candidate: number[][];
  output: number[][];
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_GRNN_CONFIG: GRNNConfig = {
  hiddenDim: 64,
  inputDim: 24,
  numLayers: 2,
  dropout: 0.1,
  learningRate: 0.01,
  windowSize: 100,
  ewcLambda: 0.5,
};

// ============================================================================
// Feature Extraction
// ============================================================================

/**
 * Extract features from a temporal event
 */
export function extractEventFeatures(event: TemporalEvent): number[] {
  const features: number[] = [];

  // Event type encoding (one-hot, 7 types)
  const eventTypes: EventType[] = ['access', 'create', 'update', 'promote', 'demote', 'compress', 'prune'];
  for (const type of eventTypes) {
    features.push(event.eventType === type ? 1 : 0);
  }

  // Entry type encoding (one-hot, 9 types)
  const entryTypes: CacheEntryType[] = [
    'system_prompt', 'claude_md', 'file_read', 'file_write',
    'tool_result', 'bash_output', 'user_message', 'assistant_message', 'mcp_context'
  ];
  for (const type of entryTypes) {
    features.push(event.entryType === type ? 1 : 0);
  }

  // Temporal features
  const now = Date.now();
  const ageMs = now - event.timestamp;
  features.push(Math.exp(-ageMs / (10 * 60 * 1000)));  // Recency (10 min half-life)

  // Relevance
  features.push(event.relevance);

  // Tier encoding (one-hot, 4 tiers)
  const tiers: TemporalTier[] = ['hot', 'warm', 'cold', 'archived'];
  for (const tier of tiers) {
    features.push(event.tier === tier ? 1 : 0);
  }

  // Token count (normalized)
  features.push(Math.min(event.tokens / 10000, 1));

  return features;
}

// ============================================================================
// Fast GRNN Class
// ============================================================================

/**
 * Fast Gated Recurrent Neural Network for temporal pattern learning
 */
export class FastGRNN {
  private config: GRNNConfig;
  private state: GRNNState;
  private eventHistory: TemporalEvent[] = [];
  private trainingMetrics: TrainingMetrics;
  private fisher: FisherInformation;

  // Network parameters
  private weights: {
    updateGate: number[][];
    resetGate: number[][];
    candidate: number[][];
    output: number[][];
  };

  constructor(config: Partial<GRNNConfig> = {}) {
    this.config = { ...DEFAULT_GRNN_CONFIG, ...config };

    this.state = {
      hidden: Array(this.config.numLayers)
        .fill(null)
        .map(() => new Array(this.config.hiddenDim).fill(0)),
      lastUpdate: Date.now(),
      position: 0,
    };

    this.trainingMetrics = {
      loss: 0,
      accuracy: 0,
      steps: 0,
      gradientNorm: 0,
      ewcPenalty: 0,
      currentLearningRate: this.config.learningRate,
    };

    this.fisher = {
      diagonal: new Map(),
      optimalParams: new Map(),
      sampleCount: 0,
      computedAt: Date.now(),
    };

    this.weights = {
      updateGate: this.initializeWeights(this.config.inputDim + this.config.hiddenDim, this.config.hiddenDim),
      resetGate: this.initializeWeights(this.config.inputDim + this.config.hiddenDim, this.config.hiddenDim),
      candidate: this.initializeWeights(this.config.inputDim + this.config.hiddenDim, this.config.hiddenDim),
      output: this.initializeWeights(this.config.hiddenDim, 9), // 9 entry types
    };
  }

  private initializeWeights(inputDim: number, outputDim: number): number[][] {
    const scale = Math.sqrt(2 / (inputDim + outputDim));
    const weights: number[][] = [];

    for (let i = 0; i < inputDim; i++) {
      const row: number[] = [];
      for (let j = 0; j < outputDim; j++) {
        row.push((Math.random() * 2 - 1) * scale);
      }
      weights.push(row);
    }

    return weights;
  }

  /**
   * Process a temporal event and update hidden state
   */
  processEvent(event: TemporalEvent): void {
    // Add to history
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.config.windowSize) {
      this.eventHistory = this.eventHistory.slice(-this.config.windowSize);
    }

    // Extract features
    const features = extractEventFeatures(event);

    // Pad/truncate to input dimension
    const input = this.padFeatures(features, this.config.inputDim);

    // Forward pass through GRU layers
    this.forwardPass(input);

    this.state.position++;
    this.state.lastUpdate = Date.now();
  }

  /**
   * GRU forward pass
   */
  private forwardPass(input: number[]): void {
    let currentInput = input;

    for (let layer = 0; layer < this.config.numLayers; layer++) {
      const prevHidden = this.state.hidden[layer];

      // Concatenate input and hidden
      const concat = [...currentInput, ...prevHidden];

      // Update gate: z = sigmoid(W_z * [x, h])
      const updateGate = this.sigmoid(this.matmul(concat, this.weights.updateGate));

      // Reset gate: r = sigmoid(W_r * [x, h])
      const resetGate = this.sigmoid(this.matmul(concat, this.weights.resetGate));

      // Candidate hidden: h_tilde = tanh(W_h * [x, r * h])
      const resetHidden = prevHidden.map((h, i) => h * resetGate[i]);
      const candidateInput = [...currentInput, ...resetHidden];
      const candidateHidden = this.tanh(this.matmul(candidateInput, this.weights.candidate));

      // New hidden state: h_new = (1 - z) * h + z * h_tilde
      this.state.hidden[layer] = prevHidden.map((h, i) =>
        (1 - updateGate[i]) * h + updateGate[i] * candidateHidden[i]
      );

      // Apply dropout during training
      if (this.config.dropout > 0 && this.trainingMetrics.steps > 0) {
        this.state.hidden[layer] = this.applyDropout(this.state.hidden[layer]);
      }

      // Current layer output becomes next layer input
      currentInput = this.state.hidden[layer];
    }
  }

  /**
   * Make predictions based on current state
   */
  predict(entries: CacheEntry[]): GRNNPrediction {
    const startTime = Date.now();

    // Get final hidden state
    const finalHidden = this.state.hidden[this.config.numLayers - 1];

    // Predict next entry type
    const typeLogits = this.matmul(finalHidden, this.weights.output);
    const typeProbs = this.softmax(typeLogits);
    const entryTypes: CacheEntryType[] = [
      'system_prompt', 'claude_md', 'file_read', 'file_write',
      'tool_result', 'bash_output', 'user_message', 'assistant_message', 'mcp_context'
    ];
    const nextEntryType = new Map<CacheEntryType, number>();
    for (let i = 0; i < entryTypes.length; i++) {
      nextEntryType.set(entryTypes[i], typeProbs[i]);
    }

    // Predict access probability for each entry
    const accessProbability = new Map<string, number>();
    const tierTransitions = new Map<string, TemporalTier>();
    const pruningScores: Array<{ id: string; score: number }> = [];

    for (const entry of entries) {
      // Compute similarity between entry features and hidden state
      const entryFeatures = this.extractEntryFeatures(entry);
      const similarity = this.cosineSimilarity(entryFeatures, finalHidden);

      // Access probability based on similarity and recency
      const recency = Math.exp(-(Date.now() - entry.lastAccessedAt) / (10 * 60 * 1000));
      const accessProb = 0.5 * similarity + 0.5 * recency;
      accessProbability.set(entry.id, accessProb);

      // Predict tier transitions
      const predictedTier = this.predictTier(entry, similarity);
      if (predictedTier !== entry.tier) {
        tierTransitions.set(entry.id, predictedTier);
      }

      // Score for pruning (lower = better candidate for pruning)
      const pruningScore = accessProb * 0.6 + (entry.relevance?.overall ?? 0.5) * 0.4;
      pruningScores.push({ id: entry.id, score: pruningScore });
    }

    // Get pruning candidates (lowest scores)
    pruningScores.sort((a, b) => a.score - b.score);
    const pruningCandidates = pruningScores
      .slice(0, Math.ceil(entries.length * 0.2))
      .map(p => p.id);

    // Compute overall confidence
    const confidence = this.computeConfidence(typeProbs);

    return {
      nextEntryType,
      accessProbability,
      pruningCandidates,
      tierTransitions,
      confidence,
      inferenceTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Predict optimal tier for an entry
   */
  private predictTier(entry: CacheEntry, similarity: number): TemporalTier {
    const ageMs = Date.now() - entry.lastAccessedAt;
    const accessRate = entry.accessCount / Math.max(1, (Date.now() - entry.timestamp) / (60 * 1000));

    // Hot if recently accessed and frequently used
    if (ageMs < 5 * 60 * 1000 && accessRate > 0.1) {
      return 'hot';
    }

    // Warm if moderately recent or high similarity
    if (ageMs < 30 * 60 * 1000 || similarity > 0.7) {
      return 'warm';
    }

    // Cold if older
    if (ageMs < 2 * 60 * 60 * 1000) {
      return 'cold';
    }

    return 'archived';
  }

  /**
   * Train on a sequence of events
   */
  async train(events: TemporalEvent[]): Promise<TrainingMetrics> {
    if (events.length < 2) {
      return this.trainingMetrics;
    }

    let totalLoss = 0;
    let correct = 0;
    let gradientNormSum = 0;

    // Process sequence
    for (let i = 0; i < events.length - 1; i++) {
      const currentEvent = events[i];
      const nextEvent = events[i + 1];

      // Forward pass
      const features = extractEventFeatures(currentEvent);
      const input = this.padFeatures(features, this.config.inputDim);
      this.forwardPass(input);

      // Compute loss (cross-entropy for next entry type prediction)
      const finalHidden = this.state.hidden[this.config.numLayers - 1];
      const logits = this.matmul(finalHidden, this.weights.output);
      const probs = this.softmax(logits);

      const targetIdx = this.getEntryTypeIndex(nextEvent.entryType);
      const loss = -Math.log(Math.max(probs[targetIdx], 1e-10));
      totalLoss += loss;

      // Accuracy
      const predictedIdx = probs.indexOf(Math.max(...probs));
      if (predictedIdx === targetIdx) {
        correct++;
      }

      // Gradient descent (simplified)
      const gradientNorm = this.updateWeights(probs, targetIdx, input);
      gradientNormSum += gradientNorm;
    }

    // Compute EWC penalty
    const ewcPenalty = this.computeEWCPenalty();

    this.trainingMetrics = {
      loss: totalLoss / (events.length - 1),
      accuracy: correct / (events.length - 1),
      steps: this.trainingMetrics.steps + events.length - 1,
      gradientNorm: gradientNormSum / (events.length - 1),
      ewcPenalty,
      currentLearningRate: this.config.learningRate * Math.pow(0.99, Math.floor(this.trainingMetrics.steps / 100)),
    };

    return this.trainingMetrics;
  }

  /**
   * Update weights using gradient descent
   */
  private updateWeights(probs: number[], targetIdx: number, _input: number[]): number {
    // Compute gradient for output layer
    const outputGrad = [...probs];
    outputGrad[targetIdx] -= 1;

    // Simple gradient update for output weights
    const finalHidden = this.state.hidden[this.config.numLayers - 1];
    let gradientNorm = 0;

    for (let i = 0; i < this.weights.output.length; i++) {
      for (let j = 0; j < this.weights.output[i].length; j++) {
        const grad = finalHidden[i] * outputGrad[j];
        gradientNorm += grad * grad;

        // EWC regularization
        const ewcGrad = this.getEWCGradient('output', i, j);

        this.weights.output[i][j] -= this.trainingMetrics.currentLearningRate * (grad + ewcGrad);
      }
    }

    return Math.sqrt(gradientNorm);
  }

  /**
   * Get EWC gradient for a parameter
   */
  private getEWCGradient(paramName: string, i: number, j: number): number {
    const fisherDiag = this.fisher.diagonal.get(paramName);
    const optimalParams = this.fisher.optimalParams.get(paramName);

    if (!fisherDiag || !optimalParams) {
      return 0;
    }

    const idx = i * this.weights.output[0].length + j;
    if (idx >= fisherDiag.length) {
      return 0;
    }

    const currentValue = this.weights.output[i][j];
    const optimalValue = optimalParams[idx] ?? currentValue;

    return this.config.ewcLambda * fisherDiag[idx] * (currentValue - optimalValue);
  }

  /**
   * Compute EWC penalty for current parameters
   */
  private computeEWCPenalty(): number {
    let penalty = 0;

    for (const [paramName, fisherDiag] of this.fisher.diagonal) {
      const optimalParams = this.fisher.optimalParams.get(paramName);
      if (!optimalParams) continue;

      for (let i = 0; i < fisherDiag.length; i++) {
        const currentValue = this.getParamValue(paramName, i);
        const optimalValue = optimalParams[i];
        penalty += fisherDiag[i] * Math.pow(currentValue - optimalValue, 2);
      }
    }

    return 0.5 * this.config.ewcLambda * penalty;
  }

  private getParamValue(paramName: string, idx: number): number {
    const weights = this.weights[paramName as keyof typeof this.weights];
    if (!weights) return 0;

    const cols = weights[0].length;
    const i = Math.floor(idx / cols);
    const j = idx % cols;

    return weights[i]?.[j] ?? 0;
  }

  /**
   * Update Fisher Information after training
   */
  updateFisher(events: TemporalEvent[]): void {
    // Compute diagonal Fisher information
    const outputFisher = new Array(
      this.weights.output.length * this.weights.output[0].length
    ).fill(0);

    for (const event of events) {
      const features = extractEventFeatures(event);
      const _input = this.padFeatures(features, this.config.inputDim);

      // Compute gradient magnitude
      const finalHidden = this.state.hidden[this.config.numLayers - 1];
      const logits = this.matmul(finalHidden, this.weights.output);
      const probs = this.softmax(logits);

      const targetIdx = this.getEntryTypeIndex(event.entryType);
      const grad = [...probs];
      grad[targetIdx] -= 1;

      for (let i = 0; i < this.weights.output.length; i++) {
        for (let j = 0; j < this.weights.output[i].length; j++) {
          const idx = i * this.weights.output[i].length + j;
          const g = finalHidden[i] * grad[j];
          outputFisher[idx] += g * g;
        }
      }
    }

    // Normalize
    for (let i = 0; i < outputFisher.length; i++) {
      outputFisher[i] /= events.length;
    }

    // Store Fisher information
    this.fisher.diagonal.set('output', outputFisher);
    this.fisher.optimalParams.set('output', this.weights.output.flat());
    this.fisher.sampleCount = events.length;
    this.fisher.computedAt = Date.now();
  }

  /**
   * Reset hidden state
   */
  reset(): void {
    this.state = {
      hidden: Array(this.config.numLayers)
        .fill(null)
        .map(() => new Array(this.config.hiddenDim).fill(0)),
      lastUpdate: Date.now(),
      position: 0,
    };
    this.eventHistory = [];
  }

  /**
   * Get current state summary
   */
  getStateSummary(): {
    position: number;
    historyLength: number;
    lastUpdate: number;
    hiddenNorm: number;
    trainingMetrics: TrainingMetrics;
  } {
    const hiddenNorm = Math.sqrt(
      this.state.hidden.flat().reduce((sum, v) => sum + v * v, 0)
    );

    return {
      position: this.state.position,
      historyLength: this.eventHistory.length,
      lastUpdate: this.state.lastUpdate,
      hiddenNorm,
      trainingMetrics: { ...this.trainingMetrics },
    };
  }

  /**
   * Export model for persistence
   */
  exportModel(): {
    config: GRNNConfig;
    weights: typeof this.weights;
    fisher: {
      diagonal: Array<[string, number[]]>;
      optimalParams: Array<[string, number[]]>;
      sampleCount: number;
      computedAt: number;
    };
    trainingMetrics: TrainingMetrics;
  } {
    return {
      config: this.config,
      weights: JSON.parse(JSON.stringify(this.weights)),
      fisher: {
        diagonal: Array.from(this.fisher.diagonal.entries()),
        optimalParams: Array.from(this.fisher.optimalParams.entries()),
        sampleCount: this.fisher.sampleCount,
        computedAt: this.fisher.computedAt,
      },
      trainingMetrics: { ...this.trainingMetrics },
    };
  }

  /**
   * Import model from persistence
   */
  importModel(data: ReturnType<typeof this.exportModel>): void {
    this.config = data.config;
    this.weights = data.weights;
    this.fisher = {
      diagonal: new Map(data.fisher.diagonal),
      optimalParams: new Map(data.fisher.optimalParams),
      sampleCount: data.fisher.sampleCount,
      computedAt: data.fisher.computedAt,
    };
    this.trainingMetrics = data.trainingMetrics;
    this.reset();
  }

  // ============================================================================
  // Utility Functions
  // ============================================================================

  private extractEntryFeatures(entry: CacheEntry): number[] {
    const features: number[] = [];

    // Entry type encoding
    const typeIdx = this.getEntryTypeIndex(entry.type);
    for (let i = 0; i < 9; i++) {
      features.push(i === typeIdx ? 1 : 0);
    }

    // Relevance components
    if (entry.relevance) {
      features.push(entry.relevance.overall);
      features.push(entry.relevance.components.recency);
      features.push(entry.relevance.components.frequency);
      features.push(entry.relevance.components.semantic);
      features.push(entry.relevance.components.attention);
    } else {
      features.push(0.5, 0.5, 0.5, 0.5, 0.5);
    }

    // Temporal features
    const ageMs = Date.now() - entry.timestamp;
    features.push(Math.exp(-ageMs / (10 * 60 * 1000)));

    // Access count
    features.push(Math.log10(entry.accessCount + 1) / 3);

    return this.padFeatures(features, this.config.hiddenDim);
  }

  private padFeatures(features: number[], targetDim: number): number[] {
    if (features.length >= targetDim) {
      return features.slice(0, targetDim);
    }
    return [...features, ...new Array(targetDim - features.length).fill(0)];
  }

  private getEntryTypeIndex(type: CacheEntryType): number {
    const types: CacheEntryType[] = [
      'system_prompt', 'claude_md', 'file_read', 'file_write',
      'tool_result', 'bash_output', 'user_message', 'assistant_message', 'mcp_context'
    ];
    return types.indexOf(type);
  }

  private matmul(vector: number[], matrix: number[][]): number[] {
    const outputDim = matrix[0]?.length ?? 0;
    const result = new Array(outputDim).fill(0);

    for (let j = 0; j < outputDim; j++) {
      for (let i = 0; i < vector.length && i < matrix.length; i++) {
        result[j] += vector[i] * (matrix[i]?.[j] ?? 0);
      }
    }

    return result;
  }

  private sigmoid(values: number[]): number[] {
    return values.map(v => 1 / (1 + Math.exp(-v)));
  }

  private tanh(values: number[]): number[] {
    return values.map(v => Math.tanh(v));
  }

  private softmax(values: number[]): number[] {
    const max = Math.max(...values);
    const exps = values.map(v => Math.exp(v - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map(e => e / sum);
  }

  private applyDropout(values: number[]): number[] {
    const scale = 1 / (1 - this.config.dropout);
    return values.map(v =>
      Math.random() > this.config.dropout ? v * scale : 0
    );
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    const len = Math.min(a.length, b.length);

    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }

  private computeConfidence(probs: number[]): number {
    // Entropy-based confidence (lower entropy = higher confidence)
    let entropy = 0;
    for (const p of probs) {
      if (p > 0) {
        entropy -= p * Math.log(p);
      }
    }
    const maxEntropy = Math.log(probs.length);
    return 1 - entropy / maxEntropy;
  }
}

/**
 * Create a new FastGRNN instance
 */
export function createFastGRNN(config?: Partial<GRNNConfig>): FastGRNN {
  return new FastGRNN(config);
}
