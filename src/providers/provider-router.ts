/**
 * Provider Router for Multi-Provider Query Routing
 * Implements intelligent routing based on query classification and provider capabilities
 */

import { EventEmitter } from 'events';
import { logger } from '../core/logger.js';

// Types and interfaces
export interface QueryClassification {
  type: 'research' | 'implementation' | 'analysis' | 'coordination' | 'consensus' | 'debugging';
  complexity: number; // 0.0 - 1.0
  domains: string[];
  urgency: 'low' | 'medium' | 'high' | 'critical';
  context_size: number;
  technical_depth: number; // 0.0 - 1.0
  requires_creativity: number; // 0.0 - 1.0
  estimated_tokens: number;
}

export interface ProviderCapabilities {
  gemini: {
    research: number;
    analysis: number;
    documentation: number;
    planning: number;
    architecture: number;
    creativity: number;
    cost_efficiency: number;
  };
  qwen: {
    implementation: number;
    debugging: number;
    testing: number;
    optimization: number;
    api_development: number;
    code_quality: number;
    cost_efficiency: number;
  };
  claude: {
    coordination: number;
    synthesis: number;
    consensus: number;
    tool_gating: number;
    hive_management: number;
    communication: number;
    cost_efficiency: number;
  };
}

export interface ProviderScore {
  provider: ProviderType;
  score: number;
  reasoning: string[];
  estimated_cost: number;
  estimated_time: number;
  confidence: number;
}

export interface ProviderSelection {
  primary: ProviderType;
  secondary?: ProviderType;
  requires_consensus: boolean;
  consensus_providers?: ProviderType[];
  routing_confidence: number;
  estimated_total_cost: number;
  estimated_total_time: number;
  selection_reasoning: string;
}

export interface LoadMetrics {
  current_load: number; // 0.0 - 1.0
  average_response_time: number; // milliseconds
  success_rate: number; // 0.0 - 1.0
  cost_per_query: number;
  queue_depth: number;
  last_update: Date;
}

export type ProviderType = 'gemini' | 'qwen' | 'claude';

/**
 * Intelligent router that selects optimal providers based on query characteristics
 */
export class ProviderRouter extends EventEmitter {
  private capabilities: ProviderCapabilities;
  private loadMetrics: Map<ProviderType, LoadMetrics> = new Map();
  private routingHistory: RoutingDecision[] = [];
  private learningModel: RoutingLearningModel;

  constructor() {
    super();
    
    // Initialize provider capabilities based on empirical performance data
    this.capabilities = {
      gemini: {
        research: 0.9,
        analysis: 0.85,
        documentation: 0.8,
        planning: 0.9,
        architecture: 0.75,
        creativity: 0.85,
        cost_efficiency: 0.7
      },
      qwen: {
        implementation: 0.9,
        debugging: 0.85,
        testing: 0.8,
        optimization: 0.85,
        api_development: 0.9,
        code_quality: 0.8,
        cost_efficiency: 0.8
      },
      claude: {
        coordination: 0.95,
        synthesis: 0.9,
        consensus: 0.85,
        tool_gating: 1.0,
        hive_management: 0.95,
        communication: 0.9,
        cost_efficiency: 0.75
      }
    };

    this.initializeLoadMetrics();
    this.learningModel = new RoutingLearningModel();
  }

  /**
   * Main routing method - selects optimal provider(s) for a given query
   */
  async selectOptimalProvider(
    query: string,
    classification: QueryClassification,
    constraints: RoutingConstraints = {}
  ): Promise<ProviderSelection> {
    
    logger.info('Starting provider selection', {
      query_type: classification.type,
      complexity: classification.complexity,
      domains: classification.domains
    });

    // Calculate scores for each provider
    const providerScores = await this.calculateProviderScores(classification, constraints);
    
    // Apply load balancing considerations
    const loadBalancedScores = this.applyLoadBalancing(providerScores);
    
    // Determine if consensus is required
    const requiresConsensus = this.shouldRequireConsensus(classification, loadBalancedScores);
    
    // Select final provider(s)
    const selection = await this.makeProviderSelection(
      loadBalancedScores,
      requiresConsensus,
      classification,
      constraints
    );

    // Record decision for learning
    this.recordRoutingDecision(query, classification, selection);

    this.emit('provider-selected', { classification, selection });
    
    return selection;
  }

