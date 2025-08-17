/**
 * Graphiti Hive-Mind Integration
 * 
 * Extends the hive-mind system with Graphiti's knowledge graph capabilities
 * for enhanced collective intelligence and persistent shared memory.
 * 
 * @author Mattae Cooper [research@aegntic.ai]
 * @since v2.0.0-alpha
 */

import { EventEmitter } from 'node:events';
import type { Logger } from '../core/logger.js';
import { GraphitiMemoryAdapter, GraphitiNode, GraphitiEdge } from '../memory/graphiti-adapter.js';
import type { 
  HiveMindSession,
  CollectiveIntelligence,
  Pattern,
  Insight 
} from './hive-mind-integration.js';

export interface GraphitiHiveConfig {
  enableGraphMemory: boolean;
  enablePatternExtraction: boolean;
  enableInsightGeneration: boolean;
  enableKnowledgeEvolution: boolean;
  graphGroupPrefix: string;
  minPatternConfidence: number;
  insightGenerationInterval: number;
  knowledgeEvolutionThreshold: number;
  // Configurable sync intervals (implementing ruvnet's suggestion)
  patternSyncInterval: number;
  knowledgeEvolutionInterval: number;
  hiveMindSyncInterval: number;
}

export interface GraphitiPattern extends Pattern {
  graphNodes: string[]; // UUIDs of related nodes
  graphEdges: string[]; // UUIDs of related edges
  evolutionHistory: PatternEvolution[];
}

export interface PatternEvolution {
  timestamp: Date;
  confidence: number;
  frequency: number;
  modifiedBy: string;
  reason: string;
}

export interface GraphitiInsight extends Insight {
  supportingNodes: GraphitiNode[];
  supportingEdges: GraphitiEdge[];
  derivedPatterns: GraphitiPattern[];
  knowledgeScore: number;
}

export class GraphitiHiveIntegration extends EventEmitter {
  private graphitiAdapter: GraphitiMemoryAdapter;
  private config: GraphitiHiveConfig;
  private logger?: Logger;
  private patternCache: Map<string, GraphitiPattern> = new Map();
  private insightCache: Map<string, GraphitiInsight> = new Map();
  private evolutionTimer?: NodeJS.Timeout;

  constructor(
    graphitiAdapter: GraphitiMemoryAdapter,
    config: Partial<GraphitiHiveConfig> = {},
    logger?: Logger
  ) {
    super();
    this.graphitiAdapter = graphitiAdapter;
    this.config = {
      enableGraphMemory: true,
      enablePatternExtraction: true,
      enableInsightGeneration: true,
      enableKnowledgeEvolution: true,
      graphGroupPrefix: 'hivemind_',
      minPatternConfidence: 0.7,
      insightGenerationInterval: 60000, // 1 minute
      knowledgeEvolutionThreshold: 0.8,
      // Configurable sync intervals (implementing ruvnet's suggestion)
      patternSyncInterval: 30000, // 30 seconds
      knowledgeEvolutionInterval: 120000, // 2 minutes
      hiveMindSyncInterval: 45000, // 45 seconds
      ...config
    };
    this.logger = logger;

    this.initialize();
  }

  private initialize(): void {
    // Listen for hive-mind events
    this.graphitiAdapter.on('memory:added', this.handleMemoryAdded.bind(this));
    this.graphitiAdapter.on('hivemind:share', this.handleHiveMindShare.bind(this));

    // Start insight generation if enabled
    if (this.config.enableInsightGeneration) {
      this.startInsightGeneration();
    }

    // Start knowledge evolution if enabled
    if (this.config.enableKnowledgeEvolution) {
      this.startKnowledgeEvolution();
    }

    this.logger?.info('Graphiti hive-mind integration initialized');
  }

  /**
   * Store hive-mind session data in Graphiti
   */
  async storeHiveMindSession(session: HiveMindSession): Promise<void> {
    if (!this.config.enableGraphMemory) return;

    const sessionData = {
      id: session.id,
      swarmId: session.swarmId,
      participants: session.participants,
      status: session.status,
      startTime: session.startTime.toISOString(),
      lastSync: session.lastSync.toISOString(),
      sharedMemory: Array.from(session.sharedMemory.entries()),
      intelligence: this.serializeCollectiveIntelligence(session.collectiveIntelligence)
    };

    await this.graphitiAdapter.addMemory(
      `HiveMind Session: ${session.id}`,
      JSON.stringify(sessionData, null, 2),
      {
        source: 'json',
        sourceDescription: 'Hive-mind session data',
        groupId: `${this.config.graphGroupPrefix}${session.swarmId}`,
        metadata: {
          type: 'hivemind_session',
          swarmId: session.swarmId,
          participantCount: session.participants.length
        }
      }
    );

    this.emit('session:stored', session.id);
  }

