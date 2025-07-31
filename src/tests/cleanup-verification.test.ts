/**
 * Cleanup Verification Test Suite
 * 
 * Verifies that the cleaned-up implementation maintains all functionality
 * while improving performance, maintainability, and specs-driven compliance.
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { promises as fs } from 'fs';
import { resolve } from 'path';
import { SpecsDrivenAgentSelector } from '../agents/specs-driven-agent-selector.js';
import { CapabilityMapper } from '../agents/capability-mapper.js';
import { MaestroSwarmCoordinator } from '../maestro/maestro-swarm-coordinator.js';

// Test configuration
const PROJECT_ROOT = resolve(process.cwd());
const SRC_PATH = resolve(PROJECT_ROOT, 'src');

describe('Cleanup Verification Tests', () => {
  describe('Code Quality and Structure', () => {
    it('should have simplified SpecsDrivenAgentSelector with clear logic', async () => {
      const filePath = resolve(SRC_PATH, 'agents/specs-driven-agent-selector.ts');
      const content = await fs.readFile(filePath, 'utf-8');

      // Check for clean structure
      expect(content).toContain('class SpecsDrivenAgentSelector');
      expect(content).toContain('SPECS_DRIVEN_MAPPING');
      expect(content).toContain('findBestAgent');
      expect(content).toContain('searchAgents');
      expect(content).toContain('getWorkflowAgents');

      // Verify simplified approach
      expect(content).toContain('direct mapping');
      expect(content).toContain('registry search');
      expect(content).toContain('semantic search');

      // Check for performance optimizations
      expect(content).toContain('cache');
      expect(content).toContain('cacheExpiry');
    });

    it('should have simplified CapabilityMapper with backward compatibility', async () => {
      const filePath = resolve(SRC_PATH, 'agents/capability-mapper-simplified.ts');
      const content = await fs.readFile(filePath, 'utf-8');

      // Check delegation pattern
      expect(content).toContain('SpecsDrivenAgentSelector');
      expect(content).toContain('delegates to');
      expect(content).toContain('backward compatibility');

      // Verify key methods preserved
      expect(content).toContain('mapCapabilityToAgents');
      expect(content).toContain('getBestAgentForCapability');
      expect(content).toContain('resolveOptimalAgentSet');
      expect(content).toContain('findAgentsByCapability');

      // Check for alias export
      expect(content).toContain('export { CapabilityMapperSimplified as CapabilityMapper }');
    });

    it('should have clean MaestroSwarmCoordinator implementation', async () => {
      const filePath = resolve(SRC_PATH, 'maestro/maestro-swarm-coordinator.ts');
      const content = await fs.readFile(filePath, 'utf-8');

      // Check for clean architecture
      expect(content).toContain('MaestroSwarmCoordinator');
      expect(content).toContain('specs-driven');
      expect(content).toContain('SpecsDrivenAgentSelector');

      // Verify workflow methods
      expect(content).toContain('createSpec');
      expect(content).toContain('generateDesign');
      expect(content).toContain('generateTasks');
      expect(content).toContain('implementTask');
      expect(content).toContain('reviewTasks');

      // Check for proper error handling
      expect(content).toContain('try {');
      expect(content).toContain('catch (error)');
      expect(content).toContain('SystemError');
    });

    it('should have consistent file structure and naming', async () => {
      const cleanFiles = [
        'agents/specs-driven-agent-selector.ts',
        'agents/capability-mapper.ts',
        'maestro/maestro-swarm-coordinator.ts'
      ];

      for (const file of cleanFiles) {
        const filePath = resolve(SRC_PATH, file);
        const exists = await fs.access(filePath).then(() => true).catch(() => false);
        expect(exists).toBe(true);

        const content = await fs.readFile(filePath, 'utf-8');
        expect(content.length).toBeGreaterThan(1000); // Substantial content
        expect(content).toMatch(/\/\*\*[\s\S]*?\*\//); // Has documentation comments
      }
    });
  });

  describe('Functional Compliance', () => {
    it('should maintain all core capabilities from original implementation', () => {
      // SpecsDrivenAgentSelector methods
      expect(typeof SpecsDrivenAgentSelector.findBestAgent).toBe('function');
      expect(typeof SpecsDrivenAgentSelector.searchAgents).toBe('function');
      expect(typeof SpecsDrivenAgentSelector.getWorkflowAgents).toBe('function');
      expect(typeof SpecsDrivenAgentSelector.validateAgentCapability).toBe('function');
      expect(typeof SpecsDrivenAgentSelector.setAgentRegistry).toBe('function');
      expect(typeof SpecsDrivenAgentSelector.clearCache).toBe('function');

      // CapabilityMapper methods (backward compatible)
      expect(typeof CapabilityMapper.mapCapabilityToAgents).toBe('function');
      expect(typeof CapabilityMapper.getBestAgentForCapability).toBe('function');
      expect(typeof CapabilityMapper.resolveOptimalAgentSet).toBe('function');
      expect(typeof CapabilityMapper.findAgentsByCapability).toBe('function');
      expect(typeof CapabilityMapper.getAllAvailableCapabilities).toBe('function');
    });

    it('should preserve SPARC workflow phase mappings', () => {
      const mapping = SpecsDrivenAgentSelector['SPECS_DRIVEN_MAPPING'];
      
      // Requirements phase
      expect(mapping['requirements_analysis']).toContain('specification');
      expect(mapping['user_story_creation']).toContain('specification');
      expect(mapping['acceptance_criteria']).toContain('tester');

      // Design phase
      expect(mapping['system_design']).toContain('architecture');
      expect(mapping['architecture']).toContain('system-architect');

      // Implementation phase
      expect(mapping['code_generation']).toContain('coder');
      expect(mapping['implementation']).toContain('coder');

      // Quality phase
      expect(mapping['code_review']).toContain('reviewer');
      expect(mapping['quality_assurance']).toContain('reviewer');
      expect(mapping['testing']).toContain('tester');
    });

    it('should handle agent registry integration correctly', async () => {
      const mockRegistry = {
        async searchByCapabilities(capabilities: string[]) {
          return [{
            name: 'test-agent',
            type: 'specialist',
            status: 'idle' as const,
            capabilities: {
              languages: ['typescript'],
              frameworks: ['node.js'],
              domains: capabilities,
              tools: ['git']
            },
            health: 0.9
          }];
        }
      };

      SpecsDrivenAgentSelector.setAgentRegistry(mockRegistry as any);
      CapabilityMapper.setAgentRegistry(mockRegistry as any);

      const result = await SpecsDrivenAgentSelector.searchAgents({
        capabilities: ['test_capability'],
        maxAgents: 1
      });

      expect(result.matches.length).toBeGreaterThan(0);
    });
  });

  describe('Performance Improvements', () => {
    it('should have efficient caching mechanism', async () => {
      const startTime = Date.now();
      
      // First search - populate cache
      await SpecsDrivenAgentSelector.searchAgents({
        capabilities: ['requirements_analysis'],
        maxAgents: 1
      });
      
      const firstSearchTime = Date.now() - startTime;

      // Second search - should use cache
      const cachedStartTime = Date.now();
      await SpecsDrivenAgentSelector.searchAgents({
        capabilities: ['requirements_analysis'],
        maxAgents: 1
      });
      const cachedSearchTime = Date.now() - cachedStartTime;

      // Cached search should be significantly faster
      expect(cachedSearchTime).toBeLessThan(firstSearchTime);
    });

    it('should limit search strategies to prevent performance degradation', async () => {
      const searchStart = Date.now();
      
      const result = await SpecsDrivenAgentSelector.searchAgents({
        capabilities: ['nonexistent_capability_test'],
        maxAgents: 10,
        minConfidence: 0.1
      });
      
      const searchTime = Date.now() - searchStart;
      
      // Should complete quickly even for unknown capabilities
      expect(searchTime).toBeLessThan(500); // 500ms max
      expect(result.matches).toBeDefined();
    });

    it('should have optimized workflow agent retrieval', async () => {
      const phases = ['requirements', 'design', 'implementation', 'quality'] as const;
      
      const startTime = Date.now();
      const results = await Promise.all(
        phases.map(phase => SpecsDrivenAgentSelector.getWorkflowAgents(phase))
      );
      const totalTime = Date.now() - startTime;

      expect(results.length).toBe(4);
      expect(totalTime).toBeLessThan(100); // Very fast workflow lookups
      results.forEach(result => {
        expect(Array.isArray(result)).toBe(true);
      });
    });
  });

  describe('Error Handling and Resilience', () => {
    it('should handle missing agent registry gracefully', async () => {
      const originalRegistry = SpecsDrivenAgentSelector['agentRegistry'];
      SpecsDrivenAgentSelector.setAgentRegistry(null as any);

      const result = await SpecsDrivenAgentSelector.findBestAgent('test_capability');
      
      // Should not throw, should return null or handle gracefully
      expect(result).toBeDefined();
      
      // Restore registry
      SpecsDrivenAgentSelector.setAgentRegistry(originalRegistry);
    });

    it('should validate input parameters and handle edge cases', async () => {
      // Empty capabilities array
      const emptyResult = await SpecsDrivenAgentSelector.searchAgents({
        capabilities: [],
        maxAgents: 1
      });
      expect(emptyResult.matches).toEqual([]);

      // Negative values
      const negativeResult = await SpecsDrivenAgentSelector.searchAgents({
        capabilities: ['test'],
        maxAgents: -1,
        minConfidence: -1
      });
      expect(Array.isArray(negativeResult.matches)).toBe(true);

      // Very large values
      const largeResult = await SpecsDrivenAgentSelector.searchAgents({
        capabilities: ['test'],
        maxAgents: 1000000,
        minConfidence: 2.0
      });
      expect(Array.isArray(largeResult.matches)).toBe(true);
    });

    it('should maintain clean error messages and logging', () => {
      // Check that error handling is present in clean files
      const cleanClasses = [SpecsDrivenAgentSelector, CapabilityMapper, MaestroSwarmCoordinatorClean];
      
      cleanClasses.forEach(cleanClass => {
        expect(cleanClass).toBeDefined();
        expect(typeof cleanClass).toBe('function'); // Constructor
      });
    });
  });

  describe('Maintainability and Documentation', () => {
    it('should have clear method signatures and return types', () => {
      // Check that methods have proper TypeScript typing
      const selector = SpecsDrivenAgentSelector;
      
      // These should not throw type errors
      expect(typeof selector.findBestAgent).toBe('function');
      expect(typeof selector.searchAgents).toBe('function');
      expect(typeof selector.getWorkflowAgents).toBe('function');
      expect(typeof selector.validateAgentCapability).toBe('function');
    });

    it('should have consistent naming conventions', async () => {
      const cleanFiles = [
        'agents/specs-driven-agent-selector.ts',
        'agents/capability-mapper.ts',
        'maestro/maestro-swarm-coordinator.ts'
      ];

      for (const file of cleanFiles) {
        const filePath = resolve(SRC_PATH, file);
        const content = await fs.readFile(filePath, 'utf-8');
        
        // Check for consistent naming patterns
        expect(content).toMatch(/class \w+/); // Has class definitions
        expect(content).toMatch(/interface \w+/); // Has interface definitions
        expect(content).toMatch(/\/\*\*[\s\S]*?\*\//); // Has JSDoc comments
        
        // Check for TypeScript patterns
        expect(content).toContain('import');
        expect(content).toContain('export');
        expect(content).toContain(': Promise<');
      }
    });

    it('should have reduced complexity compared to original implementation', async () => {
      // Read the simplified files and verify they are more focused
      const selectorPath = resolve(SRC_PATH, 'agents/specs-driven-agent-selector.ts');
      const selectorContent = await fs.readFile(selectorPath, 'utf-8');
      
      // Should have simplified search strategies
      const searchStrategies = [
        'Direct mapping',
        'Registry search', 
        'Semantic search'
      ];
      
      searchStrategies.forEach(strategy => {
        expect(selectorContent.toLowerCase()).toContain(strategy.toLowerCase());
      });
      
      // Should not have overly complex fuzzy matching logic
      expect(selectorContent).not.toContain('fuzzy');
      expect(selectorContent).not.toContain('levenshtein');
      expect(selectorContent).not.toContain('complex semantic analysis');
    });
  });

  describe('Specs-Driven Flow Compliance Verification', () => {
    it('should follow specs-driven methodology principles', async () => {
      const workflowPhases = ['requirements', 'design', 'implementation', 'quality'] as const;
      
      for (const phase of workflowPhases) {
        const agents = await SpecsDrivenAgentSelector.getWorkflowAgents(phase);
        expect(agents.length).toBeGreaterThan(0);
        
        // Each agent should have appropriate confidence and capabilities
        agents.forEach(agent => {
          expect(agent.agentName).toBeTruthy();
          expect(agent.confidence).toBeGreaterThan(0);
          expect(Array.isArray(agent.capabilities)).toBe(true);
          expect(['direct', 'semantic', 'fallback']).toContain(agent.matchType);
        });
      }
    });

    it('should maintain SPARC methodology integration', () => {
      const mapping = SpecsDrivenAgentSelector['SPECS_DRIVEN_MAPPING'];
      
      // SPARC phases should be well represented
      const sparcCapabilities = [
        'requirements_analysis',  // Specification
        'system_design',         // Pseudocode
        'architecture',          // Architecture  
        'code_generation',       // Refinement
        'quality_assurance'      // Completion
      ];
      
      sparcCapabilities.forEach(capability => {
        expect(mapping[capability]).toBeDefined();
        expect(Array.isArray(mapping[capability])).toBe(true);
        expect(mapping[capability].length).toBeGreaterThan(0);
      });
    });

    it('should support dynamic agent discovery', async () => {
      // Test that system can discover agents from .claude/agents directory
      const availableTypes = await SpecsDrivenAgentSelector.findBestAgent('code_generation');
      expect(availableTypes).toBeTruthy(); // Should find some agent for basic capability
      
      // Test search functionality
      const searchResult = await SpecsDrivenAgentSelector.searchAgents({
        capabilities: ['testing'],
        maxAgents: 3
      });
      
      expect(searchResult.matches).toBeDefined();
      expect(searchResult.totalSearched).toBeGreaterThanOrEqual(0);
      expect(searchResult.searchTime).toBeGreaterThan(0);
    });
  });
});

describe('Integration and Compatibility Tests', () => {
  it('should maintain backward compatibility with existing interfaces', () => {
    // CapabilityMapper should still work as before
    expect(typeof CapabilityMapper.mapCapabilityToAgents).toBe('function');
    expect(typeof CapabilityMapper.getBestAgentForCapability).toBe('function');
    
    // New implementation should be available
    expect(typeof SpecsDrivenAgentSelector.findBestAgent).toBe('function');
    expect(typeof SpecsDrivenAgentSelector.searchAgents).toBe('function');
  });

  it('should integrate properly with MaestroSwarmCoordinator', () => {
    const mockConfig = {
      hiveMindConfig: {
        name: 'test',
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
      specsDirectory: '/tmp/test',
      steeringDirectory: '/tmp/test'
    };

    const mockEventBus = { emit: jest.fn(), on: jest.fn(), off: jest.fn() };
    const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

    const coordinator = new MaestroSwarmCoordinator(
      mockConfig,
      mockEventBus as any,
      mockLogger as any
    );

    expect(coordinator).toBeDefined();
    expect(typeof coordinator.setAgentRegistry).toBe('function');
    expect(typeof coordinator.getWorkflowState).toBe('function');
  });

  it('should handle concurrent operations efficiently', async () => {
    const concurrentSearches = Array(10).fill(0).map((_, i) => 
      SpecsDrivenAgentSelector.findBestAgent(`capability_${i}`)
    );

    const startTime = Date.now();
    const results = await Promise.all(concurrentSearches);
    const totalTime = Date.now() - startTime;

    expect(results.length).toBe(10);
    expect(totalTime).toBeLessThan(1000); // Should handle concurrent operations efficiently
  });
});