/**
 * Progress Tracker - Advanced Progress Tracking and Error Handling
 * 
 * This module provides comprehensive progress tracking, error handling, and recovery
 * mechanisms for design cloning workflows:
 * - Real-time progress monitoring with WebSocket support
 * - Detailed step-by-step progress tracking
 * - Error categorization and recovery strategies
 * - Performance bottleneck detection
 * - Automatic retry mechanisms with exponential backoff
 * - Circuit breaker pattern for failing services
 * - Workflow checkpoint and resume functionality
 */

import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createLogger } from '../core/logger.js';
import { MCPError } from '../utils/errors.js';

/**
 * Progress Status Types
 */
export enum ProgressStatus {
  PENDING = 'pending',
  STARTING = 'starting',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  RETRYING = 'retrying',
  RECOVERING = 'recovering'
}

/**
 * Error Categories
 */
export enum ErrorCategory {
  NETWORK = 'network',
  TIMEOUT = 'timeout',
  VALIDATION = 'validation',
  RESOURCE = 'resource',
  PERMISSION = 'permission',
  DEPENDENCY = 'dependency',
  SYSTEM = 'system',
  USER_INPUT = 'user_input',
  MCP_SERVER = 'mcp_server',
  UNKNOWN = 'unknown'
}

/**
 * Recovery Strategy Types
 */
export enum RecoveryStrategy {
  RETRY = 'retry',
  RESTART_SERVER = 'restart_server',
  FALLBACK = 'fallback',
  SKIP_STEP = 'skip_step',
  MANUAL_INTERVENTION = 'manual_intervention',
  FAIL_FAST = 'fail_fast'
}

/**
 * Progress Step Definition
 */
export interface ProgressStep {
  id: string;
  name: string;
  description: string;
  weight: number; // Weight for progress calculation (0-1)
  status: ProgressStatus;
  startTime?: number;
  endTime?: number;
  duration?: number;
  progress: number; // 0-100
  substeps?: ProgressStep[];
  error?: WorkflowError;
  retryCount: number;
  maxRetries: number;
  metadata?: Record<string, any>;
}

/**
 * Workflow Error Information
 */
export interface WorkflowError {
  id: string;
  category: ErrorCategory;
  message: string;
  originalError?: Error;
  stepId: string;
  timestamp: number;
  recoveryStrategy: RecoveryStrategy;
  context?: Record<string, any>;
  stackTrace?: string;
  isRecoverable: boolean;
  retryCount: number;
  maxRetries: number;
}

/**
 * Progress Checkpoint
 */
export interface ProgressCheckpoint {
  workflowId: string;
  timestamp: number;
  completedSteps: string[];
  currentStep: string;
  overallProgress: number;
  state: Record<string, any>;
  errors: WorkflowError[];
}

/**
 * Performance Metrics
 */
export interface PerformanceMetrics {
  stepDurations: Map<string, number[]>;
  bottlenecks: Array<{
    stepId: string;
    averageDuration: number;
    slowestExecution: number;
    frequency: number;
  }>;
  errorRates: Map<ErrorCategory, number>;
  recoverySuccess: Map<RecoveryStrategy, number>;
  overallMetrics: {
    totalWorkflows: number;
    successRate: number;
    averageCompletionTime: number;
    commonFailurePoints: string[];
  };
}

/**
 * Circuit Breaker State
 */
interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  state: 'closed' | 'open' | 'half-open';
  threshold: number;
  timeout: number;
}

/**
 * Progress Tracker Main Class
 */
export class ProgressTracker extends EventEmitter {
  private workflowProgress = new Map<string, Map<string, ProgressStep>>();
  private workflowErrors = new Map<string, WorkflowError[]>();
  private workflowCheckpoints = new Map<string, ProgressCheckpoint>();
  private performanceMetrics: PerformanceMetrics;
  private circuitBreakers = new Map<string, CircuitBreakerState>();
  private logger: any;
  private checkpointDir: string;
  private metricsCollectionInterval: NodeJS.Timeout | null = null;

