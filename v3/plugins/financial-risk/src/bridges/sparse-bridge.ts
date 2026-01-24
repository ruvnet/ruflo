/**
 * Sparse Bridge - Financial Risk Plugin
 *
 * Provides sparse inference capabilities for efficient processing
 * of high-dimensional financial data. Integrates with
 * ruvector-sparse-inference-wasm for anomaly detection and
 * market regime classification.
 *
 * Features:
 * - Efficient sparse feature processing
 * - Transaction anomaly detection
 * - Market regime classification
 * - Real-time fraud detection
 */

import type {
  SparseBridge,
  SparseConfig,
  FinancialTransaction,
  DetectedAnomaly,
  AnomalySeverity,
  MarketRegimeType,
  Logger,
} from '../types.js';

/**
 * Default logger
 */
const defaultLogger: Logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => console.debug(`[sparse-bridge] ${msg}`, meta),
  info: (msg: string, meta?: Record<string, unknown>) => console.info(`[sparse-bridge] ${msg}`, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => console.warn(`[sparse-bridge] ${msg}`, meta),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(`[sparse-bridge] ${msg}`, meta),
};

/**
 * WASM module interface for ruvector-sparse-inference-wasm
 */
interface SparseWasmModule {
  create_sparse_model(inputDim: number, hiddenDim: number, sparsity: number): number;
  sparse_forward(modelPtr: number, features: Float32Array, indices: Uint32Array): Float32Array;
  detect_anomalies(modelPtr: number, data: Float32Array, numSamples: number, featureDim: number, threshold: number): Uint32Array;
  classify_regime(modelPtr: number, marketData: Float32Array, windowSize: number): number;
  free_model(modelPtr: number): void;
  memory: { buffer: ArrayBuffer };
}

/**
 * Anomaly detection using Isolation Forest-like approach
 */
export class AnomalyDetector {
  constructor(
    _numTrees: number = 100,
    _sampleSize: number = 256,
    _maxDepth: number = 8
  ) {
    // Parameters reserved for future Isolation Forest implementation
  }

  /**
   * Calculate anomaly scores for transactions
   */
  calculateAnomalyScores(transactions: FinancialTransaction[]): Map<string, number> {
    const scores = new Map<string, number>();
    const features = this.extractFeatures(transactions);

    for (let i = 0; i < transactions.length; i++) {
      const txn = transactions[i]!;
      const featureVector = features[i]!;
      const score = this.isolationScore(featureVector, features);
      scores.set(txn.id, score);
    }

    return scores;
  }

  /**
   * Detect anomalies above threshold
   */
  detectAnomalies(
    transactions: FinancialTransaction[],
    threshold: number = 0.8
  ): DetectedAnomaly[] {
    const scores = this.calculateAnomalyScores(transactions);
    const anomalies: DetectedAnomaly[] = [];

    for (const txn of transactions) {
      const score = scores.get(txn.id) ?? 0;

      if (score >= threshold) {
        anomalies.push({
          transactionId: txn.id,
          score,
          severity: this.scoresToSeverity(score),
          type: this.classifyAnomalyType(txn, score),
          description: this.generateDescription(txn, score),
          indicators: this.identifyIndicators(txn),
          recommendedAction: this.recommendAction(score),
        });
      }
    }

    // Sort by score descending
    anomalies.sort((a, b) => b.score - a.score);
    return anomalies;
  }

  private extractFeatures(transactions: FinancialTransaction[]): number[][] {
    return transactions.map(txn => {
      const hour = new Date(txn.timestamp).getHours();
      const dayOfWeek = new Date(txn.timestamp).getDay();

      return [
        Math.log(Math.abs(txn.amount) + 1), // Log-scaled amount
        txn.amount < 0 ? 1 : 0, // Debit indicator
        txn.parties.length, // Number of parties
        hour / 24, // Normalized hour
        dayOfWeek / 7, // Normalized day of week
        txn.amount > 10000 ? 1 : 0, // Large transaction flag
        txn.amount > 100000 ? 1 : 0, // Very large transaction flag
      ];
    });
  }

