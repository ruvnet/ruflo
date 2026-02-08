/**
 * V3 OpenRouter Provider
 *
 * Routes to 300+ models through a single API:
 * - Kimi 2.5 (moonshotai/kimi-k2)
 * - DeepSeek V3/R1 (deepseek/deepseek-chat, deepseek/deepseek-r1)
 * - Llama 3.3/4 (meta-llama/llama-3.3-70b, meta-llama/llama-4-scout)
 * - Qwen 3 (qwen/qwen3-235b-a22b)
 * - Mistral Large (mistralai/mistral-large)
 * - Google Gemini (google/gemini-2.5-pro)
 * - And hundreds more via OpenAI-compatible API
 *
 * Cost optimization: OpenRouter automatically selects the cheapest
 * provider for each model (e.g., Fireworks vs Together vs DeepInfra).
 *
 * @module @claude-flow/providers/openrouter-provider
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
 * Model catalog with pricing and capabilities.
 * OpenRouter uses org/model-name format.
 */
const OPENROUTER_MODELS: Record<string, {
  name: string;
  description: string;
  context: number;
  maxOutput: number;
  promptPer1k: number;
  completionPer1k: number;
  features: string[];
}> = {
  // Kimi (Moonshot AI) - extremely cost-effective reasoning
  'moonshotai/kimi-k2': {
    name: 'Kimi K2',
    description: 'Kimi K2 - MoE reasoning model with 1T parameters, competitive with frontier models at fraction of cost',
    context: 131072,
    maxOutput: 16384,
    promptPer1k: 0.0006,
    completionPer1k: 0.0024,
    features: ['chat', 'tool_calling', 'reasoning'],
  },
  // DeepSeek - best value for code and reasoning
  'deepseek/deepseek-chat-v3-0324': {
    name: 'DeepSeek V3',
    description: 'DeepSeek V3 - 671B MoE model, top-tier coding at pennies',
    context: 131072,
    maxOutput: 16384,
    promptPer1k: 0.0003,
    completionPer1k: 0.0009,
    features: ['chat', 'tool_calling', 'code'],
  },
  'deepseek/deepseek-r1': {
    name: 'DeepSeek R1',
    description: 'DeepSeek R1 - o1-class reasoning at 1/50th the price',
    context: 131072,
    maxOutput: 65536,
    promptPer1k: 0.0008,
    completionPer1k: 0.002,
    features: ['chat', 'reasoning', 'code'],
  },
  // Meta Llama
  'meta-llama/llama-3.3-70b-instruct': {
    name: 'Llama 3.3 70B',
    description: 'Meta Llama 3.3 70B - strong open-weight model',
    context: 131072,
    maxOutput: 16384,
    promptPer1k: 0.00012,
    completionPer1k: 0.0003,
    features: ['chat', 'tool_calling'],
  },
  'meta-llama/llama-4-scout': {
    name: 'Llama 4 Scout',
    description: 'Meta Llama 4 Scout - 17B active params from 109B MoE',
    context: 524288,
    maxOutput: 16384,
    promptPer1k: 0.00015,
    completionPer1k: 0.0004,
    features: ['chat', 'tool_calling', 'vision'],
  },
  // Qwen (Alibaba)
  'qwen/qwen3-235b-a22b': {
    name: 'Qwen 3 235B',
    description: 'Qwen 3 235B MoE - massive reasoning model, hybrid thinking',
    context: 131072,
    maxOutput: 16384,
    promptPer1k: 0.0002,
    completionPer1k: 0.0006,
    features: ['chat', 'tool_calling', 'reasoning'],
  },
  'qwen/qwen3-30b-a3b': {
    name: 'Qwen 3 30B',
    description: 'Qwen 3 30B lightweight MoE - fast and cheap',
    context: 131072,
    maxOutput: 16384,
    promptPer1k: 0.00005,
    completionPer1k: 0.0001,
    features: ['chat', 'tool_calling'],
  },
  // Mistral
  'mistralai/mistral-large-2411': {
    name: 'Mistral Large',
    description: 'Mistral Large 2411 - 123B frontier model',
    context: 131072,
    maxOutput: 16384,
    promptPer1k: 0.002,
    completionPer1k: 0.006,
    features: ['chat', 'tool_calling', 'vision'],
  },
  'mistralai/codestral-2501': {
    name: 'Codestral',
    description: 'Codestral - specialized code generation model',
    context: 262144,
    maxOutput: 16384,
    promptPer1k: 0.0003,
    completionPer1k: 0.0009,
    features: ['chat', 'code', 'tool_calling'],
  },
  // Google via OpenRouter
  'google/gemini-2.5-pro-preview': {
    name: 'Gemini 2.5 Pro',
    description: 'Google Gemini 2.5 Pro via OpenRouter - 1M context',
    context: 1048576,
    maxOutput: 65536,
    promptPer1k: 0.00125,
    completionPer1k: 0.01,
    features: ['chat', 'tool_calling', 'vision', 'reasoning'],
  },
  'google/gemini-2.5-flash-preview': {
    name: 'Gemini 2.5 Flash',
    description: 'Google Gemini 2.5 Flash - fast and cheap thinking model',
    context: 1048576,
    maxOutput: 65536,
    promptPer1k: 0.00015,
    completionPer1k: 0.0006,
    features: ['chat', 'tool_calling', 'vision'],
  },
  // Anthropic via OpenRouter (useful for fallback)
  'anthropic/claude-sonnet-4': {
    name: 'Claude Sonnet 4',
    description: 'Anthropic Claude Sonnet 4 via OpenRouter',
    context: 200000,
    maxOutput: 16384,
    promptPer1k: 0.003,
    completionPer1k: 0.015,
    features: ['chat', 'tool_calling', 'vision', 'reasoning'],
  },
  // Nous Research
  'nousresearch/hermes-3-llama-3.1-405b': {
    name: 'Hermes 3 405B',
    description: 'Nous Hermes 3 - agentic tool-calling specialist',
    context: 131072,
    maxOutput: 16384,
    promptPer1k: 0.0008,
    completionPer1k: 0.0008,
    features: ['chat', 'tool_calling', 'agentic'],
  },
};

