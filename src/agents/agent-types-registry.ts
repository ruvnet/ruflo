/**
 * Dynamic Agent Types Registry
 * Provides integration with Claude Code's subagent system
 */

export interface SubAgent {
  name: string;
  description: string;
  tools?: string[];
  category?: string;
}

export interface AgentTypeMappings {
  [key: string]: string;
}

/**
 * Registry for managing dynamic agent types from Claude Code
 */
export class AgentTypesRegistry {
  private availableAgents: Set<string> = new Set();
  private subAgents: Map<string, SubAgent> = new Map();
  private fallbackMappings: AgentTypeMappings = {};
  private lastRefresh: number = 0;
  private cacheExpiry: number = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.initializeFallbackMappings();
    this.initializeKnownAgents();
  }

  /**
   * Initialize fallback mappings for common agent types
   */
  private initializeFallbackMappings(): void {
    this.fallbackMappings = {
      // Missing agent types to available ones
      analyst: 'code-analyzer',
      coordinator: 'adaptive-coordinator',
      
      // Common aliases
      developer: 'coder',
      programmer: 'coder',
      reviewer: 'code-review-swarm',
      tester: 'tdd-london-swarm',
      researcher: 'researcher',
      architect: 'system-architect',
      documenter: 'api-docs',
      monitor: 'performance-benchmarker',
      optimizer: 'perf-analyzer',
      specialist: 'general-purpose',
    };
  }

  /**
   * Initialize known agent types from CLAUDE.md configuration
   */
  private initializeKnownAgents(): void {
    const knownAgents = [
      // Core Development Agents
      'general-purpose', 'refinement', 'pseudocode', 'architecture', 'specification',
      'ml-developer', 'base-template-generator', 'swarm-init', 'smart-agent',
      'sparc-coord', 'pr-manager', 'perf-analyzer', 'task-orchestrator',
      'sparc-coder', 'memory-coordinator', 'migration-planner', 
      'swarm-memory-manager', 'collective-intelligence-coordinator',
      'consensus-builder', 'repo-architect', 'issue-tracker',
      'project-board-sync', 'github-modes', 'code-review-swarm',
      'workflow-automation', 'multi-repo-swarm', 'sync-coordinator',
      'release-swarm', 'release-manager', 'swarm-pr', 'swarm-issue',
      'system-architect', 'production-validator', 'tdd-london-swarm',
      'mobile-dev', 'backend-dev', 'code-analyzer', 'coder', 'planner',
      'tester', 'researcher', 'reviewer', 'cicd-engineer', 'api-docs',
      
      // Coordination Agents
      'adaptive-coordinator', 'byzantine-coordinator', 'mesh-coordinator',
      'hierarchical-coordinator', 'gossip-coordinator', 'performance-benchmarker',
      'raft-manager', 'crdt-synchronizer', 'security-manager', 'quorum-manager',
    ];

    knownAgents.forEach(agent => {
      this.availableAgents.add(agent);
      this.subAgents.set(agent, {
        name: agent,
        description: `${agent.replace(/-/g, ' ')} agent`,
        category: this.categorizeAgent(agent),
      });
    });
  }

  /**
   * Categorize agent based on name patterns
   */
  private categorizeAgent(agentName: string): string {
    if (agentName.includes('coord') || agentName.includes('manager')) {
      return 'coordination';
    }
    if (agentName.includes('dev') || agentName.includes('coder')) {
      return 'development';
    }
    if (agentName.includes('test') || agentName.includes('tdd')) {
      return 'testing';
    }
    if (agentName.includes('github') || agentName.includes('pr') || agentName.includes('issue')) {
      return 'github';
    }
    if (agentName.includes('swarm') || agentName.includes('multi')) {
      return 'swarm';
    }
    if (agentName.includes('performance') || agentName.includes('perf')) {
      return 'performance';
    }
    if (agentName.includes('security') || agentName.includes('byzantine')) {
      return 'security';
    }
    return 'general';
  }

  /**
   * Refresh available agents list (placeholder for future dynamic loading)
   */
  async refreshAvailableAgents(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRefresh < this.cacheExpiry) {
      return; // Cache still valid
    }

    try {
      // In future versions, this could query Claude Code's subagent system
      // For now, we rely on the known agents list
      this.lastRefresh = now;
    } catch (error) {
      console.warn('Failed to refresh agent types:', error);
    }
  }

  /**
   * Get all available agent types
   */
  async getAvailableAgentTypes(): Promise<string[]> {
    await this.refreshAvailableAgents();
    return Array.from(this.availableAgents).sort();
  }

  /**
   * Get available agent types as enum values for validation
   */
  async getAgentTypeEnum(): Promise<string[]> {
    return await this.getAvailableAgentTypes();
  }

  /**
   * Validate if an agent type is available
   */
  async isValidAgentType(agentType: string): Promise<boolean> {
    await this.refreshAvailableAgents();
    return this.availableAgents.has(agentType);
  }

  /**
   * Resolve agent type with fallback mapping
   */
  async resolveAgentType(requestedType: string): Promise<string> {
    await this.refreshAvailableAgents();
    
    // Direct match
    if (this.availableAgents.has(requestedType)) {
      return requestedType;
    }

    // Fallback mapping
    const fallbackType = this.fallbackMappings[requestedType];
    if (fallbackType && this.availableAgents.has(fallbackType)) {
      return fallbackType;
    }

    // Default fallback
    return 'general-purpose';
  }

  /**
   * Get agent information
   */
  async getAgentInfo(agentType: string): Promise<SubAgent | null> {
    await this.refreshAvailableAgents();
    return this.subAgents.get(agentType) || null;
  }

  /**
   * Get agents by category
   */
  async getAgentsByCategory(category: string): Promise<SubAgent[]> {
    await this.refreshAvailableAgents();
    return Array.from(this.subAgents.values())
      .filter(agent => agent.category === category);
  }

  /**
   * Add custom agent type (for extensibility)
   */
  addCustomAgentType(agent: SubAgent): void {
    this.availableAgents.add(agent.name);
    this.subAgents.set(agent.name, agent);
  }

  /**
   * Get validation error with suggestions
   */
  async getValidationError(requestedType: string): Promise<{
    error: string;
    suggestions: string[];
    fallback: string;
  }> {
    await this.refreshAvailableAgents();
    
    const suggestions = Array.from(this.availableAgents)
      .filter(type => type.includes(requestedType) || requestedType.includes(type))
      .slice(0, 5);

    const fallback = await this.resolveAgentType(requestedType);

    return {
      error: `Agent type '${requestedType}' not found. Available agents: ${Array.from(this.availableAgents).join(', ')}`,
      suggestions,
      fallback,
    };
  }
}

// Singleton instance
export const agentTypesRegistry = new AgentTypesRegistry();