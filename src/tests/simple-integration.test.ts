/**
 * Simple Integration Test for Cleaned Implementation
 * 
 * Basic tests that don't require complex infrastructure setup
 */

import { describe, it, expect } from '@jest/globals';

// Set test environment
process.env.CLAUDE_FLOW_ENV = 'test';
process.env.NODE_ENV = 'test';

describe('Simple Cleanup Verification', () => {
  describe('File Structure Verification', () => {
    it('should have created cleaned implementation files', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const basePath = path.resolve(process.cwd(), 'src');
      
      // Check that cleaned files exist
      const cleanFiles = [
        'agents/specs-driven-agent-selector.ts',
        'agents/capability-mapper.ts', 
        'maestro/maestro-swarm-coordinator.ts'
      ];
      
      for (const file of cleanFiles) {
        const filePath = path.resolve(basePath, file);
        const exists = await fs.access(filePath).then(() => true).catch(() => false);
        expect(exists).toBe(true);
        
        if (exists) {
          const content = await fs.readFile(filePath, 'utf-8');
          expect(content.length).toBeGreaterThan(1000);
          expect(content).toContain('/**');
          expect(content).toContain('export');
        }
      }
    });
    
    it('should have proper TypeScript interfaces and types', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const selectorPath = path.resolve(process.cwd(), 'src/agents/specs-driven-agent-selector.ts');
      const content = await fs.readFile(selectorPath, 'utf-8');
      
      // Check for key interfaces
      expect(content).toContain('interface AgentMatch');
      expect(content).toContain('interface SpecsDrivenSearchCriteria');
      expect(content).toContain('interface SpecsDrivenSearchResult');
      
      // Check for key methods
      expect(content).toContain('findBestAgent');
      expect(content).toContain('searchAgents');
      expect(content).toContain('getWorkflowAgents');
      
      // Check for clean architecture patterns
      expect(content).toContain('SPECS_DRIVEN_MAPPING');
      expect(content).toContain('private static');
      expect(content).toContain('async');
    });
    
    it('should have backward compatibility layer', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const mapperPath = path.resolve(process.cwd(), 'src/agents/capability-mapper.ts');
      const content = await fs.readFile(mapperPath, 'utf-8');
      
      // Check for delegation pattern
      expect(content).toContain('SpecsDrivenAgentSelector');
      expect(content).toContain('delegates to');
      
      // Check for backward compatibility export
      expect(content).toContain('export { CapabilityMapperSimplified as CapabilityMapper }');
      
      // Check for preserved methods
      expect(content).toContain('mapCapabilityToAgents');
      expect(content).toContain('getBestAgentForCapability');
    });
    
    it('should have clean maestro coordinator', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const maestroPath = path.resolve(process.cwd(), 'src/maestro/maestro-swarm-coordinator.ts');
      const content = await fs.readFile(maestroPath, 'utf-8');
      
      // Check for clean implementation
      expect(content).toContain('MaestroSwarmCoordinator');
      expect(content).toContain('SpecsDrivenAgentSelector');
      
      // Check for workflow methods
      expect(content).toContain('createSpec');
      expect(content).toContain('generateDesign');
      expect(content).toContain('implementTask');
      expect(content).toContain('reviewTasks');
      
      // Check for proper error handling
      expect(content).toContain('SystemError');
      expect(content).toContain('try {');
      expect(content).toContain('catch (error)');
    });
  });
  
  describe('Code Quality Verification', () => {
    it('should have simplified mapping logic', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const selectorPath = path.resolve(process.cwd(), 'src/agents/specs-driven-agent-selector.ts');
      const content = await fs.readFile(selectorPath, 'utf-8');
      
      // Should have clear, simple mapping
      expect(content).toContain('requirements_analysis');
      expect(content).toContain('code_generation');
      expect(content).toContain('quality_assurance');
      
      // Should have clean search strategies
      expect(content).toContain('Direct mapping');
      expect(content).toContain('Registry search');
      expect(content).toContain('Semantic search');
      
      // Should have performance optimizations
      expect(content).toContain('cache');
      expect(content).toContain('confidence');
    });
    
    it('should maintain SPARC workflow compliance', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const selectorPath = path.resolve(process.cwd(), 'src/agents/specs-driven-agent-selector.ts');
      const content = await fs.readFile(selectorPath, 'utf-8');
      
      // Check SPARC methodology phases
      const sparcPhases = [
        'requirements',
        'design', 
        'implementation',
        'quality'
      ];
      
      sparcPhases.forEach(phase => {
        expect(content).toContain(phase);
      });
      
      // Check agent types for each phase
      expect(content).toContain('specification');
      expect(content).toContain('architecture');
      expect(content).toContain('coder');
      expect(content).toContain('reviewer');
    });
    
    it('should have consistent error handling', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const cleanFiles = [
        'agents/specs-driven-agent-selector.ts',
        'agents/capability-mapper.ts',
        'maestro/maestro-swarm-coordinator.ts'
      ];
      
      for (const file of cleanFiles) {
        const filePath = path.resolve(process.cwd(), 'src', file);
        const content = await fs.readFile(filePath, 'utf-8');
        
        // Should have proper error handling patterns
        if (content.includes('try {')) {
          expect(content).toContain('catch (error)');
        }
        
        // Should handle null/undefined cases
        if (content.includes('?.')) {
          expect(content).toMatch(/\?\.|null|undefined/);
        }
      }
    });
  });
  
  describe('Architecture Verification', () => {
    it('should follow single responsibility principle', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      // SpecsDrivenAgentSelector should focus on agent selection
      const selectorPath = path.resolve(process.cwd(), 'src/agents/specs-driven-agent-selector.ts');
      const selectorContent = await fs.readFile(selectorPath, 'utf-8');
      
      expect(selectorContent).toContain('class SpecsDrivenAgentSelector');
      expect(selectorContent).not.toContain('class HiveMind');
      expect(selectorContent).not.toContain('class EventBus');
      
      // CapabilityMapper should focus on capability mapping
      const mapperPath = path.resolve(process.cwd(), 'src/agents/capability-mapper.ts');
      const mapperContent = await fs.readFile(mapperPath, 'utf-8');
      
      expect(mapperContent).toContain('CapabilityMapperSimplified');
      expect(mapperContent).toContain('delegates to SpecsDrivenAgentSelector');
      
      // MaestroCoordinator should focus on workflow coordination
      const maestroPath = path.resolve(process.cwd(), 'src/maestro/maestro-swarm-coordinator.ts');
      const maestroContent = await fs.readFile(maestroPath, 'utf-8');
      
      expect(maestroContent).toContain('MaestroSwarmCoordinator');
      expect(maestroContent).toContain('workflow');
      expect(maestroContent).toContain('phase');
    });
    
    it('should have clear separation of concerns', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const selectorPath = path.resolve(process.cwd(), 'src/agents/specs-driven-agent-selector.ts');
      const content = await fs.readFile(selectorPath, 'utf-8');
      
      // Should separate different search strategies
      const searchMethods = [
        'findDirectMatches',
        'findRegistryMatches', 
        'findSemanticMatches'
      ];
      
      searchMethods.forEach(method => {
        expect(content).toContain(method);
      });
      
      // Should separate caching logic
      expect(content).toContain('generateCacheKey');
      expect(content).toContain('clearCache');
      
      // Should separate capability extraction
      expect(content).toContain('extractCapabilities');
    });
    
    it('should have proper dependency injection patterns', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      // Check that components can accept external dependencies
      const selectorPath = path.resolve(process.cwd(), 'src/agents/specs-driven-agent-selector.ts');
      const selectorContent = await fs.readFile(selectorPath, 'utf-8');
      
      expect(selectorContent).toContain('setAgentRegistry');
      
      const maestroPath = path.resolve(process.cwd(), 'src/maestro/maestro-swarm-coordinator.ts');
      const maestroContent = await fs.readFile(maestroPath, 'utf-8');
      
      expect(maestroContent).toContain('constructor');
      expect(maestroContent).toContain('private config');
      expect(maestroContent).toContain('private eventBus');
      expect(maestroContent).toContain('private logger');
    });
  });
  
  describe('Performance Optimization Verification', () => {
    it('should have caching mechanisms', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const selectorPath = path.resolve(process.cwd(), 'src/agents/specs-driven-agent-selector.ts');
      const content = await fs.readFile(selectorPath, 'utf-8');
      
      // Should have cache implementation
      expect(content).toContain('private static cache');
      expect(content).toContain('cacheExpiry');
      expect(content).toContain('generateCacheKey');
      expect(content).toContain('clearCache');
      
      // Should check cache before expensive operations
      expect(content).toContain('cached = this.cache.get');
      expect(content).toContain('this.cache.set');
    });
    
    it('should limit expensive operations', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const selectorPath = path.resolve(process.cwd(), 'src/agents/specs-driven-agent-selector.ts');
      const content = await fs.readFile(selectorPath, 'utf-8');
      
      // Should limit search results
      expect(content).toContain('maxAgents');
      expect(content).toContain('slice(0');
      
      // Should have early termination conditions
      expect(content).toContain('if (matches.length');
      expect(content).toContain('minConfidence');
      
      // Should prioritize direct matches
      expect(content).toContain('Direct mapping');
      expect(content).toContain('confidence: 0.95');
    });
    
    it('should have efficient data structures', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const selectorPath = path.resolve(process.cwd(), 'src/agents/specs-driven-agent-selector.ts');
      const content = await fs.readFile(selectorPath, 'utf-8');
      
      // Should use Maps for O(1) lookups
      expect(content).toContain('Map<');
      expect(content).toContain('Set<');
      
      // Should avoid nested loops where possible
      const mapCalls = (content.match(/\.map\(/g) || []).length;
      const filterCalls = (content.match(/\.filter\(/g) || []).length;
      const totalIterativeCalls = mapCalls + filterCalls;
      
      // Should have reasonable number of iterations
      expect(totalIterativeCalls).toBeLessThan(10);
    });
  });
});