  constructor(options: {
    logger?: any;
    checkpointDir?: string;
    enableMetricsCollection?: boolean;
    metricsInterval?: number;
  } = {}) {
    super();
    
    this.logger = options.logger || createLogger('ProgressTracker');
    this.checkpointDir = options.checkpointDir || './checkpoints';
    
    this.performanceMetrics = {
      stepDurations: new Map(),
      bottlenecks: [],
      errorRates: new Map(),
      recoverySuccess: new Map(),
      overallMetrics: {
        totalWorkflows: 0,
        successRate: 0,
        averageCompletionTime: 0,
        commonFailurePoints: []
      }
    };

    // Initialize metrics collection
    if (options.enableMetricsCollection !== false) {
      this.startMetricsCollection(options.metricsInterval || 30000);
    }

    this.logger.debug('Progress Tracker initialized');
  }

  /**
   * Initialize workflow progress tracking
   */
  async initializeWorkflow(workflowId: string, steps: Omit<ProgressStep, 'status' | 'progress' | 'retryCount'>[]): Promise<void> {
    this.logger.info('Initializing workflow progress tracking', { workflowId, stepsCount: steps.length });

    const progressSteps = new Map<string, ProgressStep>();
    
    for (const step of steps) {
      progressSteps.set(step.id, {
        ...step,
        status: ProgressStatus.PENDING,
        progress: 0,
        retryCount: 0,
        maxRetries: step.maxRetries || 3
      });
    }

    this.workflowProgress.set(workflowId, progressSteps);
    this.workflowErrors.set(workflowId, []);

    // Create initial checkpoint
    await this.createCheckpoint(workflowId);

    this.emit('workflowInitialized', { workflowId, steps: Array.from(progressSteps.values()) });
  }

  /**
   * Start a workflow step
   */
  async startStep(workflowId: string, stepId: string, metadata?: Record<string, any>): Promise<void> {
    const step = this.getStep(workflowId, stepId);
    if (!step) {
      throw new MCPError(`Step not found: ${stepId}`);
    }

    step.status = ProgressStatus.IN_PROGRESS;
    step.startTime = Date.now();
    step.progress = 0;
    
    if (metadata) {
      step.metadata = { ...step.metadata, ...metadata };
    }

    this.logger.debug('Step started', { workflowId, stepId });
    this.emit('stepStarted', { workflowId, stepId, step });

    // Create checkpoint for step start
    await this.createCheckpoint(workflowId);
  }

  /**
   * Update step progress
   */
  async updateStepProgress(workflowId: string, stepId: string, progress: number, message?: string): Promise<void> {
    const step = this.getStep(workflowId, stepId);
    if (!step) {
      throw new MCPError(`Step not found: ${stepId}`);
    }

    step.progress = Math.max(0, Math.min(100, progress));
    
    if (message && step.metadata) {
      step.metadata.lastProgressMessage = message;
    }

    this.emit('stepProgressUpdated', { workflowId, stepId, progress, message });

    // Update substeps if provided
    if (step.substeps) {
      await this.updateSubstepsProgress(workflowId, stepId, step.substeps);
    }
  }

  /**
   * Complete a workflow step
   */
  async completeStep(workflowId: string, stepId: string, result?: any): Promise<void> {
    const step = this.getStep(workflowId, stepId);
    if (!step) {
      throw new MCPError(`Step not found: ${stepId}`);
    }

    step.status = ProgressStatus.COMPLETED;
    step.endTime = Date.now();
    step.duration = step.endTime - (step.startTime || step.endTime);
    step.progress = 100;

    if (result && step.metadata) {
      step.metadata.result = result;
    }

    // Update performance metrics
    this.updateStepDurationMetrics(stepId, step.duration);

    this.logger.debug('Step completed', { workflowId, stepId, duration: step.duration });
    this.emit('stepCompleted', { workflowId, stepId, step, result });

    // Check if all steps are completed
    const allSteps = this.workflowProgress.get(workflowId);
    if (allSteps && Array.from(allSteps.values()).every(s => s.status === ProgressStatus.COMPLETED)) {
      await this.completeWorkflow(workflowId);
    } else {
      await this.createCheckpoint(workflowId);
    }
  }

  /**
   * Fail a workflow step with error handling
   */
  async failStep(workflowId: string, stepId: string, error: Error, context?: Record<string, any>): Promise<void> {
    const step = this.getStep(workflowId, stepId);
    if (!step) {
      throw new MCPError(`Step not found: ${stepId}`);
    }

    const workflowError = await this.categorizeError(error, stepId, workflowId, context);
    
    step.status = ProgressStatus.FAILED;
    step.endTime = Date.now();
    step.duration = step.endTime - (step.startTime || step.endTime);
    step.error = workflowError;

    // Add to workflow errors
    const workflowErrors = this.workflowErrors.get(workflowId) || [];
    workflowErrors.push(workflowError);
    this.workflowErrors.set(workflowId, workflowErrors);

    // Update error rate metrics
    this.updateErrorRateMetrics(workflowError.category);

    this.logger.error('Step failed', { 
      workflowId, 
      stepId, 
      error: workflowError,
      duration: step.duration 
    });

    this.emit('stepFailed', { workflowId, stepId, step, error: workflowError });

    // Attempt recovery if possible
    await this.attemptRecovery(workflowId, stepId, workflowError);
  }

