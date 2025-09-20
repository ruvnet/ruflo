/**
 * Performance Optimizer - System-wide performance monitoring and optimization
 * Created by System Coordinator for integrated system optimization
 */

import { getErrorMessage } from '../utils/error-handler.js';
import { EventBus } from '../core/event-bus.js';
import { Logger } from '../core/logger.js';
import type { SystemComponents } from './system-startup-manager.js';
import type { CommunicationBridge } from './communication-bridge.js';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';

const execAsync = promisify(exec);

export interface PerformanceMetrics {
  // System metrics
  system: {
    cpuUsage: number;
    memoryUsage: number;
    memoryLimit: number;
    uptime: number;
    loadAverage: number[];
    processes: number;
  };

  // Component metrics
  components: {
    orchestrator: ComponentMetrics;
    memory: ComponentMetrics;
    swarm: ComponentMetrics;
    communication: ComponentMetrics;
    health: ComponentMetrics;
  };

  // Performance indicators
  performance: {
    responseTime: number;
    throughput: number;
    errorRate: number;
    concurrency: number;
    queueDepth: number;
    gcFrequency: number;
    gcDuration: number;
  };

  // Resource utilization
  resources: {
    fileDescriptors: number;
    networkConnections: number;
    threadCount: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
  };

  timestamp: number;
}

export interface ComponentMetrics {
  active: boolean;
  responseTime: number;
  throughput: number;
  errorRate: number;
  memoryUsage: number;
  cpuUsage: number;
  queueSize: number;
  lastActivity: number;
}

export interface OptimizationRecommendation {
  component: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  issue: string;
  recommendation: string;
  impact: string;
  effort: 'low' | 'medium' | 'high';
  category: 'memory' | 'cpu' | 'io' | 'network' | 'configuration';
}

export interface PerformanceConfig {
  metricsInterval: number;
  enableOptimization: number;
  enableProfiling: boolean;
  enableGCOptimization: boolean;
  enableResourceLimits: boolean;
  memoryLimitMB: number;
  cpuLimitPercent: number;
  alertThresholds: {
    cpuUsage: number;
    memoryUsage: number;
    responseTime: number;
    errorRate: number;
    queueDepth: number;
  };
}

export class PerformanceOptimizer {
  private eventBus: EventBus;
  private logger: Logger;
  private config: PerformanceConfig;
  private components: SystemComponents;
  private communicationBridge?: CommunicationBridge;

  // Metrics and monitoring
  private currentMetrics: PerformanceMetrics | null = null;
  private metricsHistory: PerformanceMetrics[] = [];
  private metricsTimer?: NodeJS.Timeout;
  private isOptimizing = false;

  // Performance tracking
  private performanceCounters = new Map<string, number>();
  private responseTimes = new Map<string, number[]>();
  private gcObserver?: any;

  constructor(
    components: SystemComponents,
    config: Partial<PerformanceConfig> = {}
  ) {
    this.components = components;
    this.eventBus = components.eventBus;
    this.logger = components.logger;

    this.config = {
      metricsInterval: 5000, // 5 seconds
      enableOptimization: 1,
      enableProfiling: false,
      enableGCOptimization: true,
      enableResourceLimits: true,
      memoryLimitMB: 512,
      cpuLimitPercent: 80,
      alertThresholds: {
        cpuUsage: 80,
        memoryUsage: 80,
        responseTime: 1000,
        errorRate: 0.05,
        queueDepth: 100
      },
      ...config
    };

    this.initialize();
  }

  /**
   * Initialize the performance optimizer
   */
  private initialize(): void {
    // Setup GC observation if enabled
    if (this.config.enableGCOptimization) {
      this.setupGCOptimization();
    }

    // Start metrics collection
    this.startMetricsCollection();

    // Setup event listeners
    this.setupEventListeners();

    // Enable profiling if requested
    if (this.config.enableProfiling) {
      this.enableProfiling();
    }

    this.logger.info('Performance optimizer initialized');
  }

  /**
   * Set communication bridge for metrics
   */
  setCommunicationBridge(bridge: CommunicationBridge): void {
    this.communicationBridge = bridge;
  }

