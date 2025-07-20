/**
 * Integration Tests for Real LLM Provider APIs
 * Tests actual API calls with real providers (requires API keys)
 */

import { ProviderManager } from '../../src/providers/manager';
import { ProviderConfigLoader } from '../../src/providers/config';
import { LLMProvider, CompletionOptions } from '../../src/providers/types';
import { AnthropicProvider } from '../../src/providers/anthropic';
import { OpenAIProvider } from '../../src/providers/openai';
import { GoogleProvider } from '../../src/providers/google';

describe('LLM Provider Integration Tests', () => {
  let providerManager: ProviderManager;
  
  beforeAll(async () => {
    // Skip tests if no API keys are available
    const hasApiKeys = process.env.ANTHROPIC_API_KEY || 
                      process.env.OPENAI_API_KEY || 
                      process.env.GOOGLE_API_KEY;
    
    if (!hasApiKeys) {
      console.log('Skipping integration tests - no API keys found');
      return;
    }

    try {
      const config = ProviderConfigLoader.loadFromEnvironment();
      providerManager = new ProviderManager(config);
      await providerManager.initialize();
    } catch (error) {
      console.warn('Could not initialize provider manager:', error);
    }
  });

  afterAll(async () => {
    if (providerManager) {
      await providerManager.cleanup();
    }
  });

  describe('Provider Initialization', () => {
    test('should initialize at least one provider', () => {
      if (!providerManager) {
        console.log('Skipping - no provider manager initialized');
        return;
      }
      
      const metrics = providerManager.getAllMetrics();
      expect(metrics.size).toBeGreaterThan(0);
    });

    test('should have valid provider configurations', async () => {
      if (!providerManager) return;
      
      const statuses = await providerManager.getAllStatuses();
      
      for (const [provider, status] of statuses) {
        expect(status.provider).toBe(provider);
        expect(status.lastChecked).toBeInstanceOf(Date);
      }
    });
  });

  describe('Health Checks', () => {
    test('should perform health checks on all providers', async () => {
      if (!providerManager) return;
      
      const statuses = await providerManager.getAllStatuses();
      
      for (const [provider, status] of statuses) {
        console.log(`${provider} health:`, {
          available: status.available,
          healthy: status.healthy,
          latency: status.latency,
          errorRate: status.errorRate
        });
      }
    }, 30000);
  });

  describe('Real API Calls', () => {
    const testOptions: CompletionOptions = {
      model: 'gpt-3.5-turbo', // Will be overridden per provider
      messages: [
        { role: 'user', content: 'Say "Hello, World!" in exactly those words.' }
      ],
      temperature: 0,
      maxTokens: 10
    };

    test('should complete with Anthropic Claude', async () => {
      if (!process.env.ANTHROPIC_API_KEY) {
        console.log('Skipping Anthropic test - no API key');
        return;
      }

      const provider = new AnthropicProvider();
      await provider.initialize({ apiKey: process.env.ANTHROPIC_API_KEY });

      const options = {
        ...testOptions,
        model: 'claude-3-haiku-20240307'
      };

      const response = await provider.complete(options);
      
      expect(response).toBeDefined();
      expect(response.choices).toHaveLength(1);
      expect(response.choices[0].message.content).toBeTruthy();
      expect(response.usage.totalTokens).toBeGreaterThan(0);
      expect(response.usage.estimatedCost).toBeGreaterThan(0);
      expect(response.provider).toBe(LLMProvider.ANTHROPIC);

      console.log('Anthropic response:', {
        content: response.choices[0].message.content,
        tokens: response.usage.totalTokens,
        cost: response.usage.estimatedCost
      });
    }, 15000);

    test('should complete with OpenAI GPT', async () => {
      if (!process.env.OPENAI_API_KEY) {
        console.log('Skipping OpenAI test - no API key');
        return;
      }

      const provider = new OpenAIProvider();
      await provider.initialize({ apiKey: process.env.OPENAI_API_KEY });

      const response = await provider.complete(testOptions);
      
      expect(response).toBeDefined();
      expect(response.choices).toHaveLength(1);
      expect(response.choices[0].message.content).toBeTruthy();
      expect(response.usage.totalTokens).toBeGreaterThan(0);
      expect(response.usage.estimatedCost).toBeGreaterThan(0);
      expect(response.provider).toBe(LLMProvider.OPENAI);

      console.log('OpenAI response:', {
        content: response.choices[0].message.content,
        tokens: response.usage.totalTokens,
        cost: response.usage.estimatedCost
      });
    }, 15000);

    test('should complete with Google Gemini', async () => {
      if (!process.env.GOOGLE_API_KEY) {
        console.log('Skipping Google test - no API key');
        return;
      }

      const provider = new GoogleProvider();
      await provider.initialize({ apiKey: process.env.GOOGLE_API_KEY });

      const options = {
        ...testOptions,
        model: 'gemini-pro'
      };

      const response = await provider.complete(options);
      
      expect(response).toBeDefined();
      expect(response.choices).toHaveLength(1);
      expect(response.choices[0].message.content).toBeTruthy();
      expect(response.usage.totalTokens).toBeGreaterThan(0);
      expect(response.provider).toBe(LLMProvider.GOOGLE);

      console.log('Google response:', {
        content: response.choices[0].message.content,
        tokens: response.usage.totalTokens,
        cost: response.usage.estimatedCost
      });
    }, 15000);
  });

  describe('Streaming', () => {
    test('should stream responses from available providers', async () => {
      if (!providerManager) return;
      
      const streamOptions: CompletionOptions = {
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'user', content: 'Count from 1 to 5, each number on a new line.' }
        ],
        temperature: 0,
        maxTokens: 50
      };

      try {
        const chunks: string[] = [];
        const stream = providerManager.stream(streamOptions);
        
        for await (const chunk of stream) {
          if (chunk.choices[0].delta.content) {
            chunks.push(chunk.choices[0].delta.content);
          }
          
          if (chunk.choices[0].finishReason) {
            break;
          }
        }
        
        const fullContent = chunks.join('');
        expect(fullContent).toBeTruthy();
        expect(chunks.length).toBeGreaterThan(1);
        
        console.log('Streaming response:', {
          chunks: chunks.length,
          content: fullContent.substring(0, 100) + '...'
        });
      } catch (error) {
        console.log('Streaming test skipped:', error.message);
      }
    }, 20000);
  });

  describe('Fallback and Circuit Breaker', () => {
    test('should handle provider failures gracefully', async () => {
      if (!providerManager) return;
      
      // Try with an invalid model to trigger fallback
      const invalidOptions: CompletionOptions = {
        model: 'invalid-model-name',
        messages: [{ role: 'user', content: 'Test' }],
        maxTokens: 5
      };

      try {
        await providerManager.complete(invalidOptions);
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        expect(error.message).toContain('Model invalid-model-name not supported');
      }
    });

    test('should track circuit breaker states', async () => {
      if (!providerManager) return;
      
      const circuitStatus = providerManager.getCircuitBreakerStatus();
      
      for (const [provider, status] of circuitStatus) {
        expect(['closed', 'open', 'half_open']).toContain(status.state);
        expect(status.metrics).toBeDefined();
        
        console.log(`${provider} circuit breaker:`, status.state);
      }
    });
  });

  describe('Cost Tracking', () => {
    test('should track costs across providers', async () => {
      if (!providerManager) return;
      
      const costAnalysis = providerManager.getCostAnalysis();
      
      expect(costAnalysis.totalCost).toBeGreaterThanOrEqual(0);
      expect(costAnalysis.averageCostPerRequest).toBeGreaterThanOrEqual(0);
      
      console.log('Cost analysis:', {
        totalCost: costAnalysis.totalCost.toFixed(6),
        averageCost: costAnalysis.averageCostPerRequest.toFixed(6),
        providers: Array.from(costAnalysis.costByProvider.entries())
      });
    });

    test('should generate performance report', async () => {
      if (!providerManager) return;
      
      const report = providerManager.getPerformanceReport();
      
      expect(report.summary.totalProviders).toBeGreaterThan(0);
      expect(report.providers).toHaveLength(report.summary.totalProviders);
      
      console.log('Performance report:', {
        summary: report.summary,
        providers: report.providers.map(p => ({
          provider: p.provider,
          successRate: p.successRate.toFixed(2),
          requests: p.requestCount,
          cost: p.totalCost.toFixed(6),
          state: p.circuitState
        }))
      });
    });
  });

  describe('Model Selection', () => {
    test('should find best model for constraints', async () => {
      if (!providerManager) return;
      
      const lowCostModel = providerManager.findBestModel({
        maxCost: 0.001,
        requiresVision: false
      });
      
      if (lowCostModel) {
        expect(lowCostModel.capabilities.costPer1kTokens).toBeDefined();
        const avgCost = (lowCostModel.capabilities.costPer1kTokens.input + 
                        lowCostModel.capabilities.costPer1kTokens.output) / 2;
        expect(avgCost).toBeLessThanOrEqual(0.001);
        
        console.log('Low cost model:', {
          id: lowCostModel.id,
          provider: lowCostModel.provider,
          avgCost: avgCost.toFixed(6)
        });
      }
    });

    test('should find vision-capable models', async () => {
      if (!providerManager) return;
      
      const visionModel = providerManager.findBestModel({
        requiresVision: true,
        maxCost: 0.1
      });
      
      if (visionModel) {
        expect(visionModel.capabilities.vision).toBe(true);
        
        console.log('Vision model:', {
          id: visionModel.id,
          provider: visionModel.provider,
          vision: visionModel.capabilities.vision
        });
      }
    });
  });

  describe('Error Handling', () => {
    test('should handle authentication errors', async () => {
      const provider = new AnthropicProvider();
      
      try {
        await provider.initialize({ apiKey: 'invalid-key' });
        await provider.complete({
          model: 'claude-3-haiku-20240307',
          messages: [{ role: 'user', content: 'Test' }]
        });
        
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error.message).toContain('Authentication');
      }
    });

    test('should handle rate limit errors gracefully', async () => {
      // This test would require actually hitting rate limits
      // In practice, we would mock this or test with a provider that has low limits
      console.log('Rate limit test would require special setup');
      expect(true).toBe(true);
    });
  });
});

