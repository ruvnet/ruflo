# Azure Agent Error Handling & Retry Mechanisms

## Overview
This document defines comprehensive error handling strategies, retry mechanisms, and recovery patterns for the Azure Agent. The goal is to provide resilient, self-healing operations that gracefully handle failures and provide actionable feedback.

## Error Taxonomy

### Error Categories

```typescript
enum ErrorCategory {
  // Transient errors - automatically retryable
  NETWORK = 'network',                    // Connection issues
  THROTTLING = 'throttling',              // Rate limiting
  SERVER_ERROR = 'server_error',          // Azure service errors (5xx)
  TIMEOUT = 'timeout',                    // Request timeouts

  // User errors - not retryable
  AUTHENTICATION = 'authentication',      // Invalid credentials
  AUTHORIZATION = 'authorization',        // Insufficient permissions
  VALIDATION = 'validation',              // Invalid parameters
  NOT_FOUND = 'not_found',               // Resource doesn't exist
  CONFLICT = 'conflict',                 // Resource state conflict

  // System errors - may require intervention
  CONFIGURATION = 'configuration',        // Invalid configuration
  INTERNAL = 'internal',                 // Agent internal errors
  DEPENDENCY = 'dependency',             // External dependency failures

  // Unknown
  UNKNOWN = 'unknown'
}

enum ErrorSeverity {
  CRITICAL = 'critical',  // System-level failure, agent cannot continue
  HIGH = 'high',          // Operation failed, manual intervention may be needed
  MEDIUM = 'medium',      // Operation failed, automatic retry may help
  LOW = 'low',           // Minor issue, operation can continue
  INFO = 'info'          // Informational, not an actual error
}
```

### Error Structure

```typescript
interface AgentError extends Error {
  // Error identification
  code: string;
  category: ErrorCategory;
  severity: ErrorSeverity;

  // Context
  operation: string;
  resourceId?: string;
  timestamp: Date;

  // Original error
  cause?: Error;
  azureError?: AzureError;

  // Recovery information
  recoverable: boolean;
  retryable: boolean;
  suggestions: Suggestion[];

  // Additional data
  metadata: Record<string, any>;
}

interface AzureError {
  code: string;
  message: string;
  statusCode?: number;
  requestId?: string;
  timestamp?: string;
  details?: any;
}

interface Suggestion {
  action: string;
  description: string;
  automated: boolean;  // Can be automatically applied
  command?: string;    // CLI command to fix
}
```

## Error Detection and Classification

### Error Classifier