  /**
   * Start collecting performance metrics
   */
  private startMetricsCollection(): void {
    this.metricsTimer = setInterval(async () => {
      try {
        await this.collectMetrics();
        this.analyzePerformance();
        
        if (this.config.enableOptimization) {
          await this.performOptimizations();
        }
      } catch (error) {
        this.logger.error('Error collecting metrics', error);
      }
    }, this.config.metricsInterval);
  }

  /**
   * Collect comprehensive system metrics
   */
  private async collectMetrics(): Promise<void> {
    const startTime = Date.now();

    try {
      // Collect system metrics
      const systemMetrics = await this.collectSystemMetrics();
      
      // Collect component metrics
      const componentMetrics = await this.collectComponentMetrics();
      
      // Collect performance metrics
      const performanceMetrics = this.collectPerformanceMetrics();
      
      // Collect resource metrics
      const resourceMetrics = this.collectResourceMetrics();

      this.currentMetrics = {
        system: systemMetrics,
        components: componentMetrics,
        performance: performanceMetrics,
        resources: resourceMetrics,
        timestamp: Date.now()
      };

      // Store in history (keep last 100 entries)
      this.metricsHistory.push(this.currentMetrics);
      if (this.metricsHistory.length > 100) {
        this.metricsHistory.shift();
      }

      // Emit metrics event
      this.eventBus.emit('performance:metrics', {
        metrics: this.currentMetrics,
        collectionTime: Date.now() - startTime
      });

    } catch (error) {
      this.logger.error('Failed to collect metrics', error);
    }
  }

  /**
   * Collect system-level metrics
   */
  private async collectSystemMetrics(): Promise<PerformanceMetrics['system']> {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    return {
      cpuUsage: (cpuUsage.user + cpuUsage.system) / 1000000, // Convert to seconds
      memoryUsage: memUsage.heapUsed,
      memoryLimit: this.config.memoryLimitMB * 1024 * 1024,
      uptime: process.uptime(),
      loadAverage: require('os').loadavg(),
      processes: 1 // Single process for now
    };
  }

  /**
   * Collect component-specific metrics
   */
  private async collectComponentMetrics(): Promise<PerformanceMetrics['components']> {
    const components = {
      orchestrator: await this.getComponentMetrics('orchestrator'),
      memory: await this.getComponentMetrics('memory'),
      swarm: await this.getComponentMetrics('swarm'),
      communication: await this.getComponentMetrics('communication'),
      health: await this.getComponentMetrics('health')
    };

    return components;
  }

  /**
   * Get metrics for a specific component
   */
  private async getComponentMetrics(component: string): Promise<ComponentMetrics> {
    const counters = this.performanceCounters;
    const responses = this.responseTimes.get(component) || [];
    
    return {
      active: this.isComponentActive(component),
      responseTime: responses.length > 0 ? 
        responses.reduce((a, b) => a + b, 0) / responses.length : 0,
      throughput: counters.get(`${component}_throughput`) || 0,
      errorRate: counters.get(`${component}_errors`) || 0,
      memoryUsage: counters.get(`${component}_memory`) || 0,
      cpuUsage: counters.get(`${component}_cpu`) || 0,
      queueSize: counters.get(`${component}_queue`) || 0,
      lastActivity: counters.get(`${component}_last_activity`) || 0
    };
  }

  /**
   * Check if component is active
   */
  private isComponentActive(component: string): boolean {
    const componentMap = {
      orchestrator: this.components.orchestrator,
      memory: this.components.memoryManager,
      swarm: this.components.swarmCoordinator,
      communication: this.communicationBridge,
      health: this.components.healthCheckManager
    };

    return componentMap[component as keyof typeof componentMap] !== undefined;
  }

  /**
   * Collect performance indicators
   */
  private collectPerformanceMetrics(): PerformanceMetrics['performance'] {
    return {
      responseTime: this.calculateAverageResponseTime(),
      throughput: this.performanceCounters.get('total_throughput') || 0,
      errorRate: this.performanceCounters.get('total_errors') || 0,
      concurrency: this.performanceCounters.get('concurrent_operations') || 0,
      queueDepth: this.calculateTotalQueueDepth(),
      gcFrequency: this.performanceCounters.get('gc_frequency') || 0,
      gcDuration: this.performanceCounters.get('gc_duration') || 0
    };
  }