  /**
   * Calculate capability scores for each provider based on query classification
   */
  private async calculateProviderScores(
    classification: QueryClassification,
    constraints: RoutingConstraints
  ): Promise<ProviderScore[]> {
    
    const scores: ProviderScore[] = [];

    // Score Gemini
    const geminiScore = this.calculateGeminiScore(classification);
    scores.push({
      provider: 'gemini',
      score: geminiScore.total,
      reasoning: geminiScore.reasoning,
      estimated_cost: this.estimateProviderCost('gemini', classification),
      estimated_time: this.estimateProviderTime('gemini', classification),
      confidence: geminiScore.confidence
    });

    // Score Qwen
    const qwenScore = this.calculateQwenScore(classification);
    scores.push({
      provider: 'qwen',
      score: qwenScore.total,
      reasoning: qwenScore.reasoning,
      estimated_cost: this.estimateProviderCost('qwen', classification),
      estimated_time: this.estimateProviderTime('qwen', classification),
      confidence: qwenScore.confidence
    });

    // Score Claude
    const claudeScore = this.calculateClaudeScore(classification);
    scores.push({
      provider: 'claude',
      score: claudeScore.total,
      reasoning: claudeScore.reasoning,
      estimated_cost: this.estimateProviderCost('claude', classification),
      estimated_time: this.estimateProviderTime('claude', classification),
      confidence: claudeScore.confidence
    });

    // Apply constraints (budget, time, etc.)
    return this.applyConstraints(scores, constraints);
  }

  /**
   * Calculate Gemini-specific score
   */
  private calculateGeminiScore(classification: QueryClassification): ScoringResult {
    const reasoning: string[] = [];
    let score = 0;
    
    // Base capability scoring
    switch (classification.type) {
      case 'research':
        score += this.capabilities.gemini.research * 30;
        reasoning.push('Strong research capabilities (+30)');
        break;
      case 'analysis':
        score += this.capabilities.gemini.analysis * 25;
        reasoning.push('Good analysis capabilities (+25)');
        break;
      case 'coordination':
        score += this.capabilities.gemini.planning * 15;
        reasoning.push('Moderate coordination through planning (+15)');
        break;
      default:
        score += 10;
        reasoning.push('Basic capability for task type (+10)');
    }

    // Complexity bonus for research tasks
    if (classification.type === 'research' && classification.complexity > 0.7) {
      score += 15;
      reasoning.push('Complex research task bonus (+15)');
    }

    // Domain-specific bonuses
    if (classification.domains.includes('architecture') || 
        classification.domains.includes('planning') ||
        classification.domains.includes('strategy')) {
      score += 10;
      reasoning.push('Architectural/strategic domain match (+10)');
    }

    // Context size considerations
    if (classification.context_size > 50000) {
      score += 10;
      reasoning.push('Large context handling capability (+10)');
    }

    // Creativity requirements
    if (classification.requires_creativity > 0.7) {
      score += this.capabilities.gemini.creativity * 10;
      reasoning.push('High creativity requirement match (+8-9)');
    }

    // Cost efficiency penalty for high-volume queries
    if (classification.estimated_tokens > 10000) {
      score -= (1 - this.capabilities.gemini.cost_efficiency) * 5;
      reasoning.push('Cost efficiency consideration (-1-2)');
    }

    return {
      total: Math.max(0, Math.min(100, score)),
      reasoning,
      confidence: this.calculateConfidence(score, classification, 'gemini')
    };
  }

