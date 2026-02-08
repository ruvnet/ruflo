/**
 * V3 Fireworks AI Provider
 *
 * Fireworks provides the fastest inference for open models at
 * extremely competitive prices. Specializes in:
 * - DeepSeek V3/R1 (cheapest hosted inference)
 * - Llama 3.3/4 (optimized serving)
 * - Qwen 3 (early availability)
 * - Mixtral and Mistral models
 *
 * Key advantages:
 * - Speculative decoding: 2-4x faster output
 * - Quantized serving: up to 3x cheaper than competitors
 * - OpenAI-compatible API: drop-in replacement
 *
 * @module @claude-flow/providers/fireworks-provider
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
  ModelNotFoundError,
  LLMProviderError,
} from './types.js';

/**
 * Fireworks model catalog.
 * Uses accounts/fireworks/models/ prefix for hosted models.
 */
const FIREWORKS_MODELS: Record<string, {
  name: string;
  description: string;
  context: number;
  maxOutput: number;
  promptPer1k: number;
  completionPer1k: number;
  features: string[];
}> = {
  // DeepSeek models - Fireworks offers cheapest DeepSeek hosting
  'accounts/fireworks/models/deepseek-v3': {
    name: 'DeepSeek V3',
    description: 'DeepSeek V3 with speculative decoding - fastest inference',
    context: 131072,
    maxOutput: 16384,
    promptPer1k: 0.0002,
    completionPer1k: 0.0006,
    features: ['chat', 'code', 'tool_calling'],
  },
  'accounts/fireworks/models/deepseek-r1': {
    name: 'DeepSeek R1',
    description: 'DeepSeek R1 reasoning model - cost-effective chain-of-thought',
    context: 131072,
    maxOutput: 65536,
    promptPer1k: 0.0005,
    completionPer1k: 0.0015,
    features: ['chat', 'reasoning'],
  },
  // Llama models - optimized Fireworks serving
  'accounts/fireworks/models/llama-v3p3-70b-instruct': {
    name: 'Llama 3.3 70B',
    description: 'Meta Llama 3.3 70B with Fireworks optimization',
    context: 131072,
    maxOutput: 16384,
    promptPer1k: 0.0002,
    completionPer1k: 0.0002,
    features: ['chat', 'tool_calling'],
  },
  'accounts/fireworks/models/llama4-scout-instruct-basic': {
    name: 'Llama 4 Scout',
    description: 'Meta Llama 4 Scout 17B active (109B MoE)',
    context: 131072,
    maxOutput: 16384,
    promptPer1k: 0.00015,
    completionPer1k: 0.0003,
    features: ['chat', 'tool_calling', 'vision'],
  },
  'accounts/fireworks/models/llama4-maverick-instruct-basic': {
    name: 'Llama 4 Maverick',
    description: 'Meta Llama 4 Maverick 17B active (400B MoE)',
    context: 131072,
    maxOutput: 16384,
    promptPer1k: 0.0002,
    completionPer1k: 0.0006,
    features: ['chat', 'tool_calling', 'vision'],
  },
  // Qwen models
  'accounts/fireworks/models/qwen3-235b-a22b': {
    name: 'Qwen 3 235B',
    description: 'Alibaba Qwen 3 235B MoE on Fireworks',
    context: 131072,
    maxOutput: 16384,
    promptPer1k: 0.0002,
    completionPer1k: 0.0006,
    features: ['chat', 'reasoning', 'tool_calling'],
  },
  'accounts/fireworks/models/qwen3-30b-a3b': {
    name: 'Qwen 3 30B',
    description: 'Qwen 3 30B lightweight MoE - ultra-fast',
    context: 131072,
    maxOutput: 16384,
    promptPer1k: 0.00005,
    completionPer1k: 0.0001,
    features: ['chat', 'tool_calling'],
  },
  // Mixtral / Mistral
  'accounts/fireworks/models/mixtral-8x22b-instruct': {
    name: 'Mixtral 8x22B',
    description: 'Mistral Mixtral 8x22B MoE',
    context: 65536,
    maxOutput: 16384,
    promptPer1k: 0.0002,
    completionPer1k: 0.0002,
    features: ['chat', 'tool_calling'],
  },
};