  /**
   * Collect resource utilization metrics
   */
  private collectResourceMetrics(): PerformanceMetrics['resources'] {
    const memUsage = process.memoryUsage();
    
    return {
      fileDescriptors: this.performanceCounters.get('file_descriptors') || 0,
      networkConnections: this.performanceCounters.get('network_connections') || 0,
      threadCount: this.performanceCounters.get('thread_count') || 1,
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external
    };
  }

  /**
   * Analyze performance and generate recommendations
   */
  private analyzePerformance(): void {
    if (!this.currentMetrics) return;

    const recommendations: OptimizationRecommendation[] = [];
    const metrics = this.currentMetrics;
    const thresholds = this.config.alertThresholds;

    // Check CPU usage
    if (metrics.system.cpuUsage > thresholds.cpuUsage) {
      recommendations.push({
        component: 'system',
        severity: metrics.system.cpuUsage > 90 ? 'critical' : 'high',
        issue: `High CPU usage: ${metrics.system.cpuUsage.toFixed(1)}%`,
        recommendation: 'Consider reducing concurrent operations or optimizing CPU-intensive tasks',
        impact: 'High - affects overall system responsiveness',
        effort: 'medium',
        category: 'cpu'
      });
    }

    // Check memory usage
    const memoryUsagePercent = (metrics.system.memoryUsage / metrics.system.memoryLimit) * 100;
    if (memoryUsagePercent > thresholds.memoryUsage) {
      recommendations.push({
        component: 'system',
        severity: memoryUsagePercent > 95 ? 'critical' : 'high',
        issue: `High memory usage: ${memoryUsagePercent.toFixed(1)}%`,
        recommendation: 'Implement memory cleanup, reduce cache sizes, or increase memory limit',
        impact: 'High - risk of out-of-memory errors',
        effort: 'low',
        category: 'memory'
      });
    }

    // Check response times
    if (metrics.performance.responseTime > thresholds.responseTime) {
      recommendations.push({
        component: 'system',
        severity: metrics.performance.responseTime > 2000 ? 'high' : 'medium',
        issue: `Slow response time: ${metrics.performance.responseTime.toFixed(0)}ms`,
        recommendation: 'Optimize slow operations, implement caching, or use async processing',
        impact: 'Medium - affects user experience',
        effort: 'medium',
        category: 'io'
      });
    }

    // Check error rates
    if (metrics.performance.errorRate > thresholds.errorRate) {
      recommendations.push({
        component: 'system',
        severity: metrics.performance.errorRate > 0.1 ? 'critical' : 'high',
        issue: `High error rate: ${(metrics.performance.errorRate * 100).toFixed(1)}%`,
        recommendation: 'Investigate error causes, implement better error handling and retries',
        impact: 'High - affects system reliability',
        effort: 'high',
        category: 'configuration'
      });
    }

    // Check queue depths
    if (metrics.performance.queueDepth > thresholds.queueDepth) {
      recommendations.push({
        component: 'system',
        severity: metrics.performance.queueDepth > 200 ? 'high' : 'medium',
        issue: `High queue depth: ${metrics.performance.queueDepth}`,
        recommendation: 'Increase processing capacity or implement queue prioritization',
        impact: 'Medium - affects processing latency',
        effort: 'medium',
        category: 'configuration'
      });
    }

    // Emit recommendations if any
    if (recommendations.length > 0) {
      this.eventBus.emit('performance:recommendations', {
        recommendations,
        metrics,
        timestamp: Date.now()
      });

      // Log critical issues
      const critical = recommendations.filter(r => r.severity === 'critical');
      if (critical.length > 0) {
        critical.forEach(rec => {
          this.logger.warn(`CRITICAL PERFORMANCE ISSUE: ${rec.issue} - ${rec.recommendation}`);
        });
      }
    }
  }

  /**
   * Perform automatic optimizations
   */
  private async performOptimizations(): Promise<void> {
    if (this.isOptimizing || !this.currentMetrics) return;

    this.isOptimizing = true;
    
    try {
      // Memory optimization
      await this.optimizeMemory();
      
      // GC optimization
      if (this.config.enableGCOptimization) {
        await this.optimizeGarbageCollection();
      }
      
      // Component optimization
      await this.optimizeComponents();
      
      // Resource optimization
      await this.optimizeResources();

    } catch (error) {
      this.logger.error('Error during optimization', error);
    } finally {
      this.isOptimizing = false;
    }
  }

