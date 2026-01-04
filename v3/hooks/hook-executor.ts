/**
 * V3 Hook Executor
 * Executes hooks with error handling, retries, and timeout support
 */

import type {
  HookType,
  HookRegistration,
  HookContext,
  HookPayload,
  HookResult,
  HookMetrics,
  HookOptions,
  SideEffect,
  HookError,
  HookTimeoutError
} from './types.js';
import { HookRegistry, hookRegistry } from './hook-registry.js';

/**
 * Executor options
 */
export interface ExecutorOptions {
  /** Default timeout for all hooks */
  defaultTimeout?: number;
  /** Default retry count */
  defaultRetries?: number;
  /** Default retry delay */
  defaultRetryDelay?: number;
  /** Whether to collect metrics */
  collectMetrics?: boolean;
  /** Whether to process side effects */
  processSideEffects?: boolean;
  /** Side effect handler */
  sideEffectHandler?: (effect: SideEffect, context: HookContext) => Promise<void>;
}

/**
 * Execution result with full details
 */
export interface ExecutionResult<T = unknown> {
  hookId: string;
  hookType: HookType;
  result: HookResult<T>;
  metrics: HookMetrics;
  error?: Error;
  retryCount: number;
}

/**
 * Hook executor
 */
export class HookExecutor {
  private registry: HookRegistry;
  private options: ExecutorOptions;
  private activeExecutions: Set<string> = new Set();

  constructor(registry: HookRegistry = hookRegistry, options: ExecutorOptions = {}) {
    this.registry = registry;
    this.options = {
      defaultTimeout: 30000,
      defaultRetries: 0,
      defaultRetryDelay: 1000,
      collectMetrics: true,
      processSideEffects: true,
      ...options
    };
  }