  /**
   * Extract patterns from collective knowledge
   */
  async extractPatterns(
    swarmId: string,
    timeWindow?: { start: Date; end: Date }
  ): Promise<GraphitiPattern[]> {
    if (!this.config.enablePatternExtraction) return [];

    // Search for relevant nodes and facts
    const searchResults = await this.graphitiAdapter.searchNodes(
      'pattern behavior performance',
      {
        groupIds: [`${this.config.graphGroupPrefix}${swarmId}`],
        maxNodes: 100
      }
    );

    const patterns: GraphitiPattern[] = [];

    // Analyze nodes for patterns
    if (searchResults.nodes) {
      const patternGroups = this.groupNodesByPattern(searchResults.nodes);
      
      for (const [patternType, nodes] of patternGroups.entries()) {
        if (nodes.length >= 3) { // Minimum nodes for a pattern
          const pattern: GraphitiPattern = {
            id: `pattern_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: patternType as any,
            description: this.generatePatternDescription(nodes),
            frequency: nodes.length,
            confidence: this.calculatePatternConfidence(nodes),
            contexts: nodes.map(n => n.entityType),
            impact: this.assessPatternImpact(nodes),
            discoveredBy: [swarmId],
            lastSeen: new Date(),
            graphNodes: nodes.map(n => n.uuid),
            graphEdges: [],
            evolutionHistory: [{
              timestamp: new Date(),
              confidence: 0.5,
              frequency: nodes.length,
              modifiedBy: swarmId,
              reason: 'Initial discovery'
            }]
          };

          if (pattern.confidence >= this.config.minPatternConfidence) {
            patterns.push(pattern);
            this.patternCache.set(pattern.id, pattern);
          }
        }
      }
    }

    this.emit('patterns:extracted', patterns);
    return patterns;
  }

  /**
   * Generate insights from patterns and knowledge
   */
  async generateInsights(swarmId: string): Promise<GraphitiInsight[]> {
    if (!this.config.enableInsightGeneration) return [];

    const patterns = Array.from(this.patternCache.values())
      .filter(p => p.discoveredBy.includes(swarmId));

    const insights: GraphitiInsight[] = [];

    // Analyze patterns for insights
    for (const pattern of patterns) {
      if (pattern.confidence >= 0.8 && pattern.frequency >= 5) {
        // Fetch supporting evidence from Graphiti
        const supportingData = await this.fetchSupportingEvidence(pattern);

        const insight: GraphitiInsight = {
          id: `insight_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          category: this.categorizeInsight(pattern),
          title: this.generateInsightTitle(pattern),
          description: this.generateInsightDescription(pattern, supportingData),
          evidence: [pattern],
          confidence: pattern.confidence,
          applicability: [swarmId],
          contributingAgents: pattern.discoveredBy,
          timestamp: new Date(),
          supportingNodes: supportingData.nodes,
          supportingEdges: supportingData.edges,
          derivedPatterns: [pattern],
          knowledgeScore: this.calculateKnowledgeScore(pattern, supportingData)
        };

        insights.push(insight);
        this.insightCache.set(insight.id, insight);

        // Store insight in Graphiti
        await this.storeInsight(insight, swarmId);
      }
    }

    this.emit('insights:generated', insights);
    return insights;
  }

  /**
   * Evolve knowledge based on new information
   */
  async evolveKnowledge(swarmId: string): Promise<void> {
    if (!this.config.enableKnowledgeEvolution) return;

    // Get recent episodes
    const recentEpisodes = await this.graphitiAdapter.getRecentEpisodes(
      `${this.config.graphGroupPrefix}${swarmId}`,
      50
    );

    // Update patterns based on new evidence
    for (const pattern of this.patternCache.values()) {
      const relevantEpisodes = recentEpisodes.filter(ep =>
        ep.content.toLowerCase().includes(pattern.type.toLowerCase())
      );

      if (relevantEpisodes.length > 0) {
        // Update pattern confidence and frequency
        const oldConfidence = pattern.confidence;
        pattern.frequency += relevantEpisodes.length;
        pattern.confidence = this.recalculateConfidence(pattern, relevantEpisodes);
        pattern.lastSeen = new Date();

        // Track evolution
        if (Math.abs(pattern.confidence - oldConfidence) > 0.1) {
          pattern.evolutionHistory.push({
            timestamp: new Date(),
            confidence: pattern.confidence,
            frequency: pattern.frequency,
            modifiedBy: swarmId,
            reason: `Updated based on ${relevantEpisodes.length} new episodes`
          });

          this.emit('pattern:evolved', pattern);
        }
      }
    }

    // Prune low-confidence patterns
    for (const [id, pattern] of this.patternCache.entries()) {
      if (pattern.confidence < 0.3) {
        this.patternCache.delete(id);
        this.emit('pattern:pruned', id);
      }
    }
  }

  /**
   * Query collective knowledge
   */
  async queryCollectiveKnowledge(
    query: string,
    swarmIds: string[]
  ): Promise<{
    patterns: GraphitiPattern[];
    insights: GraphitiInsight[];
    facts: string[];
    relevance: number;
  }> {
    // Search across multiple swarm groups
    const groupIds = swarmIds.map(id => `${this.config.graphGroupPrefix}${id}`);
    
    // Search nodes and facts
    const [nodeResults, factResults] = await Promise.all([
      this.graphitiAdapter.searchNodes(query, { groupIds, maxNodes: 50 }),
      this.graphitiAdapter.searchFacts(query, { groupIds, maxFacts: 100 })
    ]);

    // Find relevant patterns
    const relevantPatterns = Array.from(this.patternCache.values())
      .filter(p => 
        p.description.toLowerCase().includes(query.toLowerCase()) ||
        p.discoveredBy.some(id => swarmIds.includes(id))
      )
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10);

    // Find relevant insights
    const relevantInsights = Array.from(this.insightCache.values())
      .filter(i =>
        i.description.toLowerCase().includes(query.toLowerCase()) ||
        i.applicability.some(id => swarmIds.includes(id))
      )
      .sort((a, b) => b.knowledgeScore - a.knowledgeScore)
      .slice(0, 5);

    const avgRelevance = (
      (nodeResults.relevanceScore || 0) +
      (factResults.relevanceScore || 0)
    ) / 2;

    return {
      patterns: relevantPatterns,
      insights: relevantInsights,
      facts: factResults.facts || [],
      relevance: avgRelevance
    };
  }