  /**
   * Categorize error and determine recovery strategy
   */
  private async categorizeError(
    error: Error, 
    stepId: string, 
    workflowId: string, 
    context?: Record<string, any>
  ): Promise<WorkflowError> {
    let category = ErrorCategory.UNKNOWN;
    let recoveryStrategy = RecoveryStrategy.FAIL_FAST;
    let isRecoverable = false;
    let maxRetries = 0;

    // Categorize based on error message and type
    const errorMessage = error.message.toLowerCase();

    if (errorMessage.includes('network') || errorMessage.includes('connection')) {
      category = ErrorCategory.NETWORK;
      recoveryStrategy = RecoveryStrategy.RETRY;
      isRecoverable = true;
      maxRetries = 3;
    } else if (errorMessage.includes('timeout')) {
      category = ErrorCategory.TIMEOUT;
      recoveryStrategy = RecoveryStrategy.RETRY;
      isRecoverable = true;
      maxRetries = 2;
    } else if (errorMessage.includes('validation') || errorMessage.includes('invalid')) {
      category = ErrorCategory.VALIDATION;
      recoveryStrategy = RecoveryStrategy.MANUAL_INTERVENTION;
      isRecoverable = false;
    } else if (errorMessage.includes('permission') || errorMessage.includes('unauthorized')) {
      category = ErrorCategory.PERMISSION;
      recoveryStrategy = RecoveryStrategy.MANUAL_INTERVENTION;
      isRecoverable = false;
    } else if (errorMessage.includes('memory') || errorMessage.includes('resource')) {
      category = ErrorCategory.RESOURCE;
      recoveryStrategy = RecoveryStrategy.RESTART_SERVER;
      isRecoverable = true;
      maxRetries = 2;
    } else if (errorMessage.includes('mcp') || errorMessage.includes('server')) {
      category = ErrorCategory.MCP_SERVER;
      recoveryStrategy = RecoveryStrategy.RESTART_SERVER;
      isRecoverable = true;
      maxRetries = 2;
    } else if (errorMessage.includes('dependency') || errorMessage.includes('module')) {
      category = ErrorCategory.DEPENDENCY;
      recoveryStrategy = RecoveryStrategy.MANUAL_INTERVENTION;
      isRecoverable = false;
    }

    return {
      id: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      category,
      message: error.message,
      originalError: error,
      stepId,
      timestamp: Date.now(),
      recoveryStrategy,
      context,
      stackTrace: error.stack,
      isRecoverable,
      retryCount: 0,
      maxRetries
    };
  }

  /**
   * Attempt error recovery
   */
  private async attemptRecovery(workflowId: string, stepId: string, error: WorkflowError): Promise<void> {
    if (!error.isRecoverable || error.retryCount >= error.maxRetries) {
      await this.failWorkflow(workflowId, error);
      return;
    }

    // Check circuit breaker
    if (await this.isCircuitBreakerOpen(stepId)) {
      this.logger.warn('Circuit breaker open, skipping recovery', { workflowId, stepId });
      await this.failWorkflow(workflowId, error);
      return;
    }

    this.logger.info('Attempting error recovery', { 
      workflowId, 
      stepId, 
      strategy: error.recoveryStrategy,
      retryCount: error.retryCount + 1
    });

    const step = this.getStep(workflowId, stepId);
    if (!step) return;

    step.status = ProgressStatus.RECOVERING;
    error.retryCount++;

    this.emit('recoveryAttempt', { workflowId, stepId, error, strategy: error.recoveryStrategy });

    try {
      switch (error.recoveryStrategy) {
        case RecoveryStrategy.RETRY:
          await this.retryStep(workflowId, stepId, error);
          break;
          
        case RecoveryStrategy.RESTART_SERVER:
          await this.restartMCPServer(workflowId, stepId, error);
          break;
          
        case RecoveryStrategy.FALLBACK:
          await this.useFallbackStrategy(workflowId, stepId, error);
          break;
          
        case RecoveryStrategy.SKIP_STEP:
          await this.skipStep(workflowId, stepId, error);
          break;
          
        default:
          await this.failWorkflow(workflowId, error);
      }
    } catch (recoveryError) {
      this.logger.error('Recovery attempt failed', { 
        workflowId, 
        stepId, 
        recoveryError: recoveryError.message 
      });
      
      // Update circuit breaker
      await this.recordCircuitBreakerFailure(stepId);
      
      // Try next recovery attempt or fail
      await this.attemptRecovery(workflowId, stepId, error);
    }
  }

