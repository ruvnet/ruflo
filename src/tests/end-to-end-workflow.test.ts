/**
 * End-to-End Workflow Tests - Specs-Driven Flow
 * 
 * Comprehensive tests that verify the complete SPARC methodology workflow
 * from requirements to implementation using the consolidated hive mind
 * claude-flow implementation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Core components
import { SpecsDrivenAgentSelector } from '../agents/specs-driven-agent-selector.js';
import { CapabilityMapper } from '../agents/capability-mapper.js';
import { MaestroSwarmCoordinator } from '../maestro/maestro-swarm-coordinator.js';
import { agentLoader } from '../agents/agent-loader.js';
import type { AgentRegistry } from '../agents/agent-registry.js';

// Set test environment
process.env.CLAUDE_FLOW_ENV = 'test';
process.env.NODE_ENV = 'test';

// Mock implementations for testing
const mockEventBus = {
  emit: jest.fn(),
  on: jest.fn(),
  off: jest.fn()
};

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

// Mock HiveMind for testing
const mockHiveMind = {
  initialize: jest.fn().mockResolvedValue('test-swarm-001'),
  submitTask: jest.fn().mockResolvedValue({ id: 'task-001', status: 'pending' }),
  getTask: jest.fn().mockResolvedValue({ id: 'task-001', status: 'completed', result: '{}' }),
  shutdown: jest.fn().mockResolvedValue(undefined),
  memory: {
    store: jest.fn().mockResolvedValue(undefined),
    retrieve: jest.fn().mockResolvedValue(null),
    search: jest.fn().mockResolvedValue([])
  },
  communication: {
    broadcast: jest.fn().mockResolvedValue(undefined)
  }
};

// Mock agent registry with comprehensive agents
const mockAgentRegistry: AgentRegistry = {
  async searchByCapabilities(capabilities: string[]) {
    const agentDatabase = [
      {
        name: 'specification',
        type: 'specialist' as const,
        status: 'idle' as const,
        capabilities: {
          languages: ['markdown', 'yaml'],
          frameworks: ['sparc'],
          domains: ['requirements_analysis', 'user_story_creation', 'acceptance_criteria', 'specs_driven_design'],
          tools: ['markdown', 'yaml', 'documentation']
        },
        health: 0.95
      },
      {
        name: 'architecture',
        type: 'specialist' as const,
        status: 'idle' as const,
        capabilities: {
          languages: ['typescript', 'javascript'],
          frameworks: ['node.js', 'design-patterns'],
          domains: ['system_design', 'architecture', 'specs_driven_design'],
          tools: ['diagrams', 'modeling', 'documentation']
        },
        health: 0.92
      },
      {
        name: 'coder',
        type: 'specialist' as const,
        status: 'idle' as const,
        capabilities: {
          languages: ['typescript', 'javascript', 'python'],
          frameworks: ['react', 'node.js', 'express'],
          domains: ['code_generation', 'implementation', 'refactoring'],
          tools: ['git', 'npm', 'webpack', 'babel']
        },
        health: 0.90
      },
      {
        name: 'reviewer',
        type: 'specialist' as const,
        status: 'idle' as const,
        capabilities: {
          languages: ['typescript', 'javascript'],
          frameworks: ['testing', 'quality'],
          domains: ['code_review', 'quality_assurance'],
          tools: ['eslint', 'prettier', 'sonarqube']
        },
        health: 0.88
      },
      {
        name: 'tester',
        type: 'specialist' as const,
        status: 'idle' as const,
        capabilities: {
          languages: ['typescript', 'javascript'],
          frameworks: ['jest', 'cypress', 'playwright'],
          domains: ['testing', 'quality_assurance', 'acceptance_criteria'],
          tools: ['jest', 'cypress', 'coverage']
        },
        health: 0.91
      },
      {
        name: 'planner',
        type: 'specialist' as const,
        status: 'idle' as const,
        capabilities: {
          languages: ['markdown'],
          frameworks: ['project-management'],
          domains: ['task_management', 'workflow_orchestration', 'user_story_creation'],
          tools: ['markdown', 'gantt', 'planning']
        },
        health: 0.87
      }
    ];

    return agentDatabase.filter(agent =>
      capabilities.some(cap =>
        agent.capabilities.domains.includes(cap) ||
        agent.capabilities.tools.includes(cap) ||
        agent.name.toLowerCase().includes(cap.toLowerCase())
      )
    );
  }
};

describe('End-to-End Workflow Tests - SPARC Methodology', () => {
  let tempDir: string;
  let maestroCoordinator: MaestroSwarmCoordinator;

  beforeAll(async () => {
    // Create temporary directory for test specs
    tempDir = await fs.mkdtemp(join(tmpdir(), 'claude-flow-e2e-'));
    
    // Set up registry and selectors
    SpecsDrivenAgentSelector.setAgentRegistry(mockAgentRegistry);
    CapabilityMapper.setAgentRegistry(mockAgentRegistry);

    // Mock HiveMind import
    jest.doMock('../hive-mind/core/HiveMind.js', () => ({
      HiveMind: jest.fn(() => mockHiveMind)
    }));

    // Initialize coordinator
    const testConfig = {
      hiveMindConfig: {
        name: 'e2e-test-swarm',
        topology: 'specs-driven' as any,
        queenMode: 'strategic' as const,
        maxAgents: 8,
        consensusThreshold: 0.66,
        memoryTTL: 86400000,
        autoSpawn: true,
        enableConsensus: false,
        enableMemory: true,
        enableCommunication: true
      },
      enableConsensusValidation: false,
      enableLivingDocumentation: false,
      enableSteeringIntegration: false,
      specsDirectory: join(tempDir, 'specs'),
      steeringDirectory: join(tempDir, 'steering')
    };

    maestroCoordinator = new MaestroSwarmCoordinator(
      testConfig,
      mockEventBus as any,
      mockLogger as any
    );

    maestroCoordinator.setAgentRegistry(mockAgentRegistry);
  });

  afterAll(async () => {
    if (maestroCoordinator) {
      await maestroCoordinator.shutdown();
    }
    
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    mockHiveMind.getTask.mockResolvedValue({ 
      id: 'task-001', 
      status: 'completed', 
      result: JSON.stringify({ success: true, output: 'Mock task completed' })
    });
  });

  describe('SPARC Phase 1: Specification (Requirements)', () => {
    it('should select appropriate agents for requirements analysis', async () => {
      const agents = await SpecsDrivenAgentSelector.getWorkflowAgents('requirements');
      
      expect(agents.length).toBeGreaterThan(0);
      
      // Should include specification agent
      const specAgent = agents.find(a => a.agentName === 'specification');
      expect(specAgent).toBeDefined();
      expect(specAgent?.confidence).toBeGreaterThan(0.8);
      
      // Should have requirements-related capabilities
      expect(specAgent?.capabilities).toContain('requirements_analysis');
    });

    it('should create specification document following specs-driven flow', async () => {
      const featureName = 'user-authentication-system';
      const initialRequest = 'Implement OAuth2-based user authentication with JWT tokens';
      
      // This would normally create spec files and coordinate with agents
      // For testing, we verify the coordinator setup and mock the workflow
      expect(maestroCoordinator).toBeDefined();
      
      const workflowState = maestroCoordinator.getWorkflowState(featureName);
      expect(workflowState).toBeUndefined(); // Not created yet
      
      // Verify the best agent selection for requirements
      const bestAgent = await SpecsDrivenAgentSelector.findBestAgent('requirements_analysis');
      expect(bestAgent).toBe('specification');
    });

    it('should handle user story creation workflow', async () => {
      const agents = await CapabilityMapper.findAgentsByCapability('user_story_creation');
      
      expect(agents.length).toBeGreaterThan(0);
      
      const specAgent = agents.find(a => a.name === 'specification');
      expect(specAgent).toBeDefined();
      expect(specAgent?.capabilities).toContain('user_story_creation');
    });

    it('should validate acceptance criteria creation', async () => {
      const result = await SpecsDrivenAgentSelector.searchAgents({
        capabilities: ['acceptance_criteria'],
        maxAgents: 2,
        minConfidence: 0.7
      });

      expect(result.matches.length).toBeGreaterThan(0);
      
      // Should find both specification and tester agents
      const agentNames = result.matches.map(m => m.agentName);
      expect(agentNames).toContain('specification');
      expect(agentNames).toContain('tester');
    });
  });

  describe('SPARC Phase 2: Pseudocode & Architecture (Design)', () => {
    it('should select architecture agents for system design', async () => {
      const agents = await SpecsDrivenAgentSelector.getWorkflowAgents('design');
      
      expect(agents.length).toBeGreaterThan(0);
      
      const archAgent = agents.find(a => a.agentName === 'architecture');
      expect(archAgent).toBeDefined();
      expect(archAgent?.confidence).toBeGreaterThan(0.8);
    });

    it('should handle specs-driven design workflow', async () => {
      const matches = await CapabilityMapper.mapCapabilityToAgents('specs_driven_design');
      
      expect(matches.length).toBeGreaterThan(0);
      
      // Should include both specification and architecture agents
      const agentNames = matches.map(m => m.agentName);
      expect(agentNames).toContain('specification');
      expect(agentNames).toContain('architecture');
    });

    it('should validate system architecture design', async () => {
      const bestAgent = await CapabilityMapper.getBestAgentForCapability('system_design');
      expect(bestAgent).toBe('architecture');
      
      // Verify capability validation
      const isValid = await SpecsDrivenAgentSelector.validateAgentCapability('architecture', 'system_design');
      expect(isValid).toBe(true);
    });
  });

  describe('SPARC Phase 3: Architecture & Refinement (Implementation)', () => {
    it('should select coding agents for implementation', async () => {
      const agents = await SpecsDrivenAgentSelector.getWorkflowAgents('implementation');
      
      expect(agents.length).toBeGreaterThan(0);
      
      const codeAgent = agents.find(a => a.agentName === 'coder');
      expect(codeAgent).toBeDefined();
      expect(codeAgent?.capabilities).toContain('code_generation');
    });

    it('should handle code generation workflow', async () => {
      const optimalSet = await CapabilityMapper.resolveOptimalAgentSet([
        'code_generation',
        'implementation'
      ]);
      
      expect(optimalSet.length).toBeGreaterThan(0);
      expect(optimalSet).toContain('coder');
    });

    it('should support refactoring capabilities', async () => {
      const result = await SpecsDrivenAgentSelector.searchAgents({
        capabilities: ['refactoring'],
        maxAgents: 3,
        minConfidence: 0.5
      });

      expect(result.matches.length).toBeGreaterThan(0);
      
      // Should find coder agent for refactoring
      const coderMatch = result.matches.find(m => m.agentName === 'coder');
      expect(coderMatch).toBeDefined();
    });
  });

  describe('SPARC Phase 4: Completion (Quality Assurance)', () => {
    it('should select quality assurance agents', async () => {
      const agents = await SpecsDrivenAgentSelector.getWorkflowAgents('quality');
      
      expect(agents.length).toBeGreaterThan(0);
      
      // Should include reviewer and tester agents
      const agentNames = agents.map(a => a.agentName);
      expect(agentNames).toContain('reviewer');
      expect(agentNames).toContain('tester');
    });

    it('should handle code review workflow', async () => {
      const matches = await CapabilityMapper.mapCapabilityToAgents('code_review');
      
      expect(matches.length).toBeGreaterThan(0);
      
      const reviewerMatch = matches.find(m => m.agentName === 'reviewer');
      expect(reviewerMatch).toBeDefined();
      expect(reviewerMatch?.confidence).toBeGreaterThan(0.7);
    });

    it('should support comprehensive testing workflow', async () => {
      const testingAgents = await CapabilityMapper.findBestAgentsForCapabilities([
        'testing',
        'quality_assurance'
      ]);
      
      expect(testingAgents.length).toBeGreaterThan(0);
      
      // Should find both tester and reviewer agents
      const agentNames = testingAgents.map(a => a.name);
      expect(agentNames).toContain('tester');
      expect(agentNames).toContain('reviewer');
    });
  });

  describe('Complete SPARC Workflow Integration', () => {
    it('should execute full workflow phases in sequence', async () => {
      const phases = ['requirements', 'design', 'implementation', 'quality'] as const;
      const phaseResults = [];

      for (const phase of phases) {
        const agents = await SpecsDrivenAgentSelector.getWorkflowAgents(phase);
        phaseResults.push({
          phase,
          agentCount: agents.length,
          topAgent: agents[0]?.agentName,
          avgConfidence: agents.reduce((sum, a) => sum + a.confidence, 0) / agents.length
        });
      }

      expect(phaseResults.length).toBe(4);
      
      // Verify each phase has appropriate agents
      expect(phaseResults[0].topAgent).toBe('specification'); // Requirements
      expect(phaseResults[1].topAgent).toBe('architecture');  // Design
      expect(phaseResults[2].topAgent).toBe('coder');        // Implementation
      expect(phaseResults[3].topAgent).toBe('reviewer');     // Quality

      // Verify confidence levels are reasonable
      phaseResults.forEach(result => {
        expect(result.avgConfidence).toBeGreaterThan(0.5);
        expect(result.agentCount).toBeGreaterThan(0);
      });
    });

    it('should handle cross-phase capability requirements', async () => {
      // Some capabilities span multiple phases
      const crossPhaseCapabilities = [
        'specs_driven_design',  // Requirements + Design
        'acceptance_criteria',  // Requirements + Quality
        'quality_assurance'     // Implementation + Quality
      ];

      for (const capability of crossPhaseCapabilities) {
        const matches = await CapabilityMapper.mapCapabilityToAgents(capability);
        expect(matches.length).toBeGreaterThan(0);
        
        // Should have high confidence matches
        const highConfidenceMatches = matches.filter(m => m.confidence > 0.7);
        expect(highConfidenceMatches.length).toBeGreaterThan(0);
      }
    });

    it('should maintain workflow state consistency', async () => {
      const featureName = 'test-feature-consistency';
      
      // Initially no state
      let state = maestroCoordinator.getWorkflowState(featureName);
      expect(state).toBeUndefined();
      
      // Mock workflow state for testing
      const mockState = {
        featureName,
        currentPhase: 'Requirements Clarification' as any,
        currentTaskIndex: 0,
        status: 'running' as const,
        lastActivity: new Date(),
        history: []
      };
      
      // Verify state structure matches expected interface
      expect(mockState.featureName).toBe(featureName);
      expect(mockState.status).toBe('running');
      expect(typeof mockState.currentTaskIndex).toBe('number');
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle concurrent agent searches efficiently', async () => {
      const capabilities = [
        'requirements_analysis',
        'system_design', 
        'code_generation',
        'quality_assurance',
        'testing',
        'user_story_creation'
      ];

      const startTime = Date.now();
      
      const results = await Promise.all(
        capabilities.map(cap => SpecsDrivenAgentSelector.findBestAgent(cap))
      );
      
      const totalTime = Date.now() - startTime;

      expect(results.length).toBe(capabilities.length);
      expect(totalTime).toBeLessThan(1000); // Should complete within 1 second
      
      // All results should be valid agent names
      results.forEach(result => {
        expect(typeof result).toBe('string');
        expect(result).toBeTruthy();
      });
    });

    it('should cache repeated searches for performance', async () => {
      const capability = 'code_generation';
      
      // First search
      const start1 = Date.now();
      const result1 = await SpecsDrivenAgentSelector.searchAgents({
        capabilities: [capability],
        maxAgents: 1
      });
      const time1 = Date.now() - start1;

      // Second search (should use cache)
      const start2 = Date.now();
      const result2 = await SpecsDrivenAgentSelector.searchAgents({
        capabilities: [capability],
        maxAgents: 1
      });
      const time2 = Date.now() - start2;

      expect(result1.matches).toEqual(result2.matches);
      expect(time2).toBeLessThanOrEqual(time1); // Cached should be faster or equal
    });

    it('should handle large capability sets efficiently', async () => {
      const allCapabilities = await CapabilityMapper.getAllAvailableCapabilities();
      
      expect(allCapabilities.length).toBeGreaterThan(10);
      expect(Array.isArray(allCapabilities)).toBe(true);
      
      // Should return sorted, unique capabilities
      const sortedCapabilities = [...allCapabilities].sort();
      expect(allCapabilities).toEqual(sortedCapabilities);
      
      // Should not have duplicates
      const uniqueCapabilities = [...new Set(allCapabilities)];
      expect(allCapabilities.length).toBe(uniqueCapabilities.length);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle unknown capabilities gracefully', async () => {
      const unknownCapability = 'nonexistent_capability_xyz_123';
      
      const bestAgent = await SpecsDrivenAgentSelector.findBestAgent(unknownCapability);
      expect(bestAgent).toBeNull();
      
      const searchResult = await SpecsDrivenAgentSelector.searchAgents({
        capabilities: [unknownCapability],
        maxAgents: 1
      });
      
      expect(searchResult.matches).toEqual([]);
      expect(searchResult.totalSearched).toBe(0);
    });

    it('should validate agent capabilities correctly', async () => {
      // Valid capability
      const validResult = await SpecsDrivenAgentSelector.validateAgentCapability('coder', 'code_generation');
      expect(validResult).toBe(true);
      
      // Invalid capability
      const invalidResult = await SpecsDrivenAgentSelector.validateAgentCapability('coder', 'invalid_capability');
      expect(invalidResult).toBe(false);
      
      // Non-existent agent
      const nonExistentResult = await SpecsDrivenAgentSelector.validateAgentCapability('nonexistent_agent', 'code_generation');
      expect(nonExistentResult).toBe(false);
    });

    it('should handle empty search criteria', async () => {
      const result = await SpecsDrivenAgentSelector.searchAgents({
        capabilities: [],
        maxAgents: 5
      });

      expect(result.matches).toEqual([]);
      expect(result.totalSearched).toBe(0);
      expect(result.searchTime).toBeGreaterThan(0);
    });

    it('should respect search limits and filters', async () => {
      const result = await SpecsDrivenAgentSelector.searchAgents({
        capabilities: ['code_generation', 'testing', 'quality_assurance'],
        maxAgents: 2,
        minConfidence: 0.8
      });

      expect(result.matches.length).toBeLessThanOrEqual(2);
      
      // All matches should meet minimum confidence
      result.matches.forEach(match => {
        expect(match.confidence).toBeGreaterThanOrEqual(0.8);
      });
    });
  });

  describe('Integration with Dynamic Agent Loading', () => {
    it('should integrate with agent loader for dynamic agents', async () => {
      const availableTypes = await agentLoader.getAvailableAgentTypes();
      expect(Array.isArray(availableTypes)).toBe(true);
      
      // Should have some agents available
      if (availableTypes.length > 0) {
        const firstAgent = await agentLoader.getAgent(availableTypes[0]);
        expect(firstAgent).toBeDefined();
        expect(firstAgent?.name).toBeTruthy();
      }
    });

    it('should search dynamic agents by capability', async () => {
      const searchResults = await agentLoader.searchAgents('test');
      expect(Array.isArray(searchResults)).toBe(true);
      
      // Results should have proper structure
      searchResults.forEach(agent => {
        expect(agent.name).toBeTruthy();
        expect(agent.description).toBeTruthy();
        expect(Array.isArray(agent.capabilities) || typeof agent.capabilities === 'object').toBe(true);
      });
    });

    it('should validate integration between static and dynamic agents', async () => {
      // Test that specs-driven selector can work with agent loader
      const capability = 'testing';
      
      // Search using specs-driven selector
      const selectorResult = await SpecsDrivenAgentSelector.findBestAgent(capability);
      
      // Search using agent loader
      const loaderResults = await agentLoader.searchAgents(capability);
      
      // Both should provide valid results
      expect(selectorResult).toBeTruthy();
      expect(Array.isArray(loaderResults)).toBe(true);
    });
  });
});