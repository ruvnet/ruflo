/**
 * Simplified Capability Mapper
 * 
 * Clean, streamlined implementation that delegates to SpecsDrivenAgentSelector
 * Maintains backward compatibility while providing improved performance
 */

import { SpecsDrivenAgentSelector, type AgentMatch } from './specs-driven-agent-selector.js';
import type { AgentRegistry } from './agent-registry.js';

// Maintain interface compatibility
export interface CapabilityMatch {
  agentName: string;
  confidence: number;
  capabilities: string[];
  semanticScore?: number;
  fuzzyScore?: number;
  contextScore?: number;
}

/**
 * Simplified CapabilityMapper - delegates to SpecsDrivenAgentSelector
 */
export class CapabilityMapperSimplified {
  /**
   * Initialize with agent registry
   */
  static setAgentRegistry(registry: AgentRegistry): void {
    SpecsDrivenAgentSelector.setAgentRegistry(registry);
  }

  /**
   * Map a capability to available agents - simplified implementation
   */
  static async mapCapabilityToAgents(capability: string, context?: string): Promise<CapabilityMatch[]> {
    const result = await SpecsDrivenAgentSelector.searchAgents({
      capabilities: [capability],
      maxAgents: 5,
      minConfidence: 0.3
    });

    return result.matches.map(match => this.convertToCapabilityMatch(match, context));
  }

  /**
   * Get the best agent for a specific capability
   */
  static async getBestAgentForCapability(capability: string): Promise<string | null> {
    return await SpecsDrivenAgentSelector.findBestAgent(capability);
  }

  /**
   * Resolve multiple capabilities to optimal agent set
   */
  static async resolveOptimalAgentSet(capabilities: string[]): Promise<string[]> {
    const result = await SpecsDrivenAgentSelector.searchAgents({
      capabilities,
      maxAgents: capabilities.length * 2, // Allow multiple agents per capability
      minConfidence: 0.4
    });

    // Return unique agent names
    return [...new Set(result.matches.map(match => match.agentName))];
  }

  /**
   * Find agents by capability using registry search
   */
  static async findAgentsByCapability(capability: string): Promise<any[]> {
    const result = await SpecsDrivenAgentSelector.searchAgents({
      capabilities: [capability],
      maxAgents: 10,
      minConfidence: 0.3
    });

    // Convert to expected format (simplified)
    return result.matches.map(match => ({
      id: { id: `${match.agentName}-001`, swarmId: 'default', type: 'specialist', instance: 1 },
      name: match.agentName,
      type: 'specialist',
      status: 'idle',
      capabilities: match.capabilities,
      health: match.confidence
    }));
  }

  /**
   * Find best agents for multiple capabilities
   */
  static async findBestAgentsForCapabilities(capabilities: string[]): Promise<any[]> {
    const result = await SpecsDrivenAgentSelector.searchAgents({
      capabilities,
      maxAgents: capabilities.length,
      minConfidence: 0.5
    });

    return result.matches.map(match => ({
      id: { id: `${match.agentName}-001`, swarmId: 'default', type: 'specialist', instance: 1 },
      name: match.agentName,
      type: 'specialist',
      status: 'idle',
      capabilities: match.capabilities,
      health: match.confidence
    }));
  }

  /**
   * Validate if an agent supports a capability
   */
  static async validateAgentCapability(agentName: string, capability: string): Promise<boolean> {
    return await SpecsDrivenAgentSelector.validateAgentCapability(agentName, capability);
  }

  /**
   * Get all available capabilities from dynamic agents
   */
  static async getAllAvailableCapabilities(): Promise<string[]> {
    // Get capabilities from all workflow phases
    const phases = ['requirements', 'design', 'implementation', 'quality'] as const;
    const allCapabilities = new Set<string>();

    for (const phase of phases) {
      const agents = await SpecsDrivenAgentSelector.getWorkflowAgents(phase);
      agents.forEach(agent => {
        agent.capabilities.forEach(cap => allCapabilities.add(cap));
      });
    }

    return Array.from(allCapabilities).sort();
  }

  /**
   * Convert AgentMatch to CapabilityMatch format
   */
  private static convertToCapabilityMatch(match: AgentMatch, context?: string): CapabilityMatch {
    return {
      agentName: match.agentName,
      confidence: match.confidence,
      capabilities: match.capabilities,
      semanticScore: match.matchType === 'semantic' ? match.confidence : undefined,
      fuzzyScore: match.matchType === 'fallback' ? match.confidence : undefined,
      contextScore: context ? 0.7 : undefined
    };
  }

  /**
   * Clear any caches
   */
  static clearCache(): void {
    SpecsDrivenAgentSelector.clearCache();
  }

  // Legacy compatibility methods - simplified implementations

  /**
   * Create agent template from dynamic agent definition - simplified
   */
  static convertAgentDefinitionToTemplate(agent: any): any {
    return {
      name: agent.name,
      type: agent.type || 'specialist',
      capabilities: {
        codeGeneration: agent.capabilities?.includes('code_generation') || false,
        codeReview: agent.capabilities?.includes('code_review') || false,
        testing: agent.capabilities?.includes('testing') || false,
        documentation: agent.capabilities?.includes('documentation') || false,
        research: agent.capabilities?.includes('research') || false,
        analysis: agent.capabilities?.includes('analysis') || false,
        webSearch: false,
        apiIntegration: false,
        fileSystem: true,
        terminalAccess: false,
        languages: [],
        frameworks: [],
        domains: agent.capabilities || [],
        tools: [],
        maxConcurrentTasks: 3,
        maxMemoryUsage: 256 * 1024 * 1024,
        maxExecutionTime: 300000,
        reliability: 0.9,
        speed: 0.8,
        quality: 0.9
      },
      config: {
        autonomyLevel: 0.8,
        learningEnabled: true,
        adaptationEnabled: true,
        maxTasksPerHour: 10,
        maxConcurrentTasks: 3,
        timeoutThreshold: 300000,
        reportingInterval: 30000,
        heartbeatInterval: 10000,
        permissions: ['file-read', 'file-write'],
        trustedAgents: [],
        expertise: {},
        preferences: {
          outputFormat: 'detailed',
          verbose: false
        }
      },
      environment: {
        runtime: 'deno',
        version: '1.40.0',
        workingDirectory: `./agents/${agent.type || 'specialist'}`,
        tempDirectory: `./tmp/${agent.type || 'specialist'}`,
        logDirectory: `./logs/${agent.type || 'specialist'}`,
        apiEndpoints: {},
        credentials: {},
        availableTools: ['file-reader', 'file-writer'],
        toolConfigs: {}
      },
      startupScript: `./scripts/start-${agent.name}.ts`,
      dependencies: []
    };
  }
}

// Main export - now the simplified version is the primary implementation
export { CapabilityMapperSimplified as CapabilityMapper };
export default CapabilityMapperSimplified;