/**
 * Rate Limiter for TeammateTool operations
 *
 * Implements sliding window rate limiting to prevent abuse
 * and ensure fair resource distribution across teammates.
 *
 * @module @claude-flow/teammate-plugin/utils/rate-limiter
 */

import type { RateLimitConfig, RateLimitState } from '../types.js';

/**
 * Rate limiter with configurable per-operation limits
 */
export class RateLimiter {
  private windows: Map<string, RateLimitState> = new Map();
  private readonly windowMs = 60000; // 1 minute window

  constructor(private config: RateLimitConfig) {}

  /**
   * Check if operation is allowed under rate limit
   */
  checkLimit(operation: keyof RateLimitConfig): boolean {
    const limit = this.config[operation];
    const now = Date.now();
    const state = this.windows.get(operation);

    if (!state || now - state.windowStart >= this.windowMs) {
      // New window
      this.windows.set(operation, {
        operation,
        count: 1,
        windowStart: now,
        blocked: false,
      });
      return true;
    }

    if (state.count >= limit) {
      state.blocked = true;
      state.nextAllowedAt = state.windowStart + this.windowMs;
      return false;
    }

    state.count++;
    return true;
  }

  /**
   * Get current state for an operation
   */
  getState(operation: string): RateLimitState | undefined {
    return this.windows.get(operation);
  }

  /**
   * Reset rate limit for an operation
   */
  reset(operation?: string): void {
    if (operation) {
      this.windows.delete(operation);
    } else {
      this.windows.clear();
    }
  }

  /**
   * Get remaining quota for an operation
   */
  getRemaining(operation: keyof RateLimitConfig): number {
    const limit = this.config[operation];
    const state = this.windows.get(operation);
    if (!state) return limit;
    return Math.max(0, limit - state.count);
  }

  /**
   * Get window duration in milliseconds
   */
  getWindowMs(): number {
    return this.windowMs;
  }

  /**
   * Check if an operation is currently blocked
   */
  isBlocked(operation: keyof RateLimitConfig): boolean {
    const state = this.windows.get(operation);
    return state?.blocked ?? false;
  }

  /**
   * Get time until rate limit resets for an operation
   */
  getTimeUntilReset(operation: keyof RateLimitConfig): number {
    const state = this.windows.get(operation);
    if (!state) return 0;
    const remaining = (state.windowStart + this.windowMs) - Date.now();
    return Math.max(0, remaining);
  }
}
