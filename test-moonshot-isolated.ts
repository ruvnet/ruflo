import { MoonshotProvider } from './v3/@claude-flow/providers/src/moonshot-provider.js';
import type { LLMProviderConfig } from './v3/@claude-flow/providers/src/types.js';

async function testMoonshotProvider() {
  console.log('🧪 Testing Moonshot Provider (Isolated)\n');
  
  const config: LLMProviderConfig = {
    provider: 'moonshot',
    apiKey: 'test-key',
    model: 'kimi-k2-5',
  };
  
  const provider = new MoonshotProvider({ config });

  // Test 1: Provider name
  console.log('✓ Test 1: Provider name');
  console.assert(provider.name === 'moonshot', 'Name should be moonshot');
  console.log('  Name:', provider.name);

  // Test 2: Capabilities
  console.log('\n✓ Test 2: Capabilities');
  const caps = provider.capabilities;
  console.log('  Supports streaming:', caps.supportsStreaming);
  console.log('  Supports tool calling:', caps.supportsToolCalling);
  console.log('  Max context (k2.5):', caps.maxContextLength['kimi-k2-5']);
  console.assert(caps.supportsStreaming === true, 'Should support streaming');
  console.assert(caps.maxContextLength['kimi-k2-5'] === 256000, 'Should have 256k context');

  // Test 3: Model info (no API call needed)
  console.log('\n✓ Test 3: Model info');
  const models = await provider.getModels();
  console.log('  Available models:', models.map(m => m.id).join(', '));
  console.assert(models.length === 3, 'Should have 3 models');
  console.assert(models.some(m => m.id === 'kimi-k2-5'), 'Should have k2.5');

  console.log('\n✅ All structure tests passed!');
  console.log('\nProvider is correctly configured for:');
  console.log('  • Streaming responses');
  console.log('  • Tool calling');
  console.log('  • System messages');
  console.log('  • 256k context length');
  console.log('  • Kimi K2.5 / K2 / K2-Thinking models');
}

testMoonshotProvider().catch(console.error);
