/**
 * @claude-flow/cache-optimizer - Benchmarking & Metrics
 * Performance measurement and telemetry collection
 */

import type {
  CacheMetrics,
  LatencyMetrics,
  PercentileMetrics,
  BenchmarkConfig,
  CacheOptimizerConfig,
} from '../types.js';
import { DEFAULT_CONFIG } from '../types.js';
import type { CacheOptimizer } from '../core/orchestrator.js';

/**
 * Latency tracker for percentile calculations
 */
export class LatencyTracker {
  private samples: number[] = [];
  private maxSamples: number;

  constructor(maxSamples: number = 1000) {
    this.maxSamples = maxSamples;
  }

  record(latencyMs: number): void {
    this.samples.push(latencyMs);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  getPercentiles(): PercentileMetrics {
    if (this.samples.length === 0) {
      return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0, count: 0 };
    }

    const sorted = [...this.samples].sort((a, b) => a - b);
    const len = sorted.length;

    return {
      p50: sorted[Math.floor(len * 0.5)],
      p95: sorted[Math.floor(len * 0.95)],
      p99: sorted[Math.floor(len * 0.99)],
      min: sorted[0],
      max: sorted[len - 1],
      avg: sorted.reduce((a, b) => a + b, 0) / len,
      count: len,
    };
  }

  reset(): void {
    this.samples = [];
  }
}

/**
 * Benchmark suite for cache optimizer
 */
export class BenchmarkSuite {
  private config: BenchmarkConfig;
  private scoringLatency: LatencyTracker;
  private pruningLatency: LatencyTracker;
  private compressionLatency: LatencyTracker;
  private hookLatency: LatencyTracker;
  private vectorSearchLatency: LatencyTracker;

  // Counters
  private compactionsPrevented: number = 0;
  private totalPruningOps: number = 0;
  private totalCompressions: number = 0;
  private totalTokensFreed: number = 0;
  private totalTokensProcessed: number = 0;
  private startTime: number = Date.now();

  constructor(config: Partial<BenchmarkConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG.benchmarks,
      ...config,
      metrics: {
        ...DEFAULT_CONFIG.benchmarks.metrics,
        ...config.metrics,
      },
      export: {
        ...DEFAULT_CONFIG.benchmarks.export,
        ...config.export,
      },
    };

