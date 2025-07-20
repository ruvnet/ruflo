/**
 * Real LLM Integration Usage Examples
 * Demonstrates how to use the enhanced provider system with real API calls
 */

import { ProviderManager } from '../src/providers/manager';
import { ProviderConfigLoader } from '../src/providers/config';
import { LLMProvider } from '../src/providers/types';

async function main() {
  console.log('🚀 Agentic Flow v2.0 - Real LLM Integration Demo\n');

  try {
    // 1. Load configuration from environment
    console.log('📋 Loading provider configuration...');
    const config = ProviderConfigLoader.loadFromEnvironment();
    console.log('✅ Configuration loaded:', ProviderConfigLoader.maskSensitiveConfig(config));

    // 2. Initialize provider manager
    console.log('\n🔧 Initializing provider manager...');
    const providerManager = new ProviderManager(config);
    await providerManager.initialize();

    // 3. Check provider health
    console.log('\n🏥 Checking provider health...');
    const statuses = await providerManager.getAllStatuses();
    for (const [provider, status] of statuses) {
      const healthIcon = status.healthy ? '✅' : '❌';
      console.log(`${healthIcon} ${provider}: ${status.healthy ? 'Healthy' : 'Unhealthy'} (${status.latency}ms)`);
    }

    // 4. Simple completion
    console.log('\n💬 Testing simple completion...');
    try {
      const response = await providerManager.complete({
        model: 'gpt-3.5-turbo', // Will fallback to available providers
        messages: [
          { role: 'user', content: 'Explain the concept of AI agents in one sentence.' }
        ],
        temperature: 0.7,
        maxTokens: 100
      });

      console.log('📝 Response:', response.choices[0].message.content);
      console.log('💰 Cost: $' + (response.usage.estimatedCost || 0).toFixed(6));
      console.log('🔤 Tokens:', response.usage.totalTokens);
      console.log('⚡ Provider:', response.provider);
    } catch (error) {
      console.error('❌ Completion failed:', error.message);
    }

    // 5. Streaming example
    console.log('\n🌊 Testing streaming completion...');
    try {
      const chunks: string[] = [];
      const stream = providerManager.stream({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'user', content: 'Write a haiku about artificial intelligence.' }
        ],
        temperature: 0.8,
        maxTokens: 50
      });

      console.log('📡 Streaming response:');
      for await (const chunk of stream) {
        if (chunk.choices[0].delta.content) {
          process.stdout.write(chunk.choices[0].delta.content);
          chunks.push(chunk.choices[0].delta.content);
        }
        if (chunk.choices[0].finishReason) {
          break;
        }
      }
      console.log('\n✅ Streaming complete');
    } catch (error) {
      console.error('❌ Streaming failed:', error.message);
    }

    // 6. Circuit breaker status
    console.log('\n⚡ Circuit breaker status:');
    const circuitStatus = providerManager.getCircuitBreakerStatus();
    for (const [provider, status] of circuitStatus) {
      const stateIcon = status.state === 'closed' ? '🟢' : status.state === 'open' ? '🔴' : '🟡';
      console.log(`${stateIcon} ${provider}: ${status.state.toUpperCase()}`);
    }

    // 7. Cost analysis
    console.log('\n💰 Cost analysis:');
    const costAnalysis = providerManager.getCostAnalysis();
    console.log(`Total cost: $${costAnalysis.totalCost.toFixed(6)}`);
    console.log(`Average per request: $${costAnalysis.averageCostPerRequest.toFixed(6)}`);
    
    for (const [provider, cost] of costAnalysis.costByProvider) {
      if (cost > 0) {
        console.log(`  • ${provider}: $${cost.toFixed(6)}`);
      }
    }

    // 8. Performance report
    console.log('\n📊 Performance report:');
    const report = providerManager.getPerformanceReport();
    console.log(`Healthy providers: ${report.summary.healthyProviders}/${report.summary.totalProviders}`);
    console.log(`Total requests: ${report.summary.totalRequests}`);
    console.log(`Average success rate: ${(report.summary.averageSuccessRate * 100).toFixed(1)}%`);

    // 9. Find best model for different use cases
    console.log('\n🎯 Model recommendations:');
    
    const lowCostModel = providerManager.findBestModel({
      maxCost: 0.002,
      requiresVision: false
    });
    if (lowCostModel) {
      console.log(`💸 Low cost: ${lowCostModel.id} (${lowCostModel.provider})`);
    }

    const visionModel = providerManager.findBestModel({
      requiresVision: true,
      maxCost: 0.1
    });
    if (visionModel) {
      console.log(`👁️  Vision capable: ${visionModel.id} (${visionModel.provider})`);
    }

    const highPerformanceModel = providerManager.findBestModel({
      preferredProvider: LLMProvider.ANTHROPIC,
      maxCost: 0.1
    });
    if (highPerformanceModel) {
      console.log(`🚀 High performance: ${highPerformanceModel.id} (${highPerformanceModel.provider})`);
    }

    // 10. Function calling example (if supported)
    console.log('\n🔧 Testing function calling...');
    try {
      const functionResponse = await providerManager.complete({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'user', content: 'What is the weather like today?' }
        ],
        functions: [
          {
            name: 'get_weather',
            description: 'Get the current weather in a location',
            parameters: {
              type: 'object',
              properties: {
                location: {
                  type: 'string',
                  description: 'The city and state, e.g. San Francisco, CA'
                }
              },
              required: ['location']
            }
          }
        ],
        functionCall: 'auto'
      });

      if (response.choices[0].message.functionCall) {
        console.log('🔧 Function called:', response.choices[0].message.functionCall.name);
        console.log('📋 Arguments:', response.choices[0].message.functionCall.arguments);
      } else {
        console.log('💬 Regular response:', response.choices[0].message.content);
      }
    } catch (error) {
      console.log('⚠️  Function calling not available or failed:', error.message);
    }

    // Cleanup
    console.log('\n🧹 Cleaning up...');
    await providerManager.cleanup();
    console.log('✅ Demo completed successfully!');

  } catch (error) {
    console.error('❌ Demo failed:', error);
    process.exit(1);
  }
}

