#!/usr/bin/env npx tsx
/**
 * Quick Provider Test Script
 *
 * Tests all available providers using .env credentials
 *
 * Usage:
 *   cd v3/@claude-flow/providers
 *   npm run test:quick
 *
 * Or directly:
 *   npx tsx src/__tests__/quick-test.ts
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from project root
config({ path: resolve(__dirname, '../../../../../.env') });

import {
  AnthropicProvider,
  OpenAIProvider,
  GoogleProvider,
  OllamaProvider,
  RuVectorProvider,
  createProviderManager,
  LLMRequest,
} from '../index.js';
import { consoleLogger } from '../base-provider.js';

const TEST_PROMPT = 'Say "Hello from Claude Flow V3!" Be brief.';

const createTestRequest = (model?: string): LLMRequest => ({
  messages: [{ role: 'user', content: TEST_PROMPT }],
  model,
  maxTokens: 50,
  temperature: 0.1,
  requestId: `test-${Date.now()}`,
});

async function testAnthropic() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('⏭️  Skipping Anthropic - no API key');
    return null;
  }

  console.log('\n🔷 Testing Anthropic Claude...');

  const provider = new AnthropicProvider({
    config: {
      provider: 'anthropic',
      apiKey,
      model: 'claude-haiku-4-5-20251001', // Use cheaper, widely-available model
      maxTokens: 100,
    },
    logger: consoleLogger,
  });

  try {
    await provider.initialize();
    const response = await provider.complete(createTestRequest());

    console.log('✅ Anthropic Response:', response.content);
    console.log('   Tokens:', response.usage);
    console.log('   Cost:', response.cost);

    provider.destroy();
    return response;
  } catch (error) {
    console.error('❌ Anthropic Error:', error);
    provider.destroy();
    return null;
  }
}

async function testGoogle() {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    console.log('⏭️  Skipping Google - no API key');
    return null;
  }

  console.log('\n🔷 Testing Google Gemini...');

  const provider = new GoogleProvider({
    config: {
      provider: 'google',
      apiKey,
      model: 'gemini-2.0-flash',
      maxTokens: 100,
    },
    logger: consoleLogger,
  });

  try {
    await provider.initialize();
    const response = await provider.complete(createTestRequest());

    console.log('✅ Google Response:', response.content);
    console.log('   Tokens:', response.usage);
    console.log('   Cost:', response.cost);

    provider.destroy();
    return response;
  } catch (error) {
    console.error('❌ Google Error:', error);
    provider.destroy();
    return null;
  }
}

async function testOpenRouter() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.log('⏭️  Skipping OpenRouter - no API key');
    return null;
  }

  console.log('\n🔷 Testing OpenRouter (GPT-4o-mini)...');

  const provider = new OpenAIProvider({
    config: {
      provider: 'openai',
      apiKey,
      apiUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-4o-mini',
      maxTokens: 100,
      providerOptions: {
        headers: {
          'HTTP-Referer': 'https://claude-flow.dev',
          'X-Title': 'Claude Flow V3 Test',
        },
      },
    },
    logger: consoleLogger,
  });

  try {
    await provider.initialize();
    const response = await provider.complete(createTestRequest('openai/gpt-4o-mini'));

    console.log('✅ OpenRouter Response:', response.content);
    console.log('   Tokens:', response.usage);

    provider.destroy();
    return response;
  } catch (error) {
    console.error('❌ OpenRouter Error:', error);
    provider.destroy();
    return null;
  }
}

async function testOllama() {
  console.log('\n🔷 Testing Ollama (local)...');

  const provider = new OllamaProvider({
    config: {
      provider: 'ollama',
      apiUrl: 'http://localhost:11434',
      model: 'qwen2.5:0.5b',
      maxTokens: 100,
    },
    logger: consoleLogger,
  });

  try {
    await provider.initialize();
    const response = await provider.complete(createTestRequest('qwen2.5:0.5b'));

    console.log('✅ Ollama Response:', response.content);
    console.log('   Tokens:', response.usage);
    console.log('   Cost: $0.00 (local)');

    provider.destroy();
    return response;
  } catch (error: any) {
    if (error.message?.includes('ECONNREFUSED') || error.message?.includes('fetch failed')) {
      console.log('⏭️  Skipping Ollama - not running locally');
      console.log('   To test: ollama pull qwen2.5:0.5b && ollama serve');
    } else {
      console.error('❌ Ollama Error:', error.message);
    }
    provider.destroy();
    return null;
  }
}

async function testRuVector() {
  console.log('\n🔷 Testing RuVector (SONA + Local Qwen)...');

  const provider = new RuVectorProvider({
    config: {
      provider: 'ruvector',
      model: 'qwen2.5:0.5b',
      maxTokens: 100,
      providerOptions: {
        sonaEnabled: true,
        hnswEnabled: true,
        fastgrnnEnabled: true,
        localModel: 'qwen2.5:0.5b',
        ollamaUrl: 'http://localhost:11434',
      },
    },
    logger: consoleLogger,
  });

  try {
    await provider.initialize();
    const response = await provider.complete(createTestRequest('qwen2.5:0.5b'));

    console.log('✅ RuVector Response:', response.content);
    console.log('   Tokens:', response.usage);

    // Show SONA metrics
    try {
      const sonaMetrics = await provider.getSonaMetrics();
      console.log('   SONA Metrics:', sonaMetrics);
    } catch {
      console.log('   SONA: Not available (optional)');
    }

    provider.destroy();
    return response;
  } catch (error: any) {
    if (error.message?.includes('ECONNREFUSED') || error.message?.includes('fetch failed')) {
      console.log('⏭️  Skipping RuVector - Ollama not running locally');
      console.log('   To test: ollama pull qwen2.5:0.5b && ollama serve');
    } else {
      console.error('❌ RuVector Error:', error.message);
    }
    provider.destroy();
    return null;
  }
}

async function testProviderManager() {
  console.log('\n🔷 Testing Provider Manager (multi-provider)...');

  const providers = [];

  if (process.env.ANTHROPIC_API_KEY) {
    providers.push({
      provider: 'anthropic' as const,
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 100,
    });
  }

  // Add OpenRouter as second provider for load balancing/failover
  if (process.env.OPENROUTER_API_KEY) {
    providers.push({
      provider: 'openai' as const, // OpenRouter uses OpenAI-compatible API
      apiKey: process.env.OPENROUTER_API_KEY,
      apiUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-4o-mini',
      maxTokens: 100,
    } as any);
  }

  if (providers.length === 0) {
    console.log('⏭️  Skipping Provider Manager - no cloud API keys');
    return null;
  }

  try {
    const manager = await createProviderManager({
      providers,
      loadBalancing: {
        enabled: true,
        strategy: 'round-robin',
      },
      fallback: {
        enabled: true,
        maxAttempts: 2,
      },
      cache: {
        enabled: true,
        ttl: 60000,
        maxSize: 100,
      },
    }, consoleLogger);

    console.log('   Active providers:', manager.listProviders());

    // Make request
    const response = await manager.complete(createTestRequest());
    console.log('✅ Manager Response:', response.content);
    console.log('   Used provider:', response.provider);

    // Test cache
    console.log('   Testing cache...');
    const start = Date.now();
    const cached = await manager.complete(createTestRequest());
    const cacheTime = Date.now() - start;
    console.log(`   Cache hit time: ${cacheTime}ms`);

    manager.destroy();
    return response;
  } catch (error) {
    console.error('❌ Manager Error:', error);
    return null;
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║     Claude Flow V3 - Provider Test Suite       ║');
  console.log('╚════════════════════════════════════════════════╝');

  console.log('\n📋 Loaded .env from:', resolve(__dirname, '../../../../../.env'));
  console.log('\n🔑 Available API Keys:');
  console.log('   ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? '✓' : '✗');
  console.log('   GOOGLE_GEMINI_API_KEY:', process.env.GOOGLE_GEMINI_API_KEY ? '✓' : '✗');
  console.log('   OPENROUTER_API_KEY:', process.env.OPENROUTER_API_KEY ? '✓' : '✗');

  const results = {
    anthropic: await testAnthropic(),
    google: await testGoogle(),
    openrouter: await testOpenRouter(),
    ollama: await testOllama(),
    ruvector: await testRuVector(),
    manager: await testProviderManager(),
  };

  // Summary
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║                  Test Summary                   ║');
  console.log('╚════════════════════════════════════════════════╝');

  const passed = Object.entries(results).filter(([_, r]) => r !== null).length;
  const total = Object.keys(results).length;

  Object.entries(results).forEach(([name, result]) => {
    const status = result !== null ? '✅' : '⏭️';
    console.log(`  ${status} ${name}`);
  });

  console.log(`\n📊 Passed: ${passed}/${total}`);

  if (results.ollama === null && results.ruvector === null) {
    console.log('\n💡 To test local models:');
    console.log('   1. Install Ollama: https://ollama.ai');
    console.log('   2. Pull Qwen: ollama pull qwen2.5:0.5b');
    console.log('   3. Start server: ollama serve');
    console.log('   4. Re-run this test');
  }
}

main().catch(console.error);
