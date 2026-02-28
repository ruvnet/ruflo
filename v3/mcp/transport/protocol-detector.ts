/**
 * Protocol Detector for Claude Flow V3 Transport Layer
 *
 * Enhanced protocol detection to support batch requests alongside single requests.
 * Implements intelligent routing based on request patterns and transport capabilities.
 *
 * @module @claude-flow/cli/transport/protocol-detector
 * @version 3.0.0
 */

import { EventEmitter } from 'events';
import type {
  TransportProtocol,
  DetectionResult,
  BatchDetectionContext,
  ProtocolCapabilities,
  RequestPattern,
  TransportMetrics
} from './types.js';

/**
 * Protocol detection configuration
 */
export interface ProtocolDetectorConfig {
  /** Enable batch request detection */
  enableBatchDetection: boolean;
  /** Maximum batch size threshold for automatic detection */
  batchThreshold: number;
  /** Transport-specific capabilities */
  transportCapabilities: Map<TransportProtocol, ProtocolCapabilities>;
  /** Request pattern analysis window (ms) */
  analysisWindow: number;
  /** Performance monitoring enabled */
  enableMetrics: boolean;
}

/**
 * Default configuration optimized for Claude Flow V3
 */
const DEFAULT_CONFIG: ProtocolDetectorConfig = {
  enableBatchDetection: true,
  batchThreshold: 3, // Detect batches of 3+ requests
  transportCapabilities: new Map([
    ['stdio', { supportsBatch: true, maxBatchSize: 50, latencyMs: 5 }],
    ['http', { supportsBatch: true, maxBatchSize: 100, latencyMs: 20 }],
    ['websocket', { supportsBatch: true, maxBatchSize: 200, latencyMs: 10 }],
  ]),
  analysisWindow: 1000, // 1 second analysis window
  enableMetrics: true,
};

/**
 * Advanced Protocol Detector
 *
 * Detects and routes requests between single and batch processing modes.
 * Optimizes transport selection based on request patterns and performance metrics.
 */
export class ProtocolDetector extends EventEmitter {
  private config: ProtocolDetectorConfig;
  private requestBuffer: Array<{ request: unknown; timestamp: number; transport: TransportProtocol }> = [];
  private metrics: TransportMetrics;
  private analysisTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<ProtocolDetectorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.metrics = this.initializeMetrics();