interface OpenRouterResponse {
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
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenRouterProvider extends BaseProvider {
  readonly name: LLMProvider = 'openrouter';

  readonly capabilities: ProviderCapabilities = {
    supportedModels: Object.keys(OPENROUTER_MODELS) as LLMModel[],
    maxContextLength: Object.fromEntries(
      Object.entries(OPENROUTER_MODELS).map(([k, v]) => [k, v.context])
    ),
    maxOutputTokens: Object.fromEntries(
      Object.entries(OPENROUTER_MODELS).map(([k, v]) => [k, v.maxOutput])
    ),
    supportsStreaming: true,
    supportsToolCalling: true,
    supportsSystemMessages: true,
    supportsVision: true,
    supportsAudio: false,
    supportsFineTuning: false,
    supportsEmbeddings: false,
    supportsBatching: false,
    rateLimit: {
      requestsPerMinute: 200,
      tokensPerMinute: 10000000,
      concurrentRequests: 50,
    },
    pricing: Object.fromEntries(
      Object.entries(OPENROUTER_MODELS).map(([k, v]) => [k, {
        promptCostPer1k: v.promptPer1k,
        completionCostPer1k: v.completionPer1k,
        currency: 'USD',
      }])
    ),
  };

  private baseUrl = 'https://openrouter.ai/api/v1';
  private headers: Record<string, string> = {};

  constructor(options: BaseProviderOptions) {
    super(options);
  }

  /**
   * Accept any model string - OpenRouter supports 300+ models.
   * The catalog above is just the curated set; users can pass
   * any org/model-name ID and it will work.
   */
  validateModel(_model: LLMModel): boolean {
    return true;
  }

  protected async doInitialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new AuthenticationError(
        'OpenRouter API key is required. Get one at https://openrouter.ai/keys',
        'openrouter'
      );
    }

