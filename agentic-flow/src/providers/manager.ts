/**
 * Provider Manager
 * Manages multiple LLM providers with fallback, load balancing, and cost optimization
 */

import {
  ILLMProvider,
  LLMProvider,
  ProviderManagerConfig,
  CompletionOptions,
  CompletionResponse,
  StreamChunk,
  ProviderStatus,
  ProviderMetrics,
  FallbackStrategy,
  ProviderError,
  ProviderUnavailableError,
  ModelInfo,
  ProviderEventEmitter
} from './types';
import { AnthropicProvider } from './anthropic';
import { OpenAIProvider } from './openai';
import { GoogleProvider } from './google';
import { OllamaProvider } from './ollama';
import { CircuitBreaker, CircuitState } from './circuit-breaker';
import { CIRCUIT_BREAKER_CONFIGS, ProviderConfigLoader, SecurityUtils } from './config';

interface ProviderInstance {
  provider: ILLMProvider;
  priority: number;
  weight: number;
  lastUsed: Date;
  failures: number;
  successRate: number;
  circuitBreaker: CircuitBreaker;
  totalCost: number;
  requestCount: number;
}

export class ProviderManager {
  private providers: Map<LLMProvider, ProviderInstance> = new Map();
  private config: ProviderManagerConfig;
  private healthCheckInterval?: NodeJS.Timeout;
  private events = new ProviderEventEmitter();
  private requestCount = 0;

  constructor(config: ProviderManagerConfig) {
    this.config = config;
  }

  /**
   * Initialize all configured providers with enhanced configuration
   */
  async initialize(): Promise<void> {
    const initPromises: Promise<void>[] = [];

    // Log masked configuration for debugging
    console.log('Initializing providers:', ProviderConfigLoader.maskSensitiveConfig(this.config));

    // Initialize configured providers
    for (const [providerType, providerConfig] of Object.entries(this.config.providers)) {
      const provider = this.createProvider(providerType as LLMProvider);
      if (provider) {
        initPromises.push(
          this.initializeProvider(provider, providerConfig, providerType as LLMProvider)
        );
      }
    }

    const results = await Promise.allSettled(initPromises);
    
    // Log initialization results
    let successCount = 0;
    results.forEach((result, index) => {
      const providerType = Object.keys(this.config.providers)[index];
      if (result.status === 'fulfilled') {
        successCount++;
        console.log(`✓ Provider ${providerType} initialized successfully`);
      } else {
        console.error(`✗ Provider ${providerType} failed to initialize:`, result.reason);
      }
    });

    // Start health monitoring if enabled
    if (this.config.healthCheckInterval) {
      this.startHealthMonitoring();
    }

    // Verify at least one provider is available
    if (this.providers.size === 0) {
      throw new Error('No providers could be initialized - check API keys and configuration');
    }

    console.log(`Provider Manager initialized with ${successCount}/${results.length} providers`);
  }

  /**
   * Create provider instance based on type
   */
  private createProvider(type: LLMProvider): ILLMProvider | null {
    switch (type) {
      case LLMProvider.ANTHROPIC:
        return new AnthropicProvider();
      case LLMProvider.OPENAI:
        return new OpenAIProvider();
      case LLMProvider.GOOGLE:
        return new GoogleProvider();
      case LLMProvider.OLLAMA:
        return new OllamaProvider();
      default:
        console.warn(`Unknown provider type: ${type}`);
        return null;
    }
  }

  /**
   * Initialize a single provider
   */
  private async initializeProvider(
    provider: ILLMProvider,
    config: any,
    type: LLMProvider
  ): Promise<void> {
    try {
      await provider.initialize(config);
      
      // Create circuit breaker for this provider
      const circuitBreakerConfig = CIRCUIT_BREAKER_CONFIGS[type];
      const circuitBreaker = new CircuitBreaker(circuitBreakerConfig);
      
      this.providers.set(type, {
        provider,
        priority: this.getProviderPriority(type),
        weight: 1,
        lastUsed: new Date(),
        failures: 0,
        successRate: 1,
        circuitBreaker,
        totalCost: 0,
        requestCount: 0
      });

      // Subscribe to provider events
      const emitter = (provider as any).getEventEmitter?.();
      if (emitter) {
        this.forwardProviderEvents(emitter, type);
      }

      console.log(`Initialized provider: ${type}`);
    } catch (error) {
      console.error(`Failed to initialize provider ${type}:`, error);
    }
  }