  /**
   * Retry a failed step with exponential backoff
   */
  private async retryStep(workflowId: string, stepId: string, error: WorkflowError): Promise<void> {
    const step = this.getStep(workflowId, stepId);
    if (!step) return;

    // Exponential backoff: 2^retryCount * 1000ms
    const backoffDelay = Math.pow(2, error.retryCount) * 1000;
    
    this.logger.debug('Retrying step with backoff', { 
      workflowId, 
      stepId, 
      delay: backoffDelay,
      retryCount: error.retryCount
    });

    await new Promise(resolve => setTimeout(resolve, backoffDelay));

    step.status = ProgressStatus.RETRYING;
    step.retryCount++;
    step.startTime = Date.now();
    step.progress = 0;

    this.emit('stepRetry', { workflowId, stepId, retryCount: step.retryCount });
  }

  /**
   * Restart MCP server for recovery
   */
  private async restartMCPServer(workflowId: string, stepId: string, error: WorkflowError): Promise<void> {
    // This would integrate with the WorkflowCoordinator to restart the relevant MCP server
    this.logger.info('Restarting MCP server for recovery', { workflowId, stepId });
    
    // Emit event for WorkflowCoordinator to handle
    this.emit('restartServerRequested', { workflowId, stepId, error });
    
    // Wait for server restart (simulation)
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Retry the step
    await this.retryStep(workflowId, stepId, error);
  }

  /**
   * Use fallback strategy
   */
  private async useFallbackStrategy(workflowId: string, stepId: string, error: WorkflowError): Promise<void> {
    this.logger.info('Using fallback strategy', { workflowId, stepId });
    
    // Mark step as completed with fallback result
    const step = this.getStep(workflowId, stepId);
    if (step) {
      step.status = ProgressStatus.COMPLETED;
      step.progress = 100;
      step.endTime = Date.now();
      
      if (step.metadata) {
        step.metadata.usedFallback = true;
        step.metadata.fallbackReason = error.message;
      }
      
      this.emit('fallbackUsed', { workflowId, stepId, error });
    }
  }

  /**
   * Skip a problematic step
   */
  private async skipStep(workflowId: string, stepId: string, error: WorkflowError): Promise<void> {
    this.logger.warn('Skipping problematic step', { workflowId, stepId });
    
    const step = this.getStep(workflowId, stepId);
    if (step) {
      step.status = ProgressStatus.COMPLETED;
      step.progress = 100;
      step.endTime = Date.now();
      
      if (step.metadata) {
        step.metadata.skipped = true;
        step.metadata.skipReason = error.message;
      }
      
      this.emit('stepSkipped', { workflowId, stepId, error });
    }
  }

  /**
   * Circuit breaker management
   */
  private async isCircuitBreakerOpen(stepId: string): Promise<boolean> {
    const breaker = this.circuitBreakers.get(stepId);
    if (!breaker) return false;

    if (breaker.state === 'open') {
      // Check if timeout period has passed
      if (Date.now() - breaker.lastFailureTime > breaker.timeout) {
        breaker.state = 'half-open';
        return false;
      }
      return true;
    }

    return false;
  }

  private async recordCircuitBreakerFailure(stepId: string): Promise<void> {
    let breaker = this.circuitBreakers.get(stepId);
    
    if (!breaker) {
      breaker = {
        failures: 0,
        lastFailureTime: 0,
        state: 'closed',
        threshold: 5,
        timeout: 60000 // 1 minute
      };
      this.circuitBreakers.set(stepId, breaker);
    }

    breaker.failures++;
    breaker.lastFailureTime = Date.now();

    if (breaker.failures >= breaker.threshold) {
      breaker.state = 'open';
      this.logger.warn('Circuit breaker opened', { stepId, failures: breaker.failures });
    }
  }