  private isolationScore(point: number[], allPoints: number[][]): number {
    // Simplified isolation score based on distance from median
    const numFeatures = point.length;
    let totalDeviation = 0;

    for (let f = 0; f < numFeatures; f++) {
      const values = allPoints.map(p => p[f]!).sort((a, b) => a - b);
      const median = values[Math.floor(values.length / 2)]!;
      const mad = this.medianAbsoluteDeviation(values, median);

      if (mad > 0) {
        totalDeviation += Math.abs(point[f]! - median) / mad;
      }
    }

    // Normalize score to [0, 1]
    const normalizedScore = 1 - Math.exp(-totalDeviation / (numFeatures * 3));
    return Math.min(Math.max(normalizedScore, 0), 1);
  }

  private medianAbsoluteDeviation(values: number[], median: number): number {
    const deviations = values.map(v => Math.abs(v - median));
    deviations.sort((a, b) => a - b);
    return deviations[Math.floor(deviations.length / 2)] ?? 1;
  }

  private scoresToSeverity(score: number): AnomalySeverity {
    if (score >= 0.95) return 'critical';
    if (score >= 0.85) return 'high';
    if (score >= 0.7) return 'medium';
    return 'low';
  }

  private classifyAnomalyType(txn: FinancialTransaction, score: number): string {
    if (Math.abs(txn.amount) > 100000) return 'large_transaction';
    if (txn.parties.length > 5) return 'multi_party';
    if (score > 0.9) return 'pattern_deviation';
    return 'unusual_activity';
  }

  private generateDescription(txn: FinancialTransaction, score: number): string {
    const amount = Math.abs(txn.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    return `Transaction ${txn.id} with amount ${amount} has anomaly score ${(score * 100).toFixed(1)}%`;
  }

  private identifyIndicators(txn: FinancialTransaction): string[] {
    const indicators: string[] = [];

    if (Math.abs(txn.amount) > 10000) indicators.push('large_amount');
    if (txn.parties.length > 3) indicators.push('multiple_parties');

    const hour = new Date(txn.timestamp).getHours();
    if (hour < 6 || hour > 22) indicators.push('unusual_time');

    const dayOfWeek = new Date(txn.timestamp).getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) indicators.push('weekend_transaction');

    return indicators;
  }

  private recommendAction(score: number): string {
    if (score >= 0.95) return 'Immediate escalation to compliance team required';
    if (score >= 0.85) return 'Flag for manual review within 24 hours';
    if (score >= 0.7) return 'Add to monitoring watchlist';
    return 'Continue standard monitoring';
  }
}

/**
 * Market regime classifier
 */
export class MarketRegimeClassifier {
  private readonly windowSize: number;

  constructor(windowSize: number = 20) {
    this.windowSize = windowSize;
  }

  /**
   * Classify current market regime
   */
  classify(prices: number[], volumes?: number[]): { regime: MarketRegimeType; confidence: number } {
    if (prices.length < this.windowSize) {
      return { regime: 'sideways', confidence: 0.5 };
    }

    const returns = this.calculateReturns(prices);
    const volatility = this.calculateVolatility(returns);
    const trend = this.calculateTrend(prices);
    const momentum = this.calculateMomentum(returns);

    // Regime classification logic
    const regime = this.determineRegime(trend, volatility, momentum);
    const confidence = this.calculateConfidence(trend, volatility, momentum);

    return { regime, confidence };
  }

  /**
   * Get regime probabilities
   */
  getRegimeProbabilities(prices: number[]): Record<MarketRegimeType, number> {
    const { regime, confidence } = this.classify(prices);

    // Distribute probability based on confidence
    const probs: Record<MarketRegimeType, number> = {
      bull: 0.1,
      bear: 0.1,
      sideways: 0.3,
      high_vol: 0.2,
      crisis: 0.1,
      recovery: 0.2,
    };

    // Increase probability for detected regime
    const totalOther = 1 - confidence;
    for (const r of Object.keys(probs) as MarketRegimeType[]) {
      if (r === regime) {
        probs[r] = confidence;
      } else {
        probs[r] = (totalOther * probs[r]) / (1 - probs[regime]);
      }
    }

    return probs;
  }

