/**
 * V3 Moonshot (Kimi) Provider
 *
 * Supports Moonshot AI models including Kimi K2 and K2.5 series.
 *
 * @module @claude-flow/providers/moonshot-provider
 */

import { BaseProvider, BaseProviderOptions } from './base-provider.js';
import {
  LLMProvider,
  LLMModel,
  LLMRequest,
  LLMResponse,
  LLMStreamEvent,
  ModelInfo,
  ProviderCapabilities,
  HealthCheckResult,
  AuthenticationError,
  RateLimitError,
  LLMProviderError,
} from './types.js';

interface MoonshotRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
}

interface MoonshotResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class MoonshotProvider extends BaseProvider {
  readonly name: LLMProvider = 'moonshot';
  readonly capabilities: ProviderCapabilities = {
    supportedModels: [
      'kimi-k2.5',
      'kimi-k2-turbo-preview',
      'kimi-k2-thinking',
    ],
    maxContextLength: {
      'kimi-k2.5': 256000,
      'kimi-k2-turbo-preview': 256000,
      'kimi-k2-thinking': 256000,
    },
    maxOutputTokens: {
      'kimi-k2.5': 8192,
      'kimi-k2-turbo-preview': 8192,
      'kimi-k2-thinking': 8192,
    },
    supportsStreaming: true,
    supportsToolCalling: true,
    supportsSystemMessages: true,
    supportsVision: false,
    supportsAudio: false,
    supportsFineTuning: false,
    supportsEmbeddings: false,
    supportsBatching: true,
    rateLimit: {
      requestsPerMinute: 60,
      tokensPerMinute: 100000,
      concurrentRequests: 10,
    },
    pricing: {
      'kimi-k2.5': {
        promptCostPer1k: 0.002,
        completionCostPer1k: 0.008,
        currency: 'USD',
      },
      'kimi-k2-turbo-preview': {
        promptCostPer1k: 0.002,
        completionCostPer1k: 0.008,
        currency: 'USD',
      },
      'kimi-k2-thinking': {
        promptCostPer1k: 0.002,
        completionCostPer1k: 0.008,
        currency: 'USD',
      },
    },
    latency: {
      averageResponseTime: 1500,
      p95ResponseTime: 3000,
    },
  };

  constructor(options: BaseProviderOptions) {
    super(options);
  }

  protected async doInitialize(): Promise<void> {
    this.baseUrl = this.config.apiUrl || 'https://api.moonshot.ai/v1';
    this.apiKey = this.config.apiKey || process.env.MOONSHOT_API_KEY || '';
    
    if (!this.apiKey) {
      throw new AuthenticationError(
        'Moonshot API key is required. Set MOONSHOT_API_KEY environment variable.',
        'moonshot'
      );
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 401) {
        return {
          status: 'unhealthy',
          message: 'Authentication failed - invalid API key',
          latency: 0,
        };
      }

      if (!response.ok) {
        return {
          status: 'degraded',
          message: `API returned status ${response.status}`,
          latency: 0,
        };
      }

      return {
        status: 'healthy',
        message: 'Moonshot API is accessible',
        latency: 0,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        latency: 0,
      };
    }
  }

  async getModels(): Promise<ModelInfo[]> {
    return [
      {
        id: 'kimi-k2.5',
        name: 'Kimi K2.5',
        description: 'Latest Kimi model with strong reasoning and coding capabilities',
        contextLength: 256000,
        maxOutputTokens: 8192,
        supportsVision: true,
        supportsToolCalling: true,
        supportsStreaming: true,
      },
      {
        id: 'kimi-k2-turbo-preview',
        name: 'Kimi K2 Turbo',
        description: 'Fast and capable model for general tasks',
        contextLength: 256000,
        maxOutputTokens: 8192,
        supportsVision: false,
        supportsToolCalling: true,
        supportsStreaming: true,
      },
      {
        id: 'kimi-k2-thinking',
        name: 'Kimi K2 Thinking',
        description: 'Enhanced reasoning model with thinking capabilities',
        contextLength: 256000,
        maxOutputTokens: 8192,
        supportsVision: false,
        supportsToolCalling: true,
        supportsStreaming: true,
      },
    ];
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    if (!this.apiKey) { throw new AuthenticationError("Moonshot API key not initialized", "moonshot"); }

    const model = request.model || 'kimi-k2.5';
    const messages = this.buildMessages(request);

    const body: MoonshotRequest = {
      model,
      messages,
      max_tokens: request.maxTokens || 4096,
      stream: false,
    };
    
    // Only add optional params if explicitly set
    if (request.temperature !== undefined) {
      (body as any).temperature = request.temperature;
    }
    if (request.topP !== undefined) {
      (body as any).top_p = request.topP;
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (response.status === 401) {
        throw new AuthenticationError('Invalid Moonshot API key', 'moonshot');
      }

      if (response.status === 429) {
        throw new RateLimitError('Moonshot rate limit exceeded', 'moonshot', 60);
      }

      if (!response.ok) {
        const error = await response.text();
        throw new LLMProviderError(
          `Moonshot API error: ${error}`,
          'moonshot',
          response.status.toString()
        );
      }

      const data: MoonshotResponse = await response.json();
      const choice = data.choices[0];

      return {
        id: data.id,
        model: data.model,
        content: choice.message.content,
        role: 'assistant',
        usage: {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        },
        finishReason: choice.finish_reason,
      };
    } catch (error) {
      if (error instanceof AuthenticationError || error instanceof RateLimitError) {
        throw error;
      }
      throw new LLMProviderError(
        `Moonshot request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'moonshot'
      );
    }
  }

  private buildMessages(request: LLMRequest): MoonshotRequest['messages'] {
    const messages: MoonshotRequest['messages'] = [];

    if (request.system) {
      messages.push({
        role: 'system',
        content: request.system,
      });
    }

    for (const msg of request.messages) {
      if (typeof msg.content === 'string') {
        messages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content,
        });
      } else {
        const textContent = msg.content
          .filter(part => part.type === 'text')
          .map(part => part.text)
          .join('');
        messages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: textContent,
        });
      }
    }

    return messages;
  }
}
