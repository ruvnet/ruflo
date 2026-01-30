/**
 * Performance Profiler and Metrics Collection System
 *
 * Features:
 * - Real-time performance monitoring
 * - CPU and memory profiling
 * - Latency distribution tracking
 * - Bottleneck detection
 * - Performance regression alerts
 * - Detailed metrics reporting
 */

import { performance, PerformanceObserver } from 'perf_hooks';
import * as os from 'os';
import { EventEmitter } from 'events';

interface PerformanceSnapshot {
  timestamp: number;
  cpu: CPUMetrics;
  memory: MemoryMetrics;
  latency: LatencyMetrics;
  throughput: ThroughputMetrics;
  errors: ErrorMetrics;
  custom: Map<string, any>;
}

interface CPUMetrics {
  usage: number;
  loadAverage: number[];
  coreUtilization: number[];
  processUsage: {
    user: number;
    system: number;
    total: number;
  };
}

interface MemoryMetrics {
  heap: {
    used: number;
    total: number;
    limit: number;
    utilization: number;
  };
  external: number;
  arrayBuffers: number;
  gc: {
    collections: number;
    duration: number;
    type: string;
  };
  poolUsage: {
    totalPools: number;
    totalObjects: number;
    efficiency: number;
  };
}

interface LatencyMetrics {
  samples: number[];
  statistics: {
    min: number;
    max: number;
    mean: number;
    median: number;
    p95: number;
    p99: number;
    stdDev: number;
  };
  distribution: Map<number, number>; // bucket -> count
}

interface ThroughputMetrics {
  requestsPerSecond: number;
  operationsPerSecond: number;
  bytesProcessedPerSecond: number;
  efficiency: number;
}

interface ErrorMetrics {
  total: number;
  rate: number;
  byType: Map<string, number>;
  recent: Array<{
    timestamp: number;
    type: string;
    message: string;
  }>;
}

interface PerformanceAlert {
  level: 'info' | 'warning' | 'critical';
  metric: string;
  threshold: number;
  current: number;
  timestamp: number;
  message: string;
  suggestions: string[];
}

interface ProfilingSession {
  id: string;
  startTime: number;
  endTime?: number;
  snapshots: PerformanceSnapshot[];
  alerts: PerformanceAlert[];
  summary: {
    duration: number;
    avgThroughput: number;
    avgLatency: number;
    errorRate: number;
    efficiency: number;
  };
}

/**
 * Advanced Performance Profiler
 */
export class PerformanceProfiler extends EventEmitter {
  private snapshots: PerformanceSnapshot[] = [];
  private currentSession: ProfilingSession | null = null;
  private performanceObserver: PerformanceObserver | null = null;
  private monitoringInterval: NodeJS.Timer | null = null;

  private thresholds = {
    cpu: { warning: 70, critical: 90 },
    memory: { warning: 80, critical: 95 },
    latency: { warning: 100, critical: 500 }, // ms
    errorRate: { warning: 5, critical: 10 }, // percent
    throughput: { warning: 500, critical: 100 } // req/s
  };

  private latencySamples: number[] = [];
  private requestCounter = 0;
  private errorCounter = 0;
  private startTime = Date.now();
  private lastCPUUsage = process.cpuUsage();
  private customMetrics = new Map<string, any>();

  constructor() {
    super();
    this.setupPerformanceObserver();
  }