  private calculateReturns(prices: number[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i]! - prices[i - 1]!) / prices[i - 1]!);
    }
    return returns;
  }

  private calculateVolatility(returns: number[]): number {
    if (returns.length < 2) return 0;

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
    return Math.sqrt(variance) * Math.sqrt(252); // Annualized
  }

  private calculateTrend(prices: number[]): number {
    if (prices.length < 2) return 0;

    // Simple linear regression slope
    const n = prices.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += prices[i]!;
      sumXY += i * prices[i]!;
      sumX2 += i * i;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const avgPrice = sumY / n;

    return slope / avgPrice * 252; // Annualized trend
  }

  private calculateMomentum(returns: number[]): number {
    if (returns.length < this.windowSize) return 0;

    // Recent momentum vs historical
    const recent = returns.slice(-Math.floor(this.windowSize / 2));
    const historical = returns.slice(-this.windowSize, -Math.floor(this.windowSize / 2));

    const recentMean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const historicalMean = historical.reduce((a, b) => a + b, 0) / historical.length;

    return recentMean - historicalMean;
  }

  private determineRegime(trend: number, volatility: number, momentum: number): MarketRegimeType {
    // High volatility regimes
    if (volatility > 0.4) {
      if (trend < -0.3) return 'crisis';
      return 'high_vol';
    }

    // Trend-based regimes
    if (trend > 0.15) {
      return momentum > 0 ? 'bull' : 'recovery';
    }

    if (trend < -0.15) {
      return 'bear';
    }

    return 'sideways';
  }

  private calculateConfidence(trend: number, volatility: number, momentum: number): number {
    // Higher confidence for extreme values
    const trendStrength = Math.min(Math.abs(trend) / 0.3, 1);
    const volStrength = Math.min(volatility / 0.4, 1);
    const momStrength = Math.min(Math.abs(momentum) / 0.01, 1);

    return 0.4 + 0.6 * Math.max(trendStrength, volStrength, momStrength);
  }
}

/**
 * Financial Sparse Bridge implementation
 */
export class FinancialSparseBridge implements SparseBridge {
  private wasmModule: SparseWasmModule | null = null;
  private modelPtr: number = 0;
  private config: SparseConfig;
  private logger: Logger;
  private anomalyDetector: AnomalyDetector;
  private regimeClassifier: MarketRegimeClassifier;

  public initialized = false;

  constructor(config?: Partial<SparseConfig>, logger?: Logger) {
    this.config = {
      sparsityThreshold: config?.sparsityThreshold ?? 0.9,
      maxFeatures: config?.maxFeatures ?? 1000,
      compressionLevel: config?.compressionLevel ?? 3,
    };
    this.logger = logger ?? defaultLogger;
    this.anomalyDetector = new AnomalyDetector();
    this.regimeClassifier = new MarketRegimeClassifier();
  }