    this.baseUrl = this.config.apiUrl || 'https://openrouter.ai/api/v1';
    this.headers = {
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/ruvnet/claude-flow',
      'X-Title': 'Claude Flow V3',
    };
  }

  protected async doComplete(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model || this.config.model;
    const body = this.buildRequest(request, model, false);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout || 120000);

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

      const data = await response.json() as OpenRouterResponse;
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
    const timeout = setTimeout(() => controller.abort(), (this.config.timeout || 120000) * 2);

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
              // Ignore parse errors in stream
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
    // Try fetching live model list from OpenRouter
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers,
      });
      if (response.ok) {
        const data = await response.json() as { data: Array<{ id: string }> };
        return data.data.map(m => m.id as LLMModel);
      }
    } catch {
      // Fall back to catalog
    }
    return this.capabilities.supportedModels;
  }

  async getModelInfo(model: LLMModel): Promise<ModelInfo> {
    const catalogEntry = OPENROUTER_MODELS[model];

    if (catalogEntry) {
      return {
        model,
        name: catalogEntry.name,
        description: catalogEntry.description,
        contextLength: catalogEntry.context,
        maxOutputTokens: catalogEntry.maxOutput,
        supportedFeatures: catalogEntry.features,
        pricing: {
          promptCostPer1k: catalogEntry.promptPer1k,
          completionCostPer1k: catalogEntry.completionPer1k,
          currency: 'USD',
        },
      };
    }

    // Dynamic lookup for models not in catalog
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers,
      });
      if (response.ok) {
        const data = await response.json() as {
          data: Array<{
            id: string;
            name: string;
            description: string;
            context_length: number;
            top_provider: { max_completion_tokens: number };
            pricing: { prompt: string; completion: string };
          }>;
        };
        const found = data.data.find(m => m.id === model);
        if (found) {
          return {
            model,
            name: found.name,
            description: found.description || `${found.name} via OpenRouter`,
            contextLength: found.context_length,
            maxOutputTokens: found.top_provider?.max_completion_tokens || 4096,
            supportedFeatures: ['chat'],
            pricing: {
              promptCostPer1k: parseFloat(found.pricing.prompt) * 1000,
              completionCostPer1k: parseFloat(found.pricing.completion) * 1000,
              currency: 'USD',
            },
          };
        }
      }
    } catch {
      // Fall through
    }

    return {
      model,
      name: model,
      description: `${model} via OpenRouter`,
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

    // OpenRouter-specific: allow provider preferences
    if (this.config.providerOptions?.providerPreferences) {
      body.provider = this.config.providerOptions.providerPreferences;
    }

    // Route optimization: order providers by price
    if (this.config.enableCostOptimization) {
      body.provider = {
        ...(body.provider as object || {}),
        order: ['price'],
      };
    }

    return body;
  }

  private transformResponse(data: OpenRouterResponse, model: string): LLMResponse {
    const choice = data.choices[0];
    const pricing = this.getPricing(model);

    const promptCost = (data.usage.prompt_tokens / 1000) * pricing.prompt;
    const completionCost = (data.usage.completion_tokens / 1000) * pricing.completion;

    return {
      id: data.id,
      model: model as LLMModel,
      provider: 'openrouter',
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
    const entry = OPENROUTER_MODELS[model];
    if (entry) {
      return { prompt: entry.promptPer1k, completion: entry.completionPer1k };
    }
    const pricing = this.capabilities.pricing[model];
    if (pricing) {
      return { prompt: pricing.promptCostPer1k, completion: pricing.completionCostPer1k };
    }
    return { prompt: 0, completion: 0 };
  }

  private async handleErrorResponse(response: Response, model: string): Promise<never> {
    const errorText = await response.text();
    let errorData: { error?: { message?: string; code?: number } };

    try {
      errorData = JSON.parse(errorText);
    } catch {
      errorData = { error: { message: errorText } };
    }

    const message = errorData.error?.message || 'Unknown error';

    switch (response.status) {
      case 401:
        throw new AuthenticationError(message, 'openrouter', errorData);
      case 429:
        throw new RateLimitError(message, 'openrouter', undefined, errorData);
      case 404:
        throw new ModelNotFoundError(model, 'openrouter', errorData);
      default:
        throw new LLMProviderError(
          message,
          `OPENROUTER_${response.status}`,
          'openrouter',
          response.status,
          response.status >= 500,
          errorData
        );
    }
  }
}

/**
 * Helper: get the cheapest model for a task category
 */
export function getCheapestModel(
  category: 'reasoning' | 'code' | 'chat' | 'fast'
): string {
  const categoryModels: Record<string, string[]> = {
    reasoning: [
      'deepseek/deepseek-r1',
      'moonshotai/kimi-k2',
      'qwen/qwen3-235b-a22b',
    ],
    code: [
      'deepseek/deepseek-chat-v3-0324',
      'mistralai/codestral-2501',
      'moonshotai/kimi-k2',
    ],
    chat: [
      'meta-llama/llama-3.3-70b-instruct',
      'qwen/qwen3-30b-a3b',
      'deepseek/deepseek-chat-v3-0324',
    ],
    fast: [
      'qwen/qwen3-30b-a3b',
      'google/gemini-2.5-flash-preview',
      'meta-llama/llama-3.3-70b-instruct',
    ],
  };

  const models = categoryModels[category] || categoryModels.chat;
  // Return the one with lowest total cost
  let cheapest = models[0];
  let cheapestCost = Infinity;

  for (const m of models) {
    const entry = OPENROUTER_MODELS[m];
    if (entry) {
      const cost = entry.promptPer1k + entry.completionPer1k;
      if (cost < cheapestCost) {
        cheapestCost = cost;
        cheapest = m;
      }
    }
  }

  return cheapest;
}
