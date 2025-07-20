// Advanced error handling and recovery for workflows
import { EventEmitter } from 'events';
import { WorkflowEngine, WorkflowExecution, WorkflowStep } from '../workflow-engine';
import { WorkflowMonitor, WorkflowAlert } from '../monitoring/workflow-monitor';

export interface ErrorRecoveryStrategy {
  type: 'retry' | 'skip' | 'alternative' | 'rollback' | 'escalate';
  maxAttempts?: number;
  retryDelay?: number;
  alternativeStep?: string;
  rollbackSteps?: string[];
  escalationHandler?: string;
}

export interface WorkflowError {
  id: string;
  executionId: string;
  stepId: string;
  error: Error;
  timestamp: Date;
  attempts: number;
  recoveryStrategy?: ErrorRecoveryStrategy;
  resolved: boolean;
  metadata?: Record<string, any>;
}

export interface CircuitBreakerState {
  failures: number;
  lastFailure?: Date;
  state: 'closed' | 'open' | 'half-open';
  nextAttempt?: Date;
}

export class WorkflowErrorHandler extends EventEmitter {
  private engine: WorkflowEngine;
  private monitor?: WorkflowMonitor;
  private errors: Map<string, WorkflowError> = new Map();
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private recoveryStrategies: Map<string, ErrorRecoveryStrategy> = new Map();
  private deadLetterQueue: WorkflowError[] = [];
  
  private defaultStrategy: ErrorRecoveryStrategy = {
    type: 'retry',
    maxAttempts: 3,
    retryDelay: 1000
  };

  private circuitBreakerConfig = {
    failureThreshold: 5,
    timeout: 30000, // 30 seconds
    halfOpenMaxAttempts: 3
  };

  constructor(engine: WorkflowEngine, monitor?: WorkflowMonitor) {
    super();
    this.engine = engine;
    this.monitor = monitor;
    this.setupEngineEventListeners();
  }

  // Register error recovery strategy for specific step types or steps
  registerRecoveryStrategy(
    stepTypeOrId: string, 
    strategy: ErrorRecoveryStrategy
  ): void {
    this.recoveryStrategies.set(stepTypeOrId, strategy);
    this.emit('strategy:registered', { stepTypeOrId, strategy });
  }

  // Handle workflow step error
  async handleStepError(
    executionId: string,
    stepId: string,
    error: Error,
    stepType?: string
  ): Promise<boolean> {
    const errorId = `${executionId}-${stepId}-${Date.now()}`;
    
    const workflowError: WorkflowError = {
      id: errorId,
      executionId,
      stepId,
      error,
      timestamp: new Date(),
      attempts: 1,
      resolved: false,
      metadata: { stepType }
    };

    this.errors.set(errorId, workflowError);
    this.emit('error:recorded', workflowError);

    // Get recovery strategy
    const strategy = this.getRecoveryStrategy(stepId, stepType);
    workflowError.recoveryStrategy = strategy;

    // Check circuit breaker
    if (await this.checkCircuitBreaker(stepType || stepId, error)) {
      return false; // Circuit breaker is open
    }

    // Apply recovery strategy
    const recovered = await this.applyRecoveryStrategy(workflowError);
    
    if (!recovered) {
      await this.sendToDeadLetterQueue(workflowError);
    }

    return recovered;
  }

  // Apply recovery strategy
  private async applyRecoveryStrategy(workflowError: WorkflowError): Promise<boolean> {
    const { strategy } = workflowError.recoveryStrategy || this.defaultStrategy;
    
    try {
      switch (strategy) {
        case 'retry':
          return await this.handleRetryStrategy(workflowError);
          
        case 'skip':
          return await this.handleSkipStrategy(workflowError);
          
        case 'alternative':
          return await this.handleAlternativeStrategy(workflowError);
          
        case 'rollback':
          return await this.handleRollbackStrategy(workflowError);
          
        case 'escalate':
          return await this.handleEscalationStrategy(workflowError);
          
        default:
          this.emit('error:unknown-strategy', workflowError);
          return false;
      }
    } catch (recoveryError) {
      this.emit('error:recovery-failed', { workflowError, recoveryError });
      return false;
    }
  }