interface FireworksResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class FireworksProvider extends BaseProvider {
  readonly name: LLMProvider = 'custom'; // Use 'custom' since it's not in the union yet
  readonly providerTag = 'fireworks'; // Internal identifier

  readonly capabilities: ProviderCapabilities = {
    supportedModels: Object.keys(FIREWORKS_MODELS) as LLMModel[],
    maxContextLength: Object.fromEntries(
      Object.entries(FIREWORKS_MODELS).map(([k, v]) => [k, v.context])
    ),
    maxOutputTokens: Object.fromEntries(
      Object.entries(FIREWORKS_MODELS).map(([k, v]) => [k, v.maxOutput])
    ),
    supportsStreaming: true,
    supportsToolCalling: true,
    supportsSystemMessages: true,
    supportsVision: true,
    supportsAudio: false,
    supportsFineTuning: false,
    supportsEmbeddings: false,
    supportsBatching: true,
    rateLimit: {
      requestsPerMinute: 600,
      tokensPerMinute: 10000000,
      concurrentRequests: 100,
    },
    pricing: Object.fromEntries(
      Object.entries(FIREWORKS_MODELS).map(([k, v]) => [k, {
        promptCostPer1k: v.promptPer1k,
        completionCostPer1k: v.completionPer1k,
        currency: 'USD',
      }])
    ),
  };

  private baseUrl = 'https://api.fireworks.ai/inference/v1';
  private headers: Record<string, string> = {};

  constructor(options: BaseProviderOptions) {
    super(options);
  }

  validateModel(_model: LLMModel): boolean {
    return true; // Fireworks supports custom fine-tuned models too
  }

