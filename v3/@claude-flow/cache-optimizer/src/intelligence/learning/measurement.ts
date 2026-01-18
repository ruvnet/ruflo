/**
 * @claude-flow/cache-optimizer - Measurement & Metrics Collection
 *
 * Comprehensive metrics collection for GNN/GRNN intelligence layer.
 * Tracks learning performance, cache efficiency, and model health.
 */

import type { CacheEntry, CacheEntryType, TemporalTier } from '../../types.js';

// ============================================================================
// Types
// ============================================================================

export interface MetricValue {
  value: number;
  timestamp: number;
  tags?: Record<string, string>;
}

export interface TimeSeriesMetric {
  name: string;
  values: MetricValue[];
  aggregations: {
    min: number;
    max: number;
    mean: number;
    stdDev: number;
    p50: number;
    p95: number;
    p99: number;
  };
}

export interface LearningMetrics {
  // GNN Metrics
  gnn: {
    nodeCount: number;
    edgeCount: number;
    avgDegree: number;
    clusteringCoefficient: number;
    modularity: number;
    forwardPassLatency: TimeSeriesMetric;
    messagePassingIterations: number;
    embeddingDimension: number;
    layerActivations: number[];
  };

  // GRNN Metrics
  grnn: {
    sequenceLength: number;
    hiddenStateNorm: number;
    gradientNorm: number;
    trainingLoss: TimeSeriesMetric;
    validationLoss: TimeSeriesMetric;
    predictionAccuracy: TimeSeriesMetric;
    fisherInformationSum: number;
    ewcRegularization: number;
  };

  // Cache Efficiency
  cache: {
    hitRate: TimeSeriesMetric;
    missRate: TimeSeriesMetric;
    evictionRate: TimeSeriesMetric;
    tokenSavings: TimeSeriesMetric;
    tierDistribution: Record<TemporalTier, number>;
    typeDistribution: Record<CacheEntryType, number>;
    avgRelevanceScore: number;
    compressionRatio: number;
  };

  // Model Health
  health: {
    memoryUsage: number;
    cpuUsage: number;
    inferenceLatency: TimeSeriesMetric;
    throughput: TimeSeriesMetric;
    errorRate: number;
    lastTrainingTime: number;
    modelStaleness: number;
  };
}

export interface MetricSnapshot {
  timestamp: number;
  sessionId: string;
  metrics: LearningMetrics;
  annotations?: string[];
}

export interface MetricAlert {
  id: string;
  type: 'warning' | 'error' | 'critical';
  metric: string;
  threshold: number;
  currentValue: number;
  message: string;
  timestamp: number;
  resolved: boolean;
}

export interface MeasurementConfig {
  // Collection settings
  collectionInterval: number;      // ms between metric samples
  retentionPeriod: number;         // ms to retain historical data
  maxSamples: number;              // max samples per metric

  // Aggregation settings
  aggregationWindow: number;       // ms for rolling aggregations
  percentiles: number[];           // percentiles to compute

  // Alert thresholds
  alerts: {
    hitRateMin: number;            // alert if hit rate drops below
    latencyMax: number;            // alert if latency exceeds (ms)
    memoryMax: number;             // alert if memory exceeds (bytes)
    errorRateMax: number;          // alert if error rate exceeds
    staleness: number;             // alert if model older than (ms)
  };

  // Export settings
  enablePrometheus: boolean;       // export in Prometheus format
  enableJSON: boolean;             // export in JSON format
  exportPath?: string;             // path for metric exports
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: MeasurementConfig = {
  collectionInterval: 1000,        // 1 second
  retentionPeriod: 3600000,        // 1 hour
  maxSamples: 3600,                // 1 sample/second for 1 hour
  aggregationWindow: 60000,        // 1 minute rolling window
  percentiles: [50, 95, 99],
  alerts: {
    hitRateMin: 0.7,
    latencyMax: 100,
    memoryMax: 512 * 1024 * 1024,  // 512MB
    errorRateMax: 0.05,
    staleness: 3600000,            // 1 hour
  },
  enablePrometheus: true,
  enableJSON: true,
};

// ============================================================================
// Measurement Collector
// ============================================================================

export class MeasurementCollector {
  private config: MeasurementConfig;
  private metrics: Map<string, MetricValue[]> = new Map();
  private alerts: MetricAlert[] = [];
  private snapshots: MetricSnapshot[] = [];
  private sessionId: string;
  private startTime: number;
  public lastCollectionTime = 0;

  // Counters for rate metrics
  private counters = {
    hits: 0,
    misses: 0,
    evictions: 0,
    errors: 0,
    inferences: 0,
    trainings: 0,
  };

