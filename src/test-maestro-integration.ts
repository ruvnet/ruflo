/**
 * Test Maestro Integration with Agent Registry
 * Simple test to verify specs-driven flow functionality
 */

import { agentLoader } from './agents/agent-loader.js';
import { CapabilityMapper } from './agents/capability-mapper.js';

// Mock AgentRegistry class for testing
class MockAgentRegistry {
  private agents = new Map();

  async findBestAgent(taskType: string, capabilities: string[]) {
    console.log(`MockAgentRegistry: Finding best agent for ${taskType} with capabilities:`, capabilities);
    
    // Simulate finding an agent
    return {
      id: { id: 'test-agent-001', swarmId: 'test-swarm', type: 'specialist', instance: 1 },
      name: 'test-specialist-agent',
      type: 'specialist',
      status: 'idle',
      capabilities: capabilities,
      health: 0.9
    };
  }

  async searchByCapabilities(capabilities: string[]) {
    console.log(`MockAgentRegistry: Searching by capabilities:`, capabilities);
    
    return [{
      id: { id: 'test-agent-002', swarmId: 'test-swarm', type: 'specialist', instance: 2 },
      name: 'capability-specialist',
      type: 'specialist',
      status: 'idle',
      capabilities: capabilities,
      health: 0.85
    }];
  }
}

async function testMaestroIntegration() {
  console.log('🧪 Testing Maestro Integration with Agent Registry');
  console.log('=' .repeat(60));

  try {
    // 1. Test agent loader functionality
    console.log('\n1️⃣ Testing AgentLoader...');
    const availableTypes = await agentLoader.getAvailableAgentTypes();
    console.log(`✅ Found ${availableTypes.length} agent types`);
    console.log('Available agents:', availableTypes.slice(0, 10).join(', '), availableTypes.length > 10 ? '...' : '');

    // 2. Test agent categories
    console.log('\n2️⃣ Testing Agent Categories...');
    const categories = await agentLoader.getAgentCategories();
    console.log(`✅ Found ${categories.length} agent categories`);
    categories.forEach(cat => {
      console.log(`  📁 ${cat.name}: ${cat.agents.length} agents`);
    });

    // 3. Test specific agent lookup
    console.log('\n3️⃣ Testing Specific Agent Lookup...');
    const testAgentName = availableTypes[0]; // Get first available agent
    if (testAgentName) {
      const agent = await agentLoader.getAgent(testAgentName);
      if (agent) {
        console.log(`✅ Retrieved agent: ${agent.name}`);
        console.log(`   Description: ${agent.description}`);
        console.log(`   Capabilities: ${agent.capabilities?.join(', ') || 'none'}`);
        console.log(`   Type: ${agent.type || 'unspecified'}`);
      }
    }

    // 4. Test capability mapping with mock registry
    console.log('\n4️⃣ Testing CapabilityMapper with Mock Registry...');
    const mockRegistry = new MockAgentRegistry();
    CapabilityMapper.setAgentRegistry(mockRegistry as any);

    // Test core SPARC capabilities
    const testCapabilities = [
      'requirements_analysis',
      'system_design', 
      'code_generation',
      'quality_assurance'
    ];

    for (const capability of testCapabilities) {
      console.log(`\n  🔍 Testing capability: ${capability}`);
      
      // Test legacy mapping
      const matches = await CapabilityMapper.mapCapabilityToAgents(capability);
      console.log(`     Legacy matches: ${matches.length}`);
      matches.forEach(match => {
        console.log(`       - ${match.agentName} (confidence: ${match.confidence.toFixed(2)})`);
      });

      // Test best agent lookup
      const bestAgent = await CapabilityMapper.getBestAgentForCapability(capability);
      console.log(`     Best agent: ${bestAgent || 'none found'}`);
    }

    // 5. Test search functionality
    console.log('\n5️⃣ Testing Agent Search...');
    const searchResults = await agentLoader.searchAgents('code');
    console.log(`✅ Search for 'code' returned ${searchResults.length} agents`);
    searchResults.slice(0, 3).forEach(agent => {
      console.log(`   - ${agent.name}: ${agent.description.substring(0, 80)}...`);
    });

    // 6. Test workflow capability resolution
    console.log('\n6️⃣ Testing Workflow Capability Resolution...');
    const workflowCapabilities = [
      'requirements_analysis',
      'user_story_creation',
      'system_design',
      'code_generation',
      'testing'
    ];

    const optimalAgents = await CapabilityMapper.resolveOptimalAgentSet(workflowCapabilities);
    console.log(`✅ Optimal agent set: ${optimalAgents.join(', ')}`);

    console.log('\n🎉 All tests completed successfully!');
    console.log('\n📊 Test Summary:');
    console.log(`   - Agent types: ${availableTypes.length}`);
    console.log(`   - Categories: ${categories.length}`);
    console.log(`   - Search results: ${searchResults.length}`);
    console.log(`   - Optimal agents: ${optimalAgents.length}`);

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'Unknown error');
  }
}

// Test maestro workflow simulation
async function testMaestroWorkflow() {
  console.log('\n🔄 Testing Maestro Workflow Simulation');
  console.log('=' .repeat(60));

  const mockRegistry = new MockAgentRegistry();
  CapabilityMapper.setAgentRegistry(mockRegistry as any);

  // Simulate a complete maestro workflow
  const workflowPhases = [
    {
      phase: 'Requirements Clarification',
      capabilities: ['requirements_analysis', 'user_story_creation', 'acceptance_criteria']
    },
    {
      phase: 'Research & Design', 
      capabilities: ['system_design', 'architecture', 'specs_driven_design']
    },
    {
      phase: 'Implementation Planning',
      capabilities: ['task_management', 'workflow_orchestration']
    },
    {
      phase: 'Task Execution',
      capabilities: ['code_generation', 'implementation']
    },
    {
      phase: 'Quality Gates',
      capabilities: ['code_review', 'quality_assurance', 'testing']
    }
  ];

  for (const { phase, capabilities } of workflowPhases) {
    console.log(`\n📋 ${phase} Phase:`);
    
    for (const capability of capabilities) {
      const bestAgent = await CapabilityMapper.getBestAgentForCapability(capability);
      console.log(`   ${capability} → ${bestAgent || 'No agent found'}`);
    }
    
    // Get optimal agent set for the phase
    const phaseAgents = await CapabilityMapper.resolveOptimalAgentSet(capabilities);
    console.log(`   Phase agents: ${phaseAgents.join(', ')}`);
  }

  console.log('\n✅ Maestro workflow simulation completed!');
}

// Run tests
async function runAllTests() {
  await testMaestroIntegration();
  await testMaestroWorkflow();
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(console.error);
}

export { testMaestroIntegration, testMaestroWorkflow };