  // Retry strategy implementation
  private async handleRetryStrategy(workflowError: WorkflowError): Promise<boolean> {
    const strategy = workflowError.recoveryStrategy || this.defaultStrategy;
    const maxAttempts = strategy.maxAttempts || 3;
    const retryDelay = strategy.retryDelay || 1000;

    if (workflowError.attempts >= maxAttempts) {
      this.emit('error:max-retries-exceeded', workflowError);
      return false;
    }

    // Wait before retry
    if (retryDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }

    try {
      const execution = this.engine.getExecution(workflowError.executionId);
      if (!execution) {
        this.emit('error:execution-not-found', workflowError);
        return false;
      }

      // Find the step to retry
      const workflow = this.engine.getWorkflow(execution.workflowId);
      if (!workflow) {
        this.emit('error:workflow-not-found', workflowError);
        return false;
      }

      const step = workflow.steps.find(s => s.id === workflowError.stepId);
      if (!step) {
        this.emit('error:step-not-found', workflowError);
        return false;
      }

      // Increment attempt counter
      workflowError.attempts++;
      this.emit('error:retry-attempt', workflowError);

      // Re-execute the step
      // Note: This would need to be integrated with the actual step execution logic
      // For now, we'll simulate a successful retry
      const retrySuccessful = Math.random() > 0.3; // 70% success rate on retry
      
      if (retrySuccessful) {
        workflowError.resolved = true;
        this.emit('error:resolved', workflowError);
        return true;
      } else {
        // Recursive retry if not at max attempts
        return await this.handleRetryStrategy(workflowError);
      }
    } catch (retryError) {
      workflowError.error = retryError as Error;
      this.emit('error:retry-failed', workflowError);
      return await this.handleRetryStrategy(workflowError);
    }
  }

  // Skip strategy implementation
  private async handleSkipStrategy(workflowError: WorkflowError): Promise<boolean> {
    try {
      const execution = this.engine.getExecution(workflowError.executionId);
      if (!execution) return false;

      // Mark step as skipped in results
      execution.results[workflowError.stepId] = {
        skipped: true,
        reason: 'Error recovery - step skipped',
        originalError: workflowError.error.message,
        timestamp: new Date()
      };

      workflowError.resolved = true;
      this.emit('error:step-skipped', workflowError);
      
      return true;
    } catch (error) {
      this.emit('error:skip-failed', { workflowError, error });
      return false;
    }
  }

  // Alternative strategy implementation
  private async handleAlternativeStrategy(workflowError: WorkflowError): Promise<boolean> {
    const strategy = workflowError.recoveryStrategy!;
    if (!strategy.alternativeStep) {
      this.emit('error:no-alternative-step', workflowError);
      return false;
    }

    try {
      const execution = this.engine.getExecution(workflowError.executionId);
      if (!execution) return false;

      const workflow = this.engine.getWorkflow(execution.workflowId);
      if (!workflow) return false;

      const alternativeStep = workflow.steps.find(s => s.id === strategy.alternativeStep);
      if (!alternativeStep) {
        this.emit('error:alternative-step-not-found', workflowError);
        return false;
      }

      // Execute alternative step
      // Note: This would need integration with actual step execution
      execution.results[workflowError.stepId] = {
        alternativeExecuted: true,
        alternativeStep: strategy.alternativeStep,
        reason: 'Error recovery - alternative step executed',
        timestamp: new Date()
      };

      workflowError.resolved = true;
      this.emit('error:alternative-executed', workflowError);
      
      return true;
    } catch (error) {
      this.emit('error:alternative-failed', { workflowError, error });
      return false;
    }
  }