  constructor(config: Partial<MeasurementConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.startTime = Date.now();
  }

  // --------------------------------------------------------------------------
  // Core Recording Methods
  // --------------------------------------------------------------------------

  /**
   * Record a metric value
   */
  record(name: string, value: number, tags?: Record<string, string>): void {
    const metric = this.metrics.get(name) || [];

    metric.push({
      value,
      timestamp: Date.now(),
      tags,
    });

    // Enforce retention limit
    while (metric.length > this.config.maxSamples) {
      metric.shift();
    }

    this.metrics.set(name, metric);
    this.checkAlerts(name, value);
  }

  /**
   * Record a duration metric (latency)
   */
  recordDuration(name: string, startTime: number, tags?: Record<string, string>): void {
    const duration = Date.now() - startTime;
    this.record(name, duration, tags);
  }

  /**
   * Increment a counter
   */
  increment(counter: keyof typeof this.counters, amount = 1): void {
    this.counters[counter] += amount;
  }

  /**
   * Record cache hit
   */
  recordHit(entryId: string, relevance: number, tier: TemporalTier): void {
    this.increment('hits');
    this.record('cache.hit.relevance', relevance, { entryId, tier });
  }

  /**
   * Record cache miss
   */
  recordMiss(query: string): void {
    this.increment('misses');
    this.record('cache.miss', 1, { query });
  }

  /**
   * Record eviction
   */
  recordEviction(entryId: string, reason: string): void {
    this.increment('evictions');
    this.record('cache.eviction', 1, { entryId, reason });
  }

  /**
   * Record GNN forward pass
   */
  recordGNNForward(latency: number, nodeCount: number, edgeCount: number): void {
    this.record('gnn.forward.latency', latency);
    this.record('gnn.graph.nodes', nodeCount);
    this.record('gnn.graph.edges', edgeCount);
    this.increment('inferences');
  }

  /**
   * Record GRNN prediction
   */
  recordGRNNPrediction(latency: number, accuracy: number): void {
    this.record('grnn.prediction.latency', latency);
    this.record('grnn.prediction.accuracy', accuracy);
    this.increment('inferences');
  }

  /**
   * Record training step
   */
  recordTraining(loss: number, gradientNorm: number, duration: number): void {
    this.record('training.loss', loss);
    this.record('training.gradient_norm', gradientNorm);
    this.record('training.duration', duration);
    this.increment('trainings');
  }

  // --------------------------------------------------------------------------
  // Aggregation Methods
  // --------------------------------------------------------------------------