    this.scoringLatency = new LatencyTracker();
    this.pruningLatency = new LatencyTracker();
    this.compressionLatency = new LatencyTracker();
    this.hookLatency = new LatencyTracker();
    this.vectorSearchLatency = new LatencyTracker();
  }

  /**
   * Record scoring operation latency
   */
  recordScoring(latencyMs: number): void {
    if (this.shouldSample()) {
      this.scoringLatency.record(latencyMs);
    }
  }

  /**
   * Record pruning operation latency
   */
  recordPruning(latencyMs: number, tokensFred: number): void {
    if (this.shouldSample()) {
      this.pruningLatency.record(latencyMs);
    }
    this.totalPruningOps++;
    this.totalTokensFreed += tokensFred;
  }

  /**
   * Record compression operation latency
   */
  recordCompression(latencyMs: number, tokensSaved: number): void {
    if (this.shouldSample()) {
      this.compressionLatency.record(latencyMs);
    }
    this.totalCompressions++;
    this.totalTokensFreed += tokensSaved;
  }

  /**
   * Record hook execution latency
   */
  recordHook(hookName: string, latencyMs: number): void {
    if (this.shouldSample()) {
      this.hookLatency.record(latencyMs);
    }
  }

  /**
   * Record vector search latency
   */
  recordVectorSearch(latencyMs: number): void {
    if (this.shouldSample()) {
      this.vectorSearchLatency.record(latencyMs);
    }
  }

  /**
   * Record compaction prevention
   */
  recordCompactionPrevented(): void {
    this.compactionsPrevented++;
  }

  /**
   * Record tokens processed
   */
  recordTokensProcessed(tokens: number): void {
    this.totalTokensProcessed += tokens;
  }

  /**
   * Get latency metrics
   */
  getLatencyMetrics(): LatencyMetrics {
    return {
      scoring: this.scoringLatency.getPercentiles(),
      pruning: this.pruningLatency.getPercentiles(),
      compression: this.compressionLatency.getPercentiles(),
      hooks: this.hookLatency.getPercentiles(),
      vectorSearch: this.vectorSearchLatency.getPercentiles(),
    };
  }

  /**
   * Get comprehensive benchmark report
   */
  getReport(optimizer: CacheOptimizer): BenchmarkReport {
    const cacheMetrics = optimizer.getMetrics();
    const latencyMetrics = this.getLatencyMetrics();
    const uptimeMs = Date.now() - this.startTime;

    return {
      timestamp: Date.now(),
      uptimeMs,

      // Cache metrics
      cache: cacheMetrics,

      // Latency metrics
      latency: latencyMetrics,

      // Effectiveness metrics
      effectiveness: {
        compactionsPrevented: this.compactionsPrevented,
        compactionPreventionRate: this.calculatePreventionRate(),
        totalPruningOps: this.totalPruningOps,
        totalCompressions: this.totalCompressions,
        totalTokensFreed: this.totalTokensFreed,
        totalTokensProcessed: this.totalTokensProcessed,
        tokenSavingsRate: this.totalTokensProcessed > 0
          ? this.totalTokensFreed / this.totalTokensProcessed
          : 0,
      },

      // Performance targets vs actual
      targets: {
        zeroCompaction: {
          target: true,
          actual: this.compactionsPrevented > 0 && cacheMetrics.compactionsPrevented === this.compactionsPrevented,
          met: this.compactionsPrevented === cacheMetrics.compactionsPrevented,
        },
        maxUtilization: {
          target: 0.75,
          actual: cacheMetrics.utilization,
          met: cacheMetrics.utilization <= 0.75,
        },
        scoringLatencyP95: {
          target: 50, // 50ms target
          actual: latencyMetrics.scoring.p95,
          met: latencyMetrics.scoring.p95 <= 50,
        },
        pruningLatencyP95: {
          target: 100, // 100ms target
          actual: latencyMetrics.pruning.p95,
          met: latencyMetrics.pruning.p95 <= 100,
        },
        hookLatencyP95: {
          target: 3000, // 3s hook timeout
          actual: latencyMetrics.hooks.p95,
          met: latencyMetrics.hooks.p95 <= 3000,
        },
      },
    };
  }

  /**
   * Export report in specified format
   */
  exportReport(optimizer: CacheOptimizer): string {
    const report = this.getReport(optimizer);

    switch (this.config.export.format) {
      case 'json':
        return JSON.stringify(report, null, 2);

      case 'prometheus':
        return this.toPrometheus(report);

      case 'opentelemetry':
        return this.toOpenTelemetry(report);

      default:
        return JSON.stringify(report, null, 2);
    }
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.scoringLatency.reset();
    this.pruningLatency.reset();
    this.compressionLatency.reset();
    this.hookLatency.reset();
    this.vectorSearchLatency.reset();
    this.compactionsPrevented = 0;
    this.totalPruningOps = 0;
    this.totalCompressions = 0;
    this.totalTokensFreed = 0;
    this.totalTokensProcessed = 0;
    this.startTime = Date.now();
  }

  // ========== Private Methods ==========

  private shouldSample(): boolean {
    return Math.random() < this.config.sampleRate;
  }

  private calculatePreventionRate(): number {
    // If we've had opportunities to prevent compaction and succeeded
    if (this.totalPruningOps === 0) return 1.0; // No pruning needed = perfect
    return this.compactionsPrevented / Math.max(1, this.totalPruningOps);
  }

  private toPrometheus(report: BenchmarkReport): string {
    const lines: string[] = [];
    const timestamp = report.timestamp;

    // Cache metrics
    lines.push(`# HELP cache_optimizer_utilization Current cache utilization`);
    lines.push(`# TYPE cache_optimizer_utilization gauge`);
    lines.push(`cache_optimizer_utilization ${report.cache.utilization} ${timestamp}`);

    lines.push(`# HELP cache_optimizer_tokens_current Current token count`);
    lines.push(`# TYPE cache_optimizer_tokens_current gauge`);
    lines.push(`cache_optimizer_tokens_current ${report.cache.currentTokens} ${timestamp}`);

    lines.push(`# HELP cache_optimizer_compactions_prevented Total compactions prevented`);
    lines.push(`# TYPE cache_optimizer_compactions_prevented counter`);
    lines.push(`cache_optimizer_compactions_prevented ${report.effectiveness.compactionsPrevented} ${timestamp}`);

    // Latency metrics
    lines.push(`# HELP cache_optimizer_scoring_latency_ms Scoring latency in ms`);
    lines.push(`# TYPE cache_optimizer_scoring_latency_ms summary`);
    lines.push(`cache_optimizer_scoring_latency_ms{quantile="0.5"} ${report.latency.scoring.p50}`);
    lines.push(`cache_optimizer_scoring_latency_ms{quantile="0.95"} ${report.latency.scoring.p95}`);
    lines.push(`cache_optimizer_scoring_latency_ms{quantile="0.99"} ${report.latency.scoring.p99}`);

    return lines.join('\n');
  }

  private toOpenTelemetry(report: BenchmarkReport): string {
    // Simplified OTLP JSON format
    return JSON.stringify({
      resourceMetrics: [{
        resource: {
          attributes: [{
            key: 'service.name',
            value: { stringValue: '@claude-flow/cache-optimizer' },
          }],
        },
        scopeMetrics: [{
          scope: { name: 'cache-optimizer' },
          metrics: [
            {
              name: 'cache_optimizer.utilization',
              gauge: {
                dataPoints: [{
                  asDouble: report.cache.utilization,
                  timeUnixNano: report.timestamp * 1000000,
                }],
              },
            },
            {
              name: 'cache_optimizer.compactions_prevented',
              sum: {
                dataPoints: [{
                  asInt: report.effectiveness.compactionsPrevented,
                  timeUnixNano: report.timestamp * 1000000,
                }],
                isMonotonic: true,
              },
            },
          ],
        }],
      }],
    }, null, 2);
  }
}

/**
 * Benchmark report structure
 */
export interface BenchmarkReport {
  timestamp: number;
  uptimeMs: number;
  cache: CacheMetrics;
  latency: LatencyMetrics;
  effectiveness: {
    compactionsPrevented: number;
    compactionPreventionRate: number;
    totalPruningOps: number;
    totalCompressions: number;
    totalTokensFreed: number;
    totalTokensProcessed: number;
    tokenSavingsRate: number;
  };
  targets: {
    zeroCompaction: TargetMetric<boolean>;
    maxUtilization: TargetMetric<number>;
    scoringLatencyP95: TargetMetric<number>;
    pruningLatencyP95: TargetMetric<number>;
    hookLatencyP95: TargetMetric<number>;
  };
}

export interface TargetMetric<T> {
  target: T;
  actual: T;
  met: boolean;
}

/**
 * Create a benchmark suite
 */
export function createBenchmarkSuite(config?: Partial<BenchmarkConfig>): BenchmarkSuite {
  return new BenchmarkSuite(config);
}
