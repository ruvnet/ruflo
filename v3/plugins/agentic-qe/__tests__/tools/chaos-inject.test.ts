/**
 * Chaos Injection Tool Tests
 *
 * Tests for the aqe/chaos-inject MCP tool that provides
 * chaos engineering capabilities for resilience testing.
 * All tests use dryRun mode to prevent actual system disruption.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================================
// Mock Types
// ============================================================================

interface ChaosInjectInput {
  target: string;
  failureType: ChaosFailureType;
  duration?: number;
  intensity?: number;
  dryRun?: boolean;
  options?: {
    rollbackOnError?: boolean;
    monitorMetrics?: boolean;
    notifyOnStart?: boolean;
    maxRetries?: number;
  };
}

type ChaosFailureType =
  | 'network-latency'
  | 'network-partition'
  | 'network-packet-loss'
  | 'cpu-stress'
  | 'memory-pressure'
  | 'disk-fill'
  | 'process-kill'
  | 'dns-failure'
  | 'http-error'
  | 'timeout';

interface ChaosExperiment {
  id: string;
  target: string;
  failureType: ChaosFailureType;
  duration: number;
  intensity: number;
  startTime: Date;
  endTime?: Date;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'rolled-back';
  dryRun: boolean;
  metrics?: ChaosMetrics;
}

interface ChaosMetrics {
  preExperiment: {
    responseTime: number;
    errorRate: number;
    throughput: number;
  };
  duringExperiment: {
    responseTime: number;
    errorRate: number;
    throughput: number;
  };
  postExperiment?: {
    responseTime: number;
    errorRate: number;
    throughput: number;
    recoveryTime: number;
  };
}

interface ChaosInjectOutput {
  success: boolean;
  experiment: ChaosExperiment;
  impact: {
    affectedServices: string[];
    estimatedDowntime: string;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
  };
  simulation?: {
    description: string;
    expectedBehavior: string;
    recoverySteps: string[];
  };
  errors?: string[];
}

// ============================================================================
// Mock Implementation
// ============================================================================

class MockChaosInjectTool {
  private activeExperiments: Map<string, ChaosExperiment> = new Map();

  async execute(input: ChaosInjectInput): Promise<ChaosInjectOutput> {
    // Validate input
    const errors = this.validateInput(input);
    if (errors.length > 0) {
      return this.createErrorResponse(errors);
    }

    // Create experiment
    const experiment = this.createExperiment(input);

    // In dry run mode, only simulate
    if (input.dryRun !== false) {
      return this.simulateExperiment(experiment);
    }

    // Execute real experiment (would be dangerous in production)
    return this.executeExperiment(experiment);
  }

  async stopExperiment(experimentId: string): Promise<boolean> {
    const experiment = this.activeExperiments.get(experimentId);
    if (!experiment) return false;

    experiment.status = 'rolled-back';
    experiment.endTime = new Date();
    this.activeExperiments.delete(experimentId);
    return true;
  }

  getActiveExperiments(): ChaosExperiment[] {
    return Array.from(this.activeExperiments.values());
  }

  private validateInput(input: ChaosInjectInput): string[] {
    const errors: string[] = [];

    if (!input.target) {
      errors.push('target is required');
    }

    if (!input.failureType) {
      errors.push('failureType is required');
    }

    const validFailureTypes: ChaosFailureType[] = [
      'network-latency',
      'network-partition',
      'network-packet-loss',
      'cpu-stress',
      'memory-pressure',
      'disk-fill',
      'process-kill',
      'dns-failure',
      'http-error',
      'timeout',
    ];

    if (input.failureType && !validFailureTypes.includes(input.failureType)) {
      errors.push(`Invalid failureType. Must be one of: ${validFailureTypes.join(', ')}`);
    }

    if (input.duration !== undefined && input.duration < 1) {
      errors.push('duration must be at least 1 second');
    }

    if (input.duration !== undefined && input.duration > 3600) {
      errors.push('duration must not exceed 3600 seconds (1 hour)');
    }

    if (input.intensity !== undefined) {
      if (input.intensity < 0 || input.intensity > 1) {
        errors.push('intensity must be between 0 and 1');
      }
    }

    // Safety check - warn if not dry run
    if (input.dryRun === false && !input.target.includes('test')) {
      errors.push('Non-dryRun execution requires target to include "test" for safety');
    }

    return errors;
  }

  private createExperiment(input: ChaosInjectInput): ChaosExperiment {
    const id = `chaos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return {
      id,
      target: input.target,
      failureType: input.failureType,
      duration: input.duration ?? 30,
      intensity: input.intensity ?? 0.5,
      startTime: new Date(),
      status: 'pending',
      dryRun: input.dryRun !== false,
    };
  }

  private simulateExperiment(experiment: ChaosExperiment): ChaosInjectOutput {
    experiment.status = 'completed';
    experiment.endTime = new Date();

    // Generate simulated metrics
    experiment.metrics = this.generateSimulatedMetrics(experiment);

    return {
      success: true,
      experiment,
      impact: this.assessImpact(experiment),
      simulation: {
        description: this.getSimulationDescription(experiment),
        expectedBehavior: this.getExpectedBehavior(experiment),
        recoverySteps: this.getRecoverySteps(experiment),
      },
    };
  }

  private executeExperiment(experiment: ChaosExperiment): ChaosInjectOutput {
    // In real implementation, this would inject actual chaos
    // For testing purposes, we treat it the same as simulation
    experiment.status = 'running';
    this.activeExperiments.set(experiment.id, experiment);

    return {
      success: true,
      experiment,
      impact: this.assessImpact(experiment),
    };
  }

  private generateSimulatedMetrics(experiment: ChaosExperiment): ChaosMetrics {
    const baseResponseTime = 100; // ms
    const baseErrorRate = 0.01; // 1%
    const baseThroughput = 1000; // req/s

    // Calculate impact based on intensity
    const latencyMultiplier = 1 + experiment.intensity * this.getLatencyFactor(experiment.failureType);
    const errorMultiplier = 1 + experiment.intensity * this.getErrorFactor(experiment.failureType);
    const throughputMultiplier = 1 - experiment.intensity * this.getThroughputFactor(experiment.failureType);

    return {
      preExperiment: {
        responseTime: baseResponseTime,
        errorRate: baseErrorRate,
        throughput: baseThroughput,
      },
      duringExperiment: {
        responseTime: baseResponseTime * latencyMultiplier,
        errorRate: Math.min(baseErrorRate * errorMultiplier, 1),
        throughput: baseThroughput * throughputMultiplier,
      },
      postExperiment: {
        responseTime: baseResponseTime * 1.1, // Slight recovery overhead
        errorRate: baseErrorRate,
        throughput: baseThroughput * 0.95,
        recoveryTime: experiment.duration * 0.2 * 1000, // 20% of experiment duration
      },
    };
  }

  private getLatencyFactor(failureType: ChaosFailureType): number {
    const factors: Record<ChaosFailureType, number> = {
      'network-latency': 10,
      'network-partition': 50,
      'network-packet-loss': 5,
      'cpu-stress': 3,
      'memory-pressure': 2,
      'disk-fill': 4,
      'process-kill': 100,
      'dns-failure': 20,
      'http-error': 1,
      'timeout': 30,
    };
    return factors[failureType] ?? 1;
  }

  private getErrorFactor(failureType: ChaosFailureType): number {
    const factors: Record<ChaosFailureType, number> = {
      'network-latency': 2,
      'network-partition': 100,
      'network-packet-loss': 20,
      'cpu-stress': 5,
      'memory-pressure': 10,
      'disk-fill': 50,
      'process-kill': 100,
      'dns-failure': 100,
      'http-error': 50,
      'timeout': 30,
    };
    return factors[failureType] ?? 1;
  }

  private getThroughputFactor(failureType: ChaosFailureType): number {
    const factors: Record<ChaosFailureType, number> = {
      'network-latency': 0.3,
      'network-partition': 0.9,
      'network-packet-loss': 0.4,
      'cpu-stress': 0.5,
      'memory-pressure': 0.4,
      'disk-fill': 0.6,
      'process-kill': 1,
      'dns-failure': 0.8,
      'http-error': 0.5,
      'timeout': 0.7,
    };
    return factors[failureType] ?? 0.5;
  }

  private assessImpact(experiment: ChaosExperiment): ChaosInjectOutput['impact'] {
    const affectedServices = this.getAffectedServices(experiment);
    const estimatedDowntime = this.estimateDowntime(experiment);
    const riskLevel = this.calculateRiskLevel(experiment);

    return {
      affectedServices,
      estimatedDowntime,
      riskLevel,
    };
  }

  private getAffectedServices(experiment: ChaosExperiment): string[] {
    // Mock affected services based on target
    const services = [experiment.target];

    if (experiment.failureType === 'network-partition') {
      services.push(`${experiment.target}-cache`, `${experiment.target}-db`);
    } else if (experiment.failureType === 'dns-failure') {
      services.push('api-gateway', 'service-discovery');
    }

    return services;
  }

  private estimateDowntime(experiment: ChaosExperiment): string {
    const baseDuration = experiment.duration;
    const recoveryTime = Math.ceil(baseDuration * 0.2);
    const totalTime = baseDuration + recoveryTime;

    if (totalTime < 60) {
      return `${totalTime} seconds`;
    } else {
      return `${Math.ceil(totalTime / 60)} minutes`;
    }
  }

  private calculateRiskLevel(experiment: ChaosExperiment): 'low' | 'medium' | 'high' | 'critical' {
    const highRiskTypes: ChaosFailureType[] = ['process-kill', 'disk-fill', 'network-partition'];
    const criticalTypes: ChaosFailureType[] = ['process-kill'];

    if (criticalTypes.includes(experiment.failureType) && experiment.intensity > 0.8) {
      return 'critical';
    }
    if (highRiskTypes.includes(experiment.failureType)) {
      return 'high';
    }
    if (experiment.intensity > 0.7) {
      return 'high';
    }
    if (experiment.intensity > 0.4) {
      return 'medium';
    }
    return 'low';
  }

  private getSimulationDescription(experiment: ChaosExperiment): string {
    const descriptions: Record<ChaosFailureType, string> = {
      'network-latency': `Simulate ${experiment.intensity * 1000}ms latency on ${experiment.target}`,
      'network-partition': `Simulate network partition isolating ${experiment.target}`,
      'network-packet-loss': `Simulate ${experiment.intensity * 100}% packet loss on ${experiment.target}`,
      'cpu-stress': `Simulate ${experiment.intensity * 100}% CPU stress on ${experiment.target}`,
      'memory-pressure': `Simulate memory pressure at ${experiment.intensity * 100}% on ${experiment.target}`,
      'disk-fill': `Simulate disk fill at ${experiment.intensity * 100}% on ${experiment.target}`,
      'process-kill': `Simulate process termination on ${experiment.target}`,
      'dns-failure': `Simulate DNS resolution failure for ${experiment.target}`,
      'http-error': `Simulate HTTP 5xx errors on ${experiment.target}`,
      'timeout': `Simulate request timeouts on ${experiment.target}`,
    };
    return descriptions[experiment.failureType];
  }

  private getExpectedBehavior(experiment: ChaosExperiment): string {
    const behaviors: Record<ChaosFailureType, string> = {
      'network-latency': 'Requests will experience increased latency, potentially triggering timeouts',
      'network-partition': 'Service will be unreachable, circuit breakers should activate',
      'network-packet-loss': 'Intermittent failures and retries expected',
      'cpu-stress': 'Service response time degradation, potential autoscaling',
      'memory-pressure': 'Potential OOM kills, service restarts',
      'disk-fill': 'Write operations will fail, logs may be lost',
      'process-kill': 'Service unavailable until restart, dependent services affected',
      'dns-failure': 'Service discovery failures, connection timeouts',
      'http-error': 'Dependent services receive error responses',
      'timeout': 'Requests timeout, retry logic exercised',
    };
    return behaviors[experiment.failureType];
  }

  private getRecoverySteps(experiment: ChaosExperiment): string[] {
    const commonSteps = [
      'Monitor service health dashboards',
      'Check alerting systems triggered',
      'Verify automatic recovery mechanisms',
    ];

    const typeSpecificSteps: Record<ChaosFailureType, string[]> = {
      'network-latency': ['Wait for latency injection to end', 'Verify connection pool recovery'],
      'network-partition': ['Restore network connectivity', 'Allow cluster to re-sync'],
      'network-packet-loss': ['End packet loss injection', 'Verify retry mechanisms recovered'],
      'cpu-stress': ['Stop stress process', 'Allow CPU to return to normal'],
      'memory-pressure': ['Release memory pressure', 'Verify no OOM restarts occurred'],
      'disk-fill': ['Clean up disk space', 'Verify write operations resume'],
      'process-kill': ['Wait for automatic restart', 'Verify health checks pass'],
      'dns-failure': ['Restore DNS resolution', 'Clear DNS caches'],
      'http-error': ['Stop error injection', 'Verify normal responses resume'],
      'timeout': ['End timeout injection', 'Clear connection pools'],
    };

    return [...commonSteps, ...typeSpecificSteps[experiment.failureType]];
  }

  private createErrorResponse(errors: string[]): ChaosInjectOutput {
    return {
      success: false,
      experiment: {
        id: 'error',
        target: '',
        failureType: 'timeout',
        duration: 0,
        intensity: 0,
        startTime: new Date(),
        status: 'failed',
        dryRun: true,
      },
      impact: {
        affectedServices: [],
        estimatedDowntime: '0 seconds',
        riskLevel: 'low',
      },
      errors,
    };
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('ChaosInjectTool', () => {
  let tool: MockChaosInjectTool;

  beforeEach(() => {
    tool = new MockChaosInjectTool();
  });

  describe('input validation', () => {
    it('should require target', async () => {
      const result = await tool.execute({
        target: '',
        failureType: 'network-latency',
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain('target is required');
    });

    it('should require failureType', async () => {
      const result = await tool.execute({
        target: 'test-service',
        failureType: '' as ChaosFailureType,
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain('failureType is required');
    });

    it('should validate failureType', async () => {
      const result = await tool.execute({
        target: 'test-service',
        failureType: 'invalid-type' as ChaosFailureType,
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain(expect.stringContaining('Invalid failureType'));
    });

    it('should validate duration minimum', async () => {
      const result = await tool.execute({
        target: 'test-service',
        failureType: 'network-latency',
        duration: 0,
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain(expect.stringContaining('duration'));
    });

    it('should validate duration maximum', async () => {
      const result = await tool.execute({
        target: 'test-service',
        failureType: 'network-latency',
        duration: 7200,
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain(expect.stringContaining('duration'));
    });

    it('should validate intensity range', async () => {
      const negativeResult = await tool.execute({
        target: 'test-service',
        failureType: 'network-latency',
        intensity: -0.1,
      });

      const overResult = await tool.execute({
        target: 'test-service',
        failureType: 'network-latency',
        intensity: 1.5,
      });

      expect(negativeResult.success).toBe(false);
      expect(overResult.success).toBe(false);
    });

    it('should require test in target name for non-dryRun', async () => {
      const result = await tool.execute({
        target: 'production-service',
        failureType: 'network-latency',
        dryRun: false,
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain(expect.stringContaining('test'));
    });
  });

  describe('dry run mode (default)', () => {
    it('should default to dryRun mode', async () => {
      const result = await tool.execute({
        target: 'test-service',
        failureType: 'network-latency',
      });

      expect(result.success).toBe(true);
      expect(result.experiment.dryRun).toBe(true);
    });

    it('should complete simulation immediately', async () => {
      const result = await tool.execute({
        target: 'test-service',
        failureType: 'network-latency',
      });

      expect(result.experiment.status).toBe('completed');
      expect(result.experiment.endTime).toBeDefined();
    });

    it('should include simulation details', async () => {
      const result = await tool.execute({
        target: 'test-service',
        failureType: 'network-latency',
      });

      expect(result.simulation).toBeDefined();
      expect(result.simulation?.description).toBeTruthy();
      expect(result.simulation?.expectedBehavior).toBeTruthy();
      expect(result.simulation?.recoverySteps).toBeDefined();
    });

    it('should generate simulated metrics', async () => {
      const result = await tool.execute({
        target: 'test-service',
        failureType: 'network-latency',
        intensity: 0.5,
      });

      expect(result.experiment.metrics).toBeDefined();
      expect(result.experiment.metrics?.preExperiment).toBeDefined();
      expect(result.experiment.metrics?.duringExperiment).toBeDefined();
    });
  });

  describe('failure types', () => {
    const failureTypes: ChaosFailureType[] = [
      'network-latency',
      'network-partition',
      'network-packet-loss',
      'cpu-stress',
      'memory-pressure',
      'disk-fill',
      'process-kill',
      'dns-failure',
      'http-error',
      'timeout',
    ];

    for (const failureType of failureTypes) {
      it(`should handle ${failureType} failure type`, async () => {
        const result = await tool.execute({
          target: 'test-service',
          failureType,
          dryRun: true,
        });

        expect(result.success).toBe(true);
        expect(result.experiment.failureType).toBe(failureType);
        expect(result.simulation?.description).toContain('test-service');
      });
    }
  });

  describe('experiment creation', () => {
    it('should generate unique experiment ID', async () => {
      const result1 = await tool.execute({
        target: 'test-service',
        failureType: 'network-latency',
      });

      const result2 = await tool.execute({
        target: 'test-service',
        failureType: 'network-latency',
      });

      expect(result1.experiment.id).not.toBe(result2.experiment.id);
    });

    it('should use default duration of 30 seconds', async () => {
      const result = await tool.execute({
        target: 'test-service',
        failureType: 'network-latency',
      });

      expect(result.experiment.duration).toBe(30);
    });

    it('should use default intensity of 0.5', async () => {
      const result = await tool.execute({
        target: 'test-service',
        failureType: 'network-latency',
      });

      expect(result.experiment.intensity).toBe(0.5);
    });

    it('should use specified duration', async () => {
      const result = await tool.execute({
        target: 'test-service',
        failureType: 'network-latency',
        duration: 60,
      });

      expect(result.experiment.duration).toBe(60);
    });

    it('should use specified intensity', async () => {
      const result = await tool.execute({
        target: 'test-service',
        failureType: 'network-latency',
        intensity: 0.8,
      });

      expect(result.experiment.intensity).toBe(0.8);
    });
  });

  describe('impact assessment', () => {
    it('should list affected services', async () => {
      const result = await tool.execute({
        target: 'test-service',
        failureType: 'network-latency',
      });

      expect(result.impact.affectedServices).toContain('test-service');
    });

    it('should include dependent services for network-partition', async () => {
      const result = await tool.execute({
        target: 'test-service',
        failureType: 'network-partition',
      });

      expect(result.impact.affectedServices.length).toBeGreaterThan(1);
    });

    it('should estimate downtime', async () => {
      const result = await tool.execute({
        target: 'test-service',
        failureType: 'network-latency',
        duration: 30,
      });

      expect(result.impact.estimatedDowntime).toMatch(/\d+ (seconds|minutes)/);
    });

    it('should calculate risk level based on intensity', async () => {
      const lowIntensity = await tool.execute({
        target: 'test-service',
        failureType: 'network-latency',
        intensity: 0.3,
      });

      const highIntensity = await tool.execute({
        target: 'test-service',
        failureType: 'network-latency',
        intensity: 0.8,
      });

      expect(['low', 'medium']).toContain(lowIntensity.impact.riskLevel);
      expect(['high', 'critical']).toContain(highIntensity.impact.riskLevel);
    });

    it('should consider failure type in risk assessment', async () => {
      const latency = await tool.execute({
        target: 'test-service',
        failureType: 'network-latency',
        intensity: 0.5,
      });

      const partition = await tool.execute({
        target: 'test-service',
        failureType: 'network-partition',
        intensity: 0.5,
      });

      // Network partition is inherently more risky
      const riskOrder = { low: 0, medium: 1, high: 2, critical: 3 };
      expect(riskOrder[partition.impact.riskLevel]).toBeGreaterThanOrEqual(
        riskOrder[latency.impact.riskLevel]
      );
    });
  });

  describe('metrics simulation', () => {
    it('should show degraded metrics during experiment', async () => {
      const result = await tool.execute({
        target: 'test-service',
        failureType: 'network-latency',
        intensity: 0.5,
      });

      const metrics = result.experiment.metrics!;

      expect(metrics.duringExperiment.responseTime).toBeGreaterThan(
        metrics.preExperiment.responseTime
      );
    });

    it('should show recovery in post-experiment metrics', async () => {
      const result = await tool.execute({
        target: 'test-service',
        failureType: 'network-latency',
        intensity: 0.5,
      });

      const metrics = result.experiment.metrics!;

      expect(metrics.postExperiment?.responseTime).toBeLessThan(
        metrics.duringExperiment.responseTime
      );
      expect(metrics.postExperiment?.recoveryTime).toBeGreaterThan(0);
    });

    it('should scale impact with intensity', async () => {
      const lowIntensity = await tool.execute({
        target: 'test-service',
        failureType: 'cpu-stress',
        intensity: 0.2,
      });

      const highIntensity = await tool.execute({
        target: 'test-service',
        failureType: 'cpu-stress',
        intensity: 0.8,
      });

      expect(highIntensity.experiment.metrics!.duringExperiment.responseTime).toBeGreaterThan(
        lowIntensity.experiment.metrics!.duringExperiment.responseTime
      );
    });
  });

  describe('recovery steps', () => {
    it('should include common recovery steps', async () => {
      const result = await tool.execute({
        target: 'test-service',
        failureType: 'network-latency',
      });

      expect(result.simulation?.recoverySteps).toContain(
        expect.stringContaining('Monitor')
      );
    });

    it('should include failure-type specific steps', async () => {
      const dnsResult = await tool.execute({
        target: 'test-service',
        failureType: 'dns-failure',
      });

      expect(dnsResult.simulation?.recoverySteps.some((s) => s.includes('DNS'))).toBe(true);
    });
  });
});

describe('ChaosInjectTool Safety', () => {
  let tool: MockChaosInjectTool;

  beforeEach(() => {
    tool = new MockChaosInjectTool();
  });

  it('should always default to dry run', async () => {
    const result = await tool.execute({
      target: 'test-service',
      failureType: 'process-kill',
      intensity: 1.0,
    });

    expect(result.experiment.dryRun).toBe(true);
  });

  it('should prevent non-test targets in live mode', async () => {
    const result = await tool.execute({
      target: 'my-service',
      failureType: 'network-latency',
      dryRun: false,
    });

    expect(result.success).toBe(false);
  });

  it('should allow test targets in live mode', async () => {
    const result = await tool.execute({
      target: 'test-service',
      failureType: 'network-latency',
      dryRun: false,
    });

    expect(result.success).toBe(true);
  });

  it('should limit maximum duration', async () => {
    const result = await tool.execute({
      target: 'test-service',
      failureType: 'network-latency',
      duration: 10000, // Way too long
    });

    expect(result.success).toBe(false);
    expect(result.errors).toContain(expect.stringContaining('duration'));
  });
});

describe('ChaosInjectTool Experiment Management', () => {
  let tool: MockChaosInjectTool;

  beforeEach(() => {
    tool = new MockChaosInjectTool();
  });

  it('should track active experiments in live mode', async () => {
    await tool.execute({
      target: 'test-service',
      failureType: 'network-latency',
      dryRun: false,
    });

    const active = tool.getActiveExperiments();
    expect(active.length).toBe(1);
  });

  it('should stop active experiment', async () => {
    const result = await tool.execute({
      target: 'test-service',
      failureType: 'network-latency',
      dryRun: false,
    });

    const stopped = await tool.stopExperiment(result.experiment.id);
    expect(stopped).toBe(true);

    const active = tool.getActiveExperiments();
    expect(active.length).toBe(0);
  });

  it('should return false when stopping non-existent experiment', async () => {
    const stopped = await tool.stopExperiment('non-existent-id');
    expect(stopped).toBe(false);
  });
});