  /**
   * Get provider priority based on configuration and type
   */
  private getProviderPriority(type: LLMProvider): number {
    // Default priorities (lower is higher priority)
    const defaults: Record<LLMProvider, number> = {
      [LLMProvider.ANTHROPIC]: 1,
      [LLMProvider.OPENAI]: 2,
      [LLMProvider.GOOGLE]: 3,
      [LLMProvider.OLLAMA]: 4,
      [LLMProvider.COHERE]: 5,
      [LLMProvider.HUGGINGFACE]: 6
    };

    return defaults[type] || 99;
  }

  /**
   * Forward provider events to manager events
   */
  private forwardProviderEvents(emitter: ProviderEventEmitter, type: LLMProvider): void {
    // Forward all provider events
    const events = [
      'request:start', 'request:complete', 'request:error',
      'stream:start', 'stream:chunk', 'stream:end', 'stream:error',
      'health:check', 'metrics:update'
    ];

    for (const event of events) {
      emitter.on(event as any, (...args: any[]) => {
        this.events.emit(event as any, ...args);
      });
    }
  }

  /**
   * Complete a prompt using circuit breaker pattern and configured fallback strategy
   */
  async complete(options: CompletionOptions): Promise<CompletionResponse> {
    this.requestCount++;
    
    const availableProviders = await this.getAvailableProviders(options.model);
    if (availableProviders.length === 0) {
      throw new ProviderUnavailableError(
        LLMProvider.ANTHROPIC,
        'No providers available for model: ' + options.model
      );
    }

    const providers = this.sortProvidersByStrategy(availableProviders);
    let lastError: Error | undefined;
    const startTime = Date.now();

    for (const instance of providers) {
      // Check circuit breaker state
      if (!instance.circuitBreaker.isCallable()) {
        console.debug(`Circuit breaker OPEN for ${instance.provider.provider}, skipping`);
        continue;
      }

      try {
        const response = await instance.circuitBreaker.execute(async () => {
          return await instance.provider.complete(options);
        });
        
        // Update success metrics
        this.updateProviderMetrics(instance, true, response.usage?.estimatedCost || 0);
        
        // Check cost threshold
        if (this.config.costThreshold && response.usage?.estimatedCost) {
          if (response.usage.estimatedCost > this.config.costThreshold) {
            console.warn(`Request cost $${response.usage.estimatedCost} exceeds threshold $${this.config.costThreshold}`);
          }
        }
        
        return response;
      } catch (error) {
        lastError = error as Error;
        
        // Update failure metrics
        this.updateProviderMetrics(instance, false, 0);
        
        // Log detailed error information
        const duration = Date.now() - startTime;
        console.error(`Provider ${instance.provider.provider} failed after ${duration}ms:`, {
          error: error.message,
          circuitState: instance.circuitBreaker.getState(),
          failures: instance.failures
        });
      }
    }

    throw lastError || new Error('All providers failed or unavailable');
  }

  /**
   * Stream a completion using circuit breaker pattern and configured fallback strategy
   */
  async *stream(options: CompletionOptions): AsyncGenerator<StreamChunk, void, unknown> {
    const availableProviders = await this.getAvailableProviders(options.model);
    if (availableProviders.length === 0) {
      throw new ProviderUnavailableError(
        LLMProvider.ANTHROPIC,
        'No providers available for model: ' + options.model
      );
    }

    const providers = this.sortProvidersByStrategy(availableProviders);
    let lastError: Error | undefined;
    const startTime = Date.now();

    for (const instance of providers) {
      // Check circuit breaker state
      if (!instance.circuitBreaker.isCallable()) {
        console.debug(`Circuit breaker OPEN for ${instance.provider.provider}, skipping`);
        continue;
      }

      try {
        const generator = await instance.circuitBreaker.execute(async () => {
          return instance.provider.stream(options);
        });
        
        // Update metrics on successful start
        this.updateProviderMetrics(instance, true, 0);
        
        let tokenCount = 0;
        for await (const chunk of generator) {
          // Estimate tokens from streaming chunks
          tokenCount += this.estimateChunkTokens(chunk);
          yield chunk;
        }
        
        // Update final cost estimate for streaming
        const estimatedCost = this.estimateStreamingCost(instance.provider.provider, tokenCount);
        instance.totalCost += estimatedCost;
        
        return;
      } catch (error) {
        lastError = error as Error;
        
        // Update failure metrics
        this.updateProviderMetrics(instance, false, 0);
        
        const duration = Date.now() - startTime;
        console.error(`Provider ${instance.provider.provider} streaming failed after ${duration}ms:`, {
          error: error.message,
          circuitState: instance.circuitBreaker.getState()
        });
      }
    }

    throw lastError || new Error('All providers failed to stream');
  }