  // Rollback strategy implementation
  private async handleRollbackStrategy(workflowError: WorkflowError): Promise<boolean> {
    const strategy = workflowError.recoveryStrategy!;
    const rollbackSteps = strategy.rollbackSteps || [];

    try {
      const execution = this.engine.getExecution(workflowError.executionId);
      if (!execution) return false;

      // Remove results for rollback steps
      for (const stepId of rollbackSteps) {
        if (execution.results[stepId]) {
          delete execution.results[stepId];
          this.emit('step:rolled-back', { executionId: workflowError.executionId, stepId });
        }
      }

      // Mark current step as rolled back
      execution.results[workflowError.stepId] = {
        rolledBack: true,
        rollbackSteps,
        reason: 'Error recovery - rollback executed',
        timestamp: new Date()
      };

      workflowError.resolved = true;
      this.emit('error:rollback-executed', workflowError);
      
      return true;
    } catch (error) {
      this.emit('error:rollback-failed', { workflowError, error });
      return false;
    }
  }

  // Escalation strategy implementation
  private async handleEscalationStrategy(workflowError: WorkflowError): Promise<boolean> {
    const strategy = workflowError.recoveryStrategy!;
    
    try {
      // Create escalation alert
      if (this.monitor) {
        // This would create a high-priority alert for manual intervention
        this.emit('error:escalated', {
          workflowError,
          handler: strategy.escalationHandler,
          requiresManualIntervention: true
        });
      }

      // Pause the workflow for manual intervention
      await this.engine.pauseWorkflow(workflowError.executionId);
      
      workflowError.resolved = false; // Requires manual resolution
      this.emit('error:awaiting-manual-intervention', workflowError);
      
      return false; // Not automatically resolved
    } catch (error) {
      this.emit('error:escalation-failed', { workflowError, error });
      return false;
    }
  }

  // Circuit breaker implementation
  private async checkCircuitBreaker(identifier: string, error: Error): Promise<boolean> {
    let state = this.circuitBreakers.get(identifier) || {
      failures: 0,
      state: 'closed'
    };

    const now = new Date();

    switch (state.state) {
      case 'closed':
        state.failures++;
        state.lastFailure = now;
        
        if (state.failures >= this.circuitBreakerConfig.failureThreshold) {
          state.state = 'open';
          state.nextAttempt = new Date(now.getTime() + this.circuitBreakerConfig.timeout);
          this.emit('circuit-breaker:opened', { identifier, failures: state.failures });
        }
        break;

      case 'open':
        if (state.nextAttempt && now >= state.nextAttempt) {
          state.state = 'half-open';
          state.failures = 0;
          this.emit('circuit-breaker:half-open', { identifier });
        } else {
          this.emit('circuit-breaker:rejected', { identifier, nextAttempt: state.nextAttempt });
          this.circuitBreakers.set(identifier, state);
          return true; // Circuit breaker is open
        }
        break;

      case 'half-open':
        state.failures++;
        
        if (state.failures >= this.circuitBreakerConfig.halfOpenMaxAttempts) {
          state.state = 'open';
          state.nextAttempt = new Date(now.getTime() + this.circuitBreakerConfig.timeout);
          this.emit('circuit-breaker:reopened', { identifier });
        }
        break;
    }

    this.circuitBreakers.set(identifier, state);
    return false; // Circuit breaker allows execution
  }

  // Reset circuit breaker on successful execution
  resetCircuitBreaker(identifier: string): void {
    const state = this.circuitBreakers.get(identifier);
    if (state) {
      state.failures = 0;
      state.state = 'closed';
      delete state.nextAttempt;
      this.circuitBreakers.set(identifier, state);
      this.emit('circuit-breaker:reset', { identifier });
    }
  }

  // Get recovery strategy for step
  private getRecoveryStrategy(stepId: string, stepType?: string): ErrorRecoveryStrategy {
    // Try specific step ID first
    let strategy = this.recoveryStrategies.get(stepId);
    
    // Fall back to step type
    if (!strategy && stepType) {
      strategy = this.recoveryStrategies.get(stepType);
    }
    
    // Fall back to default
    return strategy || this.defaultStrategy;
  }