```typescript
class ErrorClassifier {
  classify(error: any): AgentError {
    // Detect error source
    const source = this.detectSource(error);

    // Determine category
    const category = this.categorize(error);

    // Assess severity
    const severity = this.assessSeverity(error, category);

    // Check if recoverable
    const recoverable = this.isRecoverable(category);

    // Check if retryable
    const retryable = this.isRetryable(category, error);

    // Generate suggestions
    const suggestions = this.generateSuggestions(error, category);

    return {
      name: 'AgentError',
      message: this.extractMessage(error),
      code: this.extractErrorCode(error),
      category,
      severity,
      operation: this.extractOperation(error),
      resourceId: this.extractResourceId(error),
      timestamp: new Date(),
      cause: error,
      azureError: this.extractAzureError(error),
      recoverable,
      retryable,
      suggestions,
      metadata: this.extractMetadata(error)
    };
  }

  private categorize(error: any): ErrorCategory {
    // Network errors
    if (this.isNetworkError(error)) {
      return ErrorCategory.NETWORK;
    }

    // Azure API errors
    if (error.statusCode) {
      if (error.statusCode === 401) {
        return ErrorCategory.AUTHENTICATION;
      }
      if (error.statusCode === 403) {
        return ErrorCategory.AUTHORIZATION;
      }
      if (error.statusCode === 404) {
        return ErrorCategory.NOT_FOUND;
      }
      if (error.statusCode === 409) {
        return ErrorCategory.CONFLICT;
      }
      if (error.statusCode === 429) {
        return ErrorCategory.THROTTLING;
      }
      if (error.statusCode >= 500) {
        return ErrorCategory.SERVER_ERROR;
      }
      if (error.statusCode >= 400) {
        return ErrorCategory.VALIDATION;
      }
    }

    // Azure error codes
    const code = error.code || error.error?.code || '';
    if (code.includes('AuthenticationFailed')) {
      return ErrorCategory.AUTHENTICATION;
    }
    if (code.includes('AuthorizationFailed')) {
      return ErrorCategory.AUTHORIZATION;
    }
    if (code.includes('InvalidParameter') || code.includes('ValidationError')) {
      return ErrorCategory.VALIDATION;
    }
    if (code.includes('ResourceNotFound')) {
      return ErrorCategory.NOT_FOUND;
    }
    if (code.includes('Conflict')) {
      return ErrorCategory.CONFLICT;
    }

    // Timeout errors
    if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
      return ErrorCategory.TIMEOUT;
    }

    return ErrorCategory.UNKNOWN;
  }

  private isNetworkError(error: any): boolean {
    const networkCodes = [
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ENETUNREACH',
      'EHOSTUNREACH'
    ];

    return networkCodes.includes(error.code);
  }

  private assessSeverity(error: any, category: ErrorCategory): ErrorSeverity {
    // Critical errors
    if (category === ErrorCategory.AUTHENTICATION) {
      return ErrorSeverity.CRITICAL;
    }
    if (category === ErrorCategory.CONFIGURATION) {
      return ErrorSeverity.CRITICAL;
    }

    // High severity
    if (category === ErrorCategory.AUTHORIZATION) {
      return ErrorSeverity.HIGH;
    }

    // Medium severity
    if (category === ErrorCategory.SERVER_ERROR) {
      return ErrorSeverity.MEDIUM;
    }
    if (category === ErrorCategory.THROTTLING) {
      return ErrorSeverity.MEDIUM;
    }

    // Low severity
    if (category === ErrorCategory.NOT_FOUND) {
      return ErrorSeverity.LOW;
    }
    if (category === ErrorCategory.VALIDATION) {
      return ErrorSeverity.LOW;
    }

    return ErrorSeverity.MEDIUM;
  }

  private isRecoverable(category: ErrorCategory): boolean {
    return [
      ErrorCategory.NETWORK,
      ErrorCategory.THROTTLING,
      ErrorCategory.SERVER_ERROR,
      ErrorCategory.TIMEOUT
    ].includes(category);
  }

  private isRetryable(category: ErrorCategory, error: any): boolean {
    // Always retryable
    if (this.isRecoverable(category)) {
      return true;
    }

    // Sometimes retryable based on specific error
    if (category === ErrorCategory.CONFLICT) {
      // Retry conflicts if it's a transient state issue
      return error.message?.includes('transitioning') || false;
    }

    return false;
  }

  private generateSuggestions(
    error: any,
    category: ErrorCategory
  ): Suggestion[] {
    const suggestions: Suggestion[] = [];

    switch (category) {
      case ErrorCategory.AUTHENTICATION:
        suggestions.push({
          action: 'Verify credentials',
          description: 'Check that your Azure credentials are valid and not expired',
          automated: false
        });
        suggestions.push({
          action: 'Re-authenticate',
          description: 'Log in to Azure CLI',
          automated: false,
          command: 'az login'
        });
        break;

      case ErrorCategory.AUTHORIZATION:
        suggestions.push({
          action: 'Check permissions',
          description: 'Verify you have the required RBAC roles',
          automated: false
        });
        suggestions.push({
          action: 'List role assignments',
          description: 'View your current role assignments',
          automated: false,
          command: 'az role assignment list --assignee <your-principal-id>'
        });
        break;

      case ErrorCategory.THROTTLING:
        suggestions.push({
          action: 'Wait and retry',
          description: 'Azure is rate limiting requests. Wait before retrying',
          automated: true
        });
        suggestions.push({
          action: 'Reduce request frequency',
          description: 'Consider batching operations or reducing concurrency',
          automated: false
        });
        break;

      case ErrorCategory.VALIDATION:
        suggestions.push({
          action: 'Review parameters',
          description: 'Check the parameters you provided for correctness',
          automated: false
        });
        if (error.details) {
          suggestions.push({
            action: 'Fix validation errors',
            description: `Address these validation issues: ${JSON.stringify(error.details)}`,
            automated: false
          });
        }
        break;

      case ErrorCategory.NOT_FOUND:
        suggestions.push({
          action: 'Verify resource exists',
          description: 'Confirm the resource ID or name is correct',
          automated: false
        });
        suggestions.push({
          action: 'Check subscription',
          description: 'Ensure you are using the correct subscription',
          automated: false,
          command: 'az account show'
        });
        break;

      case ErrorCategory.NETWORK:
        suggestions.push({
          action: 'Check connectivity',
          description: 'Verify your network connection to Azure',
          automated: false
        });
        suggestions.push({
          action: 'Retry operation',
          description: 'The operation will be retried automatically',
          automated: true
        });
        break;
    }

    return suggestions;
  }
}
```

