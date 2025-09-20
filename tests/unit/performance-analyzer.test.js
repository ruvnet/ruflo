import { jest } from '@jest/globals';
import { PerformanceAnalyzer } from '../../lib/performance-analyzer.js';

describe('PerformanceAnalyzer Unit Tests', () => {
  let performanceAnalyzer;

  beforeEach(async () => {
    performanceAnalyzer = new PerformanceAnalyzer();
    await performanceAnalyzer.init();
  });

  afterEach(async () => {
    if (performanceAnalyzer && performanceAnalyzer.cleanup) {
      await performanceAnalyzer.cleanup();
    }
  });

  describe('Initialization', () => {
    test('should initialize successfully', () => {
      expect(performanceAnalyzer.initialized).toBe(true);
      expect(performanceAnalyzer.metrics).toBeDefined();
      expect(performanceAnalyzer.bottlenecks).toBeDefined();
      expect(performanceAnalyzer.benchmarks).toBeDefined();
    });

    test('should have default configuration', () => {
      expect(performanceAnalyzer.config.metricsRetentionPeriod).toBe(604800000); // 7 days
      expect(performanceAnalyzer.config.bottleneckThreshold).toBe(0.8);
      expect(performanceAnalyzer.config.benchmarkSamples).toBe(100);
      expect(performanceAnalyzer.config.alertThreshold).toBe(0.9);
      expect(performanceAnalyzer.config.enableRealTimeMonitoring).toBe(true);
    });

    test('should initialize helper components', () => {
      expect(performanceAnalyzer.metricsCollector).toBeDefined();
      expect(performanceAnalyzer.bottleneckDetector).toBeDefined();
      expect(performanceAnalyzer.tokenTracker).toBeDefined();
      expect(performanceAnalyzer.benchmarker).toBeDefined();
      expect(performanceAnalyzer.trendAnalyzer).toBeDefined();
      expect(performanceAnalyzer.costCalculator).toBeDefined();
      expect(performanceAnalyzer.qualityAssessor).toBeDefined();
      expect(performanceAnalyzer.errorAnalyzer).toBeDefined();
      expect(performanceAnalyzer.usageStats).toBeDefined();
      expect(performanceAnalyzer.healthMonitor).toBeDefined();
      expect(performanceAnalyzer.optimizer).toBeDefined();
      expect(performanceAnalyzer.baselineManager).toBeDefined();
      expect(performanceAnalyzer.alertManager).toBeDefined();
      expect(performanceAnalyzer.capacityPlanner).toBeDefined();
      expect(performanceAnalyzer.regressionDetector).toBeDefined();
      expect(performanceAnalyzer.loadSimulator).toBeDefined();
    });

    test('should initialize performance tracking', () => {
      expect(performanceAnalyzer.performanceData.requests).toBeDefined();
      expect(performanceAnalyzer.performanceData.responses).toBeDefined();
      expect(performanceAnalyzer.performanceData.errors).toBeDefined();
      expect(performanceAnalyzer.performanceData.metrics).toBeDefined();
    });
  });

  describe('Performance Report Generation', () => {
    test('should generate summary performance report', async () => {
      const result = await performanceAnalyzer.execute('performance_report', {
        format: 'summary',
        timeframe: '24h'
      });

      expect(result.format).toBe('summary');
      expect(result.timeframe).toBe('24h');
      expect(result.report).toBeDefined();
      expect(result.report.overview).toBeDefined();
      expect(result.report.metrics).toBeDefined();
      expect(result.report.bottlenecks).toBeDefined();
      expect(result.report.recommendations).toBeDefined();
      expect(result.generatedAt).toBeDefined();
    });

    test('should generate detailed performance report', async () => {
      const result = await performanceAnalyzer.execute('performance_report', {
        format: 'detailed',
        timeframe: '7d'
      });

      expect(result.format).toBe('detailed');
      expect(result.report.detailed).toBeDefined();
      expect(result.report.trends).toBeDefined();
      expect(result.report.correlations).toBeDefined();
      expect(result.report.predictions).toBeDefined();
    });

    test('should generate JSON performance report', async () => {
      const result = await performanceAnalyzer.execute('performance_report', {
        format: 'json',
        timeframe: '30d'
      });

      expect(result.format).toBe('json');
      expect(typeof result.report).toBe('object');
      expect(result.exportSize).toBeGreaterThan(0);
    });

    test('should use default parameters when not specified', async () => {
      const result = await performanceAnalyzer.execute('performance_report', {});

      expect(result.format).toBe('summary');
      expect(result.timeframe).toBe('24h');
    });

    test('should throw error for unsupported format', async () => {
      await expect(
        performanceAnalyzer.execute('performance_report', {
          format: 'unsupported',
          timeframe: '1h'
        })
      ).rejects.toThrow('Unsupported report format: unsupported');
    });
  });

  describe('Bottleneck Analysis', () => {
    test('should analyze system bottlenecks', async () => {
      const result = await performanceAnalyzer.execute('bottleneck_analyze', {
        component: 'system',
        metrics: ['cpu', 'memory', 'disk', 'network']
      });

      expect(result.component).toBe('system');
      expect(result.metrics).toEqual(['cpu', 'memory', 'disk', 'network']);
      expect(result.bottlenecks).toBeDefined();
      expect(Array.isArray(result.bottlenecks)).toBe(true);
      expect(result.severity).toBeDefined();
      expect(result.recommendations).toBeDefined();
      expect(result.analysisTime).toBeGreaterThan(0);
    });

    test('should analyze specific component bottlenecks', async () => {
      const result = await performanceAnalyzer.execute('bottleneck_analyze', {
        component: 'database',
        metrics: ['query_time', 'connection_pool']
      });

      expect(result.component).toBe('database');
      expect(result.componentSpecific).toBe(true);
      expect(result.bottlenecks.some(b => b.type === 'database')).toBe(true);
    });

    test('should prioritize bottlenecks by severity', async () => {
      const result = await performanceAnalyzer.execute('bottleneck_analyze', {
        component: 'application'
      });

      expect(result.bottlenecks).toBeDefined();
      if (result.bottlenecks.length > 0) {
        expect(result.bottlenecks[0]).toHaveProperty('severity');
        expect(result.bottlenecks[0]).toHaveProperty('impact');
        expect(result.bottlenecks[0]).toHaveProperty('solution');
      }
    });

    test('should handle no bottlenecks found', async () => {
      const result = await performanceAnalyzer.execute('bottleneck_analyze', {
        component: 'optimal_system'
      });

      expect(result.bottlenecks).toHaveLength(0);
      expect(result.status).toBe('healthy');
    });
  });

  describe('Token Usage Analysis', () => {
    test('should analyze token usage for operation', async () => {
      const result = await performanceAnalyzer.execute('token_usage', {
        operation: 'chat_completion',
        timeframe: '24h'
      });

      expect(result.operation).toBe('chat_completion');
      expect(result.timeframe).toBe('24h');
      expect(result.usage).toBeDefined();
      expect(result.usage.totalTokens).toBeGreaterThanOrEqual(0);
      expect(result.usage.inputTokens).toBeGreaterThanOrEqual(0);
      expect(result.usage.outputTokens).toBeGreaterThanOrEqual(0);
      expect(result.usage.averagePerRequest).toBeGreaterThanOrEqual(0);
      expect(result.cost).toBeDefined();
    });

    test('should provide token usage breakdown', async () => {
      const result = await performanceAnalyzer.execute('token_usage', {
        operation: 'code_generation',
        detailed: true
      });

      expect(result.breakdown).toBeDefined();
      expect(result.breakdown.byModel).toBeDefined();
      expect(result.breakdown.byTimeOfDay).toBeDefined();
      expect(result.breakdown.peakUsage).toBeDefined();
    });

    test('should calculate cost metrics', async () => {
      const result = await performanceAnalyzer.execute('token_usage', {
        operation: 'summarization'
      });

      expect(result.cost.total).toBeGreaterThanOrEqual(0);
      expect(result.cost.perToken).toBeGreaterThan(0);
      expect(result.cost.projected).toBeDefined();
    });

    test('should analyze usage trends', async () => {
      const result = await performanceAnalyzer.execute('token_usage', {
        operation: 'translation',
        timeframe: '7d'
      });

      expect(result.trends).toBeDefined();
      expect(result.trends.growth).toBeDefined();
      expect(result.trends.patterns).toBeDefined();
    });
  });

  describe('Benchmarking', () => {
    test('should run performance benchmark suite', async () => {
      const result = await performanceAnalyzer.execute('benchmark_run', {
        suite: 'full'
      });

      expect(result.suite).toBe('full');
      expect(result.results).toBeDefined();
      expect(result.results.overall).toBeDefined();
      expect(result.results.individual).toBeDefined();
      expect(result.baseline).toBeDefined();
      expect(result.comparison).toBeDefined();
      expect(result.recommendations).toBeDefined();
    });

    test('should run specific benchmark tests', async () => {
      const result = await performanceAnalyzer.execute('benchmark_run', {
        suite: 'cpu',
        tests: ['arithmetic', 'encryption', 'sorting']
      });

      expect(result.suite).toBe('cpu');
      expect(result.tests).toEqual(['arithmetic', 'encryption', 'sorting']);
      expect(result.results.individual).toHaveLength(3);
    });

    test('should compare against baseline', async () => {
      const result = await performanceAnalyzer.execute('benchmark_run', {
        suite: 'memory'
      });

      expect(result.baseline).toBeDefined();
      expect(result.comparison.improvement).toBeDefined();
      expect(result.comparison.regression).toBeDefined();
      expect(result.comparison.score).toBeGreaterThan(0);
    });

    test('should provide performance score', async () => {
      const result = await performanceAnalyzer.execute('benchmark_run', {
        suite: 'network'
      });

      expect(result.score).toBeGreaterThan(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.grade).toMatch(/^[A-F]$/);
    });
  });

  describe('Metrics Collection', () => {
    test('should collect system metrics', async () => {
      const result = await performanceAnalyzer.execute('metrics_collect', {
        components: ['cpu', 'memory', 'disk']
      });

      expect(result.components).toEqual(['cpu', 'memory', 'disk']);
      expect(result.metrics).toBeDefined();
      expect(result.metrics.cpu).toBeDefined();
      expect(result.metrics.memory).toBeDefined();
      expect(result.metrics.disk).toBeDefined();
      expect(result.timestamp).toBeDefined();
      expect(result.collectionTime).toBeGreaterThan(0);
    });

    test('should collect all available metrics', async () => {
      const result = await performanceAnalyzer.execute('metrics_collect', {});

      expect(result.components).toContain('cpu');
      expect(result.components).toContain('memory');
      expect(result.components).toContain('network');
      expect(result.components).toContain('disk');
      expect(Object.keys(result.metrics)).toHaveLength(result.components.length);
    });

    test('should provide historical comparison', async () => {
      const result = await performanceAnalyzer.execute('metrics_collect', {
        components: ['cpu'],
        includeHistory: true
      });

      expect(result.history).toBeDefined();
      expect(result.comparison).toBeDefined();
      expect(result.trends).toBeDefined();
    });

    test('should handle missing components gracefully', async () => {
      const result = await performanceAnalyzer.execute('metrics_collect', {
        components: ['invalid_component']
      });

      expect(result.warnings).toBeDefined();
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('Trend Analysis', () => {
    test('should analyze performance trends', async () => {
      const result = await performanceAnalyzer.execute('trend_analysis', {
        metric: 'response_time',
        period: '30d'
      });

      expect(result.metric).toBe('response_time');
      expect(result.period).toBe('30d');
      expect(result.trends).toBeDefined();
      expect(result.trends.direction).toMatch(/^(increasing|decreasing|stable)$/);
      expect(result.trends.strength).toBeGreaterThanOrEqual(0);
      expect(result.trends.confidence).toBeGreaterThanOrEqual(0);
      expect(result.predictions).toBeDefined();
    });

    test('should identify seasonal patterns', async () => {
      const result = await performanceAnalyzer.execute('trend_analysis', {
        metric: 'throughput',
        period: '90d'
      });

      expect(result.patterns).toBeDefined();
      expect(result.patterns.seasonal).toBeDefined();
      expect(result.patterns.cyclical).toBeDefined();
      expect(result.patterns.anomalies).toBeDefined();
    });

    test('should provide future predictions', async () => {
      const result = await performanceAnalyzer.execute('trend_analysis', {
        metric: 'error_rate',
        period: '7d'
      });

      expect(result.predictions.shortTerm).toBeDefined();
      expect(result.predictions.longTerm).toBeDefined();
      expect(result.predictions.confidence).toBeDefined();
    });
  });

  describe('Cost Analysis', () => {
    test('should analyze resource costs', async () => {
      const result = await performanceAnalyzer.execute('cost_analysis', {
        timeframe: '30d'
      });

      expect(result.timeframe).toBe('30d');
      expect(result.costs).toBeDefined();
      expect(result.costs.total).toBeGreaterThanOrEqual(0);
      expect(result.costs.breakdown).toBeDefined();
      expect(result.costs.trends).toBeDefined();
      expect(result.optimization).toBeDefined();
      expect(result.projections).toBeDefined();
    });

    test('should break down costs by category', async () => {
      const result = await performanceAnalyzer.execute('cost_analysis', {
        timeframe: '7d'
      });

      expect(result.costs.breakdown.compute).toBeDefined();
      expect(result.costs.breakdown.storage).toBeDefined();
      expect(result.costs.breakdown.network).toBeDefined();
      expect(result.costs.breakdown.api_calls).toBeDefined();
    });

    test('should provide optimization recommendations', async () => {
      const result = await performanceAnalyzer.execute('cost_analysis', {
        timeframe: '1d'
      });

      expect(result.optimization.recommendations).toBeDefined();
      expect(result.optimization.potentialSavings).toBeGreaterThanOrEqual(0);
      expect(result.optimization.priorityActions).toBeDefined();
    });
  });

  describe('Quality Assessment', () => {
    test('should assess overall quality', async () => {
      const result = await performanceAnalyzer.execute('quality_assess', {
        target: 'system',
        criteria: ['performance', 'reliability', 'security']
      });

      expect(result.target).toBe('system');
      expect(result.criteria).toEqual(['performance', 'reliability', 'security']);
      expect(result.assessment).toBeDefined();
      expect(result.assessment.overall).toBeDefined();
      expect(result.assessment.detailed).toBeDefined();
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.recommendations).toBeDefined();
    });

    test('should assess specific component quality', async () => {
      const result = await performanceAnalyzer.execute('quality_assess', {
        target: 'api',
        criteria: ['response_time', 'error_rate', 'throughput']
      });

      expect(result.target).toBe('api');
      expect(result.assessment.detailed.response_time).toBeDefined();
      expect(result.assessment.detailed.error_rate).toBeDefined();
      expect(result.assessment.detailed.throughput).toBeDefined();
    });

    test('should provide quality grade', async () => {
      const result = await performanceAnalyzer.execute('quality_assess', {
        target: 'database'
      });

      expect(result.grade).toMatch(/^[A-F]$/);
      expect(result.passedCriteria).toBeGreaterThanOrEqual(0);
      expect(result.failedCriteria).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error Analysis', () => {
    test('should analyze error patterns', async () => {
      const result = await performanceAnalyzer.execute('error_analysis', {
        logs: ['error.log', 'application.log']
      });

      expect(result.logs).toEqual(['error.log', 'application.log']);
      expect(result.analysis).toBeDefined();
      expect(result.analysis.totalErrors).toBeGreaterThanOrEqual(0);
      expect(result.analysis.patterns).toBeDefined();
      expect(result.analysis.categories).toBeDefined();
      expect(result.analysis.trends).toBeDefined();
      expect(result.recommendations).toBeDefined();
    });

    test('should categorize errors by type', async () => {
      const result = await performanceAnalyzer.execute('error_analysis', {
        logs: ['system.log']
      });

      expect(result.analysis.categories.runtime).toBeGreaterThanOrEqual(0);
      expect(result.analysis.categories.network).toBeGreaterThanOrEqual(0);
      expect(result.analysis.categories.database).toBeGreaterThanOrEqual(0);
      expect(result.analysis.categories.authentication).toBeGreaterThanOrEqual(0);
    });

    test('should identify error hotspots', async () => {
      const result = await performanceAnalyzer.execute('error_analysis', {
        logs: ['api.log']
      });

      expect(result.analysis.hotspots).toBeDefined();
      expect(result.analysis.criticalErrors).toBeDefined();
      expect(result.analysis.errorRate).toBeGreaterThanOrEqual(0);
    });

    test('should handle empty logs gracefully', async () => {
      const result = await performanceAnalyzer.execute('error_analysis', {
        logs: []
      });

      expect(result.analysis.totalErrors).toBe(0);
      expect(result.status).toBe('no_data');
    });
  });

  describe('Usage Statistics', () => {
    test('should collect usage statistics for component', async () => {
      const result = await performanceAnalyzer.execute('usage_stats', {
        component: 'api'
      });

      expect(result.component).toBe('api');
      expect(result.statistics).toBeDefined();
      expect(result.statistics.totalRequests).toBeGreaterThanOrEqual(0);
      expect(result.statistics.uniqueUsers).toBeGreaterThanOrEqual(0);
      expect(result.statistics.averageResponseTime).toBeGreaterThanOrEqual(0);
      expect(result.statistics.peakUsage).toBeDefined();
      expect(result.timeframe).toBeDefined();
    });

    test('should provide usage breakdown', async () => {
      const result = await performanceAnalyzer.execute('usage_stats', {
        component: 'database'
      });

      expect(result.statistics.breakdown).toBeDefined();
      expect(result.statistics.breakdown.byEndpoint).toBeDefined();
      expect(result.statistics.breakdown.byTime).toBeDefined();
      expect(result.statistics.breakdown.byUser).toBeDefined();
    });

    test('should calculate usage trends', async () => {
      const result = await performanceAnalyzer.execute('usage_stats', {
        component: 'cache'
      });

      expect(result.trends).toBeDefined();
      expect(result.trends.growth).toBeDefined();
      expect(result.trends.patterns).toBeDefined();
      expect(result.predictions).toBeDefined();
    });

    test('should handle component without usage data', async () => {
      const result = await performanceAnalyzer.execute('usage_stats', {
        component: 'unused_component'
      });

      expect(result.statistics.totalRequests).toBe(0);
      expect(result.status).toBe('no_activity');
    });
  });

  describe('Health Monitoring', () => {
    test('should check health of all components', async () => {
      const result = await performanceAnalyzer.execute('health_check', {
        components: ['api', 'database', 'cache', 'queue']
      });

      expect(result.components).toEqual(['api', 'database', 'cache', 'queue']);
      expect(result.health).toBeDefined();
      expect(result.overall).toMatch(/^(healthy|warning|critical)$/);
      expect(result.details).toBeDefined();
      expect(result.timestamp).toBeDefined();
      expect(result.checkDuration).toBeGreaterThan(0);
    });

    test('should check health with detailed analysis', async () => {
      const result = await performanceAnalyzer.execute('health_check', {
        components: ['system'],
        detailed: true
      });

      expect(result.detailed).toBe(true);
      expect(result.details.system.metrics).toBeDefined();
      expect(result.details.system.thresholds).toBeDefined();
      expect(result.details.system.alerts).toBeDefined();
    });

    test('should provide health recommendations', async () => {
      const result = await performanceAnalyzer.execute('health_check', {
        components: ['application']
      });

      expect(result.recommendations).toBeDefined();
      expect(Array.isArray(result.recommendations)).toBe(true);
      expect(result.actionRequired).toBeDefined();
    });

    test('should handle unhealthy components', async () => {
      const result = await performanceAnalyzer.execute('health_check', {
        components: ['failing_component']
      });

      expect(result.overall).toBe('critical');
      expect(result.issues).toBeDefined();
      expect(result.issues.length).toBeGreaterThan(0);
    });
  });

  describe('Performance Optimization', () => {
    test('should optimize performance based on metrics', async () => {
      const result = await performanceAnalyzer.execute('performance_optimize', {
        target: 'response_time',
        strategy: 'aggressive'
      });

      expect(result.target).toBe('response_time');
      expect(result.strategy).toBe('aggressive');
      expect(result.optimizations).toBeDefined();
      expect(result.optimizations.applied).toBeDefined();
      expect(result.optimizations.recommendations).toBeDefined();
      expect(result.impact).toBeDefined();
      expect(result.improvement).toBeGreaterThanOrEqual(0);
    });

    test('should use conservative optimization strategy', async () => {
      const result = await performanceAnalyzer.execute('performance_optimize', {
        target: 'throughput',
        strategy: 'conservative'
      });

      expect(result.strategy).toBe('conservative');
      expect(result.optimizations.applied.length).toBeLessThanOrEqual(5);
      expect(result.risk).toBe('low');
    });

    test('should provide optimization rollback plan', async () => {
      const result = await performanceAnalyzer.execute('performance_optimize', {
        target: 'memory_usage'
      });

      expect(result.rollback).toBeDefined();
      expect(result.rollback.plan).toBeDefined();
      expect(result.rollback.steps).toBeDefined();
    });
  });

  describe('Baseline Management', () => {
    test('should establish performance baseline', async () => {
      const result = await performanceAnalyzer.execute('baseline_manage', {
        action: 'establish',
        metrics: ['cpu', 'memory', 'response_time']
      });

      expect(result.action).toBe('establish');
      expect(result.metrics).toEqual(['cpu', 'memory', 'response_time']);
      expect(result.baseline).toBeDefined();
      expect(result.baseline.cpu).toBeDefined();
      expect(result.baseline.memory).toBeDefined();
      expect(result.baseline.response_time).toBeDefined();
      expect(result.establishedAt).toBeDefined();
    });

    test('should update existing baseline', async () => {
      const result = await performanceAnalyzer.execute('baseline_manage', {
        action: 'update',
        baselineId: 'test-baseline-123'
      });

      expect(result.action).toBe('update');
      expect(result.baselineId).toBe('test-baseline-123');
      expect(result.updatedAt).toBeDefined();
      expect(result.changes).toBeDefined();
    });

    test('should compare against baseline', async () => {
      const result = await performanceAnalyzer.execute('baseline_manage', {
        action: 'compare',
        baselineId: 'test-baseline-123'
      });

      expect(result.action).toBe('compare');
      expect(result.comparison).toBeDefined();
      expect(result.deviations).toBeDefined();
      expect(result.alertsTriggered).toBeGreaterThanOrEqual(0);
    });

    test('should list all baselines', async () => {
      const result = await performanceAnalyzer.execute('baseline_manage', {
        action: 'list'
      });

      expect(result.action).toBe('list');
      expect(Array.isArray(result.baselines)).toBe(true);
      expect(result.total).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Alert Configuration', () => {
    test('should configure performance alerts', async () => {
      const result = await performanceAnalyzer.execute('alert_config', {
        metric: 'cpu_usage',
        threshold: 80,
        condition: 'greater_than',
        action: 'notify'
      });

      expect(result.metric).toBe('cpu_usage');
      expect(result.threshold).toBe(80);
      expect(result.condition).toBe('greater_than');
      expect(result.action).toBe('notify');
      expect(result.alertId).toBeDefined();
      expect(result.status).toBe('active');
    });

    test('should configure complex alert conditions', async () => {
      const result = await performanceAnalyzer.execute('alert_config', {
        metric: 'response_time',
        threshold: 1000,
        condition: 'greater_than',
        duration: 300, // 5 minutes
        action: 'escalate'
      });

      expect(result.duration).toBe(300);
      expect(result.action).toBe('escalate');
      expect(result.complexity).toBe('advanced');
    });

    test('should manage alert subscriptions', async () => {
      const result = await performanceAnalyzer.execute('alert_config', {
        action: 'subscribe',
        alertId: 'alert-123',
        channels: ['email', 'slack', 'webhook']
      });

      expect(result.action).toBe('subscribe');
      expect(result.channels).toEqual(['email', 'slack', 'webhook']);
      expect(result.subscribed).toBe(true);
    });
  });

  describe('Capacity Planning', () => {
    test('should perform capacity planning analysis', async () => {
      const result = await performanceAnalyzer.execute('capacity_plan', {
        horizon: '6months',
        growth: 25, // 25% growth expected
        metrics: ['cpu', 'memory', 'storage']
      });

      expect(result.horizon).toBe('6months');
      expect(result.growth).toBe(25);
      expect(result.metrics).toEqual(['cpu', 'memory', 'storage']);
      expect(result.plan).toBeDefined();
      expect(result.recommendations).toBeDefined();
      expect(result.timeline).toBeDefined();
      expect(result.costs).toBeDefined();
    });

    test('should predict resource requirements', async () => {
      const result = await performanceAnalyzer.execute('capacity_plan', {
        horizon: '1year',
        scenarios: ['conservative', 'expected', 'aggressive']
      });

      expect(result.scenarios).toEqual(['conservative', 'expected', 'aggressive']);
      expect(result.predictions.conservative).toBeDefined();
      expect(result.predictions.expected).toBeDefined();
      expect(result.predictions.aggressive).toBeDefined();
    });

    test('should provide scaling recommendations', async () => {
      const result = await performanceAnalyzer.execute('capacity_plan', {
        horizon: '3months'
      });

      expect(result.scaling).toBeDefined();
      expect(result.scaling.horizontal).toBeDefined();
      expect(result.scaling.vertical).toBeDefined();
      expect(result.scaling.priority).toBeDefined();
    });
  });

  describe('Regression Detection', () => {
    test('should detect performance regressions', async () => {
      const result = await performanceAnalyzer.execute('regression_detect', {
        metrics: ['response_time', 'throughput'],
        timeframe: '7d',
        sensitivity: 'medium'
      });

      expect(result.metrics).toEqual(['response_time', 'throughput']);
      expect(result.timeframe).toBe('7d');
      expect(result.sensitivity).toBe('medium');
      expect(result.regressions).toBeDefined();
      expect(Array.isArray(result.regressions)).toBe(true);
      expect(result.analysis).toBeDefined();
    });

    test('should identify root causes', async () => {
      const result = await performanceAnalyzer.execute('regression_detect', {
        metrics: ['memory_usage'],
        analysis: 'detailed'
      });

      expect(result.analysis).toBe('detailed');
      expect(result.rootCause).toBeDefined();
      expect(result.correlations).toBeDefined();
      expect(result.timeline).toBeDefined();
    });

    test('should handle no regressions found', async () => {
      const result = await performanceAnalyzer.execute('regression_detect', {
        metrics: ['stable_metric']
      });

      expect(result.regressions).toHaveLength(0);
      expect(result.status).toBe('stable');
    });
  });

  describe('Load Simulation', () => {
    test('should simulate load scenarios', async () => {
      const result = await performanceAnalyzer.execute('load_simulate', {
        scenario: 'peak_traffic',
        duration: 300, // 5 minutes
        concurrency: 100
      });

      expect(result.scenario).toBe('peak_traffic');
      expect(result.duration).toBe(300);
      expect(result.concurrency).toBe(100);
      expect(result.simulation).toBeDefined();
      expect(result.results).toBeDefined();
      expect(result.metrics).toBeDefined();
      expect(result.bottlenecks).toBeDefined();
    });

    test('should provide load test results', async () => {
      const result = await performanceAnalyzer.execute('load_simulate', {
        scenario: 'stress_test',
        rampUp: 60, // 1 minute ramp up
        sustainPeriod: 180 // 3 minutes sustain
      });

      expect(result.rampUp).toBe(60);
      expect(result.sustainPeriod).toBe(180);
      expect(result.results.averageResponseTime).toBeGreaterThan(0);
      expect(result.results.throughput).toBeGreaterThan(0);
      expect(result.results.errorRate).toBeGreaterThanOrEqual(0);
    });

    test('should identify breaking points', async () => {
      const result = await performanceAnalyzer.execute('load_simulate', {
        scenario: 'breaking_point',
        incremental: true
      });

      expect(result.incremental).toBe(true);
      expect(result.breakingPoint).toBeDefined();
      expect(result.maxConcurrency).toBeGreaterThan(0);
      expect(result.recommendations).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    test('should throw error for unknown tool', async () => {
      await expect(
        performanceAnalyzer.execute('unknown_tool', {})
      ).rejects.toThrow('Unknown performance tool: unknown_tool');
    });

    test('should handle invalid metric names', async () => {
      await expect(
        performanceAnalyzer.execute('metrics_collect', {
          components: ['invalid_metric_name']
        })
      ).rejects.toThrow('Invalid component: invalid_metric_name');
    });

    test('should handle missing required parameters', async () => {
      await expect(
        performanceAnalyzer.execute('alert_config', {
          // Missing required parameters
        })
      ).rejects.toThrow('Missing required parameters for alert configuration');
    });
  });

  describe('Health and Capabilities', () => {
    test('should report healthy status', async () => {
      const health = await performanceAnalyzer.getHealth();

      expect(health.status).toBe('healthy');
      expect(health.initialized).toBe(true);
      expect(health.metricsCollected).toBeGreaterThanOrEqual(0);
      expect(health.activeAlerts).toBeGreaterThanOrEqual(0);
      expect(health.lastAnalysis).toBeDefined();
    });

    test('should report capabilities', () => {
      const capabilities = performanceAnalyzer.getCapabilities();

      expect(capabilities).toContain('performance-reporting');
      expect(capabilities).toContain('bottleneck-detection');
      expect(capabilities).toContain('token-usage-tracking');
      expect(capabilities).toContain('benchmarking');
      expect(capabilities).toContain('metrics-collection');
      expect(capabilities).toContain('trend-analysis');
      expect(capabilities).toContain('cost-analysis');
      expect(capabilities).toContain('quality-assessment');
      expect(capabilities).toContain('error-analysis');
      expect(capabilities).toContain('usage-statistics');
      expect(capabilities).toContain('health-monitoring');
      expect(capabilities).toContain('performance-optimization');
      expect(capabilities).toContain('baseline-management');
      expect(capabilities).toContain('alert-configuration');
      expect(capabilities).toContain('capacity-planning');
      expect(capabilities).toContain('regression-detection');
      expect(capabilities).toContain('load-simulation');
    });

    test('should report healthy when initialized', () => {
      expect(performanceAnalyzer.isHealthy()).toBe(true);
    });

    test('should provide performance metrics in health check', async () => {
      const health = await performanceAnalyzer.getHealth();

      expect(health.metrics).toBeDefined();
      expect(health.metrics.totalAnalyses).toBeGreaterThanOrEqual(0);
      expect(health.metrics.averageAnalysisTime).toBeGreaterThanOrEqual(0);
      expect(health.metrics.successRate).toBeGreaterThanOrEqual(0);
    });
  });
});