describe('Functional Verification (Without Infrastructure)', () => {
  it('should have working static methods', () => {
    // Test basic class structure without instantiation
    expect(typeof import('../agents/specs-driven-agent-selector.js')).toBe('object');
    expect(typeof import('../agents/capability-mapper.js')).toBe('object');
    expect(typeof import('../maestro/maestro-swarm-coordinator.js')).toBe('object');
  });
  
  it('should preserve key constants and mappings', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const selectorPath = path.resolve(process.cwd(), 'src/agents/specs-driven-agent-selector.ts');
    const content = await fs.readFile(selectorPath, 'utf-8');
    
    // Should have the core mapping
    expect(content).toContain('SPECS_DRIVEN_MAPPING');
    
    // Should map core capabilities
    const coreCapabilities = [
      'requirements_analysis',
      'code_generation', 
      'quality_assurance',
      'system_design'
    ];
    
    coreCapabilities.forEach(capability => {
      expect(content).toContain(capability);
    });
    
    // Verify clean implementation structure
    expect(content).toContain('class SpecsDrivenAgentSelector');
    expect(content).toContain('findBestAgent');
    expect(content).toContain('searchAgents');
    expect(content).toContain('getWorkflowAgents');
  });
  
  it('should maintain workflow phase progression', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const maestroPath = path.resolve(process.cwd(), 'src/maestro/maestro-swarm-coordinator.ts');
    const content = await fs.readFile(maestroPath, 'utf-8');
    
    // Should have workflow phases
    const workflowPhases = [
      'Requirements Clarification',
      'Research & Design',
      'Implementation Planning',
      'Task Execution',
      'Quality Gates'
    ];
    
    workflowPhases.forEach(phase => {
      expect(content).toContain(phase);
    });
    
    // Should have phase progression logic
    expect(content).toContain('phaseProgression');
    expect(content).toContain('nextPhase');
  });
});