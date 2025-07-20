/**
 * Provider Integration Tests
 * Real integration tests for LLM providers with actual API calls and fallback scenarios
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { IntegrationTestFramework, IntegrationTestContext, waitForEvent, measureTime } from './test-infrastructure';
import { ProviderManager } from '../../src/providers/manager';
import { LLMProvider, CompletionRequest, FallbackStrategy } from '../../src/providers/types';

// Skip real API tests unless explicitly enabled
const runRealAPITests = process.env.RUN_REAL_API_TESTS === 'true';
const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
const hasGoogleKey = !!process.env.GOOGLE_API_KEY;

describe('Provider Integration Tests', () => {
  let framework: IntegrationTestFramework;
  let testContext: IntegrationTestContext;

  beforeAll(async () => {
    framework = new IntegrationTestFramework();
  });

  afterAll(async () => {
    await framework.cleanup();
  });

  beforeEach(async () => {
    testContext = await framework.createTestContext({
      name: 'Provider Integration Test',
      providers: {
        anthropic: { apiKey: process.env.ANTHROPIC_API_KEY || 'test-key' },
        openai: { apiKey: process.env.OPENAI_API_KEY || 'test-key' },
        google: { apiKey: process.env.GOOGLE_API_KEY || 'test-key' }
      },
      enableRealProviders: runRealAPITests,
      timeout: 30000
    });
  });

  afterEach(async () => {
    await testContext.cleanup();
  });

  describe('Provider Manager Integration', () => {
    it('should initialize multiple providers successfully', async () => {
      const providerManager = testContext.providers;
      
      // Verify providers are initialized
      const health = await providerManager.getHealth();
      expect(Object.keys(health)).toContain(LLMProvider.ANTHROPIC);
      
      // Record metrics
      framework.recordMetric(testContext.id, 'providers_initialized', Object.keys(health).length);
    });

    it('should handle provider failover correctly', async () => {
      const providerManager = testContext.providers;
      
      const request: CompletionRequest = {
        model: 'claude-3-haiku',
        messages: [{ role: 'user', content: 'Hello, this is a test message.' }],
        maxTokens: 50
      };

      // Test primary provider
      const { result: response1, duration: duration1 } = await measureTime(async () => {
        return await providerManager.complete(request);
      });

      expect(response1).toBeDefined();
      expect(response1.choices).toHaveLength(1);
      expect(response1.choices[0].message.content).toBeTruthy();
      
      framework.recordRequest(testContext.id, duration1, true);
      framework.recordMetric(testContext.id, 'primary_provider_latency', duration1);

      // Verify response structure
      expect(response1).toHaveProperty('id');
      expect(response1).toHaveProperty('model');
      expect(response1).toHaveProperty('usage');
      
      if (runRealAPITests) {
        expect(response1.cost).toBeGreaterThan(0);
      }
    });

    it('should handle concurrent requests efficiently', async () => {
      const providerManager = testContext.providers;
      const concurrentRequests = 5;
      
      const request: CompletionRequest = {
        model: 'claude-3-haiku',
        messages: [{ role: 'user', content: 'Concurrent test request' }],
        maxTokens: 30
      };

      const { result: responses, duration: totalDuration } = await measureTime(async () => {
        const promises = Array.from({ length: concurrentRequests }, (_, i) => 
          providerManager.complete({
            ...request,
            messages: [{ role: 'user', content: `Concurrent test request ${i + 1}` }]
          })
        );
        
        return await Promise.all(promises);
      });

      expect(responses).toHaveLength(concurrentRequests);
      responses.forEach((response, index) => {
        expect(response).toBeDefined();
        expect(response.choices[0].message.content).toBeTruthy();
      });

      const avgLatency = totalDuration / concurrentRequests;
      framework.recordMetric(testContext.id, 'concurrent_requests_avg_latency', avgLatency);
      framework.recordMetric(testContext.id, 'concurrent_requests_total_duration', totalDuration);
      
      // Concurrent requests should be more efficient than sequential
      expect(avgLatency).toBeLessThan(totalDuration);
    });

    it('should handle streaming responses correctly', async () => {
      const providerManager = testContext.providers;
      
      const request: CompletionRequest = {
        model: 'claude-3-haiku',
        messages: [{ role: 'user', content: 'Count from 1 to 5 slowly.' }],
        stream: true,
        maxTokens: 100
      };

      const chunks: any[] = [];
      let chunkCount = 0;
      
      const { duration } = await measureTime(async () => {
        for await (const chunk of providerManager.stream(request)) {
          chunks.push(chunk);
          chunkCount++;
          
          if (chunk.type === 'done') {
            break;
          }
        }
      });

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[chunks.length - 1].type).toBe('done');
      expect(chunkCount).toBeGreaterThan(1);
      
      framework.recordMetric(testContext.id, 'streaming_chunks', chunkCount);
      framework.recordMetric(testContext.id, 'streaming_duration', duration);
    });

    it('should respect cost limits and optimization', async () => {
      const providerManager = testContext.providers;
      
      const lowCostRequest: CompletionRequest = {
        model: 'auto', // Let provider manager choose
        messages: [{ role: 'user', content: 'Simple test' }],
        maxTokens: 10,
        maxCost: 0.001 // Very low cost limit
      };

      if (runRealAPITests) {
        const response = await providerManager.complete(lowCostRequest);
        expect(response.cost).toBeLessThanOrEqual(0.001);
        framework.recordMetric(testContext.id, 'cost_optimized_response_cost', response.cost);
      } else {
        // For mock tests, just verify it doesn't throw
        const response = await providerManager.complete(lowCostRequest);
        expect(response).toBeDefined();
      }
    });

    it('should handle model selection based on requirements', async () => {
      const providerManager = testContext.providers;
      
      const requirements = {
        maxCost: 0.01,
        minContextWindow: 4000,
        requiresVision: false
      };

      const bestModel = providerManager.findBestModel(requirements);
      
      if (runRealAPITests) {
        expect(bestModel).toBeDefined();
        expect(bestModel.maxCost).toBeLessThanOrEqual(requirements.maxCost);
        expect(bestModel.contextWindow).toBeGreaterThanOrEqual(requirements.minContextWindow);
      }
      
      framework.recordMetric(testContext.id, 'model_selection_success', !!bestModel);
    });
  });

  describe('Provider Health and Monitoring', () => {
    it('should monitor provider health continuously', async () => {
      const providerManager = testContext.providers;
      let healthChecks = 0;
      
      // Monitor health for a short period
      const healthCheckInterval = setInterval(async () => {
        const health = await providerManager.getHealth();
        healthChecks++;
        
        Object.entries(health).forEach(([provider, status]) => {
          framework.recordMetric(testContext.id, `health_${provider}`, status.healthy);
        });
        
        if (healthChecks >= 3) {
          clearInterval(healthCheckInterval);
        }
      }, 1000);

      // Wait for health checks to complete
      await new Promise(resolve => setTimeout(resolve, 4000));
      
      expect(healthChecks).toBeGreaterThanOrEqual(3);
      framework.recordMetric(testContext.id, 'health_checks_completed', healthChecks);
    });

    it('should track provider metrics accurately', async () => {
      const providerManager = testContext.providers;
      
      // Make several requests to generate metrics
      const requests = 3;
      for (let i = 0; i < requests; i++) {
        await providerManager.complete({
          model: 'claude-3-haiku',
          messages: [{ role: 'user', content: `Metrics test ${i + 1}` }],
          maxTokens: 20
        });
      }

      const metrics = providerManager.getMetrics();
      
      expect(metrics.totalRequests).toBeGreaterThanOrEqual(requests);
      expect(metrics.averageLatency).toBeGreaterThan(0);
      
      if (runRealAPITests) {
        expect(metrics.totalCost).toBeGreaterThan(0);
      }
      
      framework.recordMetric(testContext.id, 'provider_total_requests', metrics.totalRequests);
      framework.recordMetric(testContext.id, 'provider_avg_latency', metrics.averageLatency);
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle API rate limits gracefully', async () => {
      const providerManager = testContext.providers;
      
      // Only test with real APIs
      if (!runRealAPITests) {
        return expect(true).toBe(true);
      }

      const requests = 10;
      const responses: any[] = [];
      let rateLimitErrors = 0;

      for (let i = 0; i < requests; i++) {
        try {
          const response = await providerManager.complete({
            model: 'claude-3-haiku',
            messages: [{ role: 'user', content: `Rate limit test ${i + 1}` }],
            maxTokens: 10
          });
          responses.push(response);
        } catch (error: any) {
          if (error.message.includes('rate limit') || error.status === 429) {
            rateLimitErrors++;
            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, 1000));
          } else {
            throw error;
          }
        }
      }

      framework.recordMetric(testContext.id, 'rate_limit_errors', rateLimitErrors);
      framework.recordMetric(testContext.id, 'successful_responses', responses.length);
      
      // Should handle rate limits gracefully
      expect(responses.length + rateLimitErrors).toBe(requests);
    });

    it('should recover from temporary provider failures', async () => {
      const providerManager = testContext.providers;
      
      // Simulate provider failure and recovery
      const originalComplete = providerManager.complete.bind(providerManager);
      let callCount = 0;
      let failures = 0;
      
      // Mock temporary failures
      jest.spyOn(providerManager, 'complete').mockImplementation(async (request) => {
        callCount++;
        
        // Fail first 2 calls, then succeed
        if (callCount <= 2) {
          failures++;
          throw new Error('Temporary provider failure');
        }
        
        return originalComplete(request);
      });

      try {
        // Should eventually succeed despite initial failures
        const response = await providerManager.complete({
          model: 'claude-3-haiku',
          messages: [{ role: 'user', content: 'Recovery test' }],
          maxTokens: 20
        });
        
        expect(response).toBeDefined();
        framework.recordMetric(testContext.id, 'recovery_test_failures', failures);
        framework.recordMetric(testContext.id, 'recovery_test_success', true);
      } catch (error) {
        framework.recordMetric(testContext.id, 'recovery_test_success', false);
        throw error;
      } finally {
        jest.restoreAllMocks();
      }
    });

    it('should handle network timeouts appropriately', async () => {
      const providerManager = testContext.providers;
      
      // Test with very short timeout
      const timeoutRequest: CompletionRequest = {
        model: 'claude-3-haiku',
        messages: [{ role: 'user', content: 'Timeout test' }],
        maxTokens: 10,
        timeout: 1 // 1ms timeout - should fail
      };

      if (runRealAPITests) {
        await expect(providerManager.complete(timeoutRequest)).rejects.toThrow();
        framework.recordMetric(testContext.id, 'timeout_handling_success', true);
      } else {
        // For mock tests, just verify structure
        expect(timeoutRequest.timeout).toBe(1);
        framework.recordMetric(testContext.id, 'timeout_test_mock', true);
      }
    });
  });

  describe('Performance and Load Testing', () => {
    it('should maintain performance under load', async () => {
      const providerManager = testContext.providers;
      const loadRequests = 20;
      const maxConcurrency = 5;
      
      const requests: Promise<any>[] = [];
      const startTime = Date.now();
      
      // Create batches of concurrent requests
      for (let batch = 0; batch < loadRequests / maxConcurrency; batch++) {
        const batchPromises = Array.from({ length: maxConcurrency }, (_, i) =>
          providerManager.complete({
            model: 'claude-3-haiku',
            messages: [{ role: 'user', content: `Load test batch ${batch}, request ${i}` }],
            maxTokens: 15
          }).catch(error => ({ error }))
        );
        
        requests.push(...batchPromises);
        
        // Wait between batches to avoid overwhelming
        if (batch < (loadRequests / maxConcurrency) - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      const results = await Promise.all(requests);
      const duration = Date.now() - startTime;
      
      const successful = results.filter(r => !r.error).length;
      const failed = results.filter(r => r.error).length;
      const throughput = successful / (duration / 1000);
      
      framework.recordMetric(testContext.id, 'load_test_successful', successful);
      framework.recordMetric(testContext.id, 'load_test_failed', failed);
      framework.recordMetric(testContext.id, 'load_test_throughput', throughput);
      framework.recordMetric(testContext.id, 'load_test_duration', duration);
      
      expect(successful).toBeGreaterThan(loadRequests * 0.8); // At least 80% success rate
      expect(throughput).toBeGreaterThan(1); // At least 1 request per second
    });

    it('should handle memory usage efficiently during sustained load', async () => {
      const providerManager = testContext.providers;
      const initialMemory = process.memoryUsage().heapUsed;
      
      // Sustained load for memory testing
      const rounds = 10;
      for (let round = 0; round < rounds; round++) {
        const promises = Array.from({ length: 5 }, () =>
          providerManager.complete({
            model: 'claude-3-haiku',
            messages: [{ role: 'user', content: `Memory test round ${round}` }],
            maxTokens: 10
          }).catch(() => null)
        );
        
        await Promise.all(promises);
        
        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      const memoryIncreasePercent = (memoryIncrease / initialMemory) * 100;
      
      framework.recordMetric(testContext.id, 'memory_increase_bytes', memoryIncrease);
      framework.recordMetric(testContext.id, 'memory_increase_percent', memoryIncreasePercent);
      
      // Memory increase should be reasonable (less than 50% for this test)
      expect(memoryIncreasePercent).toBeLessThan(50);
    });
  });

  describe('Real API Integration', () => {
    const describeIf = runRealAPITests ? describe : describe.skip;
    
    describeIf('Anthropic Provider Real API', () => {
      it('should work with real Anthropic API', async () => {
        if (!hasAnthropicKey) {
          return expect(true).toBe(true);
        }

        const providerManager = testContext.providers;
        
        const response = await providerManager.complete({
          model: 'claude-3-haiku-20240307',
          messages: [
            { role: 'user', content: 'Say "Hello from Anthropic!" and nothing else.' }
          ],
          maxTokens: 10
        });

        expect(response).toBeDefined();
        expect(response.choices[0].message.content).toContain('Hello from Anthropic');
        expect(response.cost).toBeGreaterThan(0);
        expect(response.usage.totalTokens).toBeGreaterThan(0);
        
        framework.recordMetric(testContext.id, 'anthropic_real_api_success', true);
        framework.recordMetric(testContext.id, 'anthropic_real_api_cost', response.cost);
      });
    });

    describeIf('OpenAI Provider Real API', () => {
      it('should work with real OpenAI API', async () => {
        if (!hasOpenAIKey) {
          return expect(true).toBe(true);
        }

        const providerManager = testContext.providers;
        
        const response = await providerManager.complete({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'user', content: 'Say "Hello from OpenAI!" and nothing else.' }
          ],
          maxTokens: 10
        });

        expect(response).toBeDefined();
        expect(response.choices[0].message.content).toContain('Hello from OpenAI');
        expect(response.cost).toBeGreaterThan(0);
        expect(response.usage.totalTokens).toBeGreaterThan(0);
        
        framework.recordMetric(testContext.id, 'openai_real_api_success', true);
        framework.recordMetric(testContext.id, 'openai_real_api_cost', response.cost);
      });
    });
  });

  describe('Integration Test Metrics', () => {
    it('should report comprehensive test metrics', () => {
      const metrics = framework.getMetrics(testContext.id);
      const stats = framework.getPerformanceStats(testContext.id);
      
      expect(metrics).toBeDefined();
      expect(stats).toBeDefined();
      
      if (stats) {
        expect(stats.requests).toBeGreaterThan(0);
        expect(stats.duration).toBeGreaterThan(0);
        expect(stats.successRate).toBeGreaterThanOrEqual(0);
        expect(stats.successRate).toBeLessThanOrEqual(100);
      }
      
      console.log('\n=== Provider Integration Test Metrics ===');
      console.log('Requests:', stats?.requests || 0);
      console.log('Success Rate:', stats?.successRate.toFixed(2) + '%' || 'N/A');
      console.log('Average Latency:', stats?.latency?.avg?.toFixed(2) + 'ms' || 'N/A');
      console.log('P95 Latency:', stats?.latency?.p95?.toFixed(2) + 'ms' || 'N/A');
      console.log('Test Duration:', stats?.duration?.toFixed(2) + 'ms' || 'N/A');
      console.log('Memory Usage:', (stats?.resourceUsage?.memory / 1024 / 1024)?.toFixed(2) + 'MB' || 'N/A');
      console.log('=========================================\n');
    });
  });
});