## Retry Mechanisms

### Retry Strategy Interface

```typescript
interface RetryStrategy {
  // Determine if error should be retried
  shouldRetry(error: AgentError, attempt: number): boolean;

  // Calculate delay before next retry
  getDelay(attempt: number): number;

  // Maximum retry attempts
  maxAttempts: number;

  // Strategy name
  name: string;
}
```

### Built-in Retry Strategies

```typescript
class ImmediateRetryStrategy implements RetryStrategy {
  name = 'immediate';
  maxAttempts: number;

  constructor(maxAttempts: number = 3) {
    this.maxAttempts = maxAttempts;
  }

  shouldRetry(error: AgentError, attempt: number): boolean {
    return error.retryable && attempt < this.maxAttempts;
  }

  getDelay(attempt: number): number {
    return 0; // No delay
  }
}

class ExponentialBackoffStrategy implements RetryStrategy {
  name = 'exponential';
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  factor: number;

  constructor(config: {
    maxAttempts?: number;
    baseDelay?: number;
    maxDelay?: number;
    factor?: number;
  } = {}) {
    this.maxAttempts = config.maxAttempts || 5;
    this.baseDelay = config.baseDelay || 1000;
    this.maxDelay = config.maxDelay || 60000;
    this.factor = config.factor || 2;
  }

  shouldRetry(error: AgentError, attempt: number): boolean {
    return error.retryable && attempt < this.maxAttempts;
  }

  getDelay(attempt: number): number {
    const delay = this.baseDelay * Math.pow(this.factor, attempt);
    return Math.min(delay, this.maxDelay);
  }
}

class LinearBackoffStrategy implements RetryStrategy {
  name = 'linear';
  maxAttempts: number;
  baseDelay: number;
  increment: number;
  maxDelay: number;

  constructor(config: {
    maxAttempts?: number;
    baseDelay?: number;
    increment?: number;
    maxDelay?: number;
  } = {}) {
    this.maxAttempts = config.maxAttempts || 5;
    this.baseDelay = config.baseDelay || 1000;
    this.increment = config.increment || 1000;
    this.maxDelay = config.maxDelay || 30000;
  }

  shouldRetry(error: AgentError, attempt: number): boolean {
    return error.retryable && attempt < this.maxAttempts;
  }

  getDelay(attempt: number): number {
    const delay = this.baseDelay + (this.increment * attempt);
    return Math.min(delay, this.maxDelay);
  }
}

class AdaptiveRetryStrategy implements RetryStrategy {
  name = 'adaptive';
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  private errorHistory: Map<string, ErrorStats> = new Map();

  constructor(config: {
    maxAttempts?: number;
    baseDelay?: number;
    maxDelay?: number;
  } = {}) {
    this.maxAttempts = config.maxAttempts || 5;
    this.baseDelay = config.baseDelay || 1000;
    this.maxDelay = config.maxDelay || 60000;
  }

  shouldRetry(error: AgentError, attempt: number): boolean {
    if (!error.retryable || attempt >= this.maxAttempts) {
      return false;
    }

    // Check success rate for this error type
    const stats = this.errorHistory.get(error.code);
    if (stats && stats.successRate < 0.1) {
      // Less than 10% success rate after retry, don't retry
      return false;
    }

    return true;
  }

  getDelay(attempt: number): number {
    // Use exponential backoff, but adjust based on error history
    const baseDelay = this.baseDelay * Math.pow(2, attempt);

    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 1000;

    const delay = Math.min(baseDelay + jitter, this.maxDelay);
    return delay;
  }

  recordAttempt(errorCode: string, success: boolean): void {
    const stats = this.errorHistory.get(errorCode) || {
      total: 0,
      successful: 0,
      successRate: 0
    };

    stats.total++;
    if (success) {
      stats.successful++;
    }
    stats.successRate = stats.successful / stats.total;

    this.errorHistory.set(errorCode, stats);
  }
}

interface ErrorStats {
  total: number;
  successful: number;
  successRate: number;
}
```

