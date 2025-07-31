/**
 * Specs-Driven Agent Selector
 * 
 * Simplified, clean implementation for selecting agents based on capabilities
 * following specs-driven flow principles. Replaces the complex CapabilityMapper
 * with a more streamlined approach.
 */

import { agentLoader, type AgentDefinition } from './agent-loader.js';
import type { AgentRegistry } from './agent-registry.js';
import type { AgentState } from '../swarm/types.js';

export interface AgentMatch {
  agentName: string;
  confidence: number;
  capabilities: string[];
  matchType: 'direct' | 'semantic' | 'fallback';
  reason: string;
}

export interface SpecsDrivenSearchCriteria {
  capabilities: string[];
  maxAgents?: number;
  minConfidence?: number;
  preferredTypes?: string[];
  excludeTypes?: string[];
}

export interface SpecsDrivenSearchResult {
  matches: AgentMatch[];
  totalSearched: number;
  searchTime: number;
  criteria: SpecsDrivenSearchCriteria;
}

/**
 * Clean, specs-driven agent selector
 * Focuses on capability-based selection with clear, understandable logic
 */
export class SpecsDrivenAgentSelector {
  private static agentRegistry: AgentRegistry | null = null;
  private static cache = new Map<string, AgentMatch[]>();
  private static cacheExpiry = 300000; // 5 minutes

  // Core SPARC workflow capability mappings - simplified and clear
  private static readonly SPECS_DRIVEN_MAPPING: Record<string, string[]> = {
    // Requirements phase
    'requirements_analysis': ['specification', 'researcher', 'planner'],
    'user_story_creation': ['specification', 'planner'],
    'acceptance_criteria': ['specification', 'tester'],
    
    // Design phase
    'system_design': ['architecture', 'system-architect'],
    'architecture': ['architecture', 'system-architect'],
    'specs_driven_design': ['specification', 'architecture'],
    
    // Implementation phase
    'code_generation': ['coder', 'sparc-coder'],
    'implementation': ['coder', 'backend-dev', 'mobile-dev'],
    
    // Quality phase
    'code_review': ['reviewer', 'code-analyzer'],
    'quality_assurance': ['reviewer', 'tester', 'code-analyzer'],
    'testing': ['tester', 'tdd-london-swarm'],
    
    // Management
    'task_management': ['planner', 'task-orchestrator'],
    'workflow_orchestration': ['sparc-coordinator', 'task-orchestrator'],
    
    // Documentation
    'documentation_generation': ['api-docs'],
    'technical_writing': ['api-docs', 'specification']
  };

  /**
   * Initialize with agent registry for enhanced functionality
   */
  static setAgentRegistry(registry: AgentRegistry): void {
    this.agentRegistry = registry;
  }

  /**
   * Find best agent for a single capability - main entry point
   */
  static async findBestAgent(capability: string): Promise<string | null> {
    const results = await this.searchAgents({
      capabilities: [capability],
      maxAgents: 1,
      minConfidence: 0.5
    });

    return results.matches.length > 0 ? results.matches[0].agentName : null;
  }

  /**
   * Search for agents matching given criteria
   */
  static async searchAgents(criteria: SpecsDrivenSearchCriteria): Promise<SpecsDrivenSearchResult> {
    const startTime = Date.now();

    // Check cache first
    const cacheKey = this.generateCacheKey(criteria);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return {
        matches: cached,
        totalSearched: cached.length,
        searchTime: Date.now() - startTime,
        criteria
      };
    }

    const allMatches: AgentMatch[] = [];
    const processedAgents = new Set<string>();

    // Process each capability
    for (const capability of criteria.capabilities) {
      const matches = await this.findAgentsForCapability(capability);
      
      for (const match of matches) {
        if (!processedAgents.has(match.agentName)) {
          // Apply filters
          if (this.passesFilters(match, criteria)) {
            allMatches.push(match);
            processedAgents.add(match.agentName);
          }
        }
      }
    }