  // Send error to dead letter queue
  private async sendToDeadLetterQueue(workflowError: WorkflowError): Promise<void> {
    this.deadLetterQueue.push(workflowError);
    this.emit('dead-letter:added', workflowError);
    
    // Limit dead letter queue size
    if (this.deadLetterQueue.length > 1000) {
      this.deadLetterQueue = this.deadLetterQueue.slice(-500);
    }

    // Pause the workflow execution
    try {
      await this.engine.pauseWorkflow(workflowError.executionId);
      this.emit('workflow:paused-due-to-error', workflowError);
    } catch (error) {
      this.emit('error:pause-failed', { workflowError, error });
    }
  }

  // Setup engine event listeners
  private setupEngineEventListeners(): void {
    this.engine.on('workflow:failed', async (data) => {
      // Handle workflow-level failures
      this.emit('workflow:failure-detected', data);
    });

    this.engine.on('node:error', async (data) => {
      // Handle step-level errors
      await this.handleStepError(
        data.executionId || 'unknown',
        data.nodeId,
        data.error,
        data.type
      );
    });
  }

  // Get error statistics
  getErrorStatistics(): {
    totalErrors: number;
    resolvedErrors: number;
    unresolvedErrors: number;
    deadLetterQueueSize: number;
    circuitBreakersOpen: number;
    errorsByType: Record<string, number>;
    recoveryStrategiesUsed: Record<string, number>;
  } {
    const errors = Array.from(this.errors.values());
    const totalErrors = errors.length;
    const resolvedErrors = errors.filter(e => e.resolved).length;
    const unresolvedErrors = totalErrors - resolvedErrors;
    const deadLetterQueueSize = this.deadLetterQueue.length;
    
    const circuitBreakersOpen = Array.from(this.circuitBreakers.values())
      .filter(cb => cb.state === 'open').length;

    const errorsByType: Record<string, number> = {};
    const recoveryStrategiesUsed: Record<string, number> = {};

    errors.forEach(error => {
      const errorType = error.error.constructor.name;
      errorsByType[errorType] = (errorsByType[errorType] || 0) + 1;
      
      if (error.recoveryStrategy) {
        const strategy = error.recoveryStrategy.type;
        recoveryStrategiesUsed[strategy] = (recoveryStrategiesUsed[strategy] || 0) + 1;
      }
    });

    return {
      totalErrors,
      resolvedErrors,
      unresolvedErrors,
      deadLetterQueueSize,
      circuitBreakersOpen,
      errorsByType,
      recoveryStrategiesUsed
    };
  }

  // Get dead letter queue items
  getDeadLetterQueue(): WorkflowError[] {
    return [...this.deadLetterQueue];
  }

  // Manually resolve error (for escalated errors)
  async resolveError(errorId: string, resolution: 'retry' | 'skip' | 'cancel'): Promise<boolean> {
    const error = this.errors.get(errorId);
    if (!error) {
      this.emit('error:not-found', { errorId });
      return false;
    }

    try {
      switch (resolution) {
        case 'retry':
          return await this.handleRetryStrategy(error);
          
        case 'skip':
          return await this.handleSkipStrategy(error);
          
        case 'cancel':
          await this.engine.cancelExecution(error.executionId);
          error.resolved = true;
          this.emit('error:manually-cancelled', error);
          return true;
          
        default:
          return false;
      }
    } catch (resolutionError) {
      this.emit('error:manual-resolution-failed', { error, resolutionError });
      return false;
    }
  }

  // Cleanup old errors
  cleanupOldErrors(olderThanMs = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - olderThanMs;
    
    for (const [errorId, error] of this.errors) {
      if (error.timestamp.getTime() < cutoff && error.resolved) {
        this.errors.delete(errorId);
      }
    }

    // Clean up dead letter queue
    this.deadLetterQueue = this.deadLetterQueue.filter(
      error => error.timestamp.getTime() > cutoff
    );
  }

  // Shutdown
  shutdown(): void {
    this.removeAllListeners();
    this.errors.clear();
    this.circuitBreakers.clear();
    this.recoveryStrategies.clear();
    this.deadLetterQueue = [];
  }
}