    // Start periodic analysis if batch detection enabled
    if (this.config.enableBatchDetection) {
      this.startPeriodicAnalysis();
    }
  }

  /**
   * Detect protocol and routing strategy for incoming request
   */
  async detect(
    request: unknown,
    transport: TransportProtocol,
    context?: BatchDetectionContext
  ): Promise<DetectionResult> {
    const timestamp = Date.now();
    const startTime = performance.now();

    try {
      // Add to analysis buffer
      this.requestBuffer.push({ request, timestamp, transport });

      // Clean old requests outside analysis window
      this.cleanRequestBuffer(timestamp);

      // Analyze request pattern
      const pattern = this.analyzeRequestPattern(request, transport, context);

      // Determine optimal processing mode
      const processingMode = this.determineProcessingMode(pattern, transport);

      // Update metrics
      this.updateMetrics(transport, processingMode, performance.now() - startTime);

      const result: DetectionResult = {
        transport,
        processingMode,
        pattern,
        confidence: this.calculateConfidence(pattern, transport),
        recommendations: this.generateRecommendations(pattern, transport),
        metrics: this.getRecentMetrics(transport),
      };

      this.emit('detection', result);
      return result;

    } catch (error) {
      this.emit('error', error);

      // Fallback to single request processing
      return {
        transport,
        processingMode: 'single',
        pattern: { type: 'single', complexity: 'low', priority: 'normal' },
        confidence: 0.5,
        recommendations: ['fallback-single-processing'],
        metrics: this.getRecentMetrics(transport),
      };
    }
  }

  /**
   * Analyze request pattern for batch optimization
   */
  private analyzeRequestPattern(
    request: unknown,
    transport: TransportProtocol,
    context?: BatchDetectionContext
  ): RequestPattern {
    const recentRequests = this.getRecentRequests(transport);
    const requestSize = this.estimateRequestSize(request);
    const complexity = this.assessComplexity(request, context);

    // Detect if this is part of a potential batch
    const batchCandidate = this.detectBatchCandidate(recentRequests, request);

    return {
      type: batchCandidate ? 'batch-candidate' : 'single',
      complexity,
      priority: this.derivePriority(request, context),
      size: requestSize,
      relatedRequests: batchCandidate ? recentRequests.length : 0,
      batchPotential: this.calculateBatchPotential(recentRequests, transport),
    };
  }

  /**
   * Determine optimal processing mode based on pattern analysis
   */
  private determineProcessingMode(
    pattern: RequestPattern,
    transport: TransportProtocol
  ): 'single' | 'batch' {
    const capabilities = this.config.transportCapabilities.get(transport);

    if (!capabilities?.supportsBatch) {
      return 'single';
    }

    // Force batch mode for batch candidates above threshold
    if (pattern.type === 'batch-candidate' &&
        pattern.relatedRequests >= this.config.batchThreshold) {
      return 'batch';
    }

    // Use batch mode for high-volume, low-complexity requests
    if (pattern.complexity === 'low' &&
        pattern.batchPotential > 0.7 &&
        pattern.relatedRequests >= 2) {
      return 'batch';
    }

    // Use single mode for high-priority or complex requests
    if (pattern.priority === 'critical' || pattern.complexity === 'high') {
      return 'single';
    }

    return 'single';
  }

  /**
   * Calculate confidence score for detection result
   */
  private calculateConfidence(pattern: RequestPattern, transport: TransportProtocol): number {
    let confidence = 0.5; // Base confidence

    // Increase confidence based on pattern clarity
    if (pattern.type === 'batch-candidate' && pattern.relatedRequests >= this.config.batchThreshold) {
      confidence += 0.3;
    }

    // Adjust based on transport capabilities
    const capabilities = this.config.transportCapabilities.get(transport);
    if (capabilities?.supportsBatch) {
      confidence += 0.1;
    }

    // Factor in historical performance
    const recentMetrics = this.getRecentMetrics(transport);
    if (recentMetrics && recentMetrics.successRate > 0.9) {
      confidence += 0.1;
    }

    return Math.min(1.0, confidence);
  }

  /**
   * Generate optimization recommendations
   */
  private generateRecommendations(
    pattern: RequestPattern,
    transport: TransportProtocol
  ): string[] {
    const recommendations: string[] = [];
    const capabilities = this.config.transportCapabilities.get(transport);

    if (pattern.type === 'batch-candidate') {
      if (capabilities?.supportsBatch) {
        recommendations.push('use-batch-processing');
        recommendations.push(`batch-size-${Math.min(pattern.relatedRequests + 1, capabilities.maxBatchSize)}`);
      } else {
        recommendations.push('consider-transport-upgrade');
      }
    }

    if (pattern.complexity === 'high') {
      recommendations.push('single-request-optimization');
      recommendations.push('increase-timeout');
    }

    if (pattern.batchPotential > 0.8) {
      recommendations.push('implement-request-queuing');
    }

    return recommendations;
  }

  /**
   * Detect if request is part of a batch candidate pattern
   */
  private detectBatchCandidate(
    recentRequests: Array<{ request: unknown; timestamp: number }>,
    currentRequest: unknown
  ): boolean {
    if (recentRequests.length < 2) return false;

    // Check for similar request patterns
    const similarity = this.calculateRequestSimilarity(recentRequests, currentRequest);

    // Check for rapid succession (requests within short time window)
    const rapidSuccession = recentRequests.some(r =>
      Date.now() - r.timestamp < 500 // 500ms window
    );

    return similarity > 0.7 || rapidSuccession;
  }

  /**
   * Calculate potential for batch processing
   */
  private calculateBatchPotential(
    recentRequests: Array<{ request: unknown; timestamp: number }>,
    transport: TransportProtocol
  ): number {
    if (recentRequests.length === 0) return 0;

    const capabilities = this.config.transportCapabilities.get(transport);
    if (!capabilities?.supportsBatch) return 0;

    // Factor in request frequency
    const avgInterval = this.calculateAverageInterval(recentRequests);
    const frequencyScore = Math.min(1.0, 1000 / avgInterval); // Higher frequency = higher score

    // Factor in transport efficiency
    const transportScore = capabilities.maxBatchSize / 100; // Normalize to 0-1

    // Factor in recent success rate
    const metrics = this.getRecentMetrics(transport);
    const reliabilityScore = metrics?.successRate || 0.5;

    return (frequencyScore * 0.4 + transportScore * 0.3 + reliabilityScore * 0.3);
  }

  /**
   * Assess request complexity for routing decisions
   */
  private assessComplexity(request: unknown, context?: BatchDetectionContext): 'low' | 'medium' | 'high' {
    // Analyze request structure and context
    const size = this.estimateRequestSize(request);
    const hasComplexPayload = this.detectComplexPayload(request);

    if (context?.requiresImmediateResponse || size > 10000 || hasComplexPayload) {
      return 'high';
    }

    if (size > 1000 || context?.hasNestedOperations) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Derive request priority from content and context
   */
  private derivePriority(request: unknown, context?: BatchDetectionContext): 'low' | 'normal' | 'high' | 'critical' {
    if (context?.priority) return context.priority;

    // Analyze request for priority indicators
    const requestStr = JSON.stringify(request);

    if (requestStr.includes('critical') || requestStr.includes('urgent')) {
      return 'critical';
    }

    if (requestStr.includes('high') || requestStr.includes('priority')) {
      return 'high';
    }

    return 'normal';
  }

  /**
   * Utility methods for analysis
   */
  private getRecentRequests(transport: TransportProtocol) {
    const cutoff = Date.now() - this.config.analysisWindow;
    return this.requestBuffer
      .filter(r => r.transport === transport && r.timestamp > cutoff)
      .map(r => ({ request: r.request, timestamp: r.timestamp }));
  }

  private cleanRequestBuffer(currentTime: number): void {
    const cutoff = currentTime - this.config.analysisWindow * 2; // Keep 2x window for analysis
    this.requestBuffer = this.requestBuffer.filter(r => r.timestamp > cutoff);
  }

  private estimateRequestSize(request: unknown): number {
    return JSON.stringify(request).length;
  }

  private detectComplexPayload(request: unknown): boolean {
    const requestStr = JSON.stringify(request);
    return requestStr.includes('nested') ||
           requestStr.includes('complex') ||
           requestStr.includes('batch') ||
           (requestStr.match(/\{/g) || []).length > 5; // Multiple nested objects
  }

  private calculateRequestSimilarity(
    recentRequests: Array<{ request: unknown }>,
    currentRequest: unknown
  ): number {
    if (recentRequests.length === 0) return 0;

    const currentStr = JSON.stringify(currentRequest);
    const similarities = recentRequests.map(r => {
      const recentStr = JSON.stringify(r.request);
      return this.levenshteinSimilarity(currentStr, recentStr);
    });

    return Math.max(...similarities);
  }

  private levenshteinSimilarity(s1: string, s2: string): number {
    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return 1;

    const distance = this.levenshteinDistance(s1, s2);
    return 1 - (distance / maxLen);
  }

  private levenshteinDistance(s1: string, s2: string): number {
    if (s1.length === 0) return s2.length;
    if (s2.length === 0) return s1.length;

    const matrix = Array(s2.length + 1).fill(null).map(() => Array(s1.length + 1).fill(null));

    for (let i = 0; i <= s1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= s2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= s2.length; j++) {
      for (let i = 1; i <= s1.length; i++) {
        if (s1[i - 1] === s2[j - 1]) {
          matrix[j][i] = matrix[j - 1][i - 1];
        } else {
          matrix[j][i] = Math.min(
            matrix[j - 1][i] + 1,    // deletion
            matrix[j][i - 1] + 1,    // insertion
            matrix[j - 1][i - 1] + 1  // substitution
          );
        }
      }
    }

    return matrix[s2.length][s1.length];
  }

  private calculateAverageInterval(
    requests: Array<{ timestamp: number }>
  ): number {
    if (requests.length < 2) return 1000; // Default 1 second

    const intervals = [];
    for (let i = 1; i < requests.length; i++) {
      intervals.push(requests[i].timestamp - requests[i-1].timestamp);
    }

    return intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
  }

  /**
   * Metrics and monitoring
   */
  private initializeMetrics(): TransportMetrics {
    return {
      requestCounts: new Map(),
      successRates: new Map(),
      averageLatencies: new Map(),
      batchEfficiency: new Map(),
      errorRates: new Map(),
    };
  }

  private updateMetrics(
    transport: TransportProtocol,
    mode: 'single' | 'batch',
    latency: number
  ): void {
    if (!this.config.enableMetrics) return;

    const key = `${transport}-${mode}`;

    // Update request counts
    this.metrics.requestCounts.set(key, (this.metrics.requestCounts.get(key) || 0) + 1);

    // Update average latency
    const currentLatency = this.metrics.averageLatencies.get(key) || 0;
    const count = this.metrics.requestCounts.get(key) || 1;
    this.metrics.averageLatencies.set(key, (currentLatency * (count - 1) + latency) / count);
  }

  private getRecentMetrics(transport: TransportProtocol) {
    const singleKey = `${transport}-single`;
    const batchKey = `${transport}-batch`;

    return {
      singleRequests: this.metrics.requestCounts.get(singleKey) || 0,
      batchRequests: this.metrics.requestCounts.get(batchKey) || 0,
      averageLatency: this.metrics.averageLatencies.get(singleKey) || 0,
      batchLatency: this.metrics.averageLatencies.get(batchKey) || 0,
      successRate: this.metrics.successRates.get(transport) || 0.9,
    };
  }

  private startPeriodicAnalysis(): void {
    this.analysisTimer = setInterval(() => {
      this.performPeriodicAnalysis();
    }, this.config.analysisWindow);
  }

  private performPeriodicAnalysis(): void {
    // Analyze patterns and emit insights
    const insights = this.analyzePatterns();
    if (insights.length > 0) {
      this.emit('insights', insights);
    }
  }

  private analyzePatterns(): string[] {
    const insights: string[] = [];

    // Analyze batch potential across transports
    for (const [transport, capabilities] of this.config.transportCapabilities) {
      const recentRequests = this.getRecentRequests(transport);
      if (recentRequests.length >= this.config.batchThreshold) {
        const batchPotential = this.calculateBatchPotential(recentRequests, transport);
        if (batchPotential > 0.8) {
          insights.push(`high-batch-potential-${transport}`);
        }
      }
    }

    return insights;
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
      this.analysisTimer = null;
    }

    this.requestBuffer = [];
    this.removeAllListeners();
  }
}

/**
 * Factory function for creating protocol detector
 */
export function createProtocolDetector(
  config?: Partial<ProtocolDetectorConfig>
): ProtocolDetector {
  return new ProtocolDetector(config);
}

export default ProtocolDetector;