  /**
   * Compute aggregations for a metric
   */
  private computeAggregations(values: number[]): TimeSeriesMetric['aggregations'] {
    if (values.length === 0) {
      return { min: 0, max: 0, mean: 0, stdDev: 0, p50: 0, p95: 0, p99: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / values.length;

    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    const stdDev = Math.sqrt(variance);

    const percentile = (p: number) => {
      const idx = Math.floor((p / 100) * sorted.length);
      return sorted[Math.min(idx, sorted.length - 1)];
    };

    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean,
      stdDev,
      p50: percentile(50),
      p95: percentile(95),
      p99: percentile(99),
    };
  }

  /**
   * Get time series metric with aggregations
   */
  getTimeSeriesMetric(name: string): TimeSeriesMetric {
    const values = this.metrics.get(name) || [];
    const now = Date.now();

    // Filter to aggregation window
    const windowValues = values
      .filter(v => now - v.timestamp < this.config.aggregationWindow)
      .map(v => v.value);

    return {
      name,
      values,
      aggregations: this.computeAggregations(windowValues),
    };
  }

  /**
   * Compute rate from counter
   */
  private computeRate(counter: number, windowMs: number): number {
    const elapsed = Date.now() - this.startTime;
    if (elapsed === 0) return 0;
    return (counter / elapsed) * windowMs;
  }

  // --------------------------------------------------------------------------
  // Metrics Snapshot
  // --------------------------------------------------------------------------

  /**
   * Collect comprehensive metrics snapshot
   */
  collectSnapshot(
    gnnState?: {
      nodeCount: number;
      edgeCount: number;
      embeddingDim: number;
      layerActivations: number[];
    },
    grnnState?: {
      sequenceLength: number;
      hiddenStateNorm: number;
      fisherSum: number;
    },
    cacheState?: {
      entries: CacheEntry[];
      compressionRatio: number;
    }
  ): MetricSnapshot {
    const now = Date.now();
    const totalRequests = this.counters.hits + this.counters.misses;

    // Compute tier distribution
    const tierDistribution: Record<TemporalTier, number> = {
      hot: 0, warm: 0, cold: 0, archived: 0
    };

    const typeDistribution: Record<CacheEntryType, number> = {
      system_prompt: 0,
      claude_md: 0,
      file_read: 0,
      file_write: 0,
      tool_result: 0,
      bash_output: 0,
      user_message: 0,
      assistant_message: 0,
      mcp_context: 0,
    };

    if (cacheState?.entries) {
      for (const entry of cacheState.entries) {
        tierDistribution[entry.tier]++;
        typeDistribution[entry.type]++;
      }
    }

    const metrics: LearningMetrics = {
      gnn: {
        nodeCount: gnnState?.nodeCount || 0,
        edgeCount: gnnState?.edgeCount || 0,
        avgDegree: gnnState?.nodeCount
          ? (gnnState.edgeCount * 2) / gnnState.nodeCount
          : 0,
        clusteringCoefficient: this.getLatestValue('gnn.clustering') || 0,
        modularity: this.getLatestValue('gnn.modularity') || 0,
        forwardPassLatency: this.getTimeSeriesMetric('gnn.forward.latency'),
        messagePassingIterations: this.getLatestValue('gnn.message_passing.iterations') || 0,
        embeddingDimension: gnnState?.embeddingDim || 64,
        layerActivations: gnnState?.layerActivations || [],
      },
      grnn: {
        sequenceLength: grnnState?.sequenceLength || 0,
        hiddenStateNorm: grnnState?.hiddenStateNorm || 0,
        gradientNorm: this.getLatestValue('training.gradient_norm') || 0,
        trainingLoss: this.getTimeSeriesMetric('training.loss'),
        validationLoss: this.getTimeSeriesMetric('validation.loss'),
        predictionAccuracy: this.getTimeSeriesMetric('grnn.prediction.accuracy'),
        fisherInformationSum: grnnState?.fisherSum || 0,
        ewcRegularization: this.getLatestValue('training.ewc_reg') || 0,
      },
      cache: {
        hitRate: this.createRateMetric('hit_rate',
          totalRequests > 0 ? this.counters.hits / totalRequests : 0),
        missRate: this.createRateMetric('miss_rate',
          totalRequests > 0 ? this.counters.misses / totalRequests : 0),
        evictionRate: this.createRateMetric('eviction_rate',
          this.computeRate(this.counters.evictions, 60000)),
        tokenSavings: this.getTimeSeriesMetric('cache.token_savings'),
        tierDistribution,
        typeDistribution,
        avgRelevanceScore: this.getTimeSeriesMetric('cache.hit.relevance').aggregations.mean,
        compressionRatio: cacheState?.compressionRatio || 1,
      },
      health: {
        memoryUsage: process.memoryUsage?.().heapUsed || 0,
        cpuUsage: this.getLatestValue('system.cpu') || 0,
        inferenceLatency: this.getTimeSeriesMetric('inference.latency'),
        throughput: this.createRateMetric('throughput',
          this.computeRate(this.counters.inferences, 1000)),
        errorRate: this.counters.inferences > 0
          ? this.counters.errors / this.counters.inferences
          : 0,
        lastTrainingTime: this.getLatestValue('training.timestamp') || 0,
        modelStaleness: now - (this.getLatestValue('training.timestamp') || this.startTime),
      },
    };

    const snapshot: MetricSnapshot = {
      timestamp: now,
      sessionId: this.sessionId,
      metrics,
    };

    // Store snapshot with retention
    this.snapshots.push(snapshot);
    while (this.snapshots.length > 100) {
      this.snapshots.shift();
    }

    this.lastCollectionTime = now;
    return snapshot;
  }

  // --------------------------------------------------------------------------
  // Helper Methods
  // --------------------------------------------------------------------------

  private getLatestValue(name: string): number | undefined {
    const values = this.metrics.get(name);
    if (!values || values.length === 0) return undefined;
    return values[values.length - 1].value;
  }

  private createRateMetric(name: string, currentRate: number): TimeSeriesMetric {
    return {
      name,
      values: [{ value: currentRate, timestamp: Date.now() }],
      aggregations: {
        min: currentRate,
        max: currentRate,
        mean: currentRate,
        stdDev: 0,
        p50: currentRate,
        p95: currentRate,
        p99: currentRate,
      },
    };
  }

  // --------------------------------------------------------------------------
  // Alerting
  // --------------------------------------------------------------------------

  private checkAlerts(metric: string, value: number): void {
    const { alerts } = this.config;
    let alert: MetricAlert | null = null;

    if (metric === 'cache.hit_rate' && value < alerts.hitRateMin) {
      alert = this.createAlert('warning', metric, alerts.hitRateMin, value,
        `Cache hit rate (${(value * 100).toFixed(1)}%) below threshold`);
    }

    if (metric.includes('latency') && value > alerts.latencyMax) {
      alert = this.createAlert('warning', metric, alerts.latencyMax, value,
        `Latency (${value.toFixed(1)}ms) exceeds threshold`);
    }

    if (metric === 'system.memory' && value > alerts.memoryMax) {
      alert = this.createAlert('error', metric, alerts.memoryMax, value,
        `Memory usage (${(value / 1024 / 1024).toFixed(1)}MB) exceeds limit`);
    }

    if (alert) {
      this.alerts.push(alert);
      // Keep last 100 alerts
      while (this.alerts.length > 100) {
        this.alerts.shift();
      }
    }
  }

  private createAlert(
    type: MetricAlert['type'],
    metric: string,
    threshold: number,
    currentValue: number,
    message: string
  ): MetricAlert {
    return {
      id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      metric,
      threshold,
      currentValue,
      message,
      timestamp: Date.now(),
      resolved: false,
    };
  }

  getActiveAlerts(): MetricAlert[] {
    return this.alerts.filter(a => !a.resolved);
  }

  resolveAlert(alertId: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
    }
  }

