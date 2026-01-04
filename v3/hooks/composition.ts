/**
 * V3 Hook Composition
 * Utilities for composing and chaining hooks
 */

import type {
  HookHandler,
  HookContext,
  HookPayload,
  HookResult,
  HookChain,
  CompositionResult,
  HookCombinators
} from './types.js';

/**
 * Hook composition utilities
 */
export class HookComposer implements HookCombinators {
  /**
   * Pipe hooks in sequence, passing result to next
   * Each hook receives the output of the previous hook
   */
  pipe<T>(...handlers: HookHandler<T>[]): HookHandler<T> {
    return async (payload: HookPayload<T>, context: HookContext): Promise<HookResult<T>> => {
      let currentData = payload.data;
      let lastResult: HookResult<T> = { continue: true, modified: false };

      for (const handler of handlers) {
        const currentPayload: HookPayload<T> = {
          ...payload,
          data: currentData
        };

        const result = await handler(currentPayload, context);
        lastResult = result;

        if (result.modified && result.data !== undefined) {
          currentData = result.data;
        }

        if (!result.continue) {
          break;
        }
      }

      return {
        ...lastResult,
        data: currentData,
        modified: currentData !== payload.data
      };
    };
  }

  /**
   * Execute hooks in parallel and wait for all to complete
   */
  parallel<T>(...handlers: HookHandler<T>[]): HookHandler<T> {
    return async (payload: HookPayload<T>, context: HookContext): Promise<HookResult<T>> => {
      const results = await Promise.all(
        handlers.map(handler => handler(payload, context))
      );

      // Aggregate results
      const errors = results.filter(r => r.error).map(r => r.error!);
      const allContinue = results.every(r => r.continue);
      const anyModified = results.some(r => r.modified);

      // Merge side effects
      const sideEffects = results.flatMap(r => r.sideEffects || []);

      return {
        continue: allContinue,
        modified: anyModified,
        data: payload.data, // Parallel doesn't modify data
        sideEffects: sideEffects.length > 0 ? sideEffects : undefined,
        error: errors.length > 0 ? errors[0] : undefined
      };
    };
  }

  /**
   * Execute hooks in parallel, return first successful result
   */
  race<T>(...handlers: HookHandler<T>[]): HookHandler<T> {
    return async (payload: HookPayload<T>, context: HookContext): Promise<HookResult<T>> => {
      return new Promise((resolve) => {
        let resolved = false;
        const errors: Error[] = [];

        handlers.forEach(handler => {
          handler(payload, context)
            .then(result => {
              if (resolved) return;

              if (!result.error) {
                resolved = true;
                resolve(result);
              } else {
                errors.push(result.error);

                // If all failed, resolve with error
                if (errors.length === handlers.length) {
                  resolve({
                    continue: true,
                    modified: false,
                    error: errors[0]
                  });
                }
              }
            })
            .catch(error => {
              errors.push(error);
              if (errors.length === handlers.length && !resolved) {
                resolve({
                  continue: true,
                  modified: false,
                  error: errors[0]
                });
              }
            });
        });
      });
    };
  }

  /**
   * Execute hooks and merge their data results
   */
  merge<T>(...handlers: HookHandler<T>[]): HookHandler<T> {
    return async (payload: HookPayload<T>, context: HookContext): Promise<HookResult<T>> => {
      const results = await Promise.all(
        handlers.map(handler => handler(payload, context))
      );

      // Merge all modified data
      let mergedData = payload.data;

      for (const result of results) {
        if (result.modified && result.data !== undefined) {
          if (typeof mergedData === 'object' && typeof result.data === 'object') {
            mergedData = { ...mergedData as object, ...result.data as object } as T;
          } else {
            mergedData = result.data;
          }
        }
      }

      // Merge side effects
      const sideEffects = results.flatMap(r => r.sideEffects || []);

      return {
        continue: results.every(r => r.continue),
        modified: mergedData !== payload.data,
        data: mergedData,
        sideEffects: sideEffects.length > 0 ? sideEffects : undefined
      };
    };
  }

  /**
   * Conditionally execute hook based on predicate
   */
  when<T>(
    condition: (ctx: HookContext) => boolean,
    handler: HookHandler<T>
  ): HookHandler<T> {
    return async (payload: HookPayload<T>, context: HookContext): Promise<HookResult<T>> => {
      if (condition(context)) {
        return handler(payload, context);
      }

      return {
        continue: true,
        modified: false
      };
    };
  }

  /**
   * Retry hook on failure with exponential backoff
   */
  retry<T>(
    handler: HookHandler<T>,
    attempts: number,
    delay: number = 1000
  ): HookHandler<T> {
    return async (payload: HookPayload<T>, context: HookContext): Promise<HookResult<T>> => {
      let lastError: Error | undefined;

      for (let i = 0; i < attempts; i++) {
        try {
          const result = await handler(payload, context);

          if (!result.error) {
            return result;
          }

          lastError = result.error;
        } catch (error) {
          lastError = error as Error;
        }

        if (i < attempts - 1) {
          await this.delay(delay * Math.pow(2, i));
        }
      }

      return {
        continue: true,
        modified: false,
        error: lastError
      };
    };
  }