  /**
   * Get available providers that support the requested model with circuit breaker consideration
   */
  private async getAvailableProviders(modelId?: string): Promise<ProviderInstance[]> {
    const available: ProviderInstance[] = [];
    const healthChecks: Promise<{ instance: ProviderInstance; healthy: boolean }>[] = [];

    for (const instance of this.providers.values()) {
      // Check if provider supports the model
      if (modelId && !instance.provider.validateModel(modelId)) {
        console.debug(`Provider ${instance.provider.provider} does not support model ${modelId}`);
        continue;
      }

      // Check circuit breaker state first (fast check)
      if (instance.circuitBreaker.getState() === CircuitState.OPEN) {
        console.debug(`Provider ${instance.provider.provider} circuit breaker is OPEN`);
        continue;
      }

      // Perform health check in parallel
      healthChecks.push(
        instance.provider.getStatus()
          .then(status => ({ 
            instance, 
            healthy: status.available && status.healthy 
          }))
          .catch(() => ({ 
            instance, 
            healthy: false 
          }))
      );
    }

    // Wait for all health checks
    const results = await Promise.all(healthChecks);
    
    for (const { instance, healthy } of results) {
      if (healthy) {
        available.push(instance);
      } else {
        console.debug(`Provider ${instance.provider.provider} failed health check`);
      }
    }

    return available;
  }

  /**
   * Sort providers based on fallback strategy
   */
  private sortProvidersByStrategy(providers: ProviderInstance[]): ProviderInstance[] {
    const strategy = this.config.fallbackStrategy || FallbackStrategy.SEQUENTIAL;

    switch (strategy) {
      case FallbackStrategy.SEQUENTIAL:
        // Sort by priority
        return [...providers].sort((a, b) => a.priority - b.priority);

      case FallbackStrategy.LOAD_BALANCE:
        // Sort by least recently used and weight
        return [...providers].sort((a, b) => {
          const scoreA = a.weight * (Date.now() - a.lastUsed.getTime());
          const scoreB = b.weight * (Date.now() - b.lastUsed.getTime());
          return scoreB - scoreA;
        });

      case FallbackStrategy.COST_OPTIMIZE:
        // Sort by cost (requires model info)
        return [...providers].sort((a, b) => {
          const costA = this.getProviderCost(a.provider);
          const costB = this.getProviderCost(b.provider);
          return costA - costB;
        });

      case FallbackStrategy.LATENCY_OPTIMIZE:
        // Sort by average latency
        return [...providers].sort((a, b) => {
          const metricsA = a.provider.getMetrics();
          const metricsB = b.provider.getMetrics();
          return metricsA.averageLatency - metricsB.averageLatency;
        });

      default:
        return providers;
    }
  }

  /**
   * Get average cost for a provider
   */
  private getProviderCost(provider: ILLMProvider): number {
    const models = provider.models;
    if (models.length === 0) return 999;

    let totalCost = 0;
    let count = 0;

    for (const model of models) {
      if (model.capabilities.costPer1kTokens) {
        totalCost += model.capabilities.costPer1kTokens.input + model.capabilities.costPer1kTokens.output;
        count += 2;
      }
    }

    return count > 0 ? totalCost / count : 999;
  }

  /**
   * Update provider metrics after request with cost tracking
   */
  private updateProviderMetrics(instance: ProviderInstance, success: boolean, cost: number): void {
    instance.lastUsed = new Date();
    instance.requestCount++;
    instance.totalCost += cost;
    
    if (success) {
      instance.failures = 0;
      instance.successRate = (instance.successRate * 0.95) + 0.05; // Moving average
      
      // Gradually restore weight on success
      if (instance.weight < 1) {
        instance.weight = Math.min(1, instance.weight * 1.1);
      }
    } else {
      instance.failures++;
      instance.successRate = instance.successRate * 0.95; // Decay success rate
      
      // Reduce weight for repeated failures
      if (instance.failures > 3) {
        instance.weight = Math.max(0.1, instance.weight * 0.8);
      }
    }
    
    // Log cost tracking for monitoring
    if (cost > 0) {
      console.debug(`[${instance.provider.provider}] Request cost: $${cost.toFixed(6)}, Total: $${instance.totalCost.toFixed(4)}`);
    }
  }