### Retry Executor

```typescript
class RetryExecutor {
  private strategy: RetryStrategy;
  private classifier: ErrorClassifier;

  constructor(strategy: RetryStrategy, classifier: ErrorClassifier) {
    this.strategy = strategy;
    this.classifier = classifier;
  }

  async execute<T>(
    operation: () => Promise<T>,
    context: OperationContext
  ): Promise<T> {
    let attempt = 0;
    let lastError: AgentError;

    while (true) {
      try {
        // Execute operation
        const result = await operation();

        // Record success if using adaptive strategy
        if (this.strategy instanceof AdaptiveRetryStrategy && lastError) {
          this.strategy.recordAttempt(lastError.code, true);
        }

        return result;

      } catch (error) {
        // Classify error
        const agentError = this.classifier.classify(error);
        lastError = agentError;

        // Check if should retry
        if (!this.strategy.shouldRetry(agentError, attempt)) {
          // Record failure if using adaptive strategy
          if (this.strategy instanceof AdaptiveRetryStrategy) {
            this.strategy.recordAttempt(agentError.code, false);
          }

          throw agentError;
        }

        // Log retry attempt
        console.warn(
          `Operation failed (attempt ${attempt + 1}/${this.strategy.maxAttempts}): ${agentError.message}`
        );

        // Calculate delay
        const delay = this.strategy.getDelay(attempt);

        // Notify about retry
        await this.notifyRetry(context, agentError, attempt, delay);

        // Wait before retry
        if (delay > 0) {
          await this.sleep(delay);
        }

        attempt++;
      }
    }
  }

  private async notifyRetry(
    context: OperationContext,
    error: AgentError,
    attempt: number,
    delay: number
  ): Promise<void> {
    // Emit retry event for monitoring
    if (context.eventEmitter) {
      context.eventEmitter.emit('retry', {
        operation: context.operation,
        error,
        attempt,
        delay,
        nextAttemptIn: delay
      });
    }

    // Call Claude Flow notify hook if enabled
    if (context.claudeFlowEnabled) {
      try {
        await this.executeClaudeFlowHook('notify', {
          message: `Retrying operation after error: ${error.message}`,
          attempt,
          delay
        });
      } catch (hookError) {
        // Don't fail the retry on hook errors
        console.error('Failed to execute notify hook:', hookError);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async executeClaudeFlowHook(
    hook: string,
    data: any
  ): Promise<void> {
    // Execute Claude Flow hook
    // Implementation depends on Claude Flow integration
  }
}

interface OperationContext {
  operation: string;
  resourceId?: string;
  eventEmitter?: EventEmitter;
  claudeFlowEnabled?: boolean;
}
```

## Circuit Breaker Pattern