    // Sort by confidence and apply limits
    const filteredMatches = allMatches
      .filter(m => m.confidence >= (criteria.minConfidence || 0.3))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, criteria.maxAgents || 10);

    // Cache results
    this.cache.set(cacheKey, filteredMatches);

    return {
      matches: filteredMatches,
      totalSearched: allMatches.length,
      searchTime: Date.now() - startTime,
      criteria
    };
  }

  /**
   * Find agents for a specific capability using multiple strategies
   */
  private static async findAgentsForCapability(capability: string): Promise<AgentMatch[]> {
    const matches: AgentMatch[] = [];

    // Strategy 1: Direct mapping (highest confidence)
    const directMatches = await this.findDirectMatches(capability);
    matches.push(...directMatches);

    // Strategy 2: Registry search (medium confidence)
    if (this.agentRegistry && matches.length < 3) {
      const registryMatches = await this.findRegistryMatches(capability);
      matches.push(...registryMatches);
    }

    // Strategy 3: Semantic search (lower confidence)
    if (matches.length < 2) {
      const semanticMatches = await this.findSemanticMatches(capability);
      matches.push(...semanticMatches);
    }

    return matches;
  }

  /**
   * Find direct matches using specs-driven mapping
   */
  private static async findDirectMatches(capability: string): Promise<AgentMatch[]> {
    const matches: AgentMatch[] = [];
    const mappedAgents = this.SPECS_DRIVEN_MAPPING[capability] || [];

    for (const agentName of mappedAgents) {
      if (await agentLoader.isValidAgentType(agentName)) {
        const agent = await agentLoader.getAgent(agentName);
        if (agent) {
          matches.push({
            agentName,
            confidence: 0.95,
            capabilities: this.extractCapabilities(agent),
            matchType: 'direct',
            reason: `Direct mapping for ${capability}`
          });
        }
      }
    }

    return matches;
  }

  /**
   * Find matches using agent registry
   */
  private static async findRegistryMatches(capability: string): Promise<AgentMatch[]> {
    if (!this.agentRegistry) return [];

    try {
      const registryAgents = await this.agentRegistry.searchByCapabilities([capability]);
      return registryAgents.map(agent => ({
        agentName: agent.name,
        confidence: 0.8,
        capabilities: this.extractCapabilitiesFromRegistryAgent(agent),
        matchType: 'semantic' as const,
        reason: `Registry search for ${capability}`
      }));
    } catch (error) {
      console.warn('Registry search failed:', error);
      return [];
    }
  }

  /**
   * Find matches using semantic search
   */
  private static async findSemanticMatches(capability: string): Promise<AgentMatch[]> {
    const searchResults = await agentLoader.searchAgents(capability);
    
    return searchResults
      .slice(0, 2) // Limit semantic matches
      .map(agent => ({
        agentName: agent.name,
        confidence: this.calculateSemanticConfidence(capability, agent),
        capabilities: this.extractCapabilities(agent),
        matchType: 'fallback' as const,
        reason: `Semantic match for ${capability}`
      }));
  }

  /**
   * Extract capabilities from agent definition
   */
  private static extractCapabilities(agent: AgentDefinition): string[] {
    const capabilities: string[] = [];

    // Handle different capability structures
    if (Array.isArray(agent.capabilities)) {
      capabilities.push(...agent.capabilities);
    } else if (agent.capabilities && typeof agent.capabilities === 'object') {
      const caps = agent.capabilities as any;
      if (caps.allowed_tools) {
        capabilities.push(...caps.allowed_tools.map((tool: string) => tool.toLowerCase()));
      }
      if (caps.domains) {
        capabilities.push(...caps.domains);
      }
    }

    // Add derived capabilities
    if (agent.type) capabilities.push(agent.type);
    capabilities.push(agent.name);

    // Extract from description
    const description = agent.description.toLowerCase();
    const keywords = ['api', 'code', 'test', 'review', 'design', 'analysis', 'documentation'];
    keywords.forEach(keyword => {
      if (description.includes(keyword)) {
        capabilities.push(keyword);
      }
    });

    return [...new Set(capabilities)];
  }

  /**
   * Extract capabilities from registry agent
   */
  private static extractCapabilitiesFromRegistryAgent(agent: AgentState): string[] {
    return [
      ...agent.capabilities.languages,
      ...agent.capabilities.frameworks,
      ...agent.capabilities.domains,
      ...agent.capabilities.tools,
      agent.type,
      agent.name
    ];
  }

  /**
   * Calculate semantic confidence score
   */
  private static calculateSemanticConfidence(capability: string, agent: AgentDefinition): number {
    const agentText = `${agent.name} ${agent.description} ${agent.type || ''}`.toLowerCase();
    const capabilityWords = capability.toLowerCase().split(/[_\s-]+/);
    
    let matches = 0;
    for (const word of capabilityWords) {
      if (word.length > 2 && agentText.includes(word)) {
        matches++;
      }
    }

    return Math.min(0.7, matches / capabilityWords.length);
  }

  /**
   * Check if agent match passes filters
   */
  private static passesFilters(match: AgentMatch, criteria: SpecsDrivenSearchCriteria): boolean {
    // Preferred types filter
    if (criteria.preferredTypes?.length) {
      const agentType = match.capabilities.find(cap => 
        criteria.preferredTypes!.includes(cap)
      );
      if (!agentType) return false;
    }

    // Exclude types filter
    if (criteria.excludeTypes?.length) {
      const hasExcludedType = match.capabilities.some(cap =>
        criteria.excludeTypes!.includes(cap)
      );
      if (hasExcludedType) return false;
    }

    return true;
  }

  /**
   * Generate cache key for search criteria
   */
  private static generateCacheKey(criteria: SpecsDrivenSearchCriteria): string {
    return JSON.stringify({
      capabilities: criteria.capabilities.sort(),
      maxAgents: criteria.maxAgents,
      minConfidence: criteria.minConfidence,
      preferredTypes: criteria.preferredTypes?.sort(),
      excludeTypes: criteria.excludeTypes?.sort()
    });
  }

  /**
   * Clear cache
   */
  static clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get specs-driven workflow agents for a complete SPARC phase
   */
  static async getWorkflowAgents(phase: 'requirements' | 'design' | 'implementation' | 'quality'): Promise<AgentMatch[]> {
    const phaseCapabilities = {
      requirements: ['requirements_analysis', 'user_story_creation', 'acceptance_criteria'],
      design: ['system_design', 'architecture', 'specs_driven_design'],
      implementation: ['code_generation', 'implementation'],
      quality: ['code_review', 'quality_assurance', 'testing']
    };

    const capabilities = phaseCapabilities[phase] || [];
    const result = await this.searchAgents({
      capabilities,
      maxAgents: 5,
      minConfidence: 0.5
    });

    return result.matches;
  }

  /**
   * Validate if an agent supports a capability
   */
  static async validateAgentCapability(agentName: string, capability: string): Promise<boolean> {
    const agent = await agentLoader.getAgent(agentName);
    if (!agent) return false;

    const capabilities = this.extractCapabilities(agent);
    return capabilities.includes(capability) || 
           capabilities.some(cap => cap.includes(capability.toLowerCase()));
  }
}