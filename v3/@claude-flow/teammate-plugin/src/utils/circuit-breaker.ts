/**
 * Circuit Breaker for TeammateTool operations
 *
 * Implements the circuit breaker pattern to prevent
 * cascading failures and allow graceful degradation.
 *
 * States:
 * - closed: Normal operation, requests pass through
 * - open: Failing, requests are rejected immediately
 * - half-open: Testing if service recovered
 *
 * @module @claude-flow/teammate-plugin/utils/circuit-breaker
 */

import type {
  CircuitBreakerConfig,
  CircuitBreakerState,
} from '../types.js';
import { TeammateErrorCode } from '../types.js';

/**
 * Error thrown when circuit breaker is open
 */
export class CircuitBreakerOpenError extends Error {
  constructor(
    message: string,
    public readonly code: TeammateErrorCode = TeammateErrorCode.BACKEND_UNAVAILABLE,
    public readonly nextAttemptAt?: Date
  ) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

/**
 * Circuit breaker with configurable thresholds and timeouts
 */
export class CircuitBreaker {
  private state: CircuitBreakerState;

  constructor(private config: CircuitBreakerConfig) {
    this.state = this.createInitialState();
  }

  private createInitialState(): CircuitBreakerState {
    return {
      state: 'closed',
      failures: 0,
      successes: 0,
      lastFailure: null,
      lastSuccess: null,
      openedAt: null,
      nextAttemptAt: null,
    };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.config.enabled) {
      return fn();
    }

    if (this.state.state === 'open') {
      if (this.state.nextAttemptAt && Date.now() >= this.state.nextAttemptAt.getTime()) {
        this.state.state = 'half-open';
      } else {
        throw new CircuitBreakerOpenError(
          'Circuit breaker is open',
          TeammateErrorCode.BACKEND_UNAVAILABLE,
          this.state.nextAttemptAt ?? undefined
        );
      }
    }

    try {
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Circuit breaker timeout')), this.config.timeoutMs)
        ),
      ]);

      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Record a successful operation
   */
  recordSuccess(): void {
    this.state.failures = 0;
    this.state.successes++;
    this.state.lastSuccess = new Date();

    if (this.state.state === 'half-open' && this.state.successes >= this.config.successThreshold) {
      this.state.state = 'closed';
      this.state.openedAt = null;
      this.state.nextAttemptAt = null;
    }
  }

  /**
   * Record a failed operation
   */
  recordFailure(): void {
    this.state.failures++;
    this.state.successes = 0;
    this.state.lastFailure = new Date();

    if (this.state.failures >= this.config.failureThreshold) {
      this.state.state = 'open';
      this.state.openedAt = new Date();
      this.state.nextAttemptAt = new Date(Date.now() + this.config.resetTimeMs);
    }
  }

  /**
   * Get current circuit breaker state
   */
  getState(): CircuitBreakerState {
    return { ...this.state };
  }

  /**
   * Check if circuit is open
   */
  isOpen(): boolean {
    return this.state.state === 'open';
  }

  /**
   * Check if circuit is closed
   */
  isClosed(): boolean {
    return this.state.state === 'closed';
  }

  /**
   * Check if circuit is half-open
   */
  isHalfOpen(): boolean {
    return this.state.state === 'half-open';
  }

  /**
   * Reset circuit breaker to initial state
   */
  reset(): void {
    this.state = this.createInitialState();
  }

  /**
   * Force circuit to open state (for testing)
   */
  forceOpen(): void {
    this.state.state = 'open';
    this.state.openedAt = new Date();
    this.state.nextAttemptAt = new Date(Date.now() + this.config.resetTimeMs);
  }

  /**
   * Force circuit to half-open state (for testing)
   */
  forceHalfOpen(): void {
    this.state.state = 'half-open';
  }
}
