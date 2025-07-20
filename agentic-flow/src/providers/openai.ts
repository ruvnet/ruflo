/**
 * OpenAI Provider
 * Implements support for GPT models with streaming and function calling
 */

import OpenAI from 'openai';
import {
  LLMProvider,
  ModelInfo,
  CompletionOptions,
  CompletionResponse,
  StreamChunk,
  Message,
  MessageContent,
  TextContent,
  ImageContent,
  ProviderError,
  FunctionDefinition
} from './types';
import { BaseLLMProvider } from './base';

export class OpenAIProvider extends BaseLLMProvider {
  readonly provider = LLMProvider.OPENAI;
  
  readonly models: ModelInfo[] = [
    {
      id: 'gpt-4-turbo-preview',
      name: 'GPT-4 Turbo',
      provider: LLMProvider.OPENAI,
      capabilities: {
        streaming: true,
        functionCalling: true,
        vision: true,
        maxTokens: 4096,
        contextWindow: 128000,
        costPer1kTokens: {
          input: 0.01,
          output: 0.03
        }
      },
      description: 'Latest GPT-4 Turbo with vision capabilities'
    },
    {
      id: 'gpt-4',
      name: 'GPT-4',
      provider: LLMProvider.OPENAI,
      capabilities: {
        streaming: true,
        functionCalling: true,
        vision: false,
        maxTokens: 8192,
        contextWindow: 8192,
        costPer1kTokens: {
          input: 0.03,
          output: 0.06
        }
      },
      description: 'Original GPT-4 model'
    },
    {
      id: 'gpt-4-32k',
      name: 'GPT-4 32K',
      provider: LLMProvider.OPENAI,
      capabilities: {
        streaming: true,
        functionCalling: true,
        vision: false,
        maxTokens: 32768,
        contextWindow: 32768,
        costPer1kTokens: {
          input: 0.06,
          output: 0.12
        }
      },
      description: 'GPT-4 with larger context window'
    },
    {
      id: 'gpt-3.5-turbo',
      name: 'GPT-3.5 Turbo',
      provider: LLMProvider.OPENAI,
      capabilities: {
        streaming: true,
        functionCalling: true,
        vision: false,
        maxTokens: 4096,
        contextWindow: 16384,
        costPer1kTokens: {
          input: 0.0005,
          output: 0.0015
        }
      },
      description: 'Fast and efficient model for most tasks'
    },
    {
      id: 'gpt-3.5-turbo-16k',
      name: 'GPT-3.5 Turbo 16K',
      provider: LLMProvider.OPENAI,
      capabilities: {
        streaming: true,
        functionCalling: true,
        vision: false,
        maxTokens: 16384,
        contextWindow: 16384,
        costPer1kTokens: {
          input: 0.001,
          output: 0.002
        }
      },
      description: 'GPT-3.5 with larger context window'
    }
  ];
  
  private client?: OpenAI;

  protected async doInitialize(): Promise<void> {
    this.client = new OpenAI({
      apiKey: this.config.apiKey!,
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout || 60000,
      maxRetries: 0, // We handle retries ourselves
      defaultHeaders: this.config.headers
    });
  }

  protected async doComplete(options: CompletionOptions): Promise<CompletionResponse> {
    if (!this.client) {
      throw new ProviderError('Client not initialized', this.provider);
    }

    try {
      const chatCompletion = await this.client.chat.completions.create({
        model: options.model,
        messages: this.convertMessages(options.messages),
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        top_p: options.topP,
        frequency_penalty: options.frequencyPenalty,
        presence_penalty: options.presencePenalty,
        stop: options.stopSequences,
        functions: options.functions ? this.convertFunctions(options.functions) : undefined,
        function_call: options.functionCall,
        user: options.user,
        stream: false
      });

      return this.convertResponse(chatCompletion, options);
    } catch (error: any) {
      throw this.handleOpenAIError(error);
    }
  }

  protected async *doStream(options: CompletionOptions): AsyncGenerator<StreamChunk, void, unknown> {
    if (!this.client) {
      throw new ProviderError('Client not initialized', this.provider);
    }

    try {
      const stream = await this.client.chat.completions.create({
        model: options.model,
        messages: this.convertMessages(options.messages),
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        top_p: options.topP,
        frequency_penalty: options.frequencyPenalty,
        presence_penalty: options.presencePenalty,
        stop: options.stopSequences,
        functions: options.functions ? this.convertFunctions(options.functions) : undefined,
        function_call: options.functionCall,
        user: options.user,
        stream: true
      });

      for await (const chunk of stream) {
        yield {
          id: chunk.id,
          model: chunk.model,
          choices: chunk.choices.map(choice => ({
            index: choice.index,
            delta: {
              role: choice.delta.role as any,
              content: choice.delta.content || undefined,
              functionCall: choice.delta.function_call ? {
                name: choice.delta.function_call.name || '',
                arguments: choice.delta.function_call.arguments || ''
              } : undefined
            },
            finishReason: choice.finish_reason || undefined
          })),
          created: chunk.created,
          provider: this.provider
        };
      }
    } catch (error: any) {
      throw this.handleOpenAIError(error);
    }
  }

  protected async doHealthCheck(): Promise<void> {
    if (!this.client) {
      throw new ProviderError('Client not initialized', this.provider);
    }

    try {
      // Real health check with minimal completion
      const response = await this.client.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Health check' }],
        max_tokens: 5,
        temperature: 0
      });
      