  /**
   * Optimize memory usage
   */
  private async optimizeMemory(): Promise<void> {
    const memUsage = this.currentMetrics!.system.memoryUsage;
    const memLimit = this.currentMetrics!.system.memoryLimit;
    const usagePercent = (memUsage / memLimit) * 100;

    if (usagePercent > 70) {
      // Clear old metrics history
      if (this.metricsHistory.length > 50) {
        this.metricsHistory.splice(0, this.metricsHistory.length - 50);
      }

      // Clear old response time data
      for (const [key, values] of this.responseTimes.entries()) {
        if (values.length > 100) {
          this.responseTimes.set(key, values.slice(-50));
        }
      }

      // Trigger GC if memory usage is high
      if (usagePercent > 85 && global.gc) {
        global.gc();
        this.logger.debug('Triggered garbage collection due to high memory usage');
      }

      // Notify components to clean up
      this.eventBus.emit('performance:cleanup', {
        type: 'memory',
        severity: usagePercent > 90 ? 'high' : 'medium',
        usage: usagePercent
      });
    }
  }

  /**
   * Optimize garbage collection
   */
  private async optimizeGarbageCollection(): Promise<void> {
    const gcFreq = this.currentMetrics!.performance.gcFrequency;
    const gcDuration = this.currentMetrics!.performance.gcDuration;

    // If GC is happening too frequently or taking too long
    if (gcFreq > 10 || gcDuration > 100) {
      this.logger.debug(`GC optimization: frequency=${gcFreq}, duration=${gcDuration}ms`);
      
      // Adjust GC settings if possible
      if (process.env.NODE_ENV !== 'production') {
        // These optimizations would be set via Node.js flags in production
        // --max-old-space-size, --optimize-for-size, etc.
      }
    }
  }

  /**
   * Optimize component performance
   */
  private async optimizeComponents(): Promise<void> {
    // Optimize communication bridge
    if (this.communicationBridge) {
      const commHealth = this.communicationBridge.getHealthStatus();
      if (!commHealth.healthy) {
        // Optimize each problematic component
        for (const [component, healthy] of Object.entries(commHealth.components)) {
          if (!healthy) {
            this.communicationBridge.optimizeComponent(component);
          }
        }
      }
    }

    // Optimize memory manager
    if (this.components.memoryManager) {
      try {
        await this.components.memoryManager.performMaintenance();
      } catch (error) {
        this.logger.warn('Memory manager maintenance failed', error);
      }
    }
  }

  /**
   * Optimize resource usage
   */
  private async optimizeResources(): Promise<void> {
    const resources = this.currentMetrics!.resources;

    // Optimize heap usage
    const heapUsagePercent = (resources.heapUsed / resources.heapTotal) * 100;
    if (heapUsagePercent > 80) {
      this.eventBus.emit('performance:heap-pressure', {
        usage: heapUsagePercent,
        used: resources.heapUsed,
        total: resources.heapTotal
      });
    }

    // Monitor external memory
    if (resources.external > 100 * 1024 * 1024) { // 100MB
      this.logger.warn(`High external memory usage: ${(resources.external / 1024 / 1024).toFixed(1)}MB`);
    }
  }

