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

interface MiniMaxRequest {
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

interface MiniMaxResponse {
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

export class MiniMaxProvider extends BaseProvider {
  readonly name: LLMProvider = 'minimax';
  readonly capabilities: ProviderCapabilities = {
    supportedModels: [
      'MiniMax-M2.5',
      'MiniMax-M2.5-highspeed',
      'MiniMax-M2.1',
      'MiniMax-M2.1-highspeed',
      'MiniMax-M2',
    ],
    maxContextLength: {
      'MiniMax-M2.5': 204800,
      'MiniMax-M2.5-highspeed': 204800,
      'MiniMax-M2.1': 204800,
      'MiniMax-M2.1-highspeed': 204800,
      'MiniMax-M2': 204800,
    },
    maxOutputTokens: {
      'MiniMax-M2.5': 128000,
      'MiniMax-M2.5-highspeed': 128000,
      'MiniMax-M2.1': 16384,
      'MiniMax-M2.1-highspeed': 16384,
      'MiniMax-M2': 16384,
    },
    supportsStreaming: true,
    supportsToolCalling: true,
    supportsSystemMessages: true,
    supportsVision: true,
    supportsAudio: false,
    supportsFineTuning: false,
    supportsEmbeddings: false,
    supportsBatching: true,
    rateLimit: {
      requestsPerMinute: 1000,
      tokensPerMinute: 1000000,
      concurrentRequests: 100,
    },
    pricing: {
      'MiniMax-M2.5': {
        promptCostPer1k: 0.004,
        completionCostPer1k: 0.016,
        currency: 'USD',
      },
      'MiniMax-M2.5-highspeed': {
        promptCostPer1k: 0.002,
        completionCostPer1k: 0.008,
        currency: 'USD',
      },
      'MiniMax-M2.1': {
        promptCostPer1k: 0.002,
        completionCostPer1k: 0.008,
        currency: 'USD',
      },
      'MiniMax-M2.1-highspeed': {
        promptCostPer1k: 0.001,
        completionCostPer1k: 0.004,
        currency: 'USD',
      },
      'MiniMax-M2': {
        promptCostPer1k: 0.001,
        completionCostPer1k: 0.004,
        currency: 'USD',
      },
    },
  };

  private baseUrl: string = 'https://api.minimax.io/v1';
  private headers: Record<string, string> = {};

  constructor(options: BaseProviderOptions) {
    super(options);
  }

  protected async doInitialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new AuthenticationError('MiniMax API key is required', 'minimax');
    }

    this.baseUrl = this.config.apiUrl || 'https://api.minimax.io/v1';
    this.headers = {
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  protected async doComplete(request: LLMRequest): Promise<LLMResponse> {
    const minimaxRequest = this.buildRequest(request);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout || 60000);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(minimaxRequest),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const data = await response.json() as MiniMaxResponse;
      return this.transformResponse(data, request);
    } catch (error) {
      clearTimeout(timeout);
      throw this.transformError(error);
    }
  }

  protected async *doStreamComplete(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
    const minimaxRequest = this.buildRequest(request, true);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (this.config.timeout || 60000) * 2);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(minimaxRequest),
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
      'MiniMax-M2.5': 'Most capable MiniMax model with 204K context and advanced reasoning (CoT up to 128K)',
      'MiniMax-M2.5-highspeed': 'Fast variant of M2.5 with lower latency',
      'MiniMax-M2.1': 'Balanced MiniMax model with 204K context',
      'MiniMax-M2.1-highspeed': 'Fast variant of M2.1 with lower latency',
      'MiniMax-M2': 'Standard MiniMax model with 204K context',
    };

    return {
      model,
      name: model,
      description: descriptions[model] || 'MiniMax language model',
      contextLength: this.capabilities.maxContextLength[model] || 204800,
      maxOutputTokens: this.capabilities.maxOutputTokens[model] || 16384,
      supportedFeatures: [
        'chat',
        'completion',
        'tool_calling',
        'vision',
      ],
      pricing: this.capabilities.pricing[model],
    };
  }

  protected async doHealthCheck(): Promise<HealthCheckResult> {
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 1,
        }),
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

  private buildRequest(request: LLMRequest, stream = false): MiniMaxRequest {
    const minimaxRequest: MiniMaxRequest = {
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
      minimaxRequest.temperature = request.temperature ?? this.config.temperature;
    }

    if (request.maxTokens || this.config.maxTokens) {
      minimaxRequest.max_tokens = request.maxTokens || this.config.maxTokens;
    }

    if (request.topP !== undefined || this.config.topP !== undefined) {
      minimaxRequest.top_p = request.topP ?? this.config.topP;
    }

    if (request.stopSequences || this.config.stopSequences) {
      minimaxRequest.stop = request.stopSequences || this.config.stopSequences;
    }

    if (request.tools) {
      minimaxRequest.tools = request.tools;
      minimaxRequest.tool_choice = request.toolChoice;
    }

    return minimaxRequest;
  }

  private transformResponse(data: MiniMaxResponse, request: LLMRequest): LLMResponse {
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
      provider: 'minimax',
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
    let errorData: { error?: { message?: string; type?: string } };

    try {
      errorData = JSON.parse(errorText);
    } catch {
      errorData = { error: { message: errorText } };
    }

    const message = errorData.error?.message || 'Unknown error';

    switch (response.status) {
      case 401:
        throw new AuthenticationError(message, 'minimax', errorData);
      case 429:
        const retryAfter = response.headers.get('retry-after');
        throw new RateLimitError(
          message,
          'minimax',
          retryAfter ? parseInt(retryAfter) : undefined,
          errorData
        );
      case 404:
        throw new ModelNotFoundError(this.config.model, 'minimax', errorData);
      default:
        throw new LLMProviderError(
          message,
          `MINIMAX_${response.status}`,
          'minimax',
          response.status,
          response.status >= 500,
          errorData
        );
    }
  }
}