// Example of handling errors and recovery
async function demonstrateErrorHandling() {
  console.log('\n🛠️  Error Handling & Recovery Demo\n');

  const config = ProviderConfigLoader.loadFromEnvironment();
  const providerManager = new ProviderManager(config);
  await providerManager.initialize();

  // 1. Invalid model test
  console.log('Testing invalid model handling...');
  try {
    await providerManager.complete({
      model: 'nonexistent-model',
      messages: [{ role: 'user', content: 'Test' }]
    });
  } catch (error) {
    console.log('✅ Properly caught invalid model error:', error.message);
  }

  // 2. Circuit breaker test (simulated)
  console.log('\nTesting circuit breaker recovery...');
  const circuitStatus = providerManager.getCircuitBreakerStatus();
  
  for (const [provider, status] of circuitStatus) {
    if (status.state === 'open') {
      console.log(`🔄 Resetting circuit breaker for ${provider}...`);
      providerManager.resetCircuitBreaker(provider);
    }
  }

  // 3. Retry with backoff (handled internally)
  console.log('\nTesting retry logic (built into providers)...');
  try {
    const response = await providerManager.complete({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'Simple test for retry logic.' }],
      maxTokens: 10
    });
    console.log('✅ Request succeeded with built-in retry logic');
  } catch (error) {
    console.log('⚠️  Request failed even with retries:', error.message);
  }

  await providerManager.cleanup();
}

// Run the demos
if (require.main === module) {
  main()
    .then(() => demonstrateErrorHandling())
    .catch(console.error);
}

export { main, demonstrateErrorHandling };