  // --------------------------------------------------------------------------
  // Export Methods
  // --------------------------------------------------------------------------

  /**
   * Export metrics in Prometheus format
   */
  exportPrometheus(): string {
    const lines: string[] = [];
    const prefix = 'claude_flow_cache';

    for (const [name, values] of this.metrics) {
      if (values.length === 0) continue;

      const latest = values[values.length - 1];
      const sanitizedName = name.replace(/\./g, '_');

      lines.push(`# HELP ${prefix}_${sanitizedName} ${name}`);
      lines.push(`# TYPE ${prefix}_${sanitizedName} gauge`);

      const labels = latest.tags
        ? Object.entries(latest.tags)
            .map(([k, v]) => `${k}="${v}"`)
            .join(',')
        : '';

      lines.push(`${prefix}_${sanitizedName}${labels ? `{${labels}}` : ''} ${latest.value}`);
    }

    return lines.join('\n');
  }

  /**
   * Export metrics in JSON format
   */
  exportJSON(): string {
    const snapshot = this.collectSnapshot();
    return JSON.stringify(snapshot, null, 2);
  }

  /**
   * Get historical snapshots
   */
  getSnapshots(limit = 10): MetricSnapshot[] {
    return this.snapshots.slice(-limit);
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics.clear();
    this.alerts = [];
    this.snapshots = [];
    this.counters = {
      hits: 0,
      misses: 0,
      evictions: 0,
      errors: 0,
      inferences: 0,
      trainings: 0,
    };
    this.startTime = Date.now();
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    uptime: number;
    totalRequests: number;
    hitRate: number;
    avgLatency: number;
    errorRate: number;
    activeAlerts: number;
  } {
    const totalRequests = this.counters.hits + this.counters.misses;
    const latencyMetric = this.getTimeSeriesMetric('inference.latency');

    return {
      uptime: Date.now() - this.startTime,
      totalRequests,
      hitRate: totalRequests > 0 ? this.counters.hits / totalRequests : 0,
      avgLatency: latencyMetric.aggregations.mean,
      errorRate: this.counters.inferences > 0
        ? this.counters.errors / this.counters.inferences
        : 0,
      activeAlerts: this.getActiveAlerts().length,
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createMeasurementCollector(
  config?: Partial<MeasurementConfig>
): MeasurementCollector {
  return new MeasurementCollector(config);
}

// ============================================================================
// Metric Decorators (for automatic instrumentation)
// ============================================================================

/**
 * Decorator to measure function execution time
 */
export function measureDuration(collector: MeasurementCollector, metricName: string) {
  return function <T extends (...args: unknown[]) => unknown>(
    _target: unknown,
    _propertyKey: string,
    descriptor: TypedPropertyDescriptor<T>
  ): TypedPropertyDescriptor<T> {
    const originalMethod = descriptor.value!;

    descriptor.value = function (this: unknown, ...args: unknown[]) {
      const start = Date.now();
      const result = originalMethod.apply(this, args);

      if (result instanceof Promise) {
        return result.finally(() => {
          collector.recordDuration(metricName, start);
        }) as ReturnType<T>;
      }

      collector.recordDuration(metricName, start);
      return result;
    } as T;

    return descriptor;
  };
}