  /**
   * Setup performance observer for automatic monitoring
   */
  private setupPerformanceObserver(): void {
    this.performanceObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      for (const entry of entries) {
        this.processPerformanceEntry(entry);
      }
    });

    // Observe various performance entry types
    this.performanceObserver.observe({
      entryTypes: ['measure', 'mark', 'function', 'gc']
    });
  }

  private processPerformanceEntry(entry: any): void {
    switch (entry.entryType) {
      case 'measure':
        this.recordLatency(entry.duration);
        break;
      case 'gc':
        this.recordGCEvent(entry);
        break;
      case 'function':
        this.recordFunctionCall(entry);
        break;
    }
  }

  /**
   * Start a profiling session
   */
  startSession(sessionId?: string): string {
    const id = sessionId || `session_${Date.now()}`;

    this.currentSession = {
      id,
      startTime: Date.now(),
      snapshots: [],
      alerts: [],
      summary: {
        duration: 0,
        avgThroughput: 0,
        avgLatency: 0,
        errorRate: 0,
        efficiency: 0
      }
    };

    // Start continuous monitoring
    this.startContinuousMonitoring();

    this.emit('sessionStarted', { sessionId: id });
    console.log(`🔍 Performance profiling session started: ${id}`);

    return id;
  }

  /**
   * End current profiling session
   */
  endSession(): ProfilingSession | null {
    if (!this.currentSession) {
      return null;
    }

    this.currentSession.endTime = Date.now();
    this.currentSession.duration = this.currentSession.endTime - this.currentSession.startTime;

    // Calculate session summary
    this.calculateSessionSummary();

    // Stop monitoring
    this.stopContinuousMonitoring();

    const completedSession = { ...this.currentSession };
    this.emit('sessionEnded', { session: completedSession });

    console.log(`📊 Performance profiling session ended: ${completedSession.id}`);
    console.log(`   Duration: ${(completedSession.duration / 1000).toFixed(2)}s`);
    console.log(`   Avg Throughput: ${completedSession.summary.avgThroughput.toFixed(0)} req/s`);
    console.log(`   Avg Latency: ${completedSession.summary.avgLatency.toFixed(2)}ms`);
    console.log(`   Error Rate: ${completedSession.summary.errorRate.toFixed(2)}%`);

    this.currentSession = null;
    return completedSession;
  }

  /**
   * Take a performance snapshot
   */
  takeSnapshot(): PerformanceSnapshot {
    const snapshot: PerformanceSnapshot = {
      timestamp: Date.now(),
      cpu: this.collectCPUMetrics(),
      memory: this.collectMemoryMetrics(),
      latency: this.collectLatencyMetrics(),
      throughput: this.collectThroughputMetrics(),
      errors: this.collectErrorMetrics(),
      custom: new Map(this.customMetrics)
    };

    this.snapshots.push(snapshot);

    // Add to current session if active
    if (this.currentSession) {
      this.currentSession.snapshots.push(snapshot);
      this.checkThresholds(snapshot);
    }

    // Keep only last 1000 snapshots for memory efficiency
    if (this.snapshots.length > 1000) {
      this.snapshots = this.snapshots.slice(-1000);
    }

    return snapshot;
  }

  private collectCPUMetrics(): CPUMetrics {
    const currentCPU = process.cpuUsage(this.lastCPUUsage);
    const totalCPU = currentCPU.user + currentCPU.system;
    const cpuUsagePercent = (totalCPU / 1000000) * 100; // Convert to percentage

    this.lastCPUUsage = process.cpuUsage();

    return {
      usage: Math.min(100, cpuUsagePercent),
      loadAverage: os.loadavg(),
      coreUtilization: os.cpus().map(cpu => {
        const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
        const idle = cpu.times.idle;
        return ((total - idle) / total) * 100;
      }),
      processUsage: {
        user: currentCPU.user / 1000, // Convert to ms
        system: currentCPU.system / 1000,
        total: totalCPU / 1000
      }
    };
  }

  private collectMemoryMetrics(): MemoryMetrics {
    const memUsage = process.memoryUsage();
    const heapLimit = (process as any).getHeapStatistics?.()?.heap_size_limit || memUsage.heapTotal * 2;

    return {
      heap: {
        used: memUsage.heapUsed,
        total: memUsage.heapTotal,
        limit: heapLimit,
        utilization: (memUsage.heapUsed / heapLimit) * 100
      },
      external: memUsage.external,
      arrayBuffers: memUsage.arrayBuffers,
      gc: this.getGCMetrics(),
      poolUsage: this.getPoolUsageMetrics()
    };
  }

  private collectLatencyMetrics(): LatencyMetrics {
    if (this.latencySamples.length === 0) {
      return {
        samples: [],
        statistics: {
          min: 0, max: 0, mean: 0, median: 0,
          p95: 0, p99: 0, stdDev: 0
        },
        distribution: new Map()
      };
    }

    const sorted = [...this.latencySamples].sort((a, b) => a - b);
    const statistics = this.calculateStatistics(sorted);
    const distribution = this.createDistribution(sorted);

    return {
      samples: [...this.latencySamples],
      statistics,
      distribution
    };
  }

  private collectThroughputMetrics(): ThroughputMetrics {
    const now = Date.now();
    const timeElapsed = (now - this.startTime) / 1000; // seconds

    const rps = this.requestCounter / timeElapsed;
    const ops = this.requestCounter / timeElapsed; // Same as RPS for now
    const bytesProcessed = this.estimateBytesProcessed();
    const efficiency = this.calculateEfficiency();

    return {
      requestsPerSecond: rps,
      operationsPerSecond: ops,
      bytesProcessedPerSecond: bytesProcessed / timeElapsed,
      efficiency: efficiency
    };
  }

  private collectErrorMetrics(): ErrorMetrics {
    const total = this.errorCounter;
    const rate = this.requestCounter > 0 ? (total / this.requestCounter) * 100 : 0;

    return {
      total,
      rate,
      byType: new Map(), // Would be populated in real implementation
      recent: [] // Would contain recent errors
    };
  }

  private calculateStatistics(sortedSamples: number[]): LatencyMetrics['statistics'] {
    const length = sortedSamples.length;

    if (length === 0) {
      return { min: 0, max: 0, mean: 0, median: 0, p95: 0, p99: 0, stdDev: 0 };
    }

    const min = sortedSamples[0];
    const max = sortedSamples[length - 1];
    const mean = sortedSamples.reduce((a, b) => a + b, 0) / length;
    const median = length % 2 === 0 ?
      (sortedSamples[length / 2 - 1] + sortedSamples[length / 2]) / 2 :
      sortedSamples[Math.floor(length / 2)];

    const p95Index = Math.floor(length * 0.95);
    const p99Index = Math.floor(length * 0.99);
    const p95 = sortedSamples[p95Index] || max;
    const p99 = sortedSamples[p99Index] || max;

    const variance = sortedSamples.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / length;
    const stdDev = Math.sqrt(variance);

    return { min, max, mean, median, p95, p99, stdDev };
  }

  private createDistribution(sortedSamples: number[]): Map<number, number> {
    const distribution = new Map<number, number>();

    // Create buckets (0-10ms, 10-50ms, 50-100ms, 100-500ms, 500+ms)
    const buckets = [10, 50, 100, 500, Infinity];
    const bucketCounts = [0, 0, 0, 0, 0];

    for (const sample of sortedSamples) {
      for (let i = 0; i < buckets.length; i++) {
        if (sample <= buckets[i]) {
          bucketCounts[i]++;
          break;
        }
      }
    }

    buckets.forEach((bucket, index) => {
      distribution.set(bucket, bucketCounts[index]);
    });

    return distribution;
  }

  /**
   * Record operation latency
   */
  recordLatency(latency: number): void {
    this.latencySamples.push(latency);

    // Keep only last 1000 samples for memory efficiency
    if (this.latencySamples.length > 1000) {
      this.latencySamples = this.latencySamples.slice(-1000);
    }
  }

  /**
   * Record request completion
   */
  recordRequest(): void {
    this.requestCounter++;
  }

  /**
   * Record error occurrence
   */
  recordError(error?: Error): void {
    this.errorCounter++;

    if (this.currentSession && error) {
      // Add to session alerts if error rate is high
      const errorRate = (this.errorCounter / this.requestCounter) * 100;
      if (errorRate > this.thresholds.errorRate.warning) {
        this.addAlert('warning', 'errorRate', this.thresholds.errorRate.warning, errorRate,
          `Error rate is elevated: ${errorRate.toFixed(2)}%`,
          ['Review error logs', 'Check system health', 'Implement circuit breaker']);
      }
    }
  }

  /**
   * Record custom metric
   */
  recordCustomMetric(name: string, value: any): void {
    this.customMetrics.set(name, value);
  }

  /**
   * Start continuous monitoring
   */
  private startContinuousMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      this.takeSnapshot();
    }, 1000); // Take snapshot every second
  }

  /**
   * Stop continuous monitoring
   */
  private stopContinuousMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  /**
   * Check performance thresholds and generate alerts
   */
  private checkThresholds(snapshot: PerformanceSnapshot): void {
    // Check CPU usage
    if (snapshot.cpu.usage > this.thresholds.cpu.critical) {
      this.addAlert('critical', 'cpu', this.thresholds.cpu.critical, snapshot.cpu.usage,
        'Critical CPU usage detected',
        ['Scale horizontally', 'Optimize hot code paths', 'Enable request throttling']);
    } else if (snapshot.cpu.usage > this.thresholds.cpu.warning) {
      this.addAlert('warning', 'cpu', this.thresholds.cpu.warning, snapshot.cpu.usage,
        'High CPU usage detected',
        ['Monitor closely', 'Review CPU-intensive operations']);
    }

    // Check memory usage
    if (snapshot.memory.heap.utilization > this.thresholds.memory.critical) {
      this.addAlert('critical', 'memory', this.thresholds.memory.critical, snapshot.memory.heap.utilization,
        'Critical memory usage detected',
        ['Increase heap size', 'Enable aggressive GC', 'Review memory leaks']);
    } else if (snapshot.memory.heap.utilization > this.thresholds.memory.warning) {
      this.addAlert('warning', 'memory', this.thresholds.memory.warning, snapshot.memory.heap.utilization,
        'High memory usage detected',
        ['Monitor memory trends', 'Review object lifecycle']);
    }

    // Check latency
    if (snapshot.latency.statistics.p95 > this.thresholds.latency.critical) {
      this.addAlert('critical', 'latency', this.thresholds.latency.critical, snapshot.latency.statistics.p95,
        'Critical latency detected',
        ['Enable caching', 'Optimize database queries', 'Add request prioritization']);
    } else if (snapshot.latency.statistics.p95 > this.thresholds.latency.warning) {
      this.addAlert('warning', 'latency', this.thresholds.latency.warning, snapshot.latency.statistics.p95,
        'High latency detected',
        ['Review slow operations', 'Consider optimization']);
    }

    // Check throughput
    if (snapshot.throughput.requestsPerSecond < this.thresholds.throughput.critical) {
      this.addAlert('critical', 'throughput', this.thresholds.throughput.critical, snapshot.throughput.requestsPerSecond,
        'Low throughput detected',
        ['Scale resources', 'Optimize bottlenecks', 'Review system capacity']);
    } else if (snapshot.throughput.requestsPerSecond < this.thresholds.throughput.warning) {
      this.addAlert('warning', 'throughput', this.thresholds.throughput.warning, snapshot.throughput.requestsPerSecond,
        'Reduced throughput detected',
        ['Monitor system load', 'Review performance trends']);
    }
  }

  private addAlert(
    level: PerformanceAlert['level'],
    metric: string,
    threshold: number,
    current: number,
    message: string,
    suggestions: string[]
  ): void {
    if (!this.currentSession) return;

    const alert: PerformanceAlert = {
      level,
      metric,
      threshold,
      current,
      timestamp: Date.now(),
      message,
      suggestions
    };

    this.currentSession.alerts.push(alert);
    this.emit('alert', alert);

    const emoji = level === 'critical' ? '🚨' : level === 'warning' ? '⚠️' : 'ℹ️';
    console.log(`${emoji} ${level.toUpperCase()}: ${message} (${current.toFixed(2)} > ${threshold})`);
  }

  /**
   * Calculate session summary
   */
  private calculateSessionSummary(): void {
    if (!this.currentSession || this.currentSession.snapshots.length === 0) return;

    const snapshots = this.currentSession.snapshots;
    const duration = this.currentSession.duration!;

    // Calculate averages
    const avgThroughput = snapshots.reduce((sum, s) => sum + s.throughput.requestsPerSecond, 0) / snapshots.length;
    const avgLatency = snapshots.reduce((sum, s) => sum + s.latency.statistics.mean, 0) / snapshots.length;
    const avgErrorRate = snapshots.reduce((sum, s) => sum + s.errors.rate, 0) / snapshots.length;
    const avgEfficiency = snapshots.reduce((sum, s) => sum + s.throughput.efficiency, 0) / snapshots.length;

    this.currentSession.summary = {
      duration,
      avgThroughput,
      avgLatency,
      errorRate: avgErrorRate,
      efficiency: avgEfficiency
    };
  }

  /**
   * Get current metrics snapshot
   */
  getCurrentMetrics(): PerformanceSnapshot {
    return this.takeSnapshot();
  }

  /**
   * Get performance trends
   */
  getTrends(minutes = 5): {
    cpu: number[];
    memory: number[];
    latency: number[];
    throughput: number[];
  } {
    const cutoff = Date.now() - (minutes * 60 * 1000);
    const recentSnapshots = this.snapshots.filter(s => s.timestamp > cutoff);

    return {
      cpu: recentSnapshots.map(s => s.cpu.usage),
      memory: recentSnapshots.map(s => s.memory.heap.utilization),
      latency: recentSnapshots.map(s => s.latency.statistics.p95),
      throughput: recentSnapshots.map(s => s.throughput.requestsPerSecond)
    };
  }

  /**
   * Generate performance report
   */
  generateReport(sessionId?: string): any {
    const session = sessionId ?
      this.currentSession?.id === sessionId ? this.currentSession : null :
      this.currentSession;

    if (!session) {
      return {
        error: 'No active session or session not found',
        currentMetrics: this.getCurrentMetrics()
      };
    }

    const trends = this.getTrends();

    return {
      session: {
        id: session.id,
        duration: session.duration || Date.now() - session.startTime,
        summary: session.summary,
        alertCount: session.alerts.length
      },
      currentMetrics: this.getCurrentMetrics(),
      trends: trends,
      alerts: session.alerts.slice(-10), // Last 10 alerts
      recommendations: this.generateRecommendations(session)
    };
  }

  private generateRecommendations(session: ProfilingSession): string[] {
    const recommendations: string[] = [];
    const latestSnapshot = session.snapshots[session.snapshots.length - 1];

    if (!latestSnapshot) return recommendations;

    // CPU recommendations
    if (latestSnapshot.cpu.usage > 80) {
      recommendations.push('Consider horizontal scaling due to high CPU usage');
      recommendations.push('Profile CPU-intensive code paths for optimization opportunities');
    }

    // Memory recommendations
    if (latestSnapshot.memory.heap.utilization > 75) {
      recommendations.push('Monitor memory usage trends - consider increasing heap size');
      recommendations.push('Review object lifecycle and implement proper cleanup');
    }

    // Latency recommendations
    if (latestSnapshot.latency.statistics.p95 > 100) {
      recommendations.push('Implement response caching to reduce latency');
      recommendations.push('Consider request batching for better throughput');
    }

    // Throughput recommendations
    if (latestSnapshot.throughput.requestsPerSecond < 500) {
      recommendations.push('Review system bottlenecks - database, I/O, or CPU bound?');
      recommendations.push('Consider connection pooling and keep-alive optimizations');
    }

    return recommendations;
  }

  // Helper methods
  private getGCMetrics(): any {
    // Would integrate with V8 GC statistics
    return {
      collections: 0,
      duration: 0,
      type: 'unknown'
    };
  }

  private getPoolUsageMetrics(): any {
    // Would integrate with memory pool statistics
    return {
      totalPools: 0,
      totalObjects: 0,
      efficiency: 0
    };
  }

  private estimateBytesProcessed(): number {
    // Estimate based on request count and average payload size
    return this.requestCounter * 1024; // Assume 1KB average
  }

  private calculateEfficiency(): number {
    // Calculate efficiency based on resource utilization and throughput
    const cpuEfficiency = Math.max(0, 100 - this.lastCPUUsage.user / 1000);
    const memoryEfficiency = Math.max(0, 100 - (process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100);

    return (cpuEfficiency + memoryEfficiency) / 2;
  }

  private recordGCEvent(entry: any): void {
    // Process GC performance entries
    this.emit('gc', {
      type: entry.detail?.type || 'unknown',
      duration: entry.duration,
      timestamp: entry.startTime
    });
  }

  private recordFunctionCall(entry: any): void {
    // Process function call performance entries
    this.recordLatency(entry.duration);
  }

  /**
   * Cleanup and shutdown
   */
  shutdown(): void {
    this.stopContinuousMonitoring();

    if (this.performanceObserver) {
      this.performanceObserver.disconnect();
      this.performanceObserver = null;
    }

    this.removeAllListeners();
    console.log('🔍 Performance profiler shutdown complete');
  }
}

export default PerformanceProfiler;