  protected async doInitialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new AuthenticationError(
        'Fireworks API key is required. Get one at https://fireworks.ai',
        'custom'
      );
    }

    this.baseUrl = this.config.apiUrl || 'https://api.fireworks.ai/inference/v1';
    this.headers = {
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  protected async doComplete(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model || this.config.model;
    const body = this.buildRequest(request, model, false);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout || 60000);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        await this.handleErrorResponse(response, model);
      }

      const data = await response.json() as FireworksResponse;
      return this.transformResponse(data, model);
    } catch (error) {
      clearTimeout(timeout);
      throw this.transformError(error);
    }
  }

  protected async *doStreamComplete(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
    const model = request.model || this.config.model;
    const body = this.buildRequest(request, model, true);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (this.config.timeout || 60000) * 2);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        await this.handleErrorResponse(response, model);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              const promptTokens = this.estimateTokens(JSON.stringify(request.messages));
              const pricing = this.getPricing(model);
              yield {
                type: 'done',
                usage: {
                  promptTokens,
                  completionTokens: 100,
                  totalTokens: promptTokens + 100,
                },
                cost: {
                  promptCost: (promptTokens / 1000) * pricing.prompt,
                  completionCost: (100 / 1000) * pricing.completion,
                  totalCost: (promptTokens / 1000) * pricing.prompt + (100 / 1000) * pricing.completion,
                  currency: 'USD',
                },
              };
              continue;
            }

            try {
              const chunk = JSON.parse(data);
              const delta = chunk.choices?.[0]?.delta;

              if (delta?.content) {
                yield { type: 'content', delta: { content: delta.content } };
              }
              if (delta?.tool_calls) {
                for (const toolCall of delta.tool_calls) {
                  yield {
                    type: 'tool_call',
                    delta: {
                      toolCall: {
                        id: toolCall.id,
                        type: 'function',
                        function: toolCall.function,
                      },
                    },
                  };
                }
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      clearTimeout(timeout);
      throw this.transformError(error);
    } finally {
      clearTimeout(timeout);
    }
  }

  async listModels(): Promise<LLMModel[]> {
    return this.capabilities.supportedModels;
  }

  async getModelInfo(model: LLMModel): Promise<ModelInfo> {
    const entry = FIREWORKS_MODELS[model];
    if (entry) {
      return {
        model,
        name: entry.name,
        description: entry.description,
        contextLength: entry.context,
        maxOutputTokens: entry.maxOutput,
        supportedFeatures: entry.features,
        pricing: {
          promptCostPer1k: entry.promptPer1k,
          completionCostPer1k: entry.completionPer1k,
          currency: 'USD',
        },
      };
    }

    return {
      model,
      name: model,
      description: `${model} on Fireworks AI`,
      contextLength: 131072,
      maxOutputTokens: 16384,
      supportedFeatures: ['chat'],
    };
  }

  protected async doHealthCheck(): Promise<HealthCheckResult> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers,
      });
      return {
        healthy: response.ok,
        timestamp: new Date(),
        ...(response.ok ? {} : { error: `HTTP ${response.status}` }),
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date(),
      };
    }
  }

  private buildRequest(
    request: LLMRequest,
    model: string,
    stream: boolean
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model,
      messages: request.messages.map(msg => ({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        ...(msg.name && { name: msg.name }),
        ...(msg.toolCallId && { tool_call_id: msg.toolCallId }),
        ...(msg.toolCalls && { tool_calls: msg.toolCalls }),
      })),
      stream,
    };

    if (request.temperature !== undefined || this.config.temperature !== undefined) {
      body.temperature = request.temperature ?? this.config.temperature;
    }
    if (request.maxTokens || this.config.maxTokens) {
      body.max_tokens = request.maxTokens || this.config.maxTokens;
    }
    if (request.topP !== undefined || this.config.topP !== undefined) {
      body.top_p = request.topP ?? this.config.topP;
    }
    if (request.frequencyPenalty !== undefined) {
      body.frequency_penalty = request.frequencyPenalty;
    }
    if (request.presencePenalty !== undefined) {
      body.presence_penalty = request.presencePenalty;
    }
    if (request.stopSequences) {
      body.stop = request.stopSequences;
    }
    if (request.tools) {
      body.tools = request.tools;
      body.tool_choice = request.toolChoice;
    }

    return body;
  }

  private transformResponse(data: FireworksResponse, model: string): LLMResponse {
    const choice = data.choices[0];
    const pricing = this.getPricing(model);

    const promptCost = (data.usage.prompt_tokens / 1000) * pricing.prompt;
    const completionCost = (data.usage.completion_tokens / 1000) * pricing.completion;

    return {
      id: data.id,
      model: model as LLMModel,
      provider: 'custom',
      content: choice.message.content || '',
      toolCalls: choice.message.tool_calls,
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
      cost: {
        promptCost,
        completionCost,
        totalCost: promptCost + completionCost,
        currency: 'USD',
      },
      finishReason: choice.finish_reason,
    };
  }

  private getPricing(model: string): { prompt: number; completion: number } {
    const entry = FIREWORKS_MODELS[model];
    if (entry) {
      return { prompt: entry.promptPer1k, completion: entry.completionPer1k };
    }
    return { prompt: 0, completion: 0 };
  }

  private async handleErrorResponse(response: Response, model: string): Promise<never> {
    const errorText = await response.text();
    let errorData: { error?: { message?: string } };

    try {
      errorData = JSON.parse(errorText);
    } catch {
      errorData = { error: { message: errorText } };
    }

    const message = errorData.error?.message || 'Unknown error';

    switch (response.status) {
      case 401:
        throw new AuthenticationError(message, 'custom', errorData);
      case 429:
        throw new RateLimitError(message, 'custom', undefined, errorData);
      case 404:
        throw new ModelNotFoundError(model, 'custom', errorData);
      default:
        throw new LLMProviderError(
          message,
          `FIREWORKS_${response.status}`,
          'custom',
          response.status,
          response.status >= 500,
          errorData
        );
    }
  }
}