```typescript
enum CircuitState {
  CLOSED = 'closed',   // Normal operation
  OPEN = 'open',       // Circuit tripped, failing fast
  HALF_OPEN = 'half_open' // Testing if service recovered
}

interface CircuitBreakerConfig {
  // Failure threshold before opening circuit
  failureThreshold: number;

  // Time window for counting failures (milliseconds)
  failureWindow: number;

  // Time to wait before attempting recovery (milliseconds)
  resetTimeout: number;

  // Number of successful requests to close circuit
  successThreshold: number;
}

class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number = 0;
  private successes: number = 0;
  private lastFailureTime?: number;
  private nextAttemptTime?: number;

  constructor(
    private config: CircuitBreakerConfig,
    private operation: string
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check circuit state
    if (this.state === CircuitState.OPEN) {
      // Check if we should transition to half-open
      if (this.shouldAttemptReset()) {
        this.state = CircuitState.HALF_OPEN;
        this.successes = 0;
      } else {
        throw new Error(
          `Circuit breaker is OPEN for ${this.operation}. ` +
          `Next attempt in ${this.getNextAttemptDelay()}ms`
        );
      }
    }

    try {
      // Execute operation
      const result = await fn();

      // Record success
      this.onSuccess();

      return result;

    } catch (error) {
      // Record failure
      this.onFailure();

      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;

      // Check if we should close the circuit
      if (this.successes >= this.config.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.failures = 0;
        this.successes = 0;
        console.info(`Circuit breaker CLOSED for ${this.operation}`);
      }
    } else {
      // Reset failure count
      this.failures = 0;
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      // Failed during recovery, reopen circuit
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = Date.now() + this.config.resetTimeout;
      console.warn(`Circuit breaker reopened for ${this.operation}`);
    } else if (this.failures >= this.config.failureThreshold) {
      // Threshold exceeded, open circuit
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = Date.now() + this.config.resetTimeout;
      console.error(`Circuit breaker OPEN for ${this.operation}`);
    }
  }

  private shouldAttemptReset(): boolean {
    return this.nextAttemptTime !== undefined &&
           Date.now() >= this.nextAttemptTime;
  }

  private getNextAttemptDelay(): number {
    if (this.nextAttemptTime) {
      return Math.max(0, this.nextAttemptTime - Date.now());
    }
    return 0;
  }

  getState(): CircuitState {
    return this.state;
  }

  getMetrics(): CircuitBreakerMetrics {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.nextAttemptTime
    };
  }
}

interface CircuitBreakerMetrics {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime?: number;
  nextAttemptTime?: number;
}
```

## Rollback Mechanisms

### Transaction Rollback

```typescript
interface RollbackStrategy {
  // Execute rollback
  rollback(checkpoints: Checkpoint[]): Promise<RollbackResult>;

  // Can this operation be rolled back?
  canRollback(operation: Operation): boolean;

  // Strategy name
  name: string;
}

class FullRollbackStrategy implements RollbackStrategy {
  name = 'full';

  async rollback(checkpoints: Checkpoint[]): Promise<RollbackResult> {
    const results: CheckpointRollback[] = [];

    // Rollback in reverse order
    for (const checkpoint of checkpoints.reverse()) {
      try {
        await this.rollbackCheckpoint(checkpoint);
        results.push({
          checkpointId: checkpoint.id,
          success: true
        });
      } catch (error) {
        results.push({
          checkpointId: checkpoint.id,
          success: false,
          error: error.message
        });
        // Continue with remaining rollbacks
      }
    }

    return {
      strategy: this.name,
      checkpointsRolledBack: results.filter(r => r.success).length,
      checkpointsFailed: results.filter(r => !r.success).length,
      results
    };
  }

  canRollback(operation: Operation): boolean {
    // Most operations can be rolled back
    const nonReversible = ['delete', 'purge'];
    return !nonReversible.includes(operation.action);
  }

  private async rollbackCheckpoint(checkpoint: Checkpoint): Promise<void> {
    const { rollbackInfo } = checkpoint;

    switch (rollbackInfo.type) {
      case 'resource_creation':
        await this.deleteResource(rollbackInfo.resourceId);
        break;

      case 'resource_update':
        await this.restoreResource(
          rollbackInfo.resourceId,
          rollbackInfo.previousState
        );
        break;

      case 'resource_deletion':
        // Cannot rollback deletion
        throw new Error('Cannot rollback resource deletion');

      default:
        throw new Error(`Unknown rollback type: ${rollbackInfo.type}`);
    }
  }
}

interface RollbackResult {
  strategy: string;
  checkpointsRolledBack: number;
  checkpointsFailed: number;
  results: CheckpointRollback[];
}

interface CheckpointRollback {
  checkpointId: string;
  success: boolean;
  error?: string;
}
```

## Error Recovery Workflows

### Automatic Recovery

