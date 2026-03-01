import { MoonshotProvider } from './v3/@claude-flow/providers/src/moonshot-provider.js';
import type { LLMProviderConfig } from './v3/@claude-flow/providers/src/types.js';

async function testMoonshotLive() {
  console.log('🧪 Moonshot Live API Test\n');
  
  const apiKey = process.env.MOONSHOT_API_KEY;
  if (!apiKey) {
    console.error('❌ MOONSHOT_API_KEY not set');
    console.log('Run: export MOONSHOT_API_KEY=your_key_here');
    process.exit(1);
  }
  
  const config: LLMProviderConfig = {
    provider: 'moonshot',
    apiKey,
    model: 'kimi-k2.5',
  };
  
  const provider = new MoonshotProvider({ config });
  
  // Initialize the provider first
  console.log('Initializing provider...');
  await provider.initialize();
  console.log('✅ Provider initialized\n');
  
  // Test 1: Health Check
  console.log('Test 1: Health Check');
  const health = await provider.healthCheck();
  console.log('  Status:', health.status);
  console.log('  Message:', health.message);
  
  if (health.status !== 'healthy') {
    console.error('❌ Health check failed');
    process.exit(1);
  }
  console.log('  ✅ Health check passed\n');
  
  // Test 2: Get Models
  console.log('Test 2: Get Models');
  const models = await provider.getModels();
  console.log('  Available models:', models.map(m => m.id).join(', '));
  console.log('  ✅ Models retrieved\n');
  
  // Test 3: Simple Completion
  console.log('Test 3: Simple Completion');
  const response = await provider.complete({
    model: 'kimi-k2.5',
    messages: [{ role: 'user', content: 'Say "Hello from Kimi K2.5" and nothing else.' }],
    maxTokens: 50,
  });
  
  console.log('  Response:', response.content);
  console.log('  Model:', response.model);
  console.log('  Tokens used:', response.usage?.totalTokens);
  console.log('  ✅ Completion successful\n');
  
  // Test 4: System Message
  console.log('Test 4: System Message');
  const sysResponse = await provider.complete({
    model: 'kimi-k2.5',
    system: 'You are a helpful assistant. Reply with exactly one word.',
    messages: [{ role: 'user', content: 'What is the capital of France?' }],
    maxTokens: 10,
  });
  
  console.log('  Response:', sysResponse.content);
  console.log('  ✅ System message works\n');
  
  console.log('========================================');
  console.log('✅ ALL TESTS PASSED!');
  console.log('========================================');
  console.log('');
  console.log('Moonshot provider is working correctly:');
  console.log('  • API connectivity: OK');
  console.log('  • Model listing: OK');
  console.log('  • Text completion: OK');
  console.log('  • System prompts: OK');
}

testMoonshotLive().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});