  // Private helper methods

  private handleMemoryAdded(episode: any): void {
    this.emit('graphiti:memory:added', episode);
  }

  private handleHiveMindShare(data: any): void {
    this.emit('graphiti:hivemind:shared', data);
  }

  private serializeCollectiveIntelligence(ci: CollectiveIntelligence): any {
    return {
      patterns: Array.from(ci.patterns.entries()),
      insights: Array.from(ci.insights.entries()),
      decisions: Array.from(ci.decisions.entries()),
      predictions: Array.from(ci.predictions.entries())
    };
  }

  private groupNodesByPattern(nodes: GraphitiNode[]): Map<string, GraphitiNode[]> {
    const groups = new Map<string, GraphitiNode[]>();
    
    for (const node of nodes) {
      const patternType = this.detectPatternType(node);
      const existing = groups.get(patternType) || [];
      existing.push(node);
      groups.set(patternType, existing);
    }
    
    return groups;
  }

  private detectPatternType(node: GraphitiNode): string {
    // Simple pattern detection based on node content
    const content = JSON.stringify(node).toLowerCase();
    
    if (content.includes('error') || content.includes('fail')) return 'error';
    if (content.includes('success') || content.includes('complete')) return 'success';
    if (content.includes('perform') || content.includes('speed')) return 'performance';
    
    return 'behavioral';
  }

  private generatePatternDescription(nodes: GraphitiNode[]): string {
    const commonWords = this.findCommonWords(nodes.map(n => n.name));
    return `Pattern detected across ${nodes.length} nodes involving: ${commonWords.join(', ')}`;
  }

  private calculatePatternConfidence(nodes: GraphitiNode[]): number {
    // Simple confidence calculation based on node count and consistency
    const baseConfidence = Math.min(nodes.length / 10, 1);
    const consistency = this.calculateConsistency(nodes);
    return (baseConfidence + consistency) / 2;
  }

  private calculateConsistency(nodes: GraphitiNode[]): number {
    // Check how similar the nodes are
    if (nodes.length < 2) return 1;
    
    const types = new Set(nodes.map(n => n.entityType));
    return 1 - (types.size / nodes.length);
  }

