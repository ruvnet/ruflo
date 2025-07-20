/**
 * Circuit Breaker Pattern Implementation for LLM Providers
 * Prevents cascading failures and provides automatic recovery
 */

export interface CircuitBreakerConfig {
  failureThreshold: number;  // Number of failures before opening
  recoveryTimeout: number;   // Time in ms before attempting recovery
  monitoringPeriod: number;  // Time window for failure counting
  successThreshold: number;  // Successful calls needed to close circuit
}

export enum CircuitState {
  CLOSED = 'closed',       // Normal operation
  OPEN = 'open',          // Failing, block all requests
  HALF_OPEN = 'half_open' // Testing recovery
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;
  private nextAttemptTime = 0;
  
  constructor(private config: CircuitBreakerConfig) {}

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttemptTime) {
        throw new Error('Circuit breaker is OPEN - blocking request');
      }
      // Transition to half-open for testing
      this.state = CircuitState.HALF_OPEN;
      this.successes = 0;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    this.failures = 0;
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.successes = 0;
      }
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.state === CircuitState.HALF_OPEN) {
      // Failed during recovery, go back to open
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = Date.now() + this.config.recoveryTimeout;
    } else if (this.failures >= this.config.failureThreshold) {
      // Too many failures, open the circuit
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = Date.now() + this.config.recoveryTimeout;
    }
  }

  /**
   * Get current circuit breaker state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get current metrics
   */
  getMetrics(): {
    state: CircuitState;
    failures: number;
    successes: number;
    lastFailureTime: number;
    nextAttemptTime: number;
  } {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.nextAttemptTime
    };
  }

  /**
   * Force reset the circuit breaker
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = 0;
    this.nextAttemptTime = 0;
  }

  /**
   * Check if circuit allows requests
   */
  isCallable(): boolean {
    return this.state === CircuitState.CLOSED || 
           (this.state === CircuitState.HALF_OPEN && Date.now() >= this.nextAttemptTime);
  }
}