  /**
   * Add timeout to hook execution
   */
  timeout<T>(handler: HookHandler<T>, ms: number): HookHandler<T> {
    return async (payload: HookPayload<T>, context: HookContext): Promise<HookResult<T>> => {
      return Promise.race([
        handler(payload, context),
        new Promise<HookResult<T>>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Hook timed out after ${ms}ms`));
          }, ms);
        })
      ]).catch(error => ({
        continue: true,
        modified: false,
        error
      }));
    };
  }

  /**
   * Cache hook results
   */
  cache<T>(
    handler: HookHandler<T>,
    ttl: number,
    keyFn?: (payload: HookPayload<T>) => string
  ): HookHandler<T> {
    const cache = new Map<string, { result: HookResult<T>; expires: number }>();

    return async (payload: HookPayload<T>, context: HookContext): Promise<HookResult<T>> => {
      const key = keyFn
        ? keyFn(payload)
        : JSON.stringify(payload.data);

      const cached = cache.get(key);

      if (cached && cached.expires > Date.now()) {
        return {
          ...cached.result,
          metrics: {
            ...cached.result.metrics,
            duration: 0
          }
        };
      }

      const result = await handler(payload, context);

      cache.set(key, {
        result,
        expires: Date.now() + ttl
      });

      return result;
    };
  }

  /**
   * Execute hook only if previous result matches condition
   */
  ifResult<T>(
    condition: (result: HookResult<T>) => boolean,
    handler: HookHandler<T>
  ): HookHandler<T> {
    let lastResult: HookResult<T> | undefined;

    return async (payload: HookPayload<T>, context: HookContext): Promise<HookResult<T>> => {
      if (lastResult && condition(lastResult)) {
        const result = await handler(payload, context);
        lastResult = result;
        return result;
      }

      // Execute and store result for next check
      lastResult = {
        continue: true,
        modified: false,
        data: payload.data
      };

      return lastResult;
    };
  }

  /**
   * Add logging/tracing to hook
   */
  trace<T>(
    handler: HookHandler<T>,
    name: string,
    logger?: (msg: string, data?: unknown) => void
  ): HookHandler<T> {
    const log = logger || console.log;

    return async (payload: HookPayload<T>, context: HookContext): Promise<HookResult<T>> => {
      const start = Date.now();
      log(`[${name}] Starting`, { hookType: context.hookType });

      try {
        const result = await handler(payload, context);
        const duration = Date.now() - start;

        log(`[${name}] Completed`, {
          hookType: context.hookType,
          duration,
          modified: result.modified,
          continue: result.continue
        });

        return result;
      } catch (error) {
        const duration = Date.now() - start;
        log(`[${name}] Error`, {
          hookType: context.hookType,
          duration,
          error: (error as Error).message
        });

        throw error;
      }
    };
  }

  /**
   * Create a hook chain from configuration
   */
  createChain<T>(config: HookChain): HookHandler<T> {
    const handlers = config.hooks.map(h => h.handler) as HookHandler<T>[];

    switch (config.mode) {
      case 'serial':
        return this.pipe(...handlers);

      case 'waterfall':
        return this.pipe(...handlers);

      case 'parallel':
        return this.parallel(...handlers);

      case 'race':
        return this.race(...handlers);

      default:
        return this.pipe(...handlers);
    }
  }

  /**
   * Execute a hook chain
   */
  async executeChain<T>(
    chain: HookChain,
    payload: T,
    context: HookContext
  ): Promise<CompositionResult<T>> {
    const startTime = Date.now();
    const handler = this.createChain<T>(chain);

    const hookPayload: HookPayload<T> = {
      data: payload,
      context,
      modifiable: true
    };

    try {
      const result = await handler(hookPayload, context);

      return {
        success: !result.error,
        results: [result],
        aggregatedData: result.modified ? result.data : payload,
        errors: result.error ? [result.error] : [],
        duration: Date.now() - startTime,
        hookCount: chain.hooks.length
      };
    } catch (error) {
      return {
        success: false,
        results: [],
        errors: [error as Error],
        duration: Date.now() - startTime,
        hookCount: chain.hooks.length
      };
    }
  }

  // ============================================
  // Private Methods
  // ============================================

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance and convenience functions
export const composer = new HookComposer();

// Re-export convenience functions
export const pipe = composer.pipe.bind(composer);
export const parallel = composer.parallel.bind(composer);
export const race = composer.race.bind(composer);
export const merge = composer.merge.bind(composer);
export const when = composer.when.bind(composer);
export const retry = composer.retry.bind(composer);
export const timeout = composer.timeout.bind(composer);
export const cache = composer.cache.bind(composer);
export const trace = composer.trace.bind(composer);