  /**
   * Calculate Qwen-specific score
   */
  private calculateQwenScore(classification: QueryClassification): ScoringResult {
    const reasoning: string[] = [];
    let score = 0;
    
    // Base capability scoring
    switch (classification.type) {
      case 'implementation':
        score += this.capabilities.qwen.implementation * 35;
        reasoning.push('Excellent implementation capabilities (+35)');
        break;
      case 'debugging':
        score += this.capabilities.qwen.debugging * 30;
        reasoning.push('Strong debugging capabilities (+30)');
        break;
      case 'analysis':
        score += this.capabilities.qwen.optimization * 20;
        reasoning.push('Good optimization analysis (+20)');
        break;
      default:
        score += 8;
        reasoning.push('Basic capability for task type (+8)');
    }

    // Technical depth bonus
    if (classification.technical_depth > 0.7) {
      score += 15;
      reasoning.push('High technical depth requirement match (+15)');
    }

    // Domain-specific bonuses
    if (classification.domains.some(d => 
        ['api', 'coding', 'programming', 'development', 'optimization'].includes(d))) {
      score += 12;
      reasoning.push('Technical development domain match (+12)');
    }

    // Code quality considerations
    if (classification.domains.includes('testing') || 
        classification.domains.includes('quality')) {
      score += this.capabilities.qwen.code_quality * 8;
      reasoning.push('Code quality domain match (+6-7)');
    }

    // Urgency bonus for implementation tasks
    if (classification.urgency === 'high' && classification.type === 'implementation') {
      score += 8;
      reasoning.push('High urgency implementation task (+8)');
    }

    // Cost efficiency bonus
    score += this.capabilities.qwen.cost_efficiency * 5;
    reasoning.push('Good cost efficiency (+4)');

    return {
      total: Math.max(0, Math.min(100, score)),
      reasoning,
      confidence: this.calculateConfidence(score, classification, 'qwen')
    };
  }

  /**
   * Calculate Claude-specific score
   */
  private calculateClaudeScore(classification: QueryClassification): ScoringResult {
    const reasoning: string[] = [];
    let score = 0;
    
    // Base capability scoring
    switch (classification.type) {
      case 'coordination':
        score += this.capabilities.claude.coordination * 35;
        reasoning.push('Excellent coordination capabilities (+35)');
        break;
      case 'consensus':
        score += this.capabilities.claude.consensus * 30;
        reasoning.push('Strong consensus building (+30)');
        break;
      case 'analysis':
        score += this.capabilities.claude.synthesis * 25;
        reasoning.push('Good synthesis and analysis (+25)');
        break;
      default:
        score += 12;
        reasoning.push('Solid general capabilities (+12)');
    }

    // Tool gating bonus (Claude's specialty)
    if (classification.domains.includes('tool_selection') || 
        classification.domains.includes('mcp') ||
        classification.type === 'coordination') {
      score += this.capabilities.claude.tool_gating * 15;
      reasoning.push('Tool gating and MCP expertise (+15)');
    }

    // Multi-provider coordination bonus
    if (classification.complexity > 0.8 && classification.domains.length > 2) {
      score += this.capabilities.claude.hive_management * 10;
      reasoning.push('Complex multi-domain coordination (+10)');
    }

    // Communication and synthesis bonus
    if (classification.domains.includes('communication') || 
        classification.domains.includes('documentation')) {
      score += this.capabilities.claude.communication * 8;
      reasoning.push('Communication and documentation strength (+7)');
    }

    // Always available bonus (Claude as fallback)
    score += 5;
    reasoning.push('Always available as coordination fallback (+5)');

    return {
      total: Math.max(0, Math.min(100, score)),
      reasoning,
      confidence: this.calculateConfidence(score, classification, 'claude')
    };
  }

  /**
   * Apply load balancing to provider scores
   */
  private applyLoadBalancing(scores: ProviderScore[]): ProviderScore[] {
    return scores.map(score => {
      const loadMetric = this.loadMetrics.get(score.provider);
      if (!loadMetric) return score;

      // Adjust score based on current load
      const loadPenalty = loadMetric.current_load * 20; // Max 20 point penalty
      const responsePenalty = Math.max(0, (loadMetric.average_response_time - 1000) / 100); // Penalty for >1s response
      const successBonus = loadMetric.success_rate * 5; // Up to 5 point bonus

      const adjustedScore = Math.max(0, score.score - loadPenalty - responsePenalty + successBonus);

      return {
        ...score,
        score: adjustedScore,
        reasoning: [
          ...score.reasoning,
          `Load adjustment: -${(loadPenalty + responsePenalty - successBonus).toFixed(1)}`
        ]
      };
    });
  }

