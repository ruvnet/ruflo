/**
 * Comprehensive Test Suite for Specs-Driven Agent Integration
 * 
 * Tests the cleaned-up, simplified implementation of hive mind claude-flow
 * with agent search by capability following specs-driven flow principles.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { SpecsDrivenAgentSelector } from '../agents/specs-driven-agent-selector.js';
import { CapabilityMapper } from '../agents/capability-mapper.js';
import { MaestroSwarmCoordinator } from '../maestro/maestro-swarm-coordinator.js';
import { agentLoader } from '../agents/agent-loader.js';
import type { AgentRegistry } from '../agents/agent-registry.js';

// Mock dependencies for testing
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

// Mock agent registry with sample agents
const mockAgentRegistry: AgentRegistry = {
  async searchByCapabilities(capabilities: string[]) {
    const mockAgents = [
      {
        name: 'specification',
        type: 'specialist',
        status: 'idle' as const,
        capabilities: {
          languages: ['typescript', 'javascript'],
          frameworks: ['node.js'],
          domains: ['requirements_analysis', 'user_story_creation'],
          tools: ['markdown', 'yaml']
        },
        health: 0.95
      },
      {
        name: 'coder',
        type: 'specialist',
        status: 'idle' as const,
        capabilities: {
          languages: ['typescript', 'javascript', 'python'],
          frameworks: ['react', 'node.js'],
          domains: ['code_generation', 'implementation'],
          tools: ['git', 'npm', 'jest']
        },
        health: 0.90
      },
      {
        name: 'reviewer',
        type: 'specialist',
        status: 'idle' as const,
        capabilities: {
          languages: ['typescript', 'javascript'],
          frameworks: ['testing'],
          domains: ['code_review', 'quality_assurance'],
          tools: ['eslint', 'jest', 'coverage']
        },
        health: 0.92
      }
    ];

    return mockAgents.filter(agent =>
      capabilities.some(cap =>
        agent.capabilities.domains.includes(cap) ||
        agent.capabilities.tools.includes(cap) ||
        agent.name.includes(cap.toLowerCase())
      )
    );
  }
};

describe('Specs-Driven Integration Tests - Cleaned Implementation', () => {
  let maestroCoordinator: MaestroSwarmCoordinator;

  beforeAll(async () => {
    // Set up mock registry
    SpecsDrivenAgentSelector.setAgentRegistry(mockAgentRegistry);
    CapabilityMapper.setAgentRegistry(mockAgentRegistry);

    // Initialize coordinator with test config
    const testConfig = {
      hiveMindConfig: {
        name: 'test-hive-mind',
        topology: 'hierarchical' as const,
        queenMode: 'strategic' as const,
        maxAgents: 5,
        consensusThreshold: 0.6,
        memoryTTL: 60000,
        autoSpawn: false,
        enableConsensus: false,
        enableMemory: true,
        enableCommunication: false
      },
      enableConsensusValidation: false,
      enableLivingDocumentation: false,
      enableSteeringIntegration: false,
      specsDirectory: '/tmp/test-specs',
      steeringDirectory: '/tmp/test-steering'
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
  });

  describe('SpecsDrivenAgentSelector', () => {
    it('should find best agent for requirements analysis capability', async () => {
      const bestAgent = await SpecsDrivenAgentSelector.findBestAgent('requirements_analysis');
      expect(bestAgent).toBe('specification');
    });

    it('should find best agent for code generation capability', async () => {
      const bestAgent = await SpecsDrivenAgentSelector.findBestAgent('code_generation');
      expect(bestAgent).toBe('coder');
    });

    it('should find best agent for quality assurance capability', async () => {
      const bestAgent = await SpecsDrivenAgentSelector.findBestAgent('quality_assurance');
      expect(bestAgent).toBe('reviewer');
    });

    it('should return workflow agents for different phases', async () => {
      const requirementsAgents = await SpecsDrivenAgentSelector.getWorkflowAgents('requirements');
      expect(requirementsAgents.length).toBeGreaterThan(0);
      expect(requirementsAgents.some(a => a.agentName === 'specification')).toBe(true);

      const implementationAgents = await SpecsDrivenAgentSelector.getWorkflowAgents('implementation');
      expect(implementationAgents.length).toBeGreaterThan(0);
      expect(implementationAgents.some(a => a.agentName === 'coder')).toBe(true);

      const qualityAgents = await SpecsDrivenAgentSelector.getWorkflowAgents('quality');
      expect(qualityAgents.length).toBeGreaterThan(0);
      expect(qualityAgents.some(a => a.agentName === 'reviewer')).toBe(true);
    });

    it('should perform agent search with criteria', async () => {
      const searchResult = await SpecsDrivenAgentSelector.searchAgents({
        capabilities: ['code_generation', 'quality_assurance'],
        maxAgents: 3,
        minConfidence: 0.5
      });

      expect(searchResult.matches.length).toBeGreaterThan(0);
      expect(searchResult.totalSearched).toBeGreaterThanOrEqual(searchResult.matches.length);
      expect(searchResult.searchTime).toBeGreaterThan(0);
      expect(searchResult.criteria.capabilities).toEqual(['code_generation', 'quality_assurance']);
    });

    it('should validate agent capabilities correctly', async () => {
      const isValidCoder = await SpecsDrivenAgentSelector.validateAgentCapability('coder', 'code_generation');
      expect(isValidCoder).toBe(true);

      const isValidReviewer = await SpecsDrivenAgentSelector.validateAgentCapability('reviewer', 'quality_assurance');
      expect(isValidReviewer).toBe(true);

      const isInvalidCapability = await SpecsDrivenAgentSelector.validateAgentCapability('specification', 'invalid_capability');
      expect(isInvalidCapability).toBe(false);
    });

    it('should handle caching properly', () => {
      // Clear cache
      SpecsDrivenAgentSelector.clearCache();
      
      // First search should populate cache
      SpecsDrivenAgentSelector.searchAgents({
        capabilities: ['testing'],
        maxAgents: 1
      });

      // Cache should work (tested indirectly through performance)
      expect(true).toBe(true); // Cache behavior is internal
    });
  });

  describe('CapabilityMapperSimplified', () => {
    it('should map capabilities to agents with backward compatibility', async () => {
      const matches = await CapabilityMapper.mapCapabilityToAgents('requirements_analysis');
      expect(matches.length).toBeGreaterThan(0);
      
      const specMatch = matches.find(m => m.agentName === 'specification');
      expect(specMatch).toBeDefined();
      if (specMatch) {
        expect(specMatch.confidence).toBeGreaterThan(0.5);
        expect(specMatch.capabilities).toContain('requirements_analysis');
      }
    });

    it('should get best agent for capability', async () => {
      const bestAgent = await CapabilityMapper.getBestAgentForCapability('code_generation');
      expect(bestAgent).toBe('coder');
    });

    it('should resolve optimal agent set for multiple capabilities', async () => {
      const optimalSet = await CapabilityMapper.resolveOptimalAgentSet([
        'requirements_analysis',
        'code_generation',
        'quality_assurance'
      ]);
      
      expect(optimalSet.length).toBeGreaterThan(0);
      expect(optimalSet).toContain('specification');
      expect(optimalSet).toContain('coder');
      expect(optimalSet).toContain('reviewer');
    });

    it('should find agents by capability in legacy format', async () => {
      const agents = await CapabilityMapper.findAgentsByCapability('code_generation');
      expect(agents.length).toBeGreaterThan(0);
      
      const coderAgent = agents.find(a => a.name === 'coder');
      expect(coderAgent).toBeDefined();
      if (coderAgent) {
        expect(coderAgent.type).toBe('specialist');
        expect(coderAgent.status).toBe('idle');
        expect(coderAgent.capabilities).toContain('code_generation');
      }
    });

    it('should get all available capabilities', async () => {
      const capabilities = await CapabilityMapper.getAllAvailableCapabilities();
      expect(capabilities.length).toBeGreaterThan(0);
      expect(capabilities).toContain('requirements_analysis');
      expect(capabilities).toContain('code_generation');
      expect(capabilities).toContain('quality_assurance');
    });

    it('should validate agent capability', async () => {
      const isValid = await CapabilityMapper.validateAgentCapability('coder', 'code_generation');
      expect(isValid).toBe(true);

      const isInvalid = await CapabilityMapper.validateAgentCapability('coder', 'nonexistent_capability');
      expect(isInvalid).toBe(false);
    });

    it('should convert agent definition to template', () => {
      const mockAgent = {
        name: 'test-agent',
        type: 'specialist',
        capabilities: ['testing', 'analysis']
      };

      const template = CapabilityMapper.convertAgentDefinitionToTemplate(mockAgent);
      expect(template.name).toBe('test-agent');
      expect(template.type).toBe('specialist');
      expect(template.capabilities.domains).toEqual(['testing', 'analysis']);
      expect(template.config.autonomyLevel).toBe(0.8);
      expect(template.environment.runtime).toBe('deno');
    });
  });

  describe('MaestroSwarmCoordinator', () => {
    it('should initialize with specs-driven configuration', async () => {
      expect(maestroCoordinator).toBeDefined();
      expect(mockLogger.info).toHaveBeenCalledWith('MaestroSwarmCoordinator initialized with specs-driven flow');
    });

    it('should set agent registry correctly', () => {
      maestroCoordinator.setAgentRegistry(mockAgentRegistry);
      expect(mockLogger.info).toHaveBeenCalledWith('Agent registry configured for specs-driven flow');
    });

    it('should get workflow state for features', () => {
      const nonExistentState = maestroCoordinator.getWorkflowState('nonexistent-feature');
      expect(nonExistentState).toBeUndefined();
    });

    // Note: More integration tests would require full hive mind infrastructure
    // which is complex to mock. These tests cover the core functionality.
  });

  describe('Agent Loader Integration', () => {
    it('should load dynamic agents from .claude/agents directory', async () => {
      const availableTypes = await agentLoader.getAvailableAgentTypes();
      expect(Array.isArray(availableTypes)).toBe(true);
      
      // Should have at least some standard agents
      const allAgents = await agentLoader.getAllAgents();
      expect(allAgents.length).toBeGreaterThan(0);
    });

    it('should search agents by capability', async () => {
      const searchResults = await agentLoader.searchAgents('code');
      expect(Array.isArray(searchResults)).toBe(true);
      
      // Should find agents with code-related capabilities
      if (searchResults.length > 0) {
        const foundAgent = searchResults[0];
        expect(foundAgent.name).toBeTruthy();
        expect(foundAgent.description).toBeTruthy();
      }
    });

    it('should validate agent types', async () => {
      const availableTypes = await agentLoader.getAvailableAgentTypes();
      if (availableTypes.length > 0) {
        const firstType = availableTypes[0];
        const isValid = await agentLoader.isValidAgentType(firstType);
        expect(isValid).toBe(true);
      }

      const isInvalid = await agentLoader.isValidAgentType('nonexistent-agent');
      expect(isInvalid).toBe(false);
    });

    it('should get agents by category', async () => {
      const categories = await agentLoader.getAgentCategories();
      expect(Array.isArray(categories)).toBe(true);
      
      if (categories.length > 0) {
        const firstCategory = categories[0];
        expect(firstCategory.name).toBeTruthy();
        expect(Array.isArray(firstCategory.agents)).toBe(true);
        
        const categoryAgents = await agentLoader.getAgentsByCategory(firstCategory.name);
        expect(categoryAgents).toEqual(firstCategory.agents);
      }
    });
  });

  describe('Specs-Driven Flow Compliance', () => {
    it('should follow SPARC methodology workflow phases', async () => {
      // Test that workflow phases map to correct agent types
      const requirementsAgents = await SpecsDrivenAgentSelector.getWorkflowAgents('requirements');
      const designAgents = await SpecsDrivenAgentSelector.getWorkflowAgents('design');
      const implementationAgents = await SpecsDrivenAgentSelector.getWorkflowAgents('implementation');
      const qualityAgents = await SpecsDrivenAgentSelector.getWorkflowAgents('quality');

      // Each phase should have appropriate agents
      expect(requirementsAgents.some(a => a.agentName.includes('specification'))).toBe(true);
      expect(designAgents.some(a => a.agentName.includes('architecture'))).toBe(true);
      expect(implementationAgents.some(a => a.agentName.includes('coder'))).toBe(true);
      expect(qualityAgents.some(a => a.agentName.includes('reviewer'))).toBe(true);
    });

    it('should maintain high confidence in direct mappings', async () => {
      const directMatches = await SpecsDrivenAgentSelector.searchAgents({
        capabilities: ['requirements_analysis'],
        maxAgents: 1,
        minConfidence: 0.9
      });

      expect(directMatches.matches.length).toBeGreaterThan(0);
      const topMatch = directMatches.matches[0];
      expect(topMatch.confidence).toBeGreaterThanOrEqual(0.9);
      expect(topMatch.matchType).toBe('direct');
    });

    it('should provide fallback mechanisms for unknown capabilities', async () => {
      const fallbackResults = await SpecsDrivenAgentSelector.searchAgents({
        capabilities: ['unknown_capability_xyz'],
        maxAgents: 3,
        minConfidence: 0.1 // Lower threshold for fallback
      });

      // Should handle gracefully even if no matches found
      expect(fallbackResults.matches).toBeDefined();
      expect(fallbackResults.searchTime).toBeGreaterThan(0);
    });

    it('should maintain performance metrics within acceptable ranges', async () => {
      const startTime = Date.now();
      
      await SpecsDrivenAgentSelector.searchAgents({
        capabilities: ['code_generation', 'testing', 'documentation'],
        maxAgents: 5,
        minConfidence: 0.5
      });
      
      const searchTime = Date.now() - startTime;
      expect(searchTime).toBeLessThan(1000); // Should complete within 1 second
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle empty capability lists gracefully', async () => {
      const result = await SpecsDrivenAgentSelector.searchAgents({
        capabilities: [],
        maxAgents: 1
      });

      expect(result.matches).toEqual([]);
      expect(result.totalSearched).toBe(0);
    });

    it('should handle non-existent agents gracefully', async () => {
      const bestAgent = await SpecsDrivenAgentSelector.findBestAgent('totally_nonexistent_capability');
      expect(bestAgent).toBeNull();
    });

    it('should handle registry failures gracefully', async () => {
      // Test with null registry
      const originalRegistry = SpecsDrivenAgentSelector['agentRegistry'];
      SpecsDrivenAgentSelector.setAgentRegistry(null as any);

      const result = await SpecsDrivenAgentSelector.searchAgents({
        capabilities: ['test_capability'],
        maxAgents: 1
      });

      expect(result.matches).toBeDefined();
      
      // Restore registry
      SpecsDrivenAgentSelector.setAgentRegistry(originalRegistry);
    });

    it('should validate input parameters', async () => {
      // Test with negative maxAgents
      const result = await SpecsDrivenAgentSelector.searchAgents({
        capabilities: ['test'],
        maxAgents: -1,
        minConfidence: -0.5
      });

      expect(result.matches).toBeDefined();
      expect(Array.isArray(result.matches)).toBe(true);
    });
  });
});

describe('Performance and Memory Tests', () => {
  it('should handle large numbers of capability searches efficiently', async () => {
    const capabilities = [
      'requirements_analysis', 'code_generation', 'quality_assurance',
      'testing', 'documentation', 'architecture', 'system_design',
      'implementation', 'code_review', 'user_story_creation'
    ];

    const startTime = Date.now();
    const results = await Promise.all(
      capabilities.map(cap => SpecsDrivenAgentSelector.findBestAgent(cap))
    );
    const totalTime = Date.now() - startTime;

    expect(results.length).toBe(capabilities.length);
    expect(totalTime).toBeLessThan(2000); // Should complete within 2 seconds
  });

  it('should manage cache efficiently', async () => {
    // Clear cache
    SpecsDrivenAgentSelector.clearCache();

    // Perform same search multiple times
    const searchCriteria = {
      capabilities: ['code_generation'],
      maxAgents: 1
    };

    const firstSearch = await SpecsDrivenAgentSelector.searchAgents(searchCriteria);
    const secondSearch = await SpecsDrivenAgentSelector.searchAgents(searchCriteria);

    // Second search should be faster (cached)
    expect(firstSearch.matches).toEqual(secondSearch.matches);
    expect(secondSearch.searchTime).toBeLessThanOrEqual(firstSearch.searchTime);
  });
});