      // Verify we got a valid response
      if (!response || !response.choices || response.choices.length === 0) {
        throw new ProviderError('Invalid response from health check', this.provider);
      }
    } catch (error: any) {
      throw this.handleOpenAIError(error);
    }
  }

  /**
   * Convert messages to OpenAI format
   */
  private convertMessages(messages: Message[]): OpenAI.Chat.ChatCompletionMessageParam[] {
    return messages.map(msg => {
      const baseMessage: any = {
        role: msg.role,
        content: this.convertMessageContent(msg.content)
      };

      if (msg.name) {
        baseMessage.name = msg.name;
      }

      if (msg.functionCall) {
        baseMessage.function_call = {
          name: msg.functionCall.name,
          arguments: msg.functionCall.arguments
        };
      }

      return baseMessage;
    });
  }

  /**
   * Convert message content to OpenAI format
   */
  private convertMessageContent(content: MessageContent): string | OpenAI.Chat.ChatCompletionContentPart[] {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content.map(item => this.convertContentPart(item));
    }

    return [this.convertContentPart(content)];
  }

  /**
   * Convert content part to OpenAI format
   */
  private convertContentPart(item: TextContent | ImageContent): OpenAI.Chat.ChatCompletionContentPart {
    if (item.type === 'text') {
      return {
        type: 'text',
        text: item.text
      };
    } else {
      return {
        type: 'image_url',
        image_url: {
          url: item.image.url,
          detail: item.image.detail
        }
      };
    }
  }

  /**
   * Convert function definitions to OpenAI format
   */
  private convertFunctions(functions: FunctionDefinition[]): OpenAI.Chat.ChatCompletionCreateParams.Function[] {
    return functions.map(fn => ({
      name: fn.name,
      description: fn.description,
      parameters: fn.parameters || {}
    }));
  }

  /**
   * Convert OpenAI response to standard format
   */
  private convertResponse(response: OpenAI.Chat.ChatCompletion, options: CompletionOptions): CompletionResponse {
    const usage = response.usage ? {
      promptTokens: response.usage.prompt_tokens,
      completionTokens: response.usage.completion_tokens,
      totalTokens: response.usage.total_tokens,
      estimatedCost: this.calculateCost(
        response.usage.prompt_tokens,
        response.usage.completion_tokens,
        options.model
      )
    } : {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    };

    return {
      id: response.id,
      model: response.model,
      choices: response.choices.map(choice => ({
        index: choice.index,
        message: {
          role: choice.message.role as any,
          content: choice.message.content || '',
          functionCall: choice.message.function_call ? {
            name: choice.message.function_call.name,
            arguments: choice.message.function_call.arguments
          } : undefined
        },
        finishReason: choice.finish_reason as any
      })),
      usage,
      created: response.created,
      provider: this.provider
    };
  }

  /**
   * Calculate cost based on token usage with real OpenAI pricing
   */
  private calculateCost(inputTokens: number, outputTokens: number, model: string): number {
    const modelInfo = this.models.find(m => m.id === model);
    if (!modelInfo?.capabilities.costPer1kTokens) {
      return 0;
    }

    const inputCost = (inputTokens / 1000) * modelInfo.capabilities.costPer1kTokens.input;
    const outputCost = (outputTokens / 1000) * modelInfo.capabilities.costPer1kTokens.output;
    const totalCost = inputCost + outputCost;

    // Log cost tracking for monitoring
    console.debug(`[${this.provider}] Cost calculation: ${inputTokens} input + ${outputTokens} output = $${totalCost.toFixed(6)}`);
    
    return totalCost;
  }

  /**
   * Handle OpenAI-specific errors with detailed error mapping
   */
  private handleOpenAIError(error: any): Error {
    if (error instanceof OpenAI.APIError) {
      // Map specific OpenAI error types
      const errorCode = error.code || error.type || 'UNKNOWN';
      
      // Add specific error handling for common cases
      let customMessage = error.message;
      if (errorCode === 'insufficient_quota') {
        customMessage = 'OpenAI API quota exceeded or billing issue';
      } else if (errorCode === 'invalid_api_key') {
        customMessage = 'Invalid OpenAI API key';
      } else if (errorCode === 'model_not_found') {
        customMessage = `OpenAI model not found: ${error.message}`;
      } else if (errorCode === 'rate_limit_exceeded') {
        customMessage = 'OpenAI API rate limit exceeded';
      } else if (errorCode === 'context_length_exceeded') {
        customMessage = 'Request exceeds maximum context length for OpenAI model';
      }
      
      return this.wrapError({
        message: customMessage,
        status: error.status,
        code: errorCode,
        headers: error.headers
      });
    }
    
    // Handle network errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return this.wrapError({
        message: 'Network error connecting to OpenAI API',
        code: 'NETWORK_ERROR',
        status: 503
      });
    }
    
    return this.wrapError(error);
  }

  /**
   * Estimate tokens using improved tiktoken approximation
   */
  async estimateTokens(text: string): Promise<number> {
    // More accurate OpenAI tokenization estimation
    // Based on tiktoken patterns: 1 token ≈ 3.8 characters for English
    let baseTokens = Math.ceil(text.length / 3.8);
    
    // Adjust for common OpenAI tokenization patterns
    const words = text.split(/\s+/).length;
    const specialChars = (text.match(/[^\w\s]/g) || []).length;
    const newlines = (text.match(/\n/g) || []).length;
    
    // Words with special characters often use more tokens
    baseTokens += Math.ceil(specialChars * 0.15);
    // Newlines are typically separate tokens
    baseTokens += newlines;
    // Account for subword tokenization
    baseTokens = Math.max(baseTokens, Math.ceil(words * 0.75));
    
    return baseTokens;
  }
}