```typescript
class AutoRecovery {
  async attempt(error: AgentError): Promise<RecoveryResult> {
    // Find applicable recovery strategies
    const strategies = this.findStrategies(error);

    for (const strategy of strategies) {
      try {
        const result = await strategy.execute(error);

        if (result.success) {
          return {
            recovered: true,
            strategy: strategy.name,
            action: result.action
          };
        }
      } catch (recoveryError) {
        // Try next strategy
        continue;
      }
    }

    return {
      recovered: false,
      message: 'No automatic recovery available'
    };
  }

  private findStrategies(error: AgentError): RecoveryStrategy[] {
    const strategies: RecoveryStrategy[] = [];

    switch (error.category) {
      case ErrorCategory.AUTHENTICATION:
        strategies.push(new TokenRefreshStrategy());
        strategies.push(new ReAuthenticationStrategy());
        break;

      case ErrorCategory.THROTTLING:
        strategies.push(new BackoffStrategy());
        break;

      case ErrorCategory.NETWORK:
        strategies.push(new ReconnectionStrategy());
        break;

      case ErrorCategory.CONFLICT:
        strategies.push(new StateResyncStrategy());
        break;
    }

    return strategies;
  }
}

interface RecoveryStrategy {
  name: string;
  execute(error: AgentError): Promise<RecoveryResult>;
}

interface RecoveryResult {
  recovered: boolean;
  strategy?: string;
  action?: string;
  message?: string;
}
```

## Error Reporting and Monitoring

### Error Metrics

```typescript
interface ErrorMetrics {
  // Error counts by category
  errorsByCategory: Record<ErrorCategory, number>;

  // Error counts by severity
  errorsBySeverity: Record<ErrorSeverity, number>;

  // Retry statistics
  retryStats: {
    totalRetries: number;
    successfulRetries: number;
    failedRetries: number;
    averageRetryCount: number;
  };

  // Circuit breaker statistics
  circuitBreakerStats: {
    totalTrips: number;
    currentlyOpen: number;
    averageRecoveryTime: number;
  };

  // Error rate
  errorRate: {
    last5Minutes: number;
    last15Minutes: number;
    last60Minutes: number;
  };
}
```

### Error Notification

```typescript
interface ErrorNotificationService {
  notify(error: AgentError, context: OperationContext): Promise<void>;
}

class CompositeNotificationService implements ErrorNotificationService {
  private services: ErrorNotificationService[] = [];

  add(service: ErrorNotificationService): void {
    this.services.push(service);
  }

  async notify(error: AgentError, context: OperationContext): Promise<void> {
    // Notify all services in parallel
    await Promise.allSettled(
      this.services.map(service => service.notify(error, context))
    );
  }
}

class LogNotificationService implements ErrorNotificationService {
  async notify(error: AgentError, context: OperationContext): Promise<void> {
    console.error({
      message: error.message,
      code: error.code,
      category: error.category,
      severity: error.severity,
      operation: context.operation,
      resourceId: context.resourceId,
      timestamp: error.timestamp
    });
  }
}

class ClaudeFlowNotificationService implements ErrorNotificationService {
  async notify(error: AgentError, context: OperationContext): Promise<void> {
    // Use Claude Flow notify hook
    await this.executeHook('notify', {
      type: 'error',
      severity: error.severity,
      message: error.message,
      operation: context.operation
    });
  }
}
```

## Best Practices

### 1. Always Classify Errors
```typescript
try {
  await operation();
} catch (error) {
  const agentError = classifier.classify(error);
  // Now you have structured error information
}
```

### 2. Use Appropriate Retry Strategy
```typescript
// For transient errors: exponential backoff
const strategy = new ExponentialBackoffStrategy({
  maxAttempts: 5,
  baseDelay: 1000,
  maxDelay: 30000
});

// For user errors: don't retry
if (error.category === ErrorCategory.VALIDATION) {
  throw error; // Don't retry
}
```

### 3. Implement Circuit Breakers for External Services
```typescript
const breaker = new CircuitBreaker({
  failureThreshold: 5,
  failureWindow: 60000,
  resetTimeout: 30000,
  successThreshold: 3
}, 'azure-api');

await breaker.execute(() => azureApiCall());
```

### 4. Provide Actionable Error Messages
```typescript
throw new AgentError({
  message: 'Failed to deploy resource',
  suggestions: [
    {
      action: 'Check subscription quota',
      command: 'az vm list-usage --location eastus'
    }
  ]
});
```

### 5. Monitor Error Rates
```typescript
// Track errors over time
metrics.recordError(error);

// Alert on high error rates
if (metrics.errorRate.last5Minutes > 0.1) {
  alertService.send('High error rate detected');
}
```