  /**
   * Complete entire workflow
   */
  private async completeWorkflow(workflowId: string): Promise<void> {
    this.performanceMetrics.overallMetrics.totalWorkflows++;
    
    // Calculate success rate
    const errors = this.workflowErrors.get(workflowId) || [];
    if (errors.length === 0) {
      this.performanceMetrics.overallMetrics.successRate = 
        (this.performanceMetrics.overallMetrics.successRate * (this.performanceMetrics.overallMetrics.totalWorkflows - 1) + 1) / 
        this.performanceMetrics.overallMetrics.totalWorkflows;
    }

    this.logger.info('Workflow completed successfully', { workflowId });
    this.emit('workflowCompleted', { workflowId });

    // Cleanup checkpoint
    await this.cleanupCheckpoint(workflowId);
  }

  /**
   * Fail entire workflow
   */
  private async failWorkflow(workflowId: string, error: WorkflowError): Promise<void> {
    this.performanceMetrics.overallMetrics.totalWorkflows++;
    
    // Update success rate (failure)
    this.performanceMetrics.overallMetrics.successRate = 
      (this.performanceMetrics.overallMetrics.successRate * (this.performanceMetrics.overallMetrics.totalWorkflows - 1)) / 
      this.performanceMetrics.overallMetrics.totalWorkflows;

    this.logger.error('Workflow failed', { workflowId, error });
    this.emit('workflowFailed', { workflowId, error });

    // Keep checkpoint for analysis
  }

  /**
   * Get workflow step
   */
  private getStep(workflowId: string, stepId: string): ProgressStep | undefined {
    return this.workflowProgress.get(workflowId)?.get(stepId);
  }

  /**
   * Update substeps progress
   */
  private async updateSubstepsProgress(workflowId: string, stepId: string, substeps: ProgressStep[]): Promise<void> {
    // Calculate overall progress based on substeps
    const totalWeight = substeps.reduce((sum, substep) => sum + substep.weight, 0);
    const weightedProgress = substeps.reduce((sum, substep) => sum + (substep.progress * substep.weight), 0);
    const overallProgress = totalWeight > 0 ? weightedProgress / totalWeight : 0;

    await this.updateStepProgress(workflowId, stepId, overallProgress);
  }