  /**
   * Determine if consensus is required
   */
  private shouldRequireConsensus(
    classification: QueryClassification,
    scores: ProviderScore[]
  ): boolean {
    
    // Critical queries always require consensus
    if (classification.urgency === 'critical') {
      return true;
    }

    // High complexity queries with close scores
    if (classification.complexity > 0.8) {
      const sortedScores = scores.sort((a, b) => b.score - a.score);
      const scoreDifference = sortedScores[0].score - sortedScores[1].score;
      
      if (scoreDifference < 15) { // Close scores
        return true;
      }
    }

    // Consensus-type queries
    if (classification.type === 'consensus') {
      return true;
    }

    // Multi-domain queries
    if (classification.domains.length > 3) {
      return true;
    }

    return false;
  }

  /**
   * Make final provider selection
   */
  private async makeProviderSelection(
    scores: ProviderScore[],
    requiresConsensus: boolean,
    classification: QueryClassification,
    constraints: RoutingConstraints
  ): Promise<ProviderSelection> {
    
    const sortedScores = scores.sort((a, b) => b.score - a.score);
    
    if (requiresConsensus) {
      // Select top 2-3 providers for consensus
      const consensusProviders = sortedScores
        .slice(0, Math.min(3, sortedScores.length))
        .filter(s => s.score > 30) // Minimum threshold
        .map(s => s.provider);

      return {
        primary: sortedScores[0].provider,
        requires_consensus: true,
        consensus_providers: consensusProviders,
        routing_confidence: this.calculateRoutingConfidence(sortedScores, true),
        estimated_total_cost: consensusProviders.reduce((sum, p) => {
          const score = scores.find(s => s.provider === p);
          return sum + (score?.estimated_cost || 0);
        }, 0),
        estimated_total_time: Math.max(...consensusProviders.map(p => {
          const score = scores.find(s => s.provider === p);
          return score?.estimated_time || 0;
        })),
        selection_reasoning: `Consensus required: ${this.explainConsensusReason(classification, sortedScores)}`
      };
    } else {
      // Single provider selection
      const primary = sortedScores[0];
      const secondary = sortedScores[1]?.score > 30 ? sortedScores[1] : undefined;

      return {
        primary: primary.provider,
        secondary: secondary?.provider,
        requires_consensus: false,
        routing_confidence: this.calculateRoutingConfidence(sortedScores, false),
        estimated_total_cost: primary.estimated_cost,
        estimated_total_time: primary.estimated_time,
        selection_reasoning: `Single provider: ${primary.reasoning.join(', ')}`
      };
    }
  }

  /**
   * Calculate routing confidence based on score distribution
   */
  private calculateRoutingConfidence(scores: ProviderScore[], isConsensus: boolean): number {
    if (scores.length === 0) return 0;

    const topScore = scores[0].score;
    const avgConfidence = scores.reduce((sum, s) => sum + s.confidence, 0) / scores.length;
    
    if (isConsensus) {
      // For consensus, confidence based on average quality
      return Math.min(0.95, avgConfidence * 0.8 + 0.1);
    } else {
      // For single provider, confidence based on score gap
      const secondScore = scores[1]?.score || 0;
      const scoreGap = topScore - secondScore;
      const gapConfidence = Math.min(1.0, scoreGap / 30); // 30 point gap = full confidence
      
      return Math.min(0.95, (avgConfidence + gapConfidence) / 2);
    }
  }

  /**
   * Helper methods
   */
  private calculateConfidence(score: number, classification: QueryClassification, provider: ProviderType): number {
    // Base confidence from score
    let confidence = Math.min(1.0, score / 80);
    
    // Adjust based on provider specialization
    if (provider === 'gemini' && classification.type === 'research') confidence *= 1.1;
    if (provider === 'qwen' && classification.type === 'implementation') confidence *= 1.1;
    if (provider === 'claude' && classification.type === 'coordination') confidence *= 1.1;
    
    return Math.min(0.95, confidence);
  }