  /**
   * Execute a single hook
   */
  async executeHook<TPayload, TResult>(
    registration: HookRegistration<TPayload, TResult>,
    payload: HookPayload<TPayload>,
    context: HookContext
  ): Promise<ExecutionResult<TResult>> {
    const executionId = this.generateExecutionId();
    const startTime = Date.now();
    let retryCount = 0;
    let lastError: Error | undefined;

    this.activeExecutions.add(executionId);

    const hookOptions = registration.options || {};
    const timeout = hookOptions.timeout || this.options.defaultTimeout!;
    const maxRetries = hookOptions.retries || this.options.defaultRetries!;
    const retryDelay = hookOptions.retryDelay || this.options.defaultRetryDelay!;

    try {
      while (retryCount <= maxRetries) {
        try {
          // Execute with timeout
          const result = await this.executeWithTimeout<TResult>(
            () => registration.handler(payload, context) as Promise<HookResult<TResult>>,
            timeout,
            registration.id,
            registration.type
          );

          // Process side effects
          if (result.sideEffects && this.options.processSideEffects && this.options.sideEffectHandler) {
            await this.processSideEffects(result.sideEffects, context);
          }

          // Update statistics
          if (this.options.collectMetrics) {
            const duration = Date.now() - startTime;
            this.registry.updateStatistics(registration.id, {
              totalExecutions: 1,
              successfulExecutions: 1,
              duration
            });
          }

          return {
            hookId: registration.id,
            hookType: registration.type,
            result,
            metrics: {
              duration: Date.now() - startTime,
              cached: false
            },
            retryCount
          };

        } catch (error) {
          lastError = error as Error;
          retryCount++;

          if (retryCount <= maxRetries) {
            // Wait before retry
            await this.delay(retryDelay * Math.pow(2, retryCount - 1)); // Exponential backoff
          }
        }
      }

      // All retries exhausted
      if (this.options.collectMetrics) {
        this.registry.updateStatistics(registration.id, {
          totalExecutions: 1,
          failedExecutions: 1,
          duration: Date.now() - startTime
        });
      }

      // Try fallback if available
      if (hookOptions.fallback) {
        try {
          const fallbackResult = await hookOptions.fallback(payload, context) as HookResult<TResult>;
          return {
            hookId: registration.id,
            hookType: registration.type,
            result: fallbackResult,
            metrics: {
              duration: Date.now() - startTime,
              cached: false
            },
            retryCount,
            error: lastError
          };
        } catch (fallbackError) {
          lastError = fallbackError as Error;
        }
      }

      // Call error handler if available
      if (hookOptions.onError && lastError) {
        hookOptions.onError(lastError, context);
      }

      // Return error result
      return {
        hookId: registration.id,
        hookType: registration.type,
        result: {
          continue: true, // Default to continue even on error
          modified: false,
          error: lastError
        },
        metrics: {
          duration: Date.now() - startTime
        },
        error: lastError,
        retryCount
      };

    } finally {
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * Execute all hooks for a type
   */
  async executeAll<TPayload, TResult>(
    type: HookType,
    payload: TPayload,
    context: Partial<HookContext> = {}
  ): Promise<ExecutionResult<TResult>[]> {
    const fullContext = this.buildContext(type, context);
    const hooks = this.registry.getByType(type).filter(h => h.enabled);

    if (hooks.length === 0) {
      return [];
    }

    const results: ExecutionResult<TResult>[] = [];
    let currentPayload = payload;

    for (const hook of hooks) {
      const hookPayload: HookPayload<TPayload> = {
        data: currentPayload,
        context: fullContext,
        modifiable: true
      };

      const result = await this.executeHook<TPayload, TResult>(
        hook as HookRegistration<TPayload, TResult>,
        hookPayload,
        fullContext
      );

      results.push(result);

      // Update payload if modified
      if (result.result.modified && result.result.data !== undefined) {
        currentPayload = result.result.data as unknown as TPayload;
      }

      // Stop if hook returns continue: false
      if (!result.result.continue) {
        break;
      }
    }

    return results;
  }

  /**
   * Execute hooks in parallel
   */
  async executeParallel<TPayload, TResult>(
    type: HookType,
    payload: TPayload,
    context: Partial<HookContext> = {}
  ): Promise<ExecutionResult<TResult>[]> {
    const fullContext = this.buildContext(type, context);
    const hooks = this.registry.getByType(type).filter(h => h.enabled);

    if (hooks.length === 0) {
      return [];
    }

    const hookPayload: HookPayload<TPayload> = {
      data: payload,
      context: fullContext,
      modifiable: false // Parallel execution shouldn't modify shared payload
    };

    const promises = hooks.map(hook =>
      this.executeHook<TPayload, TResult>(
        hook as HookRegistration<TPayload, TResult>,
        hookPayload,
        fullContext
      )
    );

    return Promise.all(promises);
  }

  /**
   * Execute hooks with race semantics (first success wins)
   */
  async executeRace<TPayload, TResult>(
    type: HookType,
    payload: TPayload,
    context: Partial<HookContext> = {}
  ): Promise<ExecutionResult<TResult> | null> {
    const fullContext = this.buildContext(type, context);
    const hooks = this.registry.getByType(type).filter(h => h.enabled);

    if (hooks.length === 0) {
      return null;
    }

    const hookPayload: HookPayload<TPayload> = {
      data: payload,
      context: fullContext,
      modifiable: false
    };

    return new Promise((resolve) => {
      let resolved = false;
      const results: ExecutionResult<TResult>[] = [];

      for (const hook of hooks) {
        this.executeHook<TPayload, TResult>(
          hook as HookRegistration<TPayload, TResult>,
          hookPayload,
          fullContext
        ).then(result => {
          if (resolved) return;

          if (!result.error && result.result.continue) {
            resolved = true;
            resolve(result);
          } else {
            results.push(result);

            // If all failed, return the first result
            if (results.length === hooks.length) {
              resolve(results[0]);
            }
          }
        });
      }
    });
  }

  /**
   * Get active execution count
   */
  getActiveCount(): number {
    return this.activeExecutions.size;
  }

  /**
   * Cancel all active executions
   */
  cancelAll(): void {
    // In a real implementation, this would abort all running hooks
    // For now, just clear the set
    this.activeExecutions.clear();
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Execute with timeout
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<HookResult<T>>,
    timeout: number,
    hookId: string,
    hookType: HookType
  ): Promise<HookResult<T>> {
    return Promise.race([
      fn(),
      new Promise<HookResult<T>>((_, reject) => {
        setTimeout(() => {
          reject(this.createTimeoutError(hookId, hookType, timeout));
        }, timeout);
      })
    ]);
  }

  /**
   * Process side effects
   */
  private async processSideEffects(effects: SideEffect[], context: HookContext): Promise<void> {
    if (!this.options.sideEffectHandler) return;

    for (const effect of effects) {
      try {
        await this.options.sideEffectHandler(effect, context);
      } catch (error) {
        // Log but don't fail on side effect errors
        console.error(`Side effect error (${effect.type}):`, error);
      }
    }
  }

  /**
   * Build full context
   */
  private buildContext(type: HookType, partial: Partial<HookContext>): HookContext {
    return {
      executionId: this.generateExecutionId(),
      hookType: type,
      timestamp: Date.now(),
      source: partial.source || 'hook-executor',
      ...partial
    };
  }

  /**
   * Generate execution ID
   */
  private generateExecutionId(): string {
    return `exec-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Create timeout error
   */
  private createTimeoutError(hookId: string, hookType: HookType, timeout: number): HookTimeoutError {
    const error = new Error(`Hook ${hookId} timed out after ${timeout}ms`) as HookTimeoutError;
    error.name = 'HookTimeoutError';
    error.hookId = hookId;
    error.hookType = hookType;
    return error;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const hookExecutor = new HookExecutor();
