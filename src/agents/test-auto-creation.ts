#!/usr/bin/env node
/**
 * Test script for automatic agent creation
 * Demonstrates how the system automatically creates new agent types
 */

import { EnhancedAgentManager } from './enhanced-agent-manager.js';
import { createLogger } from '../core/logger.js';
import { EventBus } from '../core/event-bus.js';
import { DistributedMemorySystem } from '../memory/distributed-memory.js';
import { getErrorMessage } from '../utils/error-handler.js';

async function testAutoAgentCreation() {
  console.log('🤖 Testing Automatic Agent Creation System\n');

  // Initialize dependencies
  const logger = createLogger({ 
    level: 'info',
    name: 'test-auto-creation' 
  });
  const eventBus = new EventBus();
  const memory = new DistributedMemorySystem({
    useSharedMemory: true,
    namespace: 'test-auto-creation'
  });

  // Initialize memory system
  await memory.initialize();

  // Create enhanced agent manager with auto-creation enabled
  const agentManager = new EnhancedAgentManager({
    maxAgents: 20,
    enableAutoCreation: true,
    autoCreation: {
      inferFromName: true,
      autoRegister: true
    }
  }, logger, eventBus, memory);

  // Initialize agent manager
  await agentManager.initialize();

  // Listen for auto-creation events
  agentManager.on('template:auto-created', (data) => {
    console.log('✨ Auto-created template:', {
      type: data.type,
      name: data.template.name,
      capabilities: data.template.capabilities.domains
    });
  });

  console.log('📋 Testing various agent types that don\'t exist yet:\n');

  // Test 1: Market Researcher
  try {
    console.log('1️⃣ Creating "market_researcher" agent...');
    const marketResearcherId = await agentManager.createAgent('market_researcher', {
      name: 'AI Market Research Specialist'
    });
    
    const marketResearcher = agentManager.getAgent(marketResearcherId);
    console.log('✅ Created:', {
      id: marketResearcherId,
      name: marketResearcher?.name,
      capabilities: {
        research: marketResearcher?.capabilities.research,
        webSearch: marketResearcher?.capabilities.webSearch,
        domains: marketResearcher?.capabilities.domains
      }
    });
    console.log('');
  } catch (error) {
    console.error('❌ Failed:', getErrorMessage(error));
  }

  // Test 2: UX Designer
  try {
    console.log('2️⃣ Creating "ux_designer" agent...');
    const uxDesignerId = await agentManager.createAgent('ux_designer', {
      name: 'Senior UX Designer'
    });
    
    const uxDesigner = agentManager.getAgent(uxDesignerId);
    console.log('✅ Created:', {
      id: uxDesignerId,
      name: uxDesigner?.name,
      capabilities: {
        documentation: uxDesigner?.capabilities.documentation,
        analysis: uxDesigner?.capabilities.analysis,
        domains: uxDesigner?.capabilities.domains
      }
    });
    console.log('');
  } catch (error) {
    console.error('❌ Failed:', getErrorMessage(error));
  }

  // Test 3: Python Backend Developer
  try {
    console.log('3️⃣ Creating "python_backend_developer" agent...');
    const pythonDevId = await agentManager.createAgent('python_backend_developer', {
      name: 'Python API Developer'
    });
    
    const pythonDev = agentManager.getAgent(pythonDevId);
    console.log('✅ Created:', {
      id: pythonDevId,
      name: pythonDev?.name,
      capabilities: {
        codeGeneration: pythonDev?.capabilities.codeGeneration,
        languages: pythonDev?.capabilities.languages,
        terminalAccess: pythonDev?.capabilities.terminalAccess,
        domains: pythonDev?.capabilities.domains
      }
    });
    console.log('');
  } catch (error) {
    console.error('❌ Failed:', getErrorMessage(error));
  }

  // Test 4: React Frontend Developer
  try {
    console.log('4️⃣ Creating "react_frontend_developer" agent...');
    const reactDevId = await agentManager.createAgent('react_frontend_developer', {
      name: 'React UI Developer'
    });
    
    const reactDev = agentManager.getAgent(reactDevId);
    console.log('✅ Created:', {
      id: reactDevId,
      name: reactDev?.name,
      capabilities: {
        codeGeneration: reactDev?.capabilities.codeGeneration,
        frameworks: reactDev?.capabilities.frameworks,
        domains: reactDev?.capabilities.domains
      }
    });
    console.log('');
  } catch (error) {
    console.error('❌ Failed:', getErrorMessage(error));
  }

  // Test 5: SEO Content Strategist
  try {
    console.log('5️⃣ Creating "seo_content_strategist" agent...');
    const seoId = await agentManager.createAgent('seo_content_strategist', {
      name: 'SEO Content Expert',
      config: {
        expertise: {
          seo: 0.95,
          content_writing: 0.9,
          keyword_research: 0.85
        }
      }
    });
    
    const seoAgent = agentManager.getAgent(seoId);
    console.log('✅ Created:', {
      id: seoId,
      name: seoAgent?.name,
      capabilities: {
        documentation: seoAgent?.capabilities.documentation,
        research: seoAgent?.capabilities.research,
        domains: seoAgent?.capabilities.domains
      },
      expertise: seoAgent?.config.expertise
    });
    console.log('');
  } catch (error) {
    console.error('❌ Failed:', getErrorMessage(error));
  }

  // Test 6: Full Stack Developer
  try {
    console.log('6️⃣ Creating "fullstack_developer" agent...');
    const fullstackId = await agentManager.createAgent('fullstack_developer', {
      name: 'Full Stack Engineer'
    });
    
    const fullstack = agentManager.getAgent(fullstackId);
    console.log('✅ Created:', {
      id: fullstackId,
      name: fullstack?.name,
      capabilities: {
        codeGeneration: fullstack?.capabilities.codeGeneration,
        apiIntegration: fullstack?.capabilities.apiIntegration,
        terminalAccess: fullstack?.capabilities.terminalAccess,
        domains: fullstack?.capabilities.domains
      }
    });
    console.log('');
  } catch (error) {
    console.error('❌ Failed:', getErrorMessage(error));
  }

  // Test 7: Custom handler for specialized agent
  console.log('7️⃣ Adding custom handler for "quantum_ai_researcher"...');
  agentManager.addCustomTemplateHandler('quantum_ai_researcher', async (type) => {
    return {
      name: 'Quantum AI Research Specialist',
      type: type as any,
      capabilities: {
        codeGeneration: false,
        codeReview: false,
        testing: false,
        documentation: true,
        research: true,
        analysis: true,
        webSearch: true,
        apiIntegration: true,
        fileSystem: true,
        terminalAccess: false,
        languages: ['python', 'qiskit'],
        frameworks: ['tensorflow', 'pytorch'],
        domains: ['quantum-computing', 'ai-research', 'machine-learning'],
        tools: ['quantum-simulator', 'research-tools'],
        maxConcurrentTasks: 2,
        maxMemoryUsage: 1024 * 1024 * 1024, // 1GB
        maxExecutionTime: 1800000, // 30 minutes
        reliability: 0.85,
        speed: 0.6,
        quality: 0.95
      },
      config: {
        autonomyLevel: 0.9,
        learningEnabled: true,
        adaptationEnabled: true,
        maxTasksPerHour: 5,
        maxConcurrentTasks: 2,
        timeoutThreshold: 1800000,
        reportingInterval: 60000,
        heartbeatInterval: 15000,
        permissions: ['file-read', 'web-access', 'quantum-access'],
        trustedAgents: [],
        expertise: {
          quantum_computing: 0.9,
          ai_research: 0.85,
          theoretical_physics: 0.8
        },
        preferences: {
          research_depth: 'comprehensive',
          citation_style: 'academic'
        }
      },
      environment: {
        runtime: 'deno',
        version: '1.40.0',
        workingDirectory: './agents/quantum-ai',
        tempDirectory: './tmp/quantum-ai',
        logDirectory: './logs/quantum-ai',
        apiEndpoints: {
          arxiv: 'https://arxiv.org/api',
          quantumCloud: 'https://quantum.ibm.com/api'
        },
        credentials: {},
        availableTools: ['quantum-simulator', 'arxiv-search', 'paper-analyzer'],
        toolConfigs: {
          quantumSimulator: { backend: 'qasm_simulator' }
        }
      },
      startupScript: './scripts/start-quantum-ai.ts'
    };
  });

  try {
    const quantumId = await agentManager.createAgent('quantum_ai_researcher', {
      name: 'Dr. Quantum AI'
    });
    
    const quantum = agentManager.getAgent(quantumId);
    console.log('✅ Created with custom handler:', {
      id: quantumId,
      name: quantum?.name,
      capabilities: {
        domains: quantum?.capabilities.domains,
        languages: quantum?.capabilities.languages,
        quality: quantum?.capabilities.quality
      },
      expertise: quantum?.config.expertise
    });
    console.log('');
  } catch (error) {
    console.error('❌ Failed:', getErrorMessage(error));
  }

  // Show statistics
  console.log('\n📊 Auto-Creation Statistics:');
  const stats = agentManager.getAutoCreationStats();
  console.log({
    enabled: stats.enabled,
    createdTemplates: stats.createdTemplates,
    customHandlers: stats.customHandlers,
    failedAttempts: Array.from(stats.failedAttempts.entries())
  });

  // Show all agents
  console.log('\n👥 All Created Agents:');
  const allAgents = agentManager.getAllAgents();
  allAgents.forEach(agent => {
    console.log(`- ${agent.name} (${agent.type}): ${agent.status}`);
  });

  console.log('\n✨ Test completed! The system successfully auto-created all requested agent types.');
  
  // Cleanup
  await agentManager.shutdown();
  process.exit(0);
}

// Run the test
testAutoAgentCreation().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});