  /**
   * Create workflow checkpoint
   */
  private async createCheckpoint(workflowId: string): Promise<void> {
    try {
      const steps = this.workflowProgress.get(workflowId);
      const errors = this.workflowErrors.get(workflowId) || [];
      
      if (!steps) return;

      const completedSteps = Array.from(steps.entries())
        .filter(([_, step]) => step.status === ProgressStatus.COMPLETED)
        .map(([stepId, _]) => stepId);

      const currentStep = Array.from(steps.entries())
        .find(([_, step]) => step.status === ProgressStatus.IN_PROGRESS)?.[0] || '';

      const overallProgress = this.calculateOverallProgress(workflowId);

      const checkpoint: ProgressCheckpoint = {
        workflowId,
        timestamp: Date.now(),
        completedSteps,
        currentStep,
        overallProgress,
        state: {}, // Could include workflow-specific state
        errors
      };

      this.workflowCheckpoints.set(workflowId, checkpoint);

      // Save to file
      await fs.mkdir(this.checkpointDir, { recursive: true });
      const checkpointPath = path.join(this.checkpointDir, `${workflowId}_checkpoint.json`);
      await fs.writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2));

    } catch (error) {
      this.logger.error('Failed to create checkpoint', { workflowId, error: error.message });
    }
  }

  /**
   * Calculate overall workflow progress
   */
  private calculateOverallProgress(workflowId: string): number {
    const steps = this.workflowProgress.get(workflowId);
    if (!steps) return 0;

    const stepArray = Array.from(steps.values());
    const totalWeight = stepArray.reduce((sum, step) => sum + step.weight, 0);
    const weightedProgress = stepArray.reduce((sum, step) => sum + (step.progress * step.weight), 0);

    return totalWeight > 0 ? weightedProgress / totalWeight : 0;
  }

  /**
   * Update performance metrics
   */
  private updateStepDurationMetrics(stepId: string, duration: number): void {
    if (!this.performanceMetrics.stepDurations.has(stepId)) {
      this.performanceMetrics.stepDurations.set(stepId, []);
    }
    
    const durations = this.performanceMetrics.stepDurations.get(stepId)!;
    durations.push(duration);

    // Keep only last 100 durations for each step
    if (durations.length > 100) {
      durations.shift();
    }
  }

  private updateErrorRateMetrics(category: ErrorCategory): void {
    const current = this.performanceMetrics.errorRates.get(category) || 0;
    this.performanceMetrics.errorRates.set(category, current + 1);
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(interval: number): void {
    this.metricsCollectionInterval = setInterval(() => {
      this.analyzeBottlenecks();
    }, interval);
  }

  /**
   * Analyze performance bottlenecks
   */
  private analyzeBottlenecks(): void {
    this.performanceMetrics.bottlenecks = [];

    for (const [stepId, durations] of this.performanceMetrics.stepDurations) {
      if (durations.length < 5) continue; // Need at least 5 samples

      const averageDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
      const slowestExecution = Math.max(...durations);

      // Consider a step a bottleneck if average > 30s or slowest > 60s
      if (averageDuration > 30000 || slowestExecution > 60000) {
        this.performanceMetrics.bottlenecks.push({
          stepId,
          averageDuration,
          slowestExecution,
          frequency: durations.length
        });
      }
    }

    // Sort by average duration (worst first)
    this.performanceMetrics.bottlenecks.sort((a, b) => b.averageDuration - a.averageDuration);

    if (this.performanceMetrics.bottlenecks.length > 0) {
      this.emit('bottlenecksDetected', this.performanceMetrics.bottlenecks);
    }
  }

  /**
   * Cleanup checkpoint file
   */
  private async cleanupCheckpoint(workflowId: string): Promise<void> {
    try {
      const checkpointPath = path.join(this.checkpointDir, `${workflowId}_checkpoint.json`);
      await fs.unlink(checkpointPath);
      this.workflowCheckpoints.delete(workflowId);
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  /**
   * Public API Methods
   */

  /**
   * Get workflow progress
   */
  getWorkflowProgress(workflowId: string): {
    steps: ProgressStep[];
    overallProgress: number;
    errors: WorkflowError[];
    checkpoint?: ProgressCheckpoint;
  } {
    const steps = this.workflowProgress.get(workflowId);
    const errors = this.workflowErrors.get(workflowId) || [];
    const checkpoint = this.workflowCheckpoints.get(workflowId);

    return {
      steps: steps ? Array.from(steps.values()) : [],
      overallProgress: this.calculateOverallProgress(workflowId),
      errors,
      checkpoint
    };
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): PerformanceMetrics {
    return JSON.parse(JSON.stringify(this.performanceMetrics));
  }

  /**
   * Resume workflow from checkpoint
   */
  async resumeFromCheckpoint(workflowId: string): Promise<boolean> {
    try {
      const checkpointPath = path.join(this.checkpointDir, `${workflowId}_checkpoint.json`);
      const checkpointData = await fs.readFile(checkpointPath, 'utf8');
      const checkpoint: ProgressCheckpoint = JSON.parse(checkpointData);

      this.workflowCheckpoints.set(workflowId, checkpoint);
      this.workflowErrors.set(workflowId, checkpoint.errors);

      this.logger.info('Resumed workflow from checkpoint', { workflowId });
      this.emit('workflowResumed', { workflowId, checkpoint });

      return true;
    } catch (error) {
      this.logger.error('Failed to resume from checkpoint', { workflowId, error: error.message });
      return false;
    }
  }

  /**
   * Cancel workflow
   */
  async cancelWorkflow(workflowId: string): Promise<void> {
    const steps = this.workflowProgress.get(workflowId);
    if (!steps) return;

    // Mark all pending/in-progress steps as cancelled
    for (const step of steps.values()) {
      if (step.status === ProgressStatus.PENDING || step.status === ProgressStatus.IN_PROGRESS) {
        step.status = ProgressStatus.CANCELLED;
        step.endTime = Date.now();
        if (step.startTime) {
          step.duration = step.endTime - step.startTime;
        }
      }
    }

    this.logger.info('Workflow cancelled', { workflowId });
    this.emit('workflowCancelled', { workflowId });

    await this.cleanupCheckpoint(workflowId);
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.metricsCollectionInterval) {
      clearInterval(this.metricsCollectionInterval);
      this.metricsCollectionInterval = null;
    }

    this.workflowProgress.clear();
    this.workflowErrors.clear();
    this.workflowCheckpoints.clear();
    this.circuitBreakers.clear();

    this.logger.info('Progress Tracker cleaned up');
  }
}

export default ProgressTracker;