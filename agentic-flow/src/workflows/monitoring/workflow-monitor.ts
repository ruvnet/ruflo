// Workflow monitoring and metrics collection
import { EventEmitter } from 'events';
import { WorkflowEngine, WorkflowExecution } from '../workflow-engine';

export interface WorkflowMetrics {
  totalExecutions: number;
  runningExecutions: number;
  completedExecutions: number;
  failedExecutions: number;
  cancelledExecutions: number;
  averageExecutionTime: number;
  totalStepsExecuted: number;
  errorRate: number;
  throughput: number; // executions per minute
}

export interface StepMetrics {
  stepType: string;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageExecutionTime: number;
  minExecutionTime: number;
  maxExecutionTime: number;
  errorRate: number;
}

export interface WorkflowAlert {
  id: string;
  type: 'error' | 'warning' | 'info';
  message: string;
  executionId?: string;
  workflowId?: string;
  stepId?: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export class WorkflowMonitor extends EventEmitter {
  private engine: WorkflowEngine;
  private metrics: Map<string, any> = new Map();
  private stepMetrics: Map<string, StepMetrics> = new Map();
  private alerts: WorkflowAlert[] = [];
  private monitoring = false;
  private monitoringInterval?: NodeJS.Timeout;
  private performanceThresholds = {
    maxExecutionTime: 300000, // 5 minutes
    maxErrorRate: 0.1, // 10%
    maxStepExecutionTime: 60000, // 1 minute
    maxQueueSize: 100
  };

  constructor(engine: WorkflowEngine) {
    super();
    this.engine = engine;
    this.setupEngineEventListeners();
  }

  // Start monitoring
  startMonitoring(intervalMs = 30000): void {
    if (this.monitoring) return;

    this.monitoring = true;
    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
      this.checkThresholds();
    }, intervalMs);

