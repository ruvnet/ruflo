/**
 * @claude-flow/cache-optimizer - Handoff Manager
 *
 * Manages background process handoffs to other AI models (local or remote).
 * Enables requesting models like Ollama locally or remote APIs, getting responses,
 * and injecting the next step instructions back into the workflow.
 */

import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import type {
  HandoffConfig,
  HandoffProviderConfig,
  HandoffRequest,
  HandoffResponse,
  HandoffQueueItem,
  HandoffMetrics,
  HandoffContext,
} from '../types.js';
import { CircuitBreakerRegistry, type CircuitBreaker } from './circuit-breaker.js';
import { RateLimiterRegistry, type RateLimiter } from './rate-limiter.js';
import { PersistentStore, createPersistentStore } from './persistent-store.js';
import { WebhookHandler, createWebhookHandler } from './webhook.js';
import { StreamingHandler, createStreamingHandler, type StreamOptions } from './streaming.js';

// Re-export default config from types
export { DEFAULT_HANDOFF_CONFIG } from '../types.js';

/**
 * Provider adapters for different AI model endpoints
 */
interface ProviderAdapter {
  name: string;
  healthCheck: () => Promise<boolean>;
  send: (request: HandoffRequest, config: HandoffProviderConfig) => Promise<HandoffResponse>;
  stream?: (request: HandoffRequest, config: HandoffProviderConfig, options: StreamOptions) => Promise<HandoffResponse>;
}

/**
 * HandoffManager - Orchestrates model handoffs with background processing
 */
export class HandoffManager {
  private config: HandoffConfig;
  private queue: Map<string, HandoffQueueItem> = new Map();
  private activeRequests: Map<string, ChildProcess> = new Map();
  private adapters: Map<string, ProviderAdapter> = new Map();
  private metrics: HandoffMetrics;
  private initialized: boolean = false;

  // Enhanced features
  private circuitBreakers: CircuitBreakerRegistry;
  private rateLimiters: RateLimiterRegistry;
  private persistentStore: PersistentStore;
  private webhooks: WebhookHandler;
  private streaming: StreamingHandler;

  constructor(config?: Partial<HandoffConfig>) {
    // Default configuration
    const defaultConfig: HandoffConfig = {
      providers: [
        {
          name: 'ollama-local',
          type: 'ollama',
          endpoint: 'http://localhost:11434',
          model: 'llama3.2',
          priority: 1,
          healthy: true,
        },
        {
          name: 'anthropic',
          type: 'anthropic',
          endpoint: 'https://api.anthropic.com/v1/messages',
          model: 'claude-3-5-haiku-20241022',
          priority: 2,
          healthy: true,
        },
        {
          name: 'openai',
          type: 'openai',
          endpoint: 'https://api.openai.com/v1/chat/completions',
          model: 'gpt-4o-mini',
          priority: 3,
          healthy: true,
        },
      ],
      defaultProvider: 'auto',
      background: {
        enabled: true,
        maxConcurrent: 3,
        queueSize: 100,
        pollInterval: 100,
        workDir: '/tmp/claude-flow-handoff',
      },
      retry: {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 10000,
        backoffFactor: 2,
      },
      timeout: {
        request: 30000,
        total: 60000,
        stream: 5000,
      },
    };

    this.config = { ...defaultConfig, ...config };
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageLatency: 0,
      totalTokens: 0,
      byProvider: {},
      queueLength: 0,
      activeRequests: 0,
    };

    // Initialize enhanced features
    this.circuitBreakers = new CircuitBreakerRegistry({
      failureThreshold: 5,
      recoveryTimeout: 30000,
      successThreshold: 3,
    });
    this.rateLimiters = new RateLimiterRegistry();
    this.persistentStore = createPersistentStore({
      dbPath: join(this.config.background.workDir, 'handoff.db'),
    });
    this.webhooks = createWebhookHandler();
    this.streaming = createStreamingHandler();