  /**
   * Start enhanced health monitoring with circuit breaker integration
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      const healthPromises = Array.from(this.providers.entries()).map(async ([type, instance]) => {
        try {
          const status = await instance.provider.getStatus();
          
          // Reset weight for healthy providers
          if (status.healthy && instance.weight < 1) {
            instance.weight = Math.min(1, instance.weight * 1.2);
          }
          
          // Reset circuit breaker on sustained health
          if (status.healthy && instance.circuitBreaker.getState() === CircuitState.OPEN) {
            console.log(`Provider ${type} recovered, resetting circuit breaker`);
            // Circuit breaker will automatically transition to half-open on next request
          }
          
          return { type, status, error: null };
        } catch (error) {
          console.debug(`Health check failed for ${type}:`, error.message);
          return { type, status: null, error: error as Error };
        }
      });
      
      const results = await Promise.all(healthPromises);
      
      // Log health summary
      const healthyCount = results.filter(r => r.status?.healthy).length;
      const totalCount = results.length;
      
      if (healthyCount < totalCount) {
        console.warn(`Health check: ${healthyCount}/${totalCount} providers healthy`);
      } else {
        console.debug(`Health check: All ${totalCount} providers healthy`);
      }
    }, this.config.healthCheckInterval);
  }

  /**
   * Get all provider statuses
   */
  async getAllStatuses(): Promise<Map<LLMProvider, ProviderStatus>> {
    const statuses = new Map<LLMProvider, ProviderStatus>();

    for (const [type, instance] of this.providers) {
      try {
        const status = await instance.provider.getStatus();
        statuses.set(type, status);
      } catch (error) {
        statuses.set(type, {
          provider: type,
          available: false,
          healthy: false,
          lastError: error as Error,
          lastChecked: new Date()
        });
      }
    }

    return statuses;
  }

  /**
   * Get all provider metrics
   */
  getAllMetrics(): Map<LLMProvider, ProviderMetrics> {
    const metrics = new Map<LLMProvider, ProviderMetrics>();

    for (const [type, instance] of this.providers) {
      metrics.set(type, instance.provider.getMetrics());
    }

    return metrics;
  }

  /**
   * Get all available models across providers
   */
  getAllModels(): ModelInfo[] {
    const models: ModelInfo[] = [];

    for (const instance of this.providers.values()) {
      models.push(...instance.provider.models);
    }

    return models;
  }

  /**
   * Find the best model for given constraints
   */
  findBestModel(constraints: {
    maxCost?: number;
    minContextWindow?: number;
    requiresVision?: boolean;
    requiresFunctionCalling?: boolean;
    preferredProvider?: LLMProvider;
  }): ModelInfo | null {
    let candidates = this.getAllModels();

    // Filter by constraints
    if (constraints.requiresVision) {
      candidates = candidates.filter(m => m.capabilities.vision);
    }

    if (constraints.requiresFunctionCalling) {
      candidates = candidates.filter(m => m.capabilities.functionCalling);
    }

    if (constraints.minContextWindow) {
      candidates = candidates.filter(m => m.capabilities.contextWindow >= constraints.minContextWindow);
    }

    if (constraints.maxCost !== undefined) {
      candidates = candidates.filter(m => {
        const cost = m.capabilities.costPer1kTokens;
        if (!cost) return true; // Free models
        return (cost.input + cost.output) / 2 <= constraints.maxCost;
      });
    }

    if (candidates.length === 0) return null;

    // Sort by preference and cost
    candidates.sort((a, b) => {
      // Prefer requested provider
      if (constraints.preferredProvider) {
        if (a.provider === constraints.preferredProvider && b.provider !== constraints.preferredProvider) return -1;
        if (b.provider === constraints.preferredProvider && a.provider !== constraints.preferredProvider) return 1;
      }

      // Then by cost
      const costA = a.capabilities.costPer1kTokens ? 
        (a.capabilities.costPer1kTokens.input + a.capabilities.costPer1kTokens.output) / 2 : 0;
      const costB = b.capabilities.costPer1kTokens ? 
        (b.capabilities.costPer1kTokens.input + b.capabilities.costPer1kTokens.output) / 2 : 0;

      return costA - costB;
    });

    return candidates[0];
  }

  /**
   * Get manager statistics
   */
  getStatistics(): {
    totalRequests: number;
    providerStats: Map<LLMProvider, {
      requests: number;
      failures: number;
      successRate: number;
      averageLatency: number;
      totalCost: number;
    }>;
  } {
    const providerStats = new Map();

    for (const [type, instance] of this.providers) {
      const metrics = instance.provider.getMetrics();
      providerStats.set(type, {
        requests: metrics.requestCount,
        failures: metrics.errorCount,
        successRate: instance.successRate,
        averageLatency: metrics.averageLatency,
        totalCost: metrics.totalCost
      });
    }

    return {
      totalRequests: this.requestCount,
      providerStats
    };
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    for (const instance of this.providers.values()) {
      await instance.provider.cleanup();
    }

    this.providers.clear();
    this.events.removeAllListeners();
  }