    this.emit('monitoring:started', { interval: intervalMs });
  }

  // Stop monitoring
  stopMonitoring(): void {
    if (!this.monitoring) return;

    this.monitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    this.emit('monitoring:stopped');
  }

  // Get current workflow metrics
  getWorkflowMetrics(): WorkflowMetrics {
    const executions = this.engine.listExecutions();
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    const totalExecutions = executions.length;
    const runningExecutions = executions.filter(e => e.status === 'running').length;
    const completedExecutions = executions.filter(e => e.status === 'completed').length;
    const failedExecutions = executions.filter(e => e.status === 'failed').length;
    const cancelledExecutions = executions.filter(e => e.status === 'cancelled').length;

    // Calculate average execution time for completed executions
    const completedWithTime = executions.filter(e => 
      e.status === 'completed' && e.endTime && e.startTime
    );
    const averageExecutionTime = completedWithTime.length > 0
      ? completedWithTime.reduce((sum, e) => 
          sum + (e.endTime!.getTime() - e.startTime.getTime()), 0
        ) / completedWithTime.length
      : 0;

    // Calculate total steps executed
    const totalStepsExecuted = executions.reduce((sum, e) => 
      sum + (e.results ? Object.keys(e.results).length : 0), 0
    );

    // Calculate error rate
    const errorRate = totalExecutions > 0 
      ? failedExecutions / totalExecutions 
      : 0;

    // Calculate throughput (executions completed in last minute)
    const recentCompletions = executions.filter(e => 
      e.status === 'completed' && 
      e.endTime && 
      e.endTime.getTime() > oneMinuteAgo
    ).length;

    return {
      totalExecutions,
      runningExecutions,
      completedExecutions,
      failedExecutions,
      cancelledExecutions,
      averageExecutionTime,
      totalStepsExecuted,
      errorRate,
      throughput: recentCompletions
    };
  }

  // Get step-level metrics
  getStepMetrics(): StepMetrics[] {
    return Array.from(this.stepMetrics.values());
  }

  // Get recent alerts
  getAlerts(limit = 50): WorkflowAlert[] {
    return this.alerts
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  // Clear old alerts
  clearOldAlerts(olderThanMs = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - olderThanMs;
    this.alerts = this.alerts.filter(alert => 
      alert.timestamp.getTime() > cutoff
    );
  }

  // Update performance thresholds
  updateThresholds(thresholds: Partial<typeof this.performanceThresholds>): void {
    this.performanceThresholds = { ...this.performanceThresholds, ...thresholds };
    this.emit('thresholds:updated', this.performanceThresholds);
  }

  // Get workflow health status
  getHealthStatus(): {
    status: 'healthy' | 'warning' | 'critical';
    issues: string[];
    recommendations: string[];
  } {
    const metrics = this.getWorkflowMetrics();
    const issues: string[] = [];
    const recommendations: string[] = [];
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';

    // Check error rate
    if (metrics.errorRate > this.performanceThresholds.maxErrorRate) {
      issues.push(`High error rate: ${(metrics.errorRate * 100).toFixed(1)}%`);
      recommendations.push('Review failed executions and improve error handling');
      status = 'critical';
    }

    // Check queue size (running executions)
    if (metrics.runningExecutions > this.performanceThresholds.maxQueueSize) {
      issues.push(`High queue size: ${metrics.runningExecutions} running executions`);
      recommendations.push('Consider scaling up execution capacity');
      if (status !== 'critical') status = 'warning';
    }

    // Check average execution time
    if (metrics.averageExecutionTime > this.performanceThresholds.maxExecutionTime) {
      issues.push(`Long execution times: ${Math.round(metrics.averageExecutionTime / 1000)}s average`);
      recommendations.push('Optimize workflow steps for better performance');
      if (status !== 'critical') status = 'warning';
    }

    // Check for stuck executions
    const stuckExecutions = this.findStuckExecutions();
    if (stuckExecutions.length > 0) {
      issues.push(`${stuckExecutions.length} potentially stuck executions`);
      recommendations.push('Review and cancel stuck executions');
      if (status !== 'critical') status = 'warning';
    }

    return { status, issues, recommendations };
  }

  // Find potentially stuck executions
  private findStuckExecutions(): WorkflowExecution[] {
    const executions = this.engine.listExecutions({ status: 'running' });
    const stuckThreshold = this.performanceThresholds.maxExecutionTime;
    const now = Date.now();

    return executions.filter(execution => {
      const runningTime = now - execution.startTime.getTime();
      return runningTime > stuckThreshold;
    });
  }

  // Setup event listeners for the workflow engine
  private setupEngineEventListeners(): void {
    // Track workflow lifecycle events
    this.engine.on('workflow:started', (data) => {
      this.recordEvent('workflow:started', data);
    });

    this.engine.on('workflow:completed', (data) => {
      this.recordEvent('workflow:completed', data);
      this.updateExecutionMetrics(data.executionId);
    });

    this.engine.on('workflow:failed', (data) => {
      this.recordEvent('workflow:failed', data);
      this.createAlert('error', 'Workflow execution failed', data.executionId);
    });

    this.engine.on('workflow:cancelled', (data) => {
      this.recordEvent('workflow:cancelled', data);
    });

    // Track step-level events
    this.engine.on('node:start', (data) => {
      this.recordStepStart(data);
    });

    this.engine.on('node:complete', (data) => {
      this.recordStepComplete(data);
    });

    this.engine.on('node:error', (data) => {
      this.recordStepError(data);
      this.createAlert('error', `Step execution failed: ${data.error?.message}`, 
        undefined, undefined, data.nodeId);
    });

    // Track persistence events
    this.engine.on('persistence:error', (data) => {
      this.createAlert('error', `Persistence error: ${data.error?.message}`);
    });
  }

  // Record workflow events
  private recordEvent(eventType: string, data: any): void {
    const key = `event:${eventType}`;
    const count = this.metrics.get(key) || 0;
    this.metrics.set(key, count + 1);
    this.metrics.set(`${key}:last`, Date.now());
  }

  // Update execution metrics
  private updateExecutionMetrics(executionId: string): void {
    const execution = this.engine.getExecution(executionId);
    if (!execution || !execution.endTime) return;

    const duration = execution.endTime.getTime() - execution.startTime.getTime();
    
    // Update overall metrics
    this.updateAverageMetric('execution:duration', duration);
    this.updateAverageMetric('execution:steps', 
      execution.results ? Object.keys(execution.results).length : 0
    );
  }

  // Record step start
  private recordStepStart(data: any): void {
    const startKey = `step:${data.nodeId}:start`;
    this.metrics.set(startKey, Date.now());
  }

  // Record step completion
  private recordStepComplete(data: any): void {
    const startKey = `step:${data.nodeId}:start`;
    const startTime = this.metrics.get(startKey);
    
    if (startTime) {
      const duration = data.duration || (Date.now() - startTime);
      this.updateStepMetrics(data.type || 'unknown', duration, true);
    }
  }

  // Record step error
  private recordStepError(data: any): void {
    const startKey = `step:${data.nodeId}:start`;
    const startTime = this.metrics.get(startKey);
    
    if (startTime) {
      const duration = data.duration || (Date.now() - startTime);
      this.updateStepMetrics(data.type || 'unknown', duration, false);
    }
  }

  // Update step-level metrics
  private updateStepMetrics(stepType: string, duration: number, success: boolean): void {
    const current = this.stepMetrics.get(stepType) || {
      stepType,
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      averageExecutionTime: 0,
      minExecutionTime: Infinity,
      maxExecutionTime: 0,
      errorRate: 0
    };

    current.totalExecutions++;
    if (success) {
      current.successfulExecutions++;
    } else {
      current.failedExecutions++;
    }

    // Update timing metrics
    current.minExecutionTime = Math.min(current.minExecutionTime, duration);
    current.maxExecutionTime = Math.max(current.maxExecutionTime, duration);
    
    // Update average execution time
    const totalTime = (current.averageExecutionTime * (current.totalExecutions - 1)) + duration;
    current.averageExecutionTime = totalTime / current.totalExecutions;
    
    // Update error rate
    current.errorRate = current.failedExecutions / current.totalExecutions;

    this.stepMetrics.set(stepType, current);
  }

  // Update average metric
  private updateAverageMetric(key: string, value: number): void {
    const countKey = `${key}:count`;
    const sumKey = `${key}:sum`;
    
    const count = (this.metrics.get(countKey) || 0) + 1;
    const sum = (this.metrics.get(sumKey) || 0) + value;
    
    this.metrics.set(countKey, count);
    this.metrics.set(sumKey, sum);
    this.metrics.set(key, sum / count);
  }

  // Create alert
  private createAlert(
    type: 'error' | 'warning' | 'info',
    message: string,
    executionId?: string,
    workflowId?: string,
    stepId?: string,
    metadata?: Record<string, any>
  ): void {
    const alert: WorkflowAlert = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      message,
      executionId,
      workflowId,
      stepId,
      timestamp: new Date(),
      metadata
    };

    this.alerts.push(alert);
    this.emit('alert:created', alert);

    // Limit alerts to prevent memory issues
    if (this.alerts.length > 1000) {
      this.alerts = this.alerts.slice(-500);
    }
  }

  // Collect periodic metrics
  private collectMetrics(): void {
    const metrics = this.getWorkflowMetrics();
    const stepMetrics = this.getStepMetrics();
    
    this.emit('metrics:collected', {
      workflow: metrics,
      steps: stepMetrics,
      timestamp: new Date()
    });
  }

  // Check performance thresholds
  private checkThresholds(): void {
    const metrics = this.getWorkflowMetrics();

    // Check error rate threshold
    if (metrics.errorRate > this.performanceThresholds.maxErrorRate) {
      this.createAlert('warning', 
        `Error rate exceeded threshold: ${(metrics.errorRate * 100).toFixed(1)}%`
      );
    }

    // Check queue size
    if (metrics.runningExecutions > this.performanceThresholds.maxQueueSize) {
      this.createAlert('warning', 
        `Queue size exceeded threshold: ${metrics.runningExecutions} running executions`
      );
    }

    // Check for long-running executions
    const stuckExecutions = this.findStuckExecutions();
    if (stuckExecutions.length > 0) {
      this.createAlert('warning', 
        `Found ${stuckExecutions.length} potentially stuck executions`,
        undefined, undefined, undefined,
        { stuckExecutions: stuckExecutions.map(e => e.id) }
      );
    }

    // Check step performance
    this.stepMetrics.forEach((stepMetric) => {
      if (stepMetric.averageExecutionTime > this.performanceThresholds.maxStepExecutionTime) {
        this.createAlert('warning', 
          `Step type '${stepMetric.stepType}' has high average execution time: ${Math.round(stepMetric.averageExecutionTime / 1000)}s`
        );
      }
    });
  }

  // Generate performance report
  generateReport(): {
    summary: WorkflowMetrics;
    health: ReturnType<WorkflowMonitor['getHealthStatus']>;
    stepMetrics: StepMetrics[];
    recentAlerts: WorkflowAlert[];
    recommendations: string[];
  } {
    const summary = this.getWorkflowMetrics();
    const health = this.getHealthStatus();
    const stepMetrics = this.getStepMetrics();
    const recentAlerts = this.getAlerts(20);
    
    const recommendations: string[] = [];

    // Performance recommendations
    if (summary.averageExecutionTime > 60000) {
      recommendations.push('Consider optimizing workflow steps to reduce execution time');
    }

    if (summary.errorRate > 0.05) {
      recommendations.push('Review error patterns and improve error handling');
    }

    if (summary.runningExecutions > summary.completedExecutions * 0.1) {
      recommendations.push('Monitor queue size and consider horizontal scaling');
    }

    // Step-level recommendations
    stepMetrics.forEach(metric => {
      if (metric.errorRate > 0.1) {
        recommendations.push(`Improve reliability of '${metric.stepType}' steps (${(metric.errorRate * 100).toFixed(1)}% error rate)`);
      }
    });

    return {
      summary,
      health,
      stepMetrics,
      recentAlerts,
      recommendations
    };
  }

  // Cleanup
  shutdown(): void {
    this.stopMonitoring();
    this.removeAllListeners();
    this.metrics.clear();
    this.stepMetrics.clear();
    this.alerts = [];
  }
}