  /**
   * Setup GC optimization
   */
  private setupGCOptimization(): void {
    // Monitor GC events if available
    if (process.versions.node && parseInt(process.versions.node.split('.')[0]) >= 14) {
      try {
        const { PerformanceObserver, performance } = require('perf_hooks');
        
        this.gcObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          
          for (const entry of entries) {
            if (entry.entryType === 'gc') {
              this.performanceCounters.set('gc_frequency', 
                (this.performanceCounters.get('gc_frequency') || 0) + 1);
              this.performanceCounters.set('gc_duration', entry.duration);
            }
          }
        });
        
        this.gcObserver.observe({ entryTypes: ['gc'] });
        
      } catch (error) {
        this.logger.warn('Failed to setup GC observer', error);
      }
    }
  }

  /**
   * Setup event listeners for performance tracking
   */
  private setupEventListeners(): void {
    // Track communication metrics
    this.eventBus.on('communication:message:success', (data) => {
      this.trackResponseTime(data.target, data.latency);
      this.incrementCounter(`${data.target}_throughput`);
    });

    this.eventBus.on('communication:message:error', (data) => {
      this.incrementCounter(`${data.target}_errors`);
      this.incrementCounter('total_errors');
    });

    // Track memory operations
    this.eventBus.on('memory:operation', (data) => {
      this.trackResponseTime('memory', data.duration);
    });

    // Track orchestrator operations
    this.eventBus.on('orchestrator:operation', (data) => {
      this.trackResponseTime('orchestrator', data.duration);
    });
  }

  /**
   * Track response time for a component
   */
  private trackResponseTime(component: string, responseTime: number): void {
    if (!this.responseTimes.has(component)) {
      this.responseTimes.set(component, []);
    }
    
    const times = this.responseTimes.get(component)!;
    times.push(responseTime);
    
    // Keep only last 100 measurements
    if (times.length > 100) {
      times.shift();
    }
  }

  /**
   * Increment a performance counter
   */
  private incrementCounter(counter: string, value = 1): void {
    this.performanceCounters.set(counter, 
      (this.performanceCounters.get(counter) || 0) + value);
  }

  /**
   * Calculate average response time across all components
   */
  private calculateAverageResponseTime(): number {
    let totalTime = 0;
    let totalCount = 0;

    for (const times of this.responseTimes.values()) {
      if (times.length > 0) {
        totalTime += times.reduce((a, b) => a + b, 0);
        totalCount += times.length;
      }
    }

    return totalCount > 0 ? totalTime / totalCount : 0;
  }

  /**
   * Calculate total queue depth across all components
   */
  private calculateTotalQueueDepth(): number {
    let totalDepth = 0;
    
    for (const [key, value] of this.performanceCounters.entries()) {
      if (key.endsWith('_queue')) {
        totalDepth += value;
      }
    }

    return totalDepth;
  }

  /**
   * Enable profiling if supported
   */
  private enableProfiling(): void {
    if (process.versions.node && parseInt(process.versions.node.split('.')[0]) >= 12) {
      try {
        const inspector = require('inspector');
        const session = new inspector.Session();
        session.connect();
        session.post('Profiler.enable');
        
        this.logger.info('CPU profiling enabled');
        
        // Save reference for cleanup
        (this as any).profilerSession = session;
        
      } catch (error) {
        this.logger.warn('Failed to enable profiling', error);
      }
    }
  }

  /**
   * Get current performance metrics
   */
  getMetrics(): PerformanceMetrics | null {
    return this.currentMetrics;
  }

  /**
   * Get performance history
   */
  getMetricsHistory(): PerformanceMetrics[] {
    return [...this.metricsHistory];
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary(): {
    uptime: number;
    averageResponseTime: number;
    totalThroughput: number;
    errorRate: number;
    memoryUsage: number;
    cpuUsage: number;
    recommendations: number;
  } {
    if (!this.currentMetrics) {
      return {
        uptime: 0,
        averageResponseTime: 0,
        totalThroughput: 0,
        errorRate: 0,
        memoryUsage: 0,
        cpuUsage: 0,
        recommendations: 0
      };
    }

    return {
      uptime: this.currentMetrics.system.uptime,
      averageResponseTime: this.currentMetrics.performance.responseTime,
      totalThroughput: this.currentMetrics.performance.throughput,
      errorRate: this.currentMetrics.performance.errorRate,
      memoryUsage: (this.currentMetrics.system.memoryUsage / this.currentMetrics.system.memoryLimit) * 100,
      cpuUsage: this.currentMetrics.system.cpuUsage,
      recommendations: 0 // Would track active recommendations
    };
  }

  /**
   * Shutdown the performance optimizer
   */
  shutdown(): void {
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
    }

    if (this.gcObserver) {
      this.gcObserver.disconnect();
    }

    if ((this as any).profilerSession) {
      try {
        (this as any).profilerSession.post('Profiler.disable');
        (this as any).profilerSession.disconnect();
      } catch (error) {
        this.logger.warn('Error disabling profiler', error);
      }
    }

    this.logger.info('Performance optimizer shutdown completed');
  }
}