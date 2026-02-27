/**
 * V3 Novita AI Provider
 *
 * OpenAI-compatible provider for Novita AI (https://novita.ai).
 * Uses the OpenAI API endpoint with Novita's base URL.
 *
 * @module @claude-flow/providers/novita-provider
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

interface NovitaRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    name?: string;
    tool_call_id?: string;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
  }>;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string[];
  stream?: boolean;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: unknown;
    };
  }>;
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
}

interface NovitaResponse {
  id: string;
  object: string;
  created: number;
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

export class NovitaProvider extends BaseProvider {
  readonly name: LLMProvider = 'novita';
  readonly capabilities: ProviderCapabilities = {
    supportedModels: [
      'deepseek-ai/DeepSeek-V3',
      'deepseek-ai/DeepSeek-R1',
      'meta-llama/llama-3.3-70b-instruct',
      'meta-llama/llama-3.2-3b-instruct',
      'google/gemma-2-9b-it',
      'mistralai/mistral-nemo',
      'qwen/qwen-2.5-72b-instruct',
    ],
    maxContextLength: {
      'deepseek-ai/DeepSeek-V3': 128000,
      'deepseek-ai/DeepSeek-R1': 128000,
      'meta-llama/llama-3.3-70b-instruct': 128000,
      'meta-llama/llama-3.2-3b-instruct': 128000,
      'google/gemma-2-9b-it': 8192,
      'mistralai/mistral-nemo': 128000,
      'qwen/qwen-2.5-72b-instruct': 128000,
    },
    maxOutputTokens: {
      'deepseek-ai/DeepSeek-V3': 8192,
      'deepseek-ai/DeepSeek-R1': 8192,
      'meta-llama/llama-3.3-70b-instruct': 4096,
      'meta-llama/llama-3.2-3b-instruct': 4096,
      'google/gemma-2-9b-it': 4096,
      'mistralai/mistral-nemo': 4096,
      'qwen/qwen-2.5-72b-instruct': 4096,
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
      requestsPerMinute: 1000,
      tokensPerMinute: 100000,
      concurrentRequests: 50,
    },
    pricing: {
      'deepseek-ai/DeepSeek-V3': {
        promptCostPer1k: 0.00027,
        completionCostPer1k: 0.0011,
        currency: 'USD',
      },
      'deepseek-ai/DeepSeek-R1': {
        promptCostPer1k: 0.00055,
        completionCostPer1k: 0.0022,
        currency: 'USD',
      },
      'meta-llama/llama-3.3-70b-instruct': {
        promptCostPer1k: 0.00075,
        completionCostPer1k: 0.0015,
        currency: 'USD',
      },
      'meta-llama/llama-3.2-3b-instruct': {
        promptCostPer1k: 0.00015,
        completionCostPer1k: 0.0003,
        currency: 'USD',
      },
      'google/gemma-2-9b-it': {
        promptCostPer1k: 0.0001,
        completionCostPer1k: 0.0002,
        currency: 'USD',
      },
      'mistralai/mistral-nemo': {
        promptCostPer1k: 0.0003,
        completionCostPer1k: 0.0006,
        currency: 'USD',
      },
      'qwen/qwen-2.5-72b-instruct': {
        promptCostPer1k: 0.00035,
        completionCostPer1k: 0.0007,
        currency: 'USD',
      },
    },
  };

  private baseUrl: string = 'https://api.novita.ai/openai';
  private headers: Record<string, string> = {};

  constructor(options: BaseProviderOptions) {
    super(options);
  }

  protected async doInitialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new AuthenticationError('Novita API key is required. Set NOVITA_API_KEY environment variable.', 'novita');
    }

    this.baseUrl = this.config.apiUrl || 'https://api.novita.ai/openai';
    this.headers = {
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  protected async doComplete(request: LLMRequest): Promise<LLMResponse> {
    const novitaRequest = this.buildRequest(request);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout || 60000);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(novitaRequest),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const data = await response.json() as NovitaResponse;
      return this.transformResponse(data, request);
    } catch (error) {
      clearTimeout(timeout);
      throw this.transformError(error);
    }
  }

  protected async *doStreamComplete(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
    const novitaRequest = this.buildRequest(request, true);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (this.config.timeout || 60000) * 2);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(novitaRequest),
        signal: controller.signal,
      });

      if (!response.ok) {
        await this.handleErrorResponse(response);
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
            const data = line.slice(6);
            if (data === '[DONE]') {
              const promptTokens = this.estimateTokens(JSON.stringify(request.messages));
              const model = request.model || this.config.model;
              const pricing = this.capabilities.pricing[model];
              const promptCostPer1k = pricing?.promptCostPer1k ?? 0;
              const completionCostPer1k = pricing?.completionCostPer1k ?? 0;

              yield {
                type: 'done',
                usage: {
                  promptTokens,
                  completionTokens: 100,
                  totalTokens: promptTokens + 100,
                },
                cost: {
                  promptCost: (promptTokens / 1000) * promptCostPer1k,
                  completionCost: (100 / 1000) * completionCostPer1k,
                  totalCost:
                    (promptTokens / 1000) * promptCostPer1k +
                    (100 / 1000) * completionCostPer1k,
                  currency: 'USD',
                },
              };
              continue;
            }

            try {
              const chunk = JSON.parse(data);
              const delta = chunk.choices?.[0]?.delta;

              if (delta?.content) {
                yield {
                  type: 'content',
                  delta: { content: delta.content },
                };
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
    const descriptions: Record<string, string> = {
      'deepseek-ai/DeepSeek-V3': 'DeepSeek V3 - High performance model',
      'deepseek-ai/DeepSeek-R1': 'DeepSeek R1 - Reasoning model',
      'meta-llama/llama-3.3-70b-instruct': 'Llama 3.3 70B - Meta\'s latest large model',
      'meta-llama/llama-3.2-3b-instruct': 'Llama 3.2 3B - Lightweight model',
      'google/gemma-2-9b-it': 'Google Gemma 2 9B',
      'mistralai/mistral-nemo': 'Mistral Nemo - Efficient model',
      'qwen/qwen-2.5-72b-instruct': 'Qwen 2.5 72B - Alibaba\'s large model',
    };

    return {
      model,
      name: model,
      description: descriptions[model] || 'Novita AI language model',
      contextLength: this.capabilities.maxContextLength[model] || 8192,
      maxOutputTokens: this.capabilities.maxOutputTokens[model] || 4096,
      supportedFeatures: [
        'chat',
        'completion',
        'tool_calling',
      ],
      pricing: this.capabilities.pricing[model],
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

  private buildRequest(request: LLMRequest, stream = false): NovitaRequest {
    const novitaRequest: NovitaRequest = {
      model: request.model || this.config.model,
      messages: request.messages.map((msg) => ({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        ...(msg.name && { name: msg.name }),
        ...(msg.toolCallId && { tool_call_id: msg.toolCallId }),
        ...(msg.toolCalls && { tool_calls: msg.toolCalls }),
      })),
      stream,
    };

    if (request.temperature !== undefined || this.config.temperature !== undefined) {
      novitaRequest.temperature = request.temperature ?? this.config.temperature;
    }

    if (request.maxTokens || this.config.maxTokens) {
      novitaRequest.max_tokens = request.maxTokens || this.config.maxTokens;
    }

    if (request.topP !== undefined || this.config.topP !== undefined) {
      novitaRequest.top_p = request.topP ?? this.config.topP;
    }

    if (request.frequencyPenalty !== undefined || this.config.frequencyPenalty !== undefined) {
      novitaRequest.frequency_penalty = request.frequencyPenalty ?? this.config.frequencyPenalty;
    }

    if (request.presencePenalty !== undefined || this.config.presencePenalty !== undefined) {
      novitaRequest.presence_penalty = request.presencePenalty ?? this.config.presencePenalty;
    }

    if (request.stopSequences || this.config.stopSequences) {
      novitaRequest.stop = request.stopSequences || this.config.stopSequences;
    }

    if (request.tools) {
      novitaRequest.tools = request.tools;
      novitaRequest.tool_choice = request.toolChoice;
    }

    return novitaRequest;
  }

  private transformResponse(data: NovitaResponse, request: LLMRequest): LLMResponse {
    const choice = data.choices[0];
    const model = request.model || this.config.model;
    const pricing = this.capabilities.pricing[model];

    const promptCostPer1k = pricing?.promptCostPer1k ?? 0;
    const completionCostPer1k = pricing?.completionCostPer1k ?? 0;

    const promptCost = (data.usage.prompt_tokens / 1000) * promptCostPer1k;
    const completionCost = (data.usage.completion_tokens / 1000) * completionCostPer1k;

    return {
      id: data.id,
      model: model as LLMModel,
      provider: 'novita',
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

  private async handleErrorResponse(response: Response): Promise<never> {
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
        throw new AuthenticationError(message, 'novita', errorData);
      case 429:
        const retryAfter = response.headers.get('retry-after');
        throw new RateLimitError(
          message,
          'novita',
          retryAfter ? parseInt(retryAfter) : undefined,
          errorData
        );
      case 404:
        throw new ModelNotFoundError(this.config.model, 'novita', errorData);
      default:
        throw new LLMProviderError(
          message,
          `NOVITA_${response.status}`,
          'novita',
          response.status,
          response.status >= 500,
          errorData
        );
    }
  }
}