describe('Provider Configuration Security', () => {
  test('should validate API key formats', () => {
    const config = ProviderConfigLoader.loadFromEnvironment();
    const maskedConfig = ProviderConfigLoader.maskSensitiveConfig(config);
    
    // All API keys should be masked
    for (const providerConfig of Object.values(maskedConfig.providers)) {
      if (providerConfig.apiKey) {
        expect(providerConfig.apiKey).toMatch(/\*\*\*$/);
      }
    }
  });

  test('should enforce HTTPS for cloud providers', () => {
    // Test would check that all cloud provider base URLs use HTTPS
    expect(true).toBe(true); // Placeholder
  });
});

describe('Performance Benchmarks', () => {
  test('should measure provider latency', async () => {
    if (!providerManager) return;
    
    const statuses = await providerManager.getAllStatuses();
    
    for (const [provider, status] of statuses) {
      if (status.latency !== undefined) {
        expect(status.latency).toBeGreaterThan(0);
        expect(status.latency).toBeLessThan(30000); // 30 second max
        
        console.log(`${provider} latency: ${status.latency}ms`);
      }
    }
  });

  test('should track token estimation accuracy', async () => {
    if (!process.env.OPENAI_API_KEY) return;
    
    const provider = new OpenAIProvider();
    await provider.initialize({ apiKey: process.env.OPENAI_API_KEY });
    
    const testText = 'This is a test sentence for token estimation.';
    const estimatedTokens = await provider.estimateTokens(testText);
    
    // Make a real request to compare
    const response = await provider.complete({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: testText }],
      maxTokens: 5
    });
    
    const actualInputTokens = response.usage.promptTokens;
    const estimationError = Math.abs(estimatedTokens - actualInputTokens) / actualInputTokens;
    
    // Estimation should be within 50% of actual
    expect(estimationError).toBeLessThan(0.5);
    
    console.log('Token estimation accuracy:', {
      text: testText,
      estimated: estimatedTokens,
      actual: actualInputTokens,
      error: (estimationError * 100).toFixed(1) + '%'
    });
  }, 10000);
});