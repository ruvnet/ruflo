/**
 * Mock Provider for Testing
 * 
 * Simple mock implementation of LLM provider interface
 * for use in unit tests.
 */

import {
  ILLMProvider,
  LLMRequest,
  LLMResponse,
  LLMStreamEvent,
  ProviderCapabilities,
  HealthCheckResult,
  ModelInfo,
} from '@claude-flow/providers';

export class MockProvider implements ILLMProvider {
  readonly name = 'mock';
  readonly capabilities: ProviderCapabilities = {
    supportedModels: ['mock-model'],
    maxContextLength: { 'mock-model': 4000 },
    maxOutputTokens: { 'mock-model': 1000 },
    supportsStreaming: true,
    supportsToolCalling: false,
    supportsSystemMessages: true,
    supportsVision: false,
    supportsAudio: false,
    supportsFineTuning: false,
    supportsEmbeddings: false,
    supportsBatching: false,
    rateLimit: { requestsPerMinute: 100, tokensPerMinute: 10000, concurrentRequests: 10 },
  };

  async initialize(): Promise<void> {}
  
  async healthCheck(): Promise<HealthCheckResult> {
    return { status: 'healthy', message: 'Mock provider is healthy', latency: 0 };
  }

  async getModels(): Promise<ModelInfo[]> {
    return [{
      id: 'mock-model',
      name: 'Mock Model',
      description: 'A mock model for testing',
      contextLength: 4000,
      maxOutputTokens: 1000,
    }];
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    return {
      id: 'mock-' + Date.now(),
      model: request.model || 'mock-model',
      content: 'This is a mock response for testing.',
      role: 'assistant',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      finishReason: 'stop',
    };
  }

  async *stream(request: LLMRequest): AsyncGenerator<LLMStreamEvent> {
    yield { type: 'content', content: 'Mock ' };
    yield { type: 'content', content: 'streaming ' };
    yield { type: 'content', content: 'response.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}