  private assessPatternImpact(nodes: GraphitiNode[]): 'low' | 'medium' | 'high' {
    if (nodes.length > 20) return 'high';
    if (nodes.length > 10) return 'medium';
    return 'low';
  }

  private categorizeInsight(pattern: GraphitiPattern): 'optimization' | 'coordination' | 'quality' | 'efficiency' {
    switch (pattern.type) {
      case 'performance': return 'optimization';
      case 'behavioral': return 'coordination';
      case 'error': return 'quality';
      default: return 'efficiency';
    }
  }

  private generateInsightTitle(pattern: GraphitiPattern): string {
    return `${pattern.type.charAt(0).toUpperCase() + pattern.type.slice(1)} Pattern Insight`;
  }

  private generateInsightDescription(
    pattern: GraphitiPattern,
    supportingData: { nodes: GraphitiNode[]; edges: GraphitiEdge[] }
  ): string {
    return `Analysis of ${pattern.frequency} occurrences reveals a ${pattern.type} pattern ` +
           `with ${(pattern.confidence * 100).toFixed(1)}% confidence. ` +
           `Supported by ${supportingData.nodes.length} nodes and ${supportingData.edges.length} relationships.`;
  }

  private async fetchSupportingEvidence(
    pattern: GraphitiPattern
  ): Promise<{ nodes: GraphitiNode[]; edges: GraphitiEdge[] }> {
    // Fetch nodes and edges related to the pattern
    const nodes: GraphitiNode[] = [];
    const edges: GraphitiEdge[] = [];
    
    // In a real implementation, this would fetch from Graphiti
    // For now, return cached data
    for (const nodeId of pattern.graphNodes) {
      const cachedNode = this.graphitiAdapter['nodeCache'].get(nodeId);
      if (cachedNode) nodes.push(cachedNode);
    }
    
    return { nodes, edges };
  }

  private calculateKnowledgeScore(
    pattern: GraphitiPattern,
    supportingData: { nodes: GraphitiNode[]; edges: GraphitiEdge[] }
  ): number {
    const patternScore = pattern.confidence * pattern.frequency;
    const evidenceScore = (supportingData.nodes.length + supportingData.edges.length) / 100;
    const evolutionScore = pattern.evolutionHistory.length / 10;
    
    return Math.min((patternScore + evidenceScore + evolutionScore) / 3, 1);
  }

  private async storeInsight(insight: GraphitiInsight, swarmId: string): Promise<void> {
    await this.graphitiAdapter.addMemory(
      `Insight: ${insight.title}`,
      JSON.stringify(insight, null, 2),
      {
        source: 'json',
        sourceDescription: 'Generated insight from collective intelligence',
        groupId: `${this.config.graphGroupPrefix}${swarmId}`,
        metadata: {
          type: 'insight',
          category: insight.category,
          knowledgeScore: insight.knowledgeScore
        }
      }
    );
  }

  private findCommonWords(strings: string[]): string[] {
    if (strings.length === 0) return [];
    
    const wordCounts = new Map<string, number>();
    
    for (const str of strings) {
      const words = str.toLowerCase().split(/\s+/);
      for (const word of words) {
        if (word.length > 3) {
          wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
        }
      }
    }
    
    return Array.from(wordCounts.entries())
      .filter(([_, count]) => count >= strings.length / 2)
      .map(([word]) => word)
      .slice(0, 5);
  }

  private recalculateConfidence(
    pattern: GraphitiPattern,
    newEvidence: any[]
  ): number {
    const oldConfidence = pattern.confidence;
    const evidenceWeight = Math.min(newEvidence.length / 10, 0.3);
    return Math.min(oldConfidence + evidenceWeight, 1);
  }

  private startInsightGeneration(): void {
    setInterval(async () => {
      // Generate insights for active swarms
      this.emit('insight:generation:started');
    }, this.config.insightGenerationInterval);
  }

  private startKnowledgeEvolution(): void {
    this.evolutionTimer = setInterval(async () => {
      // Evolve knowledge for active swarms
      this.emit('knowledge:evolution:started');
    }, 60000); // Every minute
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    if (this.evolutionTimer) {
      clearInterval(this.evolutionTimer);
    }
    
    this.patternCache.clear();
    this.insightCache.clear();
    
    this.emit('destroyed');
  }
}

export default GraphitiHiveIntegration;