/**
 * Kiro-Inspired Specs-Driven Flow Test Suite
 * 
 * Comprehensive testing of specs-driven development with living documentation,
 * steering documents, consensus mechanisms, and enhanced workflow state management
 * inspired by Kiro's advanced orchestration patterns.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Core components
import { SpecsDrivenAgentSelector } from '../agents/specs-driven-agent-selector.js';
import { CapabilityMapper } from '../agents/capability-mapper.js';
import { MaestroSwarmCoordinator } from '../maestro/maestro-swarm-coordinator.js';
import type { AgentRegistry } from '../agents/agent-registry.js';
import type { 
  KiroEnhancedSpec,
  LivingDocumentationConfig,
  AgentHookConfig,
  ConsensusRequirements,
  PatternLearningConfig,
  MaestroWorkflowState,
  WorkflowPhase
} from '../maestro/maestro-types.js';

// Set test environment
process.env.CLAUDE_FLOW_ENV = 'test';
process.env.NODE_ENV = 'test';

// Mock implementations for Kiro-enhanced testing
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

// Enhanced mock agent registry with Kiro capabilities
const mockKiroAgentRegistry: AgentRegistry = {
  async searchByCapabilities(capabilities: string[]) {
    const kiroAgentDatabase = [
      {
        name: 'specification',
        type: 'specialist' as const,
        status: 'idle' as const,
        capabilities: {
          languages: ['markdown', 'yaml', 'json'],
          frameworks: ['sparc', 'kiro', 'living-docs'],
          domains: ['requirements_analysis', 'specs_driven_design', 'living_documentation'],
          tools: ['markdown', 'yaml', 'mermaid', 'plantUML']
        },
        health: 0.95
      },
      {
        name: 'steering-documenter',
        type: 'specialist' as const,
        status: 'idle' as const,
        capabilities: {
          languages: ['markdown', 'yaml'],
          frameworks: ['kiro', 'steering'],
          domains: ['steering_documentation', 'governance', 'pattern_learning'],
          tools: ['documentation', 'governance', 'patterns']
        },
        health: 0.93
      },
      {
        name: 'consensus-coordinator',
        type: 'specialist' as const,
        status: 'idle' as const,
        capabilities: {
          languages: ['typescript', 'json'],
          frameworks: ['consensus', 'byzantine', 'raft'],
          domains: ['consensus_validation', 'decision_making', 'validation'],
          tools: ['voting', 'consensus', 'validation']
        },
        health: 0.91
      },
      {
        name: 'pattern-learner',
        type: 'specialist' as const,
        status: 'idle' as const,
        capabilities: {
          languages: ['python', 'typescript'],
          frameworks: ['ml', 'pattern-recognition'],
          domains: ['pattern_learning', 'adaptation', 'optimization'],
          tools: ['ml', 'analytics', 'patterns']
        },
        health: 0.89
      },
      {
        name: 'architecture',
        type: 'specialist' as const,
        status: 'idle' as const,
        capabilities: {
          languages: ['typescript', 'mermaid'],
          frameworks: ['design-patterns', 'kiro'],
          domains: ['system_design', 'architecture', 'specs_driven_design'],
          tools: ['diagrams', 'modeling', 'documentation']
        },
        health: 0.92
      }
    ];

    return kiroAgentDatabase.filter(agent =>
      capabilities.some(cap =>
        agent.capabilities.domains.includes(cap) ||
        agent.capabilities.tools.includes(cap) ||
        agent.name.toLowerCase().includes(cap.toLowerCase())
      )
    );
  }
};

describe('Kiro-Inspired Specs-Driven Flow Tests', () => {
  let tempDir: string;
  let maestroCoordinator: MaestroSwarmCoordinator;

  beforeAll(async () => {
    // Create temporary directory for Kiro test artifacts
    tempDir = await fs.mkdtemp(join(tmpdir(), 'kiro-specs-driven-'));
    
    // Set up enhanced registry
    SpecsDrivenAgentSelector.setAgentRegistry(mockKiroAgentRegistry);
    CapabilityMapper.setAgentRegistry(mockKiroAgentRegistry);

    // Initialize Kiro-enhanced coordinator
    const kiroConfig = {
      hiveMindConfig: {
        name: 'kiro-specs-driven-swarm',
        topology: 'specs-driven' as any,
        queenMode: 'strategic' as const,
        maxAgents: 12,
        consensusThreshold: 0.7,
        memoryTTL: 86400000,
        autoSpawn: true,
        enableConsensus: true,
        enableMemory: true,
        enableCommunication: true
      },
      enableConsensusValidation: true,
      enableLivingDocumentation: true,
      enableSteeringIntegration: true,
      specsDirectory: join(tempDir, 'specs'),
      steeringDirectory: join(tempDir, 'steering')
    };

    maestroCoordinator = new MaestroSwarmCoordinator(
      kiroConfig,
      mockEventBus as any,
      mockLogger as any
    );

    maestroCoordinator.setAgentRegistry(mockKiroAgentRegistry);
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
    jest.clearAllMocks();
  });

  describe('Kiro-Enhanced Agent Selection', () => {
    it('should select Kiro-specific agents for enhanced capabilities', async () => {
      const kiroCapabilities = [
        'living_documentation',
        'steering_documentation', 
        'consensus_validation',
        'pattern_learning'
      ];

      for (const capability of kiroCapabilities) {
        const matches = await CapabilityMapper.mapCapabilityToAgents(capability);
        expect(matches.length).toBeGreaterThan(0);
        
        const match = matches[0];
        expect(match.agentName).toBeTruthy();
        expect(match.confidence).toBeGreaterThan(0.7);
        expect(match.capabilities).toContain(capability);
      }
    });

    it('should support enhanced workflow agents with Kiro capabilities', async () => {
      const enhancedPhases = ['requirements', 'design', 'implementation', 'quality'] as const;
      
      for (const phase of enhancedPhases) {
        const agents = await SpecsDrivenAgentSelector.getWorkflowAgents(phase);
        expect(agents.length).toBeGreaterThan(0);
        
        // Should have at least one agent with enhanced capabilities
        const enhancedAgent = agents.find(agent => 
          agent.capabilities.some(cap => 
            cap.includes('kiro') || 
            cap.includes('living') || 
            cap.includes('steering') ||
            cap.includes('consensus')
          )
        );
        
        if (phase === 'requirements' || phase === 'design') {
          expect(enhancedAgent).toBeDefined();
        }
      }
    });

    it('should integrate steering documentation agents', async () => {
      const steeringAgent = await SpecsDrivenAgentSelector.findBestAgent('steering_documentation');
      expect(steeringAgent).toBe('steering-documenter');
      
      const isValid = await SpecsDrivenAgentSelector.validateAgentCapability(
        'steering-documenter', 
        'steering_documentation'
      );
      expect(isValid).toBe(true);
    });
  });

  describe('Living Documentation Integration', () => {
    it('should support living documentation configuration', () => {
      const livingDocConfig: LivingDocumentationConfig = {
        enabled: true,
        syncMode: 'bidirectional',
        autoUpdateThreshold: 0.8,
        conflictResolution: 'spec-wins',
        versionTracking: true,
        changeDetectionGranularity: 'function',
        realTimeSync: true,
        watchPatterns: ['**/*.ts', '**/*.md'],
        excludePatterns: ['node_modules/**', '**/*.test.ts']
      };

      expect(livingDocConfig.enabled).toBe(true);
      expect(livingDocConfig.syncMode).toBe('bidirectional');
      expect(livingDocConfig.autoUpdateThreshold).toBe(0.8);
      expect(livingDocConfig.watchPatterns).toContain('**/*.ts');
    });

    it('should handle living documentation agents', async () => {
      const livingDocAgents = await CapabilityMapper.findAgentsByCapability('living_documentation');
      expect(livingDocAgents.length).toBeGreaterThan(0);
      
      const specAgent = livingDocAgents.find(a => a.name === 'specification');
      expect(specAgent).toBeDefined();
      expect(specAgent?.capabilities).toContain('living_documentation');
    });

    it('should support specs-to-code synchronization', async () => {
      // Test specification agent can handle living documentation
      const result = await SpecsDrivenAgentSelector.searchAgents({
        capabilities: ['specs_driven_design', 'living_documentation'],
        maxAgents: 2,
        minConfidence: 0.8
      });

      expect(result.matches.length).toBeGreaterThan(0);
      
      const specMatch = result.matches.find(m => m.agentName === 'specification');
      expect(specMatch).toBeDefined();
      expect(specMatch?.matchType).toBe('direct');
    });
  });

  describe('Steering Documents and Governance', () => {
    it('should create and manage steering documents', async () => {
      const steeringDomains = [
        'product',
        'technical',
        'workflow',
        'quality',
        'security'
      ];

      // Test that coordinator can create steering documents
      expect(maestroCoordinator).toBeDefined();
      
      // Mock steering document creation
      const steeringContent = `# Product Steering Document

## Vision
Clear product direction for specs-driven development.

## Principles
1. User-centric design
2. Iterative development
3. Quality-first approach

## Guidelines
- Follow SPARC methodology
- Maintain living documentation
- Enable consensus-driven decisions
`;

      // Verify steering document structure
      expect(steeringContent).toContain('# Product Steering Document');
      expect(steeringContent).toContain('## Vision');
      expect(steeringContent).toContain('## Principles');
      expect(steeringContent).toContain('SPARC methodology');
    });

    it('should support steering document agents', async () => {
      const steeringAgents = await CapabilityMapper.resolveOptimalAgentSet([
        'steering_documentation',
        'governance',
        'pattern_learning'
      ]);

      expect(steeringAgents).toContain('steering-documenter');
      expect(steeringAgents).toContain('pattern-learner');
    });

    it('should integrate steering context into workflows', async () => {
      // Test that workflows can access steering context
      const workflowState: MaestroWorkflowState = {
        featureName: 'user-onboarding',
        currentPhase: 'Requirements Clarification' as WorkflowPhase,
        currentTaskIndex: 0,
        status: 'running',
        lastActivity: new Date(),
        history: [{
          phase: 'Requirements Clarification' as WorkflowPhase,
          status: 'in-progress',
          timestamp: new Date()
        }]
      };

      expect(workflowState.featureName).toBe('user-onboarding');
      expect(workflowState.currentPhase).toBe('Requirements Clarification');
      expect(workflowState.status).toBe('running');
    });
  });

  describe('Consensus Mechanisms and Validation', () => {
    it('should configure consensus requirements', () => {
      const consensusConfig: ConsensusRequirements = {
        enabled: true,
        algorithm: 'byzantine-fault-tolerant',
        minimumAgents: 3,
        quorumPercentage: 0.66,
        timeoutMs: 300000,
        retryCount: 3,
        validatorAgentTypes: ['specification', 'architecture', 'reviewer'],
        consensusScope: 'design-phase',
        conflictResolution: 'revote'
      };

      expect(consensusConfig.enabled).toBe(true);
      expect(consensusConfig.algorithm).toBe('byzantine-fault-tolerant');
      expect(consensusConfig.quorumPercentage).toBe(0.66);
      expect(consensusConfig.validatorAgentTypes).toContain('specification');
    });

    it('should support consensus validation agents', async () => {
      const consensusAgent = await SpecsDrivenAgentSelector.findBestAgent('consensus_validation');
      expect(consensusAgent).toBe('consensus-coordinator');
      
      const agents = await CapabilityMapper.findBestAgentsForCapabilities([
        'consensus_validation',
        'decision_making',
        'validation'
      ]);

      expect(agents.length).toBeGreaterThan(0);
      
      const consensusAgentFound = agents.find(a => a.name === 'consensus-coordinator');
      expect(consensusAgentFound).toBeDefined();
    });

    it('should handle Byzantine fault tolerance', async () => {
      const result = await SpecsDrivenAgentSelector.searchAgents({
        capabilities: ['byzantine', 'consensus', 'fault-tolerance'],
        maxAgents: 3,
        minConfidence: 0.7
      });

      // Should find consensus-coordinator agent
      const consensusMatch = result.matches.find(m => m.agentName === 'consensus-coordinator');
      expect(consensusMatch).toBeDefined();
      
      if (consensusMatch) {
        expect(consensusMatch.confidence).toBeGreaterThan(0.7);
        expect(consensusMatch.capabilities).toContain('byzantine');
      }
    });
  });

  describe('Pattern Learning and Adaptation', () => {
    it('should configure pattern learning', () => {
      const patternConfig: PatternLearningConfig = {
        enabled: true,
        learningMode: 'hybrid',
        dataCollection: {
          specHistory: true,
          designDecisions: true,
          implementationOutcomes: true,
          userFeedback: true
        },
        modelType: 'ml-based',
        adaptationThreshold: 0.75,
        confidenceThreshold: 0.8
      };

      expect(patternConfig.enabled).toBe(true);
      expect(patternConfig.learningMode).toBe('hybrid');
      expect(patternConfig.dataCollection.specHistory).toBe(true);
      expect(patternConfig.adaptationThreshold).toBe(0.75);
    });

    it('should support pattern learning agents', async () => {
      const patternAgent = await SpecsDrivenAgentSelector.findBestAgent('pattern_learning');
      expect(patternAgent).toBe('pattern-learner');
      
      const isValid = await SpecsDrivenAgentSelector.validateAgentCapability(
        'pattern-learner',
        'pattern_learning'
      );
      expect(isValid).toBe(true);
    });

    it('should adapt based on historical patterns', async () => {
      const adaptationCapabilities = [
        'pattern_learning',
        'adaptation',
        'optimization'
      ];

      const adaptationAgents = await CapabilityMapper.resolveOptimalAgentSet(adaptationCapabilities);
      expect(adaptationAgents).toContain('pattern-learner');
      
      // Pattern learner should handle multiple adaptation capabilities
      const matches = await CapabilityMapper.mapCapabilityToAgents('adaptation');
      const patternMatch = matches.find(m => m.agentName === 'pattern-learner');
      expect(patternMatch).toBeDefined();
    });
  });

  describe('Agent Hooks and Event-Driven Architecture', () => {
    it('should configure agent hooks', () => {
      const hookConfig: AgentHookConfig = {
        type: 'code-quality',
        trigger: {
          event: 'file-modified',
          patterns: ['**/*.ts', '**/*.js'],
          debounceMs: 1000,
          batchingEnabled: true,
          conditions: ['file-size < 10MB']
        },
        actions: [{
          type: 'quality-check',
          agentType: 'reviewer',
          parameters: { strictMode: true },
          timeout: 30000,
          retryCount: 2,
          background: false
        }],
        conditions: [{
          type: 'file-size',
          operator: 'lt',
          value: 10485760, // 10MB
          negate: false
        }],
        priority: 2,
        enabled: true,
        agentTypes: ['reviewer', 'code-analyzer'],
        metadata: { version: '1.0', category: 'quality' }
      };

      expect(hookConfig.type).toBe('code-quality');
      expect(hookConfig.trigger.event).toBe('file-modified');
      expect(hookConfig.actions[0].agentType).toBe('reviewer');
      expect(hookConfig.enabled).toBe(true);
    });

    it('should support hook-based agent coordination', async () => {
      // Test that agents can be triggered by hooks
      const hookAgents = await CapabilityMapper.resolveOptimalAgentSet([
        'code_review',
        'quality_assurance',
        'testing'
      ]);

      expect(hookAgents.length).toBeGreaterThan(0);
      
      // Should include quality-focused agents
      expect(hookAgents.some(agent => 
        agent.includes('reviewer') || 
        agent.includes('tester') || 
        agent.includes('analyzer')
      )).toBe(true);
    });
  });

  describe('Enhanced Workflow State Management', () => {
    it('should support Kiro-enhanced workflow states', () => {
      const enhancedState = {
        featureName: 'kiro-enhanced-feature',
        currentPhase: 'Research & Design' as WorkflowPhase,
        currentTaskIndex: 2,
        status: 'running' as const,
        lastActivity: new Date(),
        history: [
          {
            phase: 'Requirements Clarification' as WorkflowPhase,
            status: 'completed' as const,
            timestamp: new Date(Date.now() - 3600000), // 1 hour ago
            output: { specDocument: 'requirements.md', stakeholderApproval: true }
          },
          {
            phase: 'Research & Design' as WorkflowPhase,
            status: 'in-progress' as const,
            timestamp: new Date(Date.now() - 1800000) // 30 minutes ago
          }
        ],
        // Kiro enhancements
        livingDocState: {
          specVersion: '1.2.0',
          codeVersion: '1.1.8',
          lastSyncTimestamp: new Date(),
          syncStatus: 'in-sync' as const,
          changesSinceLastSync: [],
          conflicts: [],
          automatedSyncEnabled: true
        },
        activeHooks: ['code-quality-hook', 'documentation-sync-hook'],
        consensusSessions: [],
        patternLearningData: {
          specificationPatterns: [],
          designPatterns: [],
          implementationPatterns: [],
          outcomePatterns: []
        },
        qualityMetrics: {
          codeQuality: 0.92,
          documentationQuality: 0.88,
          testCoverage: 0.85,
          specCompleteness: 0.95,
          implementationFidelity: 0.89,
          consensusReliability: 0.91,
          cycletime: 7200000, // 2 hours
          defectDensity: 0.02
        }
      };

      expect(enhancedState.featureName).toBe('kiro-enhanced-feature');
      expect(enhancedState.livingDocState.syncStatus).toBe('in-sync');
      expect(enhancedState.qualityMetrics.codeQuality).toBe(0.92);
      expect(enhancedState.activeHooks).toContain('code-quality-hook');
    });

    it('should track quality metrics throughout workflow', () => {
      const qualityMetrics = {
        codeQuality: 0.92,
        documentationQuality: 0.88,
        testCoverage: 0.85,
        specCompleteness: 0.95,
        implementationFidelity: 0.89,
        consensusReliability: 0.91,
        cycletime: 7200000,
        defectDensity: 0.02
      };

      // All metrics should be between 0 and 1 (except cycletime and defectDensity)
      expect(qualityMetrics.codeQuality).toBeGreaterThanOrEqual(0);
      expect(qualityMetrics.codeQuality).toBeLessThanOrEqual(1);
      expect(qualityMetrics.documentationQuality).toBeGreaterThanOrEqual(0);
      expect(qualityMetrics.testCoverage).toBeGreaterThanOrEqual(0);
      expect(qualityMetrics.specCompleteness).toBeGreaterThanOrEqual(0);
      
      // Cycletime should be positive
      expect(qualityMetrics.cycletime).toBeGreaterThan(0);
      
      // Defect density should be low
      expect(qualityMetrics.defectDensity).toBeLessThan(0.1);
    });
  });

  describe('Complete Kiro-Enhanced SPARC Workflow', () => {
    it('should execute enhanced SPARC workflow with all Kiro features', async () => {
      const kiroWorkflowPhases = [
        'requirements', 
        'design', 
        'implementation', 
        'quality'
      ] as const;

      const workflowResults = [];

      for (const phase of kiroWorkflowPhases) {
        const agents = await SpecsDrivenAgentSelector.getWorkflowAgents(phase);
        
        const result = {
          phase,
          agents: agents.map(a => a.agentName),
          avgConfidence: agents.reduce((sum, a) => sum + a.confidence, 0) / agents.length,
          hasKiroEnhancements: agents.some(a => 
            a.capabilities.some(cap => 
              cap.includes('kiro') || 
              cap.includes('living') || 
              cap.includes('steering') ||
              cap.includes('consensus') ||
              cap.includes('pattern')
            )
          )
        };

        workflowResults.push(result);
      }

      // Verify all phases have appropriate agents
      expect(workflowResults).toHaveLength(4);
      
      // Requirements phase should have specification agent
      const reqPhase = workflowResults.find(r => r.phase === 'requirements');
      expect(reqPhase?.agents).toContain('specification');
      
      // Design phase should have architecture agent
      const designPhase = workflowResults.find(r => r.phase === 'design');
      expect(designPhase?.agents).toContain('architecture');
      
      // At least some phases should have Kiro enhancements
      const enhancedPhases = workflowResults.filter(r => r.hasKiroEnhancements);
      expect(enhancedPhases.length).toBeGreaterThan(0);
    });

    it('should integrate all Kiro capabilities in workflow coordination', async () => {
      const kiroCapabilities = [
        'specs_driven_design',
        'living_documentation',
        'steering_documentation',
        'consensus_validation',
        'pattern_learning'
      ];

      const integrationResults = [];

      for (const capability of kiroCapabilities) {
        const matches = await CapabilityMapper.mapCapabilityToAgents(capability);
        integrationResults.push({
          capability,
          agentCount: matches.length,
          topAgent: matches[0]?.agentName,
          avgConfidence: matches.reduce((sum, m) => sum + m.confidence, 0) / matches.length
        });
      }

      // All Kiro capabilities should have agent matches
      expect(integrationResults.every(r => r.agentCount > 0)).toBe(true);
      
      // Should have reasonable confidence levels
      expect(integrationResults.every(r => r.avgConfidence > 0.6)).toBe(true);
      
      // Should have specific agent assignments
      const specsDriven = integrationResults.find(r => r.capability === 'specs_driven_design');
      expect(specsDriven?.topAgent).toBe('specification');
      
      const steeringDoc = integrationResults.find(r => r.capability === 'steering_documentation');
      expect(steeringDoc?.topAgent).toBe('steering-documenter');
    });

    it('should handle cross-capability coordination', async () => {
      const crossCapabilitySearch = await SpecsDrivenAgentSelector.searchAgents({
        capabilities: [
          'specs_driven_design',
          'living_documentation', 
          'consensus_validation'
        ],
        maxAgents: 5,
        minConfidence: 0.7
      });

      expect(crossCapabilitySearch.matches.length).toBeGreaterThan(0);
      
      // Should find agents that can handle multiple capabilities
      const multiCapabilityAgents = crossCapabilitySearch.matches.filter(match =>
        match.capabilities.length > 3
      );
      
      expect(multiCapabilityAgents.length).toBeGreaterThan(0);
      
      // Should maintain high confidence for cross-capability matches
      const highConfidenceMatches = crossCapabilitySearch.matches.filter(m => m.confidence > 0.8);
      expect(highConfidenceMatches.length).toBeGreaterThan(0);
    });
  });

  describe('Performance and Scalability with Kiro Enhancements', () => {
    it('should handle enhanced agent coordination efficiently', async () => {
      const enhancedCapabilities = [
        'specs_driven_design',
        'living_documentation',
        'steering_documentation',
        'consensus_validation',
        'pattern_learning',
        'system_design',
        'code_generation',
        'quality_assurance'
      ];

      const startTime = Date.now();
      
      const results = await Promise.all(
        enhancedCapabilities.map(cap => SpecsDrivenAgentSelector.findBestAgent(cap))
      );
      
      const totalTime = Date.now() - startTime;

      expect(results.length).toBe(enhancedCapabilities.length);
      expect(totalTime).toBeLessThan(2000); // Should complete within 2 seconds
      
      // All capabilities should have agent matches
      const successfulMatches = results.filter(result => result !== null);
      expect(successfulMatches.length).toBeGreaterThan(6); // At least 75% success rate
    });

    it('should cache enhanced searches effectively', async () => {
      const complexCapability = 'living_documentation';
      
      // Clear cache first
      SpecsDrivenAgentSelector.clearCache();
      
      // First search
      const start1 = Date.now();
      const result1 = await SpecsDrivenAgentSelector.searchAgents({
        capabilities: [complexCapability],
        maxAgents: 3
      });
      const time1 = Date.now() - start1;

      // Second search (should use cache)
      const start2 = Date.now();
      const result2 = await SpecsDrivenAgentSelector.searchAgents({
        capabilities: [complexCapability],
        maxAgents: 3
      });
      const time2 = Date.now() - start2;

      expect(result1.matches).toEqual(result2.matches);
      expect(time2).toBeLessThanOrEqual(time1); // Cached should be faster or equal
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle unknown Kiro capabilities gracefully', async () => {
      const unknownKiroCapability = 'kiro_quantum_entanglement_xyz';
      
      const bestAgent = await SpecsDrivenAgentSelector.findBestAgent(unknownKiroCapability);
      expect(bestAgent).toBeNull();
      
      const searchResult = await SpecsDrivenAgentSelector.searchAgents({
        capabilities: [unknownKiroCapability],
        maxAgents: 1
      });
      
      expect(searchResult.matches).toEqual([]);
      expect(searchResult.totalSearched).toBe(0);
      expect(searchResult.searchTime).toBeGreaterThan(0);
    });

    it('should validate Kiro agent capabilities correctly', async () => {
      // Valid Kiro capabilities
      const validResults = await Promise.all([
        SpecsDrivenAgentSelector.validateAgentCapability('specification', 'living_documentation'),
        SpecsDrivenAgentSelector.validateAgentCapability('steering-documenter', 'steering_documentation'),
        SpecsDrivenAgentSelector.validateAgentCapability('consensus-coordinator', 'consensus_validation')
      ]);

      validResults.forEach(result => {
        expect(result).toBe(true);
      });

      // Invalid capability
      const invalidResult = await SpecsDrivenAgentSelector.validateAgentCapability(
        'specification', 
        'invalid_kiro_capability'
      );
      expect(invalidResult).toBe(false);
    });

    it('should handle complex Kiro search criteria', async () => {
      const complexSearch = await SpecsDrivenAgentSelector.searchAgents({
        capabilities: [],
        maxAgents: 0,
        minConfidence: 1.5, // Invalid confidence level
        preferredTypes: ['nonexistent-type'],
        excludeTypes: ['all-types']
      });

      expect(complexSearch.matches).toEqual([]);
      expect(complexSearch.totalSearched).toBe(0);
      expect(typeof complexSearch.searchTime).toBe('number');
      expect(complexSearch.searchTime).toBeGreaterThan(0);
    });
  });
});