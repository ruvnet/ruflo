/**
 * Maestro Specs-Driven Integration Verification
 * Tests the complete hive mind agent discovery and capability mapping
 */

import { agentLoader } from './agents/agent-loader.js';
import { CapabilityMapper } from './agents/capability-mapper.js';

// Test results collector
interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL';
  details: string;
  error?: string;
}

const results: TestResult[] = [];

function addResult(name: string, status: 'PASS' | 'FAIL', details: string, error?: string) {
  results.push({ name, status, details, error });
  const emoji = status === 'PASS' ? '✅' : '❌';
  console.log(`${emoji} ${name}: ${details}`);
  if (error) console.log(`   Error: ${error}`);
}

async function testAgentDiscovery() {
  console.log('\n🔍 Testing Agent Discovery System');
  console.log('=' .repeat(50));

  try {
    // Test 1: Agent loader can find agents
    const agents = await agentLoader.getAvailableAgentTypes();
    if (agents.length > 0) {
      addResult('Agent Discovery', 'PASS', `Found ${agents.length} agent types`);
    } else {
      addResult('Agent Discovery', 'FAIL', 'No agents found');
    }

    // Test 2: Can load specific agents
    const firstAgent = agents[0];
    if (firstAgent) {
      const agentDef = await agentLoader.getAgent(firstAgent);
      if (agentDef) {
        addResult('Agent Loading', 'PASS', `Successfully loaded ${agentDef.name}`);
      } else {
        addResult('Agent Loading', 'FAIL', `Could not load agent ${firstAgent}`);
      }
    }

    // Test 3: Categories work
    const categories = await agentLoader.getAgentCategories();
    if (categories.length > 0) {
      addResult('Agent Categories', 'PASS', `Found ${categories.length} categories`);
    } else {
      addResult('Agent Categories', 'FAIL', 'No categories found');
    }

    return true;
  } catch (error) {
    addResult('Agent Discovery', 'FAIL', 'System error', error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function testCapabilityMapping() {
  console.log('\n🎯 Testing Capability Mapping System');
  console.log('=' .repeat(50));

  try {
    // Test SPARC workflow capabilities
    const sparcCapabilities = [
      'requirements_analysis',
      'system_design', 
      'code_generation',
      'quality_assurance'
    ];

    let mappingWorks = true;

    for (const capability of sparcCapabilities) {
      try {
        const matches = await CapabilityMapper.mapCapabilityToAgents(capability);
        if (matches.length > 0) {
          addResult(`Capability: ${capability}`, 'PASS', `Found ${matches.length} matches, best: ${matches[0].agentName}`);
        } else {
          addResult(`Capability: ${capability}`, 'FAIL', 'No matches found');
          mappingWorks = false;
        }
      } catch (error) {
        addResult(`Capability: ${capability}`, 'FAIL', 'Mapping error', error instanceof Error ? error.message : String(error));
        mappingWorks = false;
      }
    }

    // Test optimal agent set resolution
    try {
      const optimalSet = await CapabilityMapper.resolveOptimalAgentSet(sparcCapabilities);
      if (optimalSet.length > 0) {
        addResult('Optimal Agent Set', 'PASS', `Resolved ${optimalSet.length} agents: ${optimalSet.join(', ')}`);
      } else {
        addResult('Optimal Agent Set', 'FAIL', 'No optimal agents found');
        mappingWorks = false;
      }
    } catch (error) {
      addResult('Optimal Agent Set', 'FAIL', 'Resolution error', error instanceof Error ? error.message : String(error));
      mappingWorks = false;
    }

    return mappingWorks;
  } catch (error) {
    addResult('Capability Mapping', 'FAIL', 'System error', error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function testSpecsDrivenFlow() {
  console.log('\n🏗️ Testing Specs-Driven Flow');
  console.log('=' .repeat(50));

  try {
    // Simulate maestro workflow phases
    const workflowPhases = [
      {
        name: 'Requirements Phase',
        capabilities: ['requirements_analysis', 'user_story_creation']
      },
      {
        name: 'Design Phase',
        capabilities: ['system_design', 'architecture']
      },
      {
        name: 'Implementation Phase', 
        capabilities: ['code_generation', 'implementation']
      },
      {
        name: 'Quality Phase',
        capabilities: ['code_review', 'testing']
      }
    ];

    let allPhasesWork = true;

    for (const phase of workflowPhases) {
      try {
        const phaseAgents = await CapabilityMapper.resolveOptimalAgentSet(phase.capabilities);
        if (phaseAgents.length > 0) {
          addResult(phase.name, 'PASS', `Agents: ${phaseAgents.join(', ')}`);
        } else {
          addResult(phase.name, 'FAIL', 'No agents found for phase');
          allPhasesWork = false;
        }
      } catch (error) {
        addResult(phase.name, 'FAIL', 'Phase error', error instanceof Error ? error.message : String(error));
        allPhasesWork = false;
      }
    }

    return allPhasesWork;
  } catch (error) {
    addResult('Specs-Driven Flow', 'FAIL', 'System error', error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function testMaestroIntegration() {
  console.log('\n🎼 Testing Maestro Integration Readiness');
  console.log('=' .repeat(50));

  try {
    // Test capability resolution functions that maestro uses
    const maestroCapabilities = [
      'requirements_analysis',
      'system_design',
      'task_management', 
      'code_generation',
      'quality_assurance'
    ];

    let integrationReady = true;

    // Test each capability individually (like maestro does)
    for (const cap of maestroCapabilities) {
      try {
        const bestAgent = await CapabilityMapper.getBestAgentForCapability(cap);
        if (bestAgent) {
          addResult(`Maestro ${cap}`, 'PASS', `Best agent: ${bestAgent}`);
        } else {
          addResult(`Maestro ${cap}`, 'FAIL', 'No best agent found');
          integrationReady = false;
        }
      } catch (error) {
        addResult(`Maestro ${cap}`, 'FAIL', 'Integration error', error instanceof Error ? error.message : String(error));
        integrationReady = false;
      }
    }

    return integrationReady;
  } catch (error) {
    addResult('Maestro Integration', 'FAIL', 'System error', error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function runVerification() {
  console.log('🧠 HIVE MIND CLAUDE-FLOW SPECS-DRIVEN VERIFICATION');
  console.log('=' .repeat(60));

  const tests = [
    { name: 'Agent Discovery', fn: testAgentDiscovery },
    { name: 'Capability Mapping', fn: testCapabilityMapping },
    { name: 'Specs-Driven Flow', fn: testSpecsDrivenFlow },
    { name: 'Maestro Integration', fn: testMaestroIntegration }
  ];

  let allPassed = true;

  for (const test of tests) {
    const passed = await test.fn();
    if (!passed) allPassed = false;
  }

  // Summary
  console.log('\n📊 VERIFICATION SUMMARY');
  console.log('=' .repeat(60));

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;

  console.log(`Total Tests: ${results.length}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Success Rate: ${((passed / results.length) * 100).toFixed(1)}%`);

  if (allPassed) {
    console.log('\n🎉 HIVE MIND INTEGRATION VERIFIED!');
    console.log('✨ Maestro can now use specs-driven agent selection');
    console.log('🚀 System ready for production workflow execution');
  } else {
    console.log('\n⚠️  INTEGRATION ISSUES DETECTED');
    console.log('🔧 Some components need attention before production use');
  }

  return allPassed;
}

// Execute verification
if (import.meta.url === `file://${process.argv[1]}`) {
  runVerification().catch(console.error);
}

export { runVerification };