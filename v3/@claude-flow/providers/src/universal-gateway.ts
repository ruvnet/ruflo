/**
 * V3 Universal Provider Gateway
 *
 * Smart routing layer that automatically selects the cheapest/fastest
 * provider for any given model across:
 * - OpenRouter (300+ models, automatic provider selection)
 * - Fireworks AI (fastest open model inference)
 * - Direct APIs (Anthropic, OpenAI, Google, Cohere)
 * - Local (Ollama)
 *
 * The gateway maintains a pricing database and routes each request to
 * the most cost-effective provider that supports the requested model.
 *
 * Usage:
 *   const gateway = new UniversalGateway(config);
 *   await gateway.initialize();
 *
 *   // Automatically picks cheapest provider for Kimi K2
 *   const response = await gateway.complete({
 *     messages: [...],
 *     model: 'moonshotai/kimi-k2',
 *   });
 *
 *   // Or specify a strategy
 *   const fast = await gateway.complete(request, { strategy: 'fastest' });
 *
 * @module @claude-flow/providers/universal-gateway
 */

import { EventEmitter } from 'events';
import {
  ILLMProvider,
  LLMProvider,
  LLMModel,
  LLMRequest,
  LLMResponse,
  LLMStreamEvent,
  CostEstimate,
  HealthCheckResult,
} from './types.js';
import { ILogger, consoleLogger } from './base-provider.js';

// ===== GATEWAY TYPES =====

export type RoutingStrategy = 'cheapest' | 'fastest' | 'quality' | 'fallback-chain';

export interface GatewayRoute {
  /** Model ID or pattern (supports wildcards: 'deepseek/*') */
  model: string;
  /** Ordered list of providers to try */
  providers: LLMProvider[];
  /** Strategy for selecting among providers */
  strategy: RoutingStrategy;
  /** Max cost per 1K tokens (prompt + completion) */
  maxCostPer1k?: number;
  /** Max acceptable latency in ms */
  maxLatency?: number;
}

export interface GatewayConfig {
  /** Available provider instances, keyed by name */
  providers: Map<string, ILLMProvider>;
  /** Custom routing rules (evaluated in order, first match wins) */
  routes?: GatewayRoute[];
  /** Default strategy when no route matches */
  defaultStrategy?: RoutingStrategy;
  /** Enable automatic cost tracking and reporting */
  trackCosts?: boolean;
  /** Budget limit per hour in USD */
  hourlyBudget?: number;
  /** Budget limit per day in USD */
  dailyBudget?: number;
  /** Logger */
  logger?: ILogger;
}

interface ProviderPerformance {
  avgLatency: number;
  successRate: number;
  totalCost: number;
  requestCount: number;
  lastUsed: number;
}

interface CostBucket {
  hourly: number;
  daily: number;
  hourStart: number;
  dayStart: number;
}

/**
 * Provider affinity: which providers can serve which model patterns
 */
const MODEL_PROVIDER_AFFINITY: Record<string, LLMProvider[]> = {
  // Anthropic models - direct API or OpenRouter
  'claude-*': ['anthropic', 'openrouter'],
  'anthropic/*': ['openrouter'],

  // OpenAI models - direct API or OpenRouter
  'gpt-*': ['openai', 'openrouter'],
  'o1-*': ['openai', 'openrouter'],
  'o3-*': ['openai', 'openrouter'],

  // Google models
  'gemini-*': ['google', 'openrouter'],
  'google/*': ['openrouter'],

  // DeepSeek - Fireworks is cheapest, OpenRouter as fallback
  'deepseek/*': ['custom', 'openrouter'],  // custom = fireworks
  'accounts/fireworks/models/deepseek-*': ['custom'],

  // Llama - Fireworks or OpenRouter
  'meta-llama/*': ['openrouter', 'custom'],
  'accounts/fireworks/models/llama*': ['custom'],

  // Kimi - OpenRouter only (Moonshot AI)
  'moonshotai/*': ['openrouter'],

  // Qwen - Fireworks or OpenRouter
  'qwen/*': ['openrouter', 'custom'],
  'accounts/fireworks/models/qwen*': ['custom'],

  // Mistral
  'mistralai/*': ['openrouter', 'custom'],
  'accounts/fireworks/models/mixtral*': ['custom'],

  // Cohere
  'command-*': ['cohere', 'openrouter'],

  // Local models
  'llama3*': ['ollama'],
  'mistral': ['ollama'],
  'mixtral': ['ollama'],
  'codellama': ['ollama'],
  'phi-*': ['ollama'],
};

export class UniversalGateway extends EventEmitter {
  private providers: Map<string, ILLMProvider>;
  private routes: GatewayRoute[];
  private defaultStrategy: RoutingStrategy;
  private performance: Map<string, ProviderPerformance> = new Map();
  private costBucket: CostBucket;
  private logger: ILogger;
  private hourlyBudget?: number;
  private dailyBudget?: number;
  private trackCosts: boolean;

  constructor(config: GatewayConfig) {
    super();
    this.providers = config.providers;
    this.routes = config.routes || [];
    this.defaultStrategy = config.defaultStrategy || 'cheapest';
    this.logger = config.logger || consoleLogger;
    this.hourlyBudget = config.hourlyBudget;
    this.dailyBudget = config.dailyBudget;
    this.trackCosts = config.trackCosts ?? true;

    const now = Date.now();
    this.costBucket = {
      hourly: 0,
      daily: 0,
      hourStart: now,
      dayStart: now,
    };

    // Initialize performance tracking for all providers
    for (const [name] of this.providers) {
      this.performance.set(name, {
        avgLatency: 0,
        successRate: 1.0,
        totalCost: 0,
        requestCount: 0,
        lastUsed: 0,
      });
    }
  }

  /**
   * Route and complete a request through the best available provider
   */
  async complete(
    request: LLMRequest,
    options?: { strategy?: RoutingStrategy; preferredProvider?: string }
  ): Promise<LLMResponse> {
    const model = request.model || '';
    const strategy = options?.strategy || this.resolveStrategy(model);

    // Check budget
    this.checkBudget();

    // Resolve providers for this model
    const candidateProviders = options?.preferredProvider
      ? [this.providers.get(options.preferredProvider)].filter(Boolean) as ILLMProvider[]
      : await this.resolveProviders(model, strategy);

    if (candidateProviders.length === 0) {
      throw new Error(`No providers available for model: ${model}`);
    }

    // Try providers in order
    let lastError: Error | undefined;

    for (const provider of candidateProviders) {
      const startTime = Date.now();
      try {
        const response = await provider.complete(request);
        const latency = Date.now() - startTime;

        this.updatePerformance(provider.name, latency, true, response.cost?.totalCost || 0);
        this.trackCostBucket(response.cost?.totalCost || 0);

        this.emit('routed', {
          model,
          provider: provider.name,
          strategy,
          latency,
          cost: response.cost?.totalCost,
        });

        return response;
      } catch (error) {
        const latency = Date.now() - startTime;
        this.updatePerformance(provider.name, latency, false, 0);
        lastError = error instanceof Error ? error : new Error(String(error));

        this.logger.warn(`Provider ${provider.name} failed for ${model}`, {
          error: lastError.message,
        });
      }
    }

    throw lastError || new Error(`All providers failed for model: ${model}`);
  }

  /**
   * Stream through the best provider
   */
  async *stream(
    request: LLMRequest,
    options?: { strategy?: RoutingStrategy; preferredProvider?: string }
  ): AsyncIterable<LLMStreamEvent> {
    const model = request.model || '';
    const strategy = options?.strategy || this.resolveStrategy(model);
    this.checkBudget();

    const candidateProviders = options?.preferredProvider
      ? [this.providers.get(options.preferredProvider)].filter(Boolean) as ILLMProvider[]
      : await this.resolveProviders(model, strategy);

    if (candidateProviders.length === 0) {
      throw new Error(`No providers available for model: ${model}`);
    }

    // Use first available provider for streaming (no retry mid-stream)
    const provider = candidateProviders[0];
    const startTime = Date.now();

    try {
      for await (const event of provider.streamComplete(request)) {
        if (event.cost) {
          this.trackCostBucket(event.cost.totalCost);
        }
        yield event;
      }

      this.updatePerformance(provider.name, Date.now() - startTime, true, 0);
    } catch (error) {
      this.updatePerformance(provider.name, Date.now() - startTime, false, 0);
      throw error;
    }
  }

  /**
   * Estimate cost across all available providers for a request
   */
  async estimateCosts(request: LLMRequest): Promise<Array<{
    provider: string;
    estimate: CostEstimate;
  }>> {
    const model = request.model || '';
    const candidates = await this.resolveProviders(model, 'cheapest');
    const estimates: Array<{ provider: string; estimate: CostEstimate }> = [];

    for (const provider of candidates) {
      try {
        const estimate = await provider.estimateCost(request);
        estimates.push({ provider: provider.name, estimate });
      } catch {
        // Skip providers that can't estimate
      }
    }

    return estimates.sort((a, b) =>
      a.estimate.estimatedCost.total - b.estimate.estimatedCost.total
    );
  }

  /**
   * Health check all registered providers
   */
  async healthCheck(): Promise<Map<string, HealthCheckResult>> {
    const results = new Map<string, HealthCheckResult>();

    await Promise.all(
      Array.from(this.providers.entries()).map(async ([name, provider]) => {
        const result = await provider.healthCheck();
        results.set(name, result);
      })
    );

    return results;
  }

  /**
   * Get performance report for all providers
   */
  getPerformanceReport(): Record<string, ProviderPerformance> {
    return Object.fromEntries(this.performance);
  }

  /**
   * Get current cost tracking info
   */
  getCostReport(): {
    hourly: number;
    daily: number;
    hourlyBudget?: number;
    dailyBudget?: number;
    hourlyRemaining?: number;
    dailyRemaining?: number;
  } {
    this.rotateBuckets();
    return {
      hourly: this.costBucket.hourly,
      daily: this.costBucket.daily,
      hourlyBudget: this.hourlyBudget,
      dailyBudget: this.dailyBudget,
      hourlyRemaining: this.hourlyBudget ? this.hourlyBudget - this.costBucket.hourly : undefined,
      dailyRemaining: this.dailyBudget ? this.dailyBudget - this.costBucket.daily : undefined,
    };
  }

  /**
   * Add or replace a provider at runtime
   */
  addProvider(name: string, provider: ILLMProvider): void {
    this.providers.set(name, provider);
    this.performance.set(name, {
      avgLatency: 0,
      successRate: 1.0,
      totalCost: 0,
      requestCount: 0,
      lastUsed: 0,
    });
  }

  /**
   * Remove a provider at runtime
   */
  removeProvider(name: string): void {
    const provider = this.providers.get(name);
    if (provider) {
      provider.destroy();
      this.providers.delete(name);
      this.performance.delete(name);
    }
  }

  // ===== PRIVATE METHODS =====

  /**
   * Resolve which strategy to use for a model
   */
  private resolveStrategy(model: string): RoutingStrategy {
    // Check custom routes first
    for (const route of this.routes) {
      if (this.matchModel(model, route.model)) {
        return route.strategy;
      }
    }
    return this.defaultStrategy;
  }

  /**
   * Resolve and order providers for a model + strategy
   */
  private async resolveProviders(
    model: string,
    strategy: RoutingStrategy
  ): Promise<ILLMProvider[]> {
    // Check custom routes first
    for (const route of this.routes) {
      if (this.matchModel(model, route.model)) {
        const providers = route.providers
          .map(name => this.providers.get(name))
          .filter(Boolean) as ILLMProvider[];
        if (providers.length > 0) {
          return this.orderByStrategy(providers, strategy, model);
        }
      }
    }

    // Use affinity table
    const affinityProviders = this.getAffinityProviders(model);
    if (affinityProviders.length > 0) {
      return this.orderByStrategy(affinityProviders, strategy, model);
    }

    // Fallback: try OpenRouter (it supports everything), then all providers
    const openrouter = this.providers.get('openrouter');
    if (openrouter) return [openrouter];

    return Array.from(this.providers.values());
  }

  /**
   * Get providers from the affinity table
   */
  private getAffinityProviders(model: string): ILLMProvider[] {
    for (const [pattern, providerNames] of Object.entries(MODEL_PROVIDER_AFFINITY)) {
      if (this.matchModel(model, pattern)) {
        const providers = providerNames
          .map(name => this.providers.get(name))
          .filter(Boolean) as ILLMProvider[];
        if (providers.length > 0) return providers;
      }
    }
    return [];
  }

  /**
   * Order providers by strategy
   */
  private async orderByStrategy(
    providers: ILLMProvider[],
    strategy: RoutingStrategy,
    _model: string
  ): Promise<ILLMProvider[]> {
    switch (strategy) {
      case 'cheapest':
        // Sort by known cost performance (lower total cost per request)
        return [...providers].sort((a, b) => {
          const aPerf = this.performance.get(a.name);
          const bPerf = this.performance.get(b.name);
          if (!aPerf || aPerf.requestCount === 0) return 1;
          if (!bPerf || bPerf.requestCount === 0) return -1;
          const aCostPerReq = aPerf.totalCost / aPerf.requestCount;
          const bCostPerReq = bPerf.totalCost / bPerf.requestCount;
          return aCostPerReq - bCostPerReq;
        });

      case 'fastest':
        return [...providers].sort((a, b) => {
          const aPerf = this.performance.get(a.name);
          const bPerf = this.performance.get(b.name);
          return (aPerf?.avgLatency || Infinity) - (bPerf?.avgLatency || Infinity);
        });

      case 'quality':
        return [...providers].sort((a, b) => {
          const aPerf = this.performance.get(a.name);
          const bPerf = this.performance.get(b.name);
          return (bPerf?.successRate || 0) - (aPerf?.successRate || 0);
        });

      case 'fallback-chain':
      default:
        return providers; // Use in provided order
    }
  }

  /**
   * Match a model ID against a pattern (supports wildcards)
   */
  private matchModel(model: string, pattern: string): boolean {
    if (pattern === model) return true;

    // Convert glob pattern to regex
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    return regex.test(model);
  }

  /**
   * Update provider performance metrics
   */
  private updatePerformance(
    provider: LLMProvider | string,
    latency: number,
    success: boolean,
    cost: number
  ): void {
    const perf = this.performance.get(provider) || {
      avgLatency: 0,
      successRate: 1.0,
      totalCost: 0,
      requestCount: 0,
      lastUsed: 0,
    };

    const alpha = 0.3;
    perf.avgLatency = perf.requestCount === 0
      ? latency
      : alpha * latency + (1 - alpha) * perf.avgLatency;
    perf.successRate = alpha * (success ? 1 : 0) + (1 - alpha) * perf.successRate;
    perf.totalCost += cost;
    perf.requestCount++;
    perf.lastUsed = Date.now();

    this.performance.set(provider, perf);
  }

  /**
   * Track costs in time buckets
   */
  private trackCostBucket(cost: number): void {
    if (!this.trackCosts) return;
    this.rotateBuckets();
    this.costBucket.hourly += cost;
    this.costBucket.daily += cost;
  }

  /**
   * Rotate cost buckets when the time window passes
   */
  private rotateBuckets(): void {
    const now = Date.now();
    if (now - this.costBucket.hourStart > 3600000) {
      this.costBucket.hourly = 0;
      this.costBucket.hourStart = now;
    }
    if (now - this.costBucket.dayStart > 86400000) {
      this.costBucket.daily = 0;
      this.costBucket.dayStart = now;
    }
  }

  /**
   * Check if we're within budget
   */
  private checkBudget(): void {
    this.rotateBuckets();

    if (this.hourlyBudget && this.costBucket.hourly >= this.hourlyBudget) {
      throw new Error(
        `Hourly budget exceeded: $${this.costBucket.hourly.toFixed(4)} / $${this.hourlyBudget}`
      );
    }

    if (this.dailyBudget && this.costBucket.daily >= this.dailyBudget) {
      throw new Error(
        `Daily budget exceeded: $${this.costBucket.daily.toFixed(4)} / $${this.dailyBudget}`
      );
    }
  }
}

/**
 * Quick factory: create a gateway from environment variables
 */
export function createGatewayFromEnv(
  providerInstances: Map<string, ILLMProvider>,
  options?: {
    defaultStrategy?: RoutingStrategy;
    hourlyBudget?: number;
    dailyBudget?: number;
  }
): UniversalGateway {
  return new UniversalGateway({
    providers: providerInstances,
    defaultStrategy: options?.defaultStrategy || 'cheapest',
    hourlyBudget: options?.hourlyBudget,
    dailyBudget: options?.dailyBudget,
    trackCosts: true,
  });
}