    this.registerDefaultAdapters();
  }

  /**
   * Initialize the handoff manager (create work directory, etc.)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await mkdir(this.config.background.workDir, { recursive: true });
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize handoff manager:', error);
      throw error;
    }
  }

  /**
   * Register provider adapters
   */
  private registerDefaultAdapters(): void {
    // Ollama adapter (local)
    this.adapters.set('ollama', {
      name: 'ollama',
      healthCheck: async () => {
        const provider = this.config.providers.find(p => p.type === 'ollama');
        if (!provider) return false;

        try {
          const response = await fetch(`${provider.endpoint}/api/tags`, {
            method: 'GET',
            signal: AbortSignal.timeout(5000),
          });
          return response.ok;
        } catch {
          return false;
        }
      },
      send: async (request, config) => this.sendToOllama(request, config),
    });

    // Anthropic adapter
    this.adapters.set('anthropic', {
      name: 'anthropic',
      healthCheck: async () => {
        const provider = this.config.providers.find(p => p.type === 'anthropic');
        return !!provider?.apiKey || !!process.env.ANTHROPIC_API_KEY;
      },
      send: async (request, config) => this.sendToAnthropic(request, config),
    });

    // OpenAI adapter
    this.adapters.set('openai', {
      name: 'openai',
      healthCheck: async () => {
        const provider = this.config.providers.find(p => p.type === 'openai');
        return !!provider?.apiKey || !!process.env.OPENAI_API_KEY;
      },
      send: async (request, config) => this.sendToOpenAI(request, config),
      stream: async (request, config, options) => this.streaming.streamFromOpenAI(request, config, options),
    });

    // OpenRouter adapter
    this.adapters.set('openrouter', {
      name: 'openrouter',
      healthCheck: async () => {
        const provider = this.config.providers.find(p => p.type === 'openrouter');
        return !!provider?.apiKey || !!process.env.OPENROUTER_API_KEY;
      },
      send: async (request, config) => this.sendToOpenRouter(request, config),
    });

    // Custom adapter (for user-defined endpoints)
    this.adapters.set('custom', {
      name: 'custom',
      healthCheck: async () => true, // Custom endpoints are assumed healthy
      send: async (request, config) => this.sendToCustom(request, config),
    });
  }

  /**
   * Send request to OpenRouter API
   */
  private async sendToOpenRouter(
    request: HandoffRequest,
    config: HandoffProviderConfig
  ): Promise<HandoffResponse> {
    const startTime = Date.now();
    const apiKey = config.apiKey || process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      return {
        requestId: request.id,
        provider: config.name,
        model: config.model,
        content: '',
        tokens: { prompt: 0, completion: 0, total: 0 },
        durationMs: Date.now() - startTime,
        status: 'failed',
        error: 'No OpenRouter API key configured',
        completedAt: Date.now(),
      };
    }

    const messages = this.buildMessages(request);

    try {
      const referer = (config.options?.referer as string | undefined) ?? 'https://github.com/ruvnet/claude-flow';
      const title = (config.options?.title as string | undefined) ?? 'Claude Flow';

      const response = await fetch(config.endpoint || 'https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': referer,
          'X-Title': title,
        },
        body: JSON.stringify({
          model: config.model || 'anthropic/claude-3.5-sonnet',
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          max_tokens: request.options.maxTokens ?? 2048,
          temperature: request.options.temperature ?? 0.7,
        }),
        signal: AbortSignal.timeout(this.config.timeout.request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as {
        choices: Array<{ message: { content: string } }>;
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };

      return {
        requestId: request.id,
        provider: config.name,
        model: config.model,
        content: data.choices[0]?.message?.content || '',
        tokens: {
          prompt: data.usage.prompt_tokens,
          completion: data.usage.completion_tokens,
          total: data.usage.total_tokens,
          estimatedCost: this.estimateCost('openrouter', data.usage.prompt_tokens, data.usage.completion_tokens),
        },
        durationMs: Date.now() - startTime,
        status: 'completed',
        injectedInstructions: request.callbackInstructions,
        completedAt: Date.now(),
      };
    } catch (error) {
      return {
        requestId: request.id,
        provider: config.name,
        model: config.model,
        content: '',
        tokens: { prompt: 0, completion: 0, total: 0 },
        durationMs: Date.now() - startTime,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        completedAt: Date.now(),
      };
    }
  }

  /**
   * Send request to custom endpoint
   */
  private async sendToCustom(
    request: HandoffRequest,
    config: HandoffProviderConfig
  ): Promise<HandoffResponse> {
    const startTime = Date.now();

    if (!config.endpoint) {
      return {
        requestId: request.id,
        provider: config.name,
        model: config.model || 'custom',
        content: '',
        tokens: { prompt: 0, completion: 0, total: 0 },
        durationMs: Date.now() - startTime,
        status: 'failed',
        error: 'No endpoint configured for custom provider',
        completedAt: Date.now(),
      };
    }

    const messages = this.buildMessages(request);

    // Build headers from config options
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    // Add custom headers from options
    if (config.options) {
      for (const [key, value] of Object.entries(config.options)) {
        if (typeof value === 'string' && key.startsWith('header_')) {
          headers[key.replace('header_', '')] = value;
        }
      }
    }

    try {
      // Support both OpenAI-compatible and custom formats
      const requestFormat = config.options?.format || 'openai';

      let body: string;
      if (requestFormat === 'openai') {
        body = JSON.stringify({
          model: config.model || 'custom',
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          max_tokens: request.options.maxTokens ?? 2048,
          temperature: request.options.temperature ?? 0.7,
        });
      } else if (requestFormat === 'ollama') {
        body = JSON.stringify({
          model: config.model || 'llama3.2',
          messages,
          stream: false,
          options: {
            temperature: request.options.temperature ?? 0.7,
            num_predict: request.options.maxTokens ?? 2048,
          },
        });
      } else {
        // Raw format - pass through
        body = JSON.stringify({
          prompt: request.prompt,
          system: request.systemPrompt,
          context: request.context,
          options: request.options,
        });
      }

      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(this.config.timeout.request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Custom endpoint error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as Record<string, unknown>;

      // Try to extract content from various formats
      let content = '';
      let tokens = { prompt: 0, completion: 0, total: 0 };

      // OpenAI format
      if (data.choices && Array.isArray(data.choices)) {
        const choices = data.choices as Array<{ message?: { content?: string } }>;
        content = choices[0]?.message?.content || '';
        const usage = data.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
        if (usage) {
          tokens = {
            prompt: usage.prompt_tokens || 0,
            completion: usage.completion_tokens || 0,
            total: usage.total_tokens || 0,
          };
        }
      }
      // Ollama format
      else if (data.message && typeof (data.message as { content?: string }).content === 'string') {
        content = (data.message as { content: string }).content;
        tokens = {
          prompt: (data.prompt_eval_count as number) || 0,
          completion: (data.eval_count as number) || 0,
          total: ((data.prompt_eval_count as number) || 0) + ((data.eval_count as number) || 0),
        };
      }
      // Anthropic format
      else if (data.content && Array.isArray(data.content)) {
        const contentBlocks = data.content as Array<{ text?: string }>;
        content = contentBlocks[0]?.text || '';
        const usage = data.usage as { input_tokens?: number; output_tokens?: number } | undefined;
        if (usage) {
          tokens = {
            prompt: usage.input_tokens || 0,
            completion: usage.output_tokens || 0,
            total: (usage.input_tokens || 0) + (usage.output_tokens || 0),
          };
        }
      }
      // Raw response
      else if (typeof data.response === 'string') {
        content = data.response;
      } else if (typeof data.text === 'string') {
        content = data.text;
      } else if (typeof data.output === 'string') {
        content = data.output;
      }

      return {
        requestId: request.id,
        provider: config.name,
        model: config.model || 'custom',
        content,
        tokens,
        durationMs: Date.now() - startTime,
        status: 'completed',
        injectedInstructions: request.callbackInstructions,
        completedAt: Date.now(),
      };
    } catch (error) {
      return {
        requestId: request.id,
        provider: config.name,
        model: config.model || 'custom',
        content: '',
        tokens: { prompt: 0, completion: 0, total: 0 },
        durationMs: Date.now() - startTime,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        completedAt: Date.now(),
      };
    }
  }

  /**
   * Send request to Ollama (local)
   */
  private async sendToOllama(
    request: HandoffRequest,
    config: HandoffProviderConfig
  ): Promise<HandoffResponse> {
    const startTime = Date.now();

    const messages = this.buildMessages(request);

    try {
      const response = await fetch(`${config.endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          messages,
          stream: false,
          options: {
            temperature: request.options.temperature ?? 0.7,
            num_predict: request.options.maxTokens ?? 2048,
          },
        }),
        signal: AbortSignal.timeout(this.config.timeout.request),
      });

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as {
        message: { content: string };
        prompt_eval_count?: number;
        eval_count?: number;
      };

      return {
        requestId: request.id,
        provider: config.name,
        model: config.model,
        content: data.message.content,
        tokens: {
          prompt: data.prompt_eval_count || 0,
          completion: data.eval_count || 0,
          total: (data.prompt_eval_count || 0) + (data.eval_count || 0),
        },
        durationMs: Date.now() - startTime,
        status: 'completed',
        injectedInstructions: request.callbackInstructions,
        completedAt: Date.now(),
      };
    } catch (error) {
      return {
        requestId: request.id,
        provider: config.name,
        model: config.model,
        content: '',
        tokens: { prompt: 0, completion: 0, total: 0 },
        durationMs: Date.now() - startTime,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        completedAt: Date.now(),
      };
    }
  }

  /**
   * Send request to Anthropic API
   */
  private async sendToAnthropic(
    request: HandoffRequest,
    config: HandoffProviderConfig
  ): Promise<HandoffResponse> {
    const startTime = Date.now();
    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return {
        requestId: request.id,
        provider: config.name,
        model: config.model,
        content: '',
        tokens: { prompt: 0, completion: 0, total: 0 },
        durationMs: Date.now() - startTime,
        status: 'failed',
        error: 'No Anthropic API key configured',
        completedAt: Date.now(),
      };
    }

    const messages = this.buildMessages(request).filter(m => m.role !== 'system');
    const systemPrompt = request.systemPrompt || request.context?.find(c => c.role === 'system')?.content;

    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: request.options.maxTokens ?? 2048,
          system: systemPrompt,
          messages: messages.map(m => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
          })),
          temperature: request.options.temperature ?? 0.7,
        }),
        signal: AbortSignal.timeout(this.config.timeout.request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Anthropic error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as {
        content: Array<{ text: string }>;
        usage: { input_tokens: number; output_tokens: number };
      };

      return {
        requestId: request.id,
        provider: config.name,
        model: config.model,
        content: data.content[0]?.text || '',
        tokens: {
          prompt: data.usage.input_tokens,
          completion: data.usage.output_tokens,
          total: data.usage.input_tokens + data.usage.output_tokens,
          estimatedCost: this.estimateCost('anthropic', data.usage.input_tokens, data.usage.output_tokens),
        },
        durationMs: Date.now() - startTime,
        status: 'completed',
        injectedInstructions: request.callbackInstructions,
        completedAt: Date.now(),
      };
    } catch (error) {
      return {
        requestId: request.id,
        provider: config.name,
        model: config.model,
        content: '',
        tokens: { prompt: 0, completion: 0, total: 0 },
        durationMs: Date.now() - startTime,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        completedAt: Date.now(),
      };
    }
  }

  /**
   * Send request to OpenAI API
   */
  private async sendToOpenAI(
    request: HandoffRequest,
    config: HandoffProviderConfig
  ): Promise<HandoffResponse> {
    const startTime = Date.now();
    const apiKey = config.apiKey || process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return {
        requestId: request.id,
        provider: config.name,
        model: config.model,
        content: '',
        tokens: { prompt: 0, completion: 0, total: 0 },
        durationMs: Date.now() - startTime,
        status: 'failed',
        error: 'No OpenAI API key configured',
        completedAt: Date.now(),
      };
    }

    const messages = this.buildMessages(request);

    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          max_tokens: request.options.maxTokens ?? 2048,
          temperature: request.options.temperature ?? 0.7,
        }),
        signal: AbortSignal.timeout(this.config.timeout.request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as {
        choices: Array<{ message: { content: string } }>;
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };

      return {
        requestId: request.id,
        provider: config.name,
        model: config.model,
        content: data.choices[0]?.message?.content || '',
        tokens: {
          prompt: data.usage.prompt_tokens,
          completion: data.usage.completion_tokens,
          total: data.usage.total_tokens,
          estimatedCost: this.estimateCost('openai', data.usage.prompt_tokens, data.usage.completion_tokens),
        },
        durationMs: Date.now() - startTime,
        status: 'completed',
        injectedInstructions: request.callbackInstructions,
        completedAt: Date.now(),
      };
    } catch (error) {
      return {
        requestId: request.id,
        provider: config.name,
        model: config.model,
        content: '',
        tokens: { prompt: 0, completion: 0, total: 0 },
        durationMs: Date.now() - startTime,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        completedAt: Date.now(),
      };
    }
  }

  /**
   * Build messages array for API requests
   */
  private buildMessages(request: HandoffRequest): HandoffContext[] {
    const messages: HandoffContext[] = [];

    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }

    if (request.context) {
      messages.push(...request.context);
    }

    messages.push({ role: 'user', content: request.prompt });

    return messages;
  }

  /**
   * Estimate cost based on provider pricing
   */
  private estimateCost(provider: string, inputTokens: number, outputTokens: number): number {
    const pricing: Record<string, { input: number; output: number }> = {
      anthropic: { input: 0.25 / 1_000_000, output: 1.25 / 1_000_000 }, // Haiku pricing
      openai: { input: 0.15 / 1_000_000, output: 0.60 / 1_000_000 }, // GPT-4o-mini pricing
      openrouter: { input: 0.20 / 1_000_000, output: 1.00 / 1_000_000 }, // Approximate
    };

    const rate = pricing[provider];
    if (!rate) return 0;

    return inputTokens * rate.input + outputTokens * rate.output;
  }

  // =============================================================================
  // Enhanced Feature APIs
  // =============================================================================

  /**
   * Get circuit breaker for a provider
   */
  getCircuitBreaker(providerName: string): CircuitBreaker {
    return this.circuitBreakers.get(providerName);
  }

  /**
   * Get rate limiter for a provider
   */
  getRateLimiter(providerName: string): RateLimiter {
    return this.rateLimiters.get(providerName);
  }

  /**
   * Register a webhook
   */
  registerWebhook(id: string, config: { url: string; events?: string[]; secret?: string }): void {
    this.webhooks.register(id, {
      url: config.url,
      events: (config.events || ['handoff.completed', 'handoff.failed']) as import('./webhook.js').WebhookEvent[],
      secret: config.secret,
    });
  }

  /**
   * Unregister a webhook
   */
  unregisterWebhook(id: string): void {
    this.webhooks.unregister(id);
  }

  /**
   * Send with streaming
   */
  async sendStreaming(
    request: HandoffRequest,
    options: StreamOptions = {}
  ): Promise<HandoffResponse> {
    await this.initialize();

    const provider = await this.selectProvider(request.provider);
    if (!provider) {
      return {
        requestId: request.id,
        provider: request.provider,
        model: 'unknown',
        content: '',
        tokens: { prompt: 0, completion: 0, total: 0 },
        durationMs: 0,
        status: 'failed',
        error: 'No healthy provider available',
        completedAt: Date.now(),
      };
    }

    const adapter = this.adapters.get(provider.type);
    if (!adapter?.stream) {
      // Fall back to non-streaming
      return this.send(request);
    }

    // Check circuit breaker
    const breaker = this.circuitBreakers.get(provider.name);
    if (!breaker.canExecute()) {
      return {
        requestId: request.id,
        provider: provider.name,
        model: provider.model,
        content: '',
        tokens: { prompt: 0, completion: 0, total: 0 },
        durationMs: 0,
        status: 'failed',
        error: 'Circuit breaker is open',
        completedAt: Date.now(),
      };
    }

    // Check rate limiter
    const rateLimiter = this.rateLimiters.get(provider.name);
    const rateStatus = rateLimiter.acquire();
    if (!rateStatus.allowed) {
      return {
        requestId: request.id,
        provider: provider.name,
        model: provider.model,
        content: '',
        tokens: { prompt: 0, completion: 0, total: 0 },
        durationMs: 0,
        status: 'failed',
        error: `Rate limited. Retry after ${rateStatus.retryAfter}ms`,
        completedAt: Date.now(),
      };
    }

    try {
      const response = await adapter.stream(request, provider, options);

      if (response.status === 'completed') {
        breaker.recordSuccess();
        rateLimiter.recordTokens(response.tokens.total);
        await this.webhooks.trigger('handoff.completed', { requestId: request.id, response });
      } else {
        breaker.recordFailure();
        await this.webhooks.trigger('handoff.failed', { requestId: request.id, error: response.error });
      }

      return response;
    } catch (error) {
      breaker.recordFailure(error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Get persistent store for external access
   */
  getStore(): PersistentStore {
    return this.persistentStore;
  }

  /**
   * Get streaming handler
   */
  getStreamingHandler(): StreamingHandler {
    return this.streaming;
  }

  /**
   * Get all circuit breaker stats
   */
  getCircuitBreakerStats(): Record<string, import('./circuit-breaker.js').CircuitStats> {
    return this.circuitBreakers.getAllStats();
  }

  /**
   * Get all rate limiter stats
   */
  getRateLimiterStats(): Record<string, ReturnType<RateLimiter['getStats']>> {
    return this.rateLimiters.getAllStats();
  }

  /**
   * Select best provider (auto-selection or specific)
   */
  private async selectProvider(providerName: string): Promise<HandoffProviderConfig | null> {
    if (providerName !== 'auto') {
      const provider = this.config.providers.find(p => p.name === providerName);
      if (provider?.healthy) return provider;
      return null;
    }

    // Auto-select: try providers in priority order
    const sortedProviders = [...this.config.providers]
      .filter(p => p.healthy)
      .sort((a, b) => a.priority - b.priority);

    for (const provider of sortedProviders) {
      const adapter = this.adapters.get(provider.type);
      if (adapter) {
        const healthy = await adapter.healthCheck();
        if (healthy) {
          provider.healthy = true;
          return provider;
        } else {
          provider.healthy = false;
        }
      }
    }

    return null;
  }

  /**
   * Create a handoff request
   */
  createRequest(options: {
    prompt: string;
    systemPrompt?: string;
    context?: HandoffContext[];
    provider?: string;
    sessionId?: string;
    taskId?: string;
    callbackInstructions?: string;
    temperature?: number;
    maxTokens?: number;
    background?: boolean;
    onComplete?: (response: HandoffResponse) => Promise<void>;
  }): HandoffRequest {
    return {
      id: randomUUID(),
      provider: options.provider || this.config.defaultProvider,
      systemPrompt: options.systemPrompt,
      prompt: options.prompt,
      context: options.context,
      callbackInstructions: options.callbackInstructions,
      metadata: {
        sessionId: options.sessionId || 'default',
        taskId: options.taskId,
        source: 'handoff-manager',
        tags: [],
        createdAt: Date.now(),
      },
      options: {
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        background: options.background ?? false,
        onComplete: options.onComplete,
      },
    };
  }

  /**
   * Send a handoff request (synchronous)
   */
  async send(request: HandoffRequest): Promise<HandoffResponse> {
    await this.initialize();

    this.metrics.totalRequests++;
    const startTime = Date.now();

    // Select provider
    const provider = await this.selectProvider(request.provider);
    if (!provider) {
      this.metrics.failedRequests++;
      await this.persistentStore.updateMetrics(this.metrics);
      return {
        requestId: request.id,
        provider: request.provider,
        model: 'unknown',
        content: '',
        tokens: { prompt: 0, completion: 0, total: 0 },
        durationMs: Date.now() - startTime,
        status: 'failed',
        error: `No healthy provider available for: ${request.provider}`,
        completedAt: Date.now(),
      };
    }

    // Check circuit breaker
    const breaker = this.circuitBreakers.get(provider.name);
    if (!breaker.canExecute()) {
      this.metrics.failedRequests++;
      await this.webhooks.trigger('circuit.opened', { provider: provider.name });
      return {
        requestId: request.id,
        provider: provider.name,
        model: provider.model,
        content: '',
        tokens: { prompt: 0, completion: 0, total: 0 },
        durationMs: Date.now() - startTime,
        status: 'failed',
        error: `Circuit breaker is open for provider: ${provider.name}`,
        completedAt: Date.now(),
      };
    }

    // Check rate limiter
    const rateLimiter = this.rateLimiters.get(provider.name);
    const rateStatus = rateLimiter.acquire();
    if (!rateStatus.allowed) {
      this.metrics.failedRequests++;
      await this.webhooks.trigger('rate.limited', {
        provider: provider.name,
        metadata: { retryAfter: rateStatus.retryAfter },
      });
      return {
        requestId: request.id,
        provider: provider.name,
        model: provider.model,
        content: '',
        tokens: { prompt: 0, completion: 0, total: 0 },
        durationMs: Date.now() - startTime,
        status: 'failed',
        error: `Rate limited. Retry after ${rateStatus.retryAfter}ms`,
        completedAt: Date.now(),
      };
    }

    // Get adapter and send
    const adapter = this.adapters.get(provider.type);
    if (!adapter) {
      this.metrics.failedRequests++;
      return {
        requestId: request.id,
        provider: provider.name,
        model: provider.model,
        content: '',
        tokens: { prompt: 0, completion: 0, total: 0 },
        durationMs: Date.now() - startTime,
        status: 'failed',
        error: `No adapter for provider type: ${provider.type}`,
        completedAt: Date.now(),
      };
    }

    // Send with retry logic
    let lastError: string = '';
    for (let attempt = 0; attempt < this.config.retry.maxRetries; attempt++) {
      const response = await adapter.send(request, provider);

      if (response.status === 'completed') {
        breaker.recordSuccess();
        rateLimiter.recordTokens(response.tokens.total);

        this.metrics.successfulRequests++;
        this.metrics.totalTokens += response.tokens.total;
        this.metrics.byProvider[provider.name] = (this.metrics.byProvider[provider.name] || 0) + 1;
        this.updateAverageLatency(response.durationMs);

        // Persist metrics
        await this.persistentStore.updateMetrics(this.metrics);

        // Trigger webhook
        await this.webhooks.trigger('handoff.completed', { requestId: request.id, response });

        // Call completion callback if provided
        if (request.options.onComplete) {
          await request.options.onComplete(response);
        }

        return response;
      }

      lastError = response.error || 'Unknown error';
      breaker.recordFailure();

      // Wait before retry with exponential backoff
      const delay = Math.min(
        this.config.retry.baseDelay * Math.pow(this.config.retry.backoffFactor, attempt),
        this.config.retry.maxDelay
      );
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    this.metrics.failedRequests++;
    await this.persistentStore.updateMetrics(this.metrics);
    await this.webhooks.trigger('handoff.failed', { requestId: request.id, error: lastError });

    return {
      requestId: request.id,
      provider: provider.name,
      model: provider.model,
      content: '',
      tokens: { prompt: 0, completion: 0, total: 0 },
      durationMs: Date.now() - startTime,
      status: 'failed',
      error: `All retries failed: ${lastError}`,
      completedAt: Date.now(),
    };
  }

  /**
   * Send request in background process
   */
  async sendBackground(request: HandoffRequest): Promise<string> {
    await this.initialize();

    const queueItem: HandoffQueueItem = {
      request,
      position: this.queue.size,
      addedAt: Date.now(),
      status: 'pending',
    };

    this.queue.set(request.id, queueItem);
    this.metrics.queueLength = this.queue.size;

    // Check if we can start processing immediately
    if (this.activeRequests.size < this.config.background.maxConcurrent) {
      this.processBackgroundRequest(request.id);
    }

    return request.id;
  }

  /**
   * Process a background request
   */
  private async processBackgroundRequest(requestId: string): Promise<void> {
    const queueItem = this.queue.get(requestId);
    if (!queueItem || queueItem.status !== 'pending') return;

    queueItem.status = 'processing';
    queueItem.startedAt = Date.now();
    this.metrics.activeRequests++;

    // Write request to temp file for background process
    const requestFile = join(this.config.background.workDir, `${requestId}.json`);
    await writeFile(requestFile, JSON.stringify(queueItem.request));

    // Spawn background process
    const child = spawn('node', [
      '-e',
      `
      const fs = require('fs');
      const requestData = JSON.parse(fs.readFileSync('${requestFile}', 'utf8'));

      // Simple fetch-based request
      async function run() {
        const response = await fetch(requestData.endpoint || 'http://localhost:11434/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: requestData.model || 'llama3.2',
            messages: [{ role: 'user', content: requestData.prompt }],
            stream: false,
          }),
        });
        const data = await response.json();
        console.log(JSON.stringify({ success: true, content: data.message?.content || '' }));
      }
      run().catch(e => console.log(JSON.stringify({ success: false, error: e.message })));
      `,
    ], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.activeRequests.set(requestId, child);

    let output = '';
    child.stdout?.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', async (_code) => {
      this.activeRequests.delete(requestId);
      this.metrics.activeRequests--;

      try {
        await unlink(requestFile);
      } catch {
        // Ignore cleanup errors
      }

      const item = this.queue.get(requestId);
      if (!item) return;

      try {
        const result = JSON.parse(output) as { success: boolean; content?: string; error?: string };
        item.status = result.success ? 'completed' : 'failed';
        item.response = {
          requestId,
          provider: 'background',
          model: 'unknown',
          content: result.content || '',
          tokens: { prompt: 0, completion: 0, total: 0 },
          durationMs: Date.now() - (item.startedAt || item.addedAt),
          status: result.success ? 'completed' : 'failed',
          error: result.error,
          injectedInstructions: item.request.callbackInstructions,
          completedAt: Date.now(),
        };

        if (result.success) {
          this.metrics.successfulRequests++;
        } else {
          this.metrics.failedRequests++;
        }

        // Call completion callback
        if (item.request.options.onComplete && item.response) {
          await item.request.options.onComplete(item.response);
        }
      } catch {
        item.status = 'failed';
        this.metrics.failedRequests++;
      }

      this.metrics.queueLength = this.queue.size;

      // Process next item in queue
      this.processNextInQueue();
    });
  }

  /**
   * Process next item in queue
   */
  private processNextInQueue(): void {
    if (this.activeRequests.size >= this.config.background.maxConcurrent) return;

    for (const [id, item] of this.queue) {
      if (item.status === 'pending') {
        this.processBackgroundRequest(id);
        return;
      }
    }
  }

  /**
   * Get request status
   */
  getStatus(requestId: string): HandoffQueueItem | undefined {
    return this.queue.get(requestId);
  }

  /**
   * Get response (poll for completion)
   */
  async getResponse(requestId: string, timeout: number = 30000): Promise<HandoffResponse | null> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const item = this.queue.get(requestId);
      if (!item) return null;

      if (item.status === 'completed' || item.status === 'failed') {
        return item.response || null;
      }

      await new Promise(resolve => setTimeout(resolve, this.config.background.pollInterval));
    }

    // Timeout
    const item = this.queue.get(requestId);
    if (item) {
      item.status = 'timeout';
    }
    return null;
  }

  /**
   * Cancel a request
   */
  cancel(requestId: string): boolean {
    const item = this.queue.get(requestId);
    if (!item) return false;

    if (item.status === 'pending') {
      item.status = 'cancelled';
      return true;
    }

    if (item.status === 'processing') {
      const child = this.activeRequests.get(requestId);
      if (child) {
        child.kill('SIGTERM');
        this.activeRequests.delete(requestId);
        this.metrics.activeRequests--;
      }
      item.status = 'cancelled';
      return true;
    }

    return false;
  }

  /**
   * Update average latency
   */
  private updateAverageLatency(latency: number): void {
    const total = this.metrics.successfulRequests;
    this.metrics.averageLatency =
      (this.metrics.averageLatency * (total - 1) + latency) / total;
  }

  /**
   * Get metrics
   */
  getMetrics(): HandoffMetrics {
    return { ...this.metrics };
  }

  /**
   * Add a custom provider
   */
  addProvider(config: HandoffProviderConfig): void {
    this.config.providers.push(config);
  }

  /**
   * Remove a provider
   */
  removeProvider(name: string): boolean {
    const index = this.config.providers.findIndex(p => p.name === name);
    if (index >= 0) {
      this.config.providers.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Health check all providers
   */
  async healthCheckAll(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    for (const provider of this.config.providers) {
      const adapter = this.adapters.get(provider.type);
      if (adapter) {
        results[provider.name] = await adapter.healthCheck();
        provider.healthy = results[provider.name];
      } else {
        results[provider.name] = false;
        provider.healthy = false;
      }
    }

    return results;
  }

  /**
   * Inject instructions into response for next step
   */
  injectInstructions(response: HandoffResponse, instructions: string): string {
    return `${response.content}

---
[HANDOFF CALLBACK INSTRUCTIONS]
${instructions}
---`;
  }

  /**
   * Clear completed requests from queue
   */
  clearCompleted(): number {
    let cleared = 0;
    for (const [id, item] of this.queue) {
      if (item.status === 'completed' || item.status === 'failed' || item.status === 'cancelled') {
        this.queue.delete(id);
        cleared++;
      }
    }
    this.metrics.queueLength = this.queue.size;
    return cleared;
  }

  /**
   * Shutdown manager
   */
  async shutdown(): Promise<void> {
    // Cancel all active requests
    for (const [id, child] of this.activeRequests) {
      child.kill('SIGTERM');
      const item = this.queue.get(id);
      if (item) {
        item.status = 'cancelled';
      }
    }
    this.activeRequests.clear();
    this.metrics.activeRequests = 0;

    // Cleanup enhanced features
    this.streaming.cancelAll();
    this.circuitBreakers.destroy();
    this.rateLimiters.destroy();
    await this.persistentStore.close();
    this.webhooks.clear();
  }
}

/**
 * Create a simple handoff helper
 */
export async function handoff(options: {
  prompt: string;
  systemPrompt?: string;
  provider?: string;
  callbackInstructions?: string;
  background?: boolean;
}): Promise<HandoffResponse> {
  const manager = new HandoffManager();
  const request = manager.createRequest(options);

  if (options.background) {
    const id = await manager.sendBackground(request);
    const response = await manager.getResponse(id);
    return response || {
      requestId: id,
      provider: options.provider || 'auto',
      model: 'unknown',
      content: '',
      tokens: { prompt: 0, completion: 0, total: 0 },
      durationMs: 0,
      status: 'timeout',
      completedAt: Date.now(),
    };
  }

  return manager.send(request);
}