  /**
   * Initialize the sparse bridge
   */
  async initialize(config?: SparseConfig): Promise<void> {
    if (config) {
      this.config = { ...this.config, ...config };
    }

    try {
      const wasmPath = await this.resolveWasmPath();
      if (wasmPath) {
        this.wasmModule = await this.loadWasmModule(wasmPath);
        this.modelPtr = this.wasmModule.create_sparse_model(
          this.config.maxFeatures ?? 1000,
          256, // Hidden dimension
          this.config.sparsityThreshold ?? 0.9
        );
        this.logger.info('Sparse WASM module initialized', {
          maxFeatures: this.config.maxFeatures,
          sparsityThreshold: this.config.sparsityThreshold,
        });
      } else {
        this.logger.warn('WASM module not available, using JavaScript fallback');
      }

      this.initialized = true;
    } catch (error) {
      this.logger.warn('Failed to initialize WASM, using fallback', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.initialized = true;
    }
  }

  /**
   * Perform sparse inference on features
   */
  async sparseInference(features: Float32Array, indices: Uint32Array): Promise<Float32Array> {
    if (!this.initialized) {
      throw new Error('Sparse bridge not initialized');
    }

    if (this.wasmModule && this.modelPtr) {
      return this.wasmModule.sparse_forward(this.modelPtr, features, indices);
    }

    // Fallback: Simple linear projection
    const output = new Float32Array(128);
    for (let i = 0; i < indices.length && i < output.length; i++) {
      const idx = indices[i]!;
      if (idx < features.length) {
        output[i] = features[idx]! * 0.1; // Simple scaling
      }
    }

    return output;
  }

  /**
   * Detect anomalies in transactions
   */
  async detectAnomalies(transactions: Float32Array[], threshold: number): Promise<Uint32Array> {
    if (!this.initialized) {
      throw new Error('Sparse bridge not initialized');
    }

    if (this.wasmModule && this.modelPtr) {
      const numSamples = transactions.length;
      const featureDim = transactions[0]?.length ?? 0;

      if (numSamples === 0 || featureDim === 0) {
        return new Uint32Array(0);
      }

      // Flatten transactions
      const flatData = new Float32Array(numSamples * featureDim);
      for (let i = 0; i < numSamples; i++) {
        flatData.set(transactions[i]!, i * featureDim);
      }

      return this.wasmModule.detect_anomalies(
        this.modelPtr,
        flatData,
        numSamples,
        featureDim,
        threshold
      );
    }

    // Fallback: Use JavaScript anomaly detector
    // Convert Float32Array[] to FinancialTransaction[] for the detector
    // This is a simplified fallback - in production, pass actual transactions
    const anomalyIndices: number[] = [];

    for (let i = 0; i < transactions.length; i++) {
      const txn = transactions[i]!;
      // Simple anomaly heuristic based on feature magnitudes
      const magnitude = Math.sqrt(txn.reduce((sum, v) => sum + v * v, 0));
      if (magnitude > threshold * 10) {
        anomalyIndices.push(i);
      }
    }

    return new Uint32Array(anomalyIndices);
  }

  /**
   * Classify market regime from market data
   */
  async classifyRegime(marketData: Float32Array): Promise<{ regime: number; confidence: number }> {
    if (!this.initialized) {
      throw new Error('Sparse bridge not initialized');
    }

    if (this.wasmModule && this.modelPtr) {
      const regimeCode = this.wasmModule.classify_regime(
        this.modelPtr,
        marketData,
        20 // Window size
      );

      return {
        regime: regimeCode,
        confidence: 0.8, // WASM returns confidence separately in full implementation
      };
    }

    // Fallback: Use JavaScript classifier
    const prices = Array.from(marketData);
    const result = this.regimeClassifier.classify(prices);

    return {
      regime: this.regimeToCode(result.regime),
      confidence: result.confidence,
    };
  }

  /**
   * Detect anomalies in financial transactions
   */
  async detectTransactionAnomalies(
    transactions: FinancialTransaction[],
    threshold: number = 0.8
  ): Promise<DetectedAnomaly[]> {
    return this.anomalyDetector.detectAnomalies(transactions, threshold);
  }

  /**
   * Classify market regime from price data
   */
  async classifyMarketRegime(prices: number[], volumes?: number[]): Promise<{
    regime: MarketRegimeType;
    confidence: number;
    probabilities: Record<MarketRegimeType, number>;
  }> {
    const { regime, confidence } = this.regimeClassifier.classify(prices, volumes);
    const probabilities = this.regimeClassifier.getRegimeProbabilities(prices);

    return { regime, confidence, probabilities };
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.wasmModule && this.modelPtr) {
      this.wasmModule.free_model(this.modelPtr);
    }
    this.initialized = false;
  }

  // Private methods

  private async resolveWasmPath(): Promise<string | null> {
    try {
      const module = await import('ruvector-sparse-inference-wasm');
      return module.default ?? null;
    } catch {
      return null;
    }
  }

  private async loadWasmModule(wasmPath: string): Promise<SparseWasmModule> {
    const module = await import(wasmPath);
    await module.default();
    return module as SparseWasmModule;
  }

  private regimeToCode(regime: MarketRegimeType): number {
    const codes: Record<MarketRegimeType, number> = {
      bull: 0,
      bear: 1,
      sideways: 2,
      high_vol: 3,
      crisis: 4,
      recovery: 5,
    };
    return codes[regime] ?? 2;
  }
}

/**
 * Create a new sparse bridge instance
 */
export function createSparseBridge(config?: Partial<SparseConfig>, logger?: Logger): FinancialSparseBridge {
  return new FinancialSparseBridge(config, logger);
}

export default FinancialSparseBridge;