  private estimateProviderCost(provider: ProviderType, classification: QueryClassification): number {
    const baseCosts = { gemini: 0.10, qwen: 0.08, claude: 0.12 };
    const tokenMultiplier = classification.estimated_tokens / 1000;
    
    return baseCosts[provider] * tokenMultiplier;
  }

  private estimateProviderTime(provider: ProviderType, classification: QueryClassification): number {
    const baseTimes = { gemini: 2000, qwen: 1500, claude: 1800 }; // milliseconds
    const complexityMultiplier = 1 + classification.complexity;
    
    return baseTimes[provider] * complexityMultiplier;
  }

  private initializeLoadMetrics(): void {
    ['gemini', 'qwen', 'claude'].forEach(provider => {
      this.loadMetrics.set(provider as ProviderType, {
        current_load: 0.1,
        average_response_time: 1500,
        success_rate: 0.95,
        cost_per_query: 0.10,
        queue_depth: 0,
        last_update: new Date()
      });
    });
  }

  private recordRoutingDecision(
    query: string,
    classification: QueryClassification,
    selection: ProviderSelection
  ): void {
    this.routingHistory.push({
      timestamp: new Date(),
      query_hash: this.hashQuery(query),
      classification,
      selection,
      actual_performance: null // Will be updated later
    });

    // Keep only last 1000 decisions
    if (this.routingHistory.length > 1000) {
      this.routingHistory = this.routingHistory.slice(-1000);
    }
  }

  private hashQuery(query: string): string {
    // Simple hash function for query identification
    let hash = 0;
    for (let i = 0; i < query.length; i++) {
      const char = query.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  private applyConstraints(scores: ProviderScore[], constraints: RoutingConstraints): ProviderScore[] {
    if (!constraints) return scores;

    return scores.filter(score => {
      if (constraints.max_cost && score.estimated_cost > constraints.max_cost) {
        return false;
      }
      if (constraints.max_time && score.estimated_time > constraints.max_time) {
        return false;
      }
      if (constraints.excluded_providers?.includes(score.provider)) {
        return false;
      }
      return true;
    });
  }

  private explainConsensusReason(classification: QueryClassification, scores: ProviderScore[]): string {
    if (classification.urgency === 'critical') return 'Critical query requires validation';
    if (classification.complexity > 0.8) return 'High complexity benefits from multiple perspectives';
    if (classification.type === 'consensus') return 'Query explicitly requests consensus';
    if (classification.domains.length > 3) return 'Multi-domain query benefits from specialist input';
    
    const topTwo = scores.slice(0, 2);
    const scoreDiff = topTwo[0].score - topTwo[1].score;
    if (scoreDiff < 15) return 'Close provider scores warrant consensus validation';
    
    return 'Multiple factors indicate consensus would improve quality';
  }
}

// Supporting interfaces and classes
interface ScoringResult {
  total: number;
  reasoning: string[];
  confidence: number;
}

interface RoutingConstraints {
  max_cost?: number;
  max_time?: number;
  excluded_providers?: ProviderType[];
  preferred_providers?: ProviderType[];
}

interface RoutingDecision {
  timestamp: Date;
  query_hash: string;
  classification: QueryClassification;
  selection: ProviderSelection;
  actual_performance: PerformanceMetrics | null;
}

interface PerformanceMetrics {
  actual_cost: number;
  actual_time: number;
  quality_score: number;
  user_satisfaction: number;
}

class RoutingLearningModel {
  // Placeholder for machine learning model to improve routing decisions
  // Would implement reinforcement learning or neural network-based optimization
  
  async updateFromFeedback(decision: RoutingDecision, performance: PerformanceMetrics): Promise<void> {
    // Update model based on actual performance vs. predictions
  }
  
  async predictOptimalRouting(classification: QueryClassification): Promise<ProviderType[]> {
    // Use trained model to predict best routing
    return ['claude']; // Placeholder
  }
}

export { ProviderRouter as default };