  /**
   * Estimate tokens from stream chunks
   */
  private estimateChunkTokens(chunk: StreamChunk): number {
    let tokens = 0;
    for (const choice of chunk.choices) {
      if (choice.delta.content) {
        tokens += Math.ceil(choice.delta.content.length / 4);
      }
    }
    return tokens;
  }

  /**
   * Estimate streaming cost based on provider and token count
   */
  private estimateStreamingCost(provider: LLMProvider, tokens: number): number {
    // Use the first available model for the provider to estimate cost
    const providerInstance = this.providers.get(provider);
    if (!providerInstance) return 0;

    const firstModel = providerInstance.provider.models[0];
    if (!firstModel?.capabilities.costPer1kTokens) return 0;

    // Estimate 70% completion tokens, 30% prompt tokens
    const completionTokens = Math.ceil(tokens * 0.7);
    const promptTokens = Math.ceil(tokens * 0.3);

    const inputCost = (promptTokens / 1000) * firstModel.capabilities.costPer1kTokens.input;
    const outputCost = (completionTokens / 1000) * firstModel.capabilities.costPer1kTokens.output;

    return inputCost + outputCost;
  }

  /**
   * Get circuit breaker status for all providers
   */
  getCircuitBreakerStatus(): Map<LLMProvider, { state: string; metrics: any }> {
    const status = new Map();
    
    for (const [type, instance] of this.providers) {
      status.set(type, {
        state: instance.circuitBreaker.getState(),
        metrics: instance.circuitBreaker.getMetrics()
      });
    }
    
    return status;
  }

  /**
   * Reset circuit breaker for a specific provider
   */
  resetCircuitBreaker(provider: LLMProvider): boolean {
    const instance = this.providers.get(provider);
    if (!instance) return false;
    
    instance.circuitBreaker.reset();
    console.log(`Circuit breaker reset for provider: ${provider}`);
    return true;
  }

  /**
   * Get cost analysis across all providers
   */
  getCostAnalysis(): {
    totalCost: number;
    costByProvider: Map<LLMProvider, number>;
    requestsByProvider: Map<LLMProvider, number>;
    averageCostPerRequest: number;
  } {
    let totalCost = 0;
    let totalRequests = 0;
    const costByProvider = new Map<LLMProvider, number>();
    const requestsByProvider = new Map<LLMProvider, number>();

    for (const [type, instance] of this.providers) {
      totalCost += instance.totalCost;
      totalRequests += instance.requestCount;
      costByProvider.set(type, instance.totalCost);
      requestsByProvider.set(type, instance.requestCount);
    }

    return {
      totalCost,
      costByProvider,
      requestsByProvider,
      averageCostPerRequest: totalRequests > 0 ? totalCost / totalRequests : 0
    };
  }

  /**
   * Get comprehensive provider performance report
   */
  getPerformanceReport(): {
    summary: {
      totalProviders: number;
      healthyProviders: number;
      totalRequests: number;
      totalCost: number;
      averageSuccessRate: number;
    };
    providers: Array<{
      provider: LLMProvider;
      status: string;
      successRate: number;
      requestCount: number;
      totalCost: number;
      averageLatency: number;
      circuitState: string;
      weight: number;
    }>;
  } {
    const providers = Array.from(this.providers.entries()).map(([type, instance]) => {
      const metrics = instance.provider.getMetrics();
      return {
        provider: type,
        status: instance.circuitBreaker.getState(),
        successRate: instance.successRate,
        requestCount: instance.requestCount,
        totalCost: instance.totalCost,
        averageLatency: metrics.averageLatency,
        circuitState: instance.circuitBreaker.getState(),
        weight: instance.weight
      };
    });

    const totalRequests = providers.reduce((sum, p) => sum + p.requestCount, 0);
    const totalCost = providers.reduce((sum, p) => sum + p.totalCost, 0);
    const healthyProviders = providers.filter(p => p.circuitState === 'closed').length;
    const averageSuccessRate = providers.reduce((sum, p) => sum + p.successRate, 0) / providers.length;

    return {
      summary: {
        totalProviders: providers.length,
        healthyProviders,
        totalRequests,
        totalCost,
        averageSuccessRate
      },
      providers
    };
  }

  /**
   * Get event emitter for external listeners
   */
  getEventEmitter(): ProviderEventEmitter {
    return this.events;
  }
}