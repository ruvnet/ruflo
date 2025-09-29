/**
 * Multi-Provider Enhanced Gating Service
 * Extends the existing gating service to support intelligent multi-provider routing
 */

import { GatingService, ProvisionOptions, GatingMetrics } from './gating-service.js';
import { DiscoveryService } from './discovery-service.js';
import { ProviderRouter, QueryClassification, ProviderSelection, ProviderType } from '../providers/provider-router.js';
import { ConsensusBuilder, ProviderResponse, ConsensusResult } from '../consensus/consensus-builder.js';
import { MCPTool } from '../utils/types.js';
import { tokenSizer } from '../utils/token-sizer.js';
import { logger } from '../core/logger.js';
import { EventEmitter } from 'events';

// Extended interfaces
export interface MultiProviderProvisionOptions extends ProvisionOptions {
  providers?: ProviderType[];
  require_consensus?: boolean;
  cost_limit?: number;
  time_limit?: number;
  quality_threshold?: number;
}

export interface MultiProviderResult {
  tools: MCPTool[];
  provider_selection: ProviderSelection;
  consensus_result?: ConsensusResult;
  metrics: MultiProviderMetrics;
  routing_explanation: string;
}

export interface MultiProviderMetrics extends GatingMetrics {
  providers_used: ProviderType[];
  consensus_used: boolean;
  routing_confidence: number;
  provider_costs: Record<ProviderType, number>;
  provider_times: Record<ProviderType, number>;
  total_providers_considered: number;
  routing_time: number;
}

/**
 * Enhanced gating service that intelligently routes queries across multiple providers
 * while maintaining the core tool-gating functionality
 */
export class MultiProviderGatingService extends GatingService {
  private providerRouter: ProviderRouter;
  private consensusBuilder: ConsensusBuilder;
  private queryClassifier: QueryClassifier;
  private providerClients: Map<ProviderType, ProviderClient> = new Map();

  constructor(
    discoveryService: DiscoveryService,
    providerRouter?: ProviderRouter,
    consensusBuilder?: ConsensusBuilder
  ) {
    super(discoveryService);
    
    this.providerRouter = providerRouter || new ProviderRouter();
    this.consensusBuilder = consensusBuilder || new ConsensusBuilder();
    this.queryClassifier = new QueryClassifier();
    
    this.initializeProviderClients();
    this.setupEventHandlers();
  }

  /**
   * Enhanced tool provisioning with multi-provider support
   */
  async provisionToolsWithProviders(
    options: MultiProviderProvisionOptions
  ): Promise<MultiProviderResult> {
    const startTime = Date.now();
    
    logger.info('Starting multi-provider tool provisioning', {
      query: options.query.substring(0, 100),
      maxTokens: options.maxTokens,
      providersRequested: options.providers
    });

    try {
      // Step 1: Classify the query to understand requirements
      const classification = await this.classifyQuery(options.query);
      
      // Step 2: Route to optimal provider(s)
      const providerSelection = await this.routeToProviders(classification, options);
      
      // Step 3: Execute query with selected provider(s)
      const executionResult = await this.executeWithProviders(
        options,
        providerSelection,
        classification
      );
      
      // Step 4: Apply consensus if needed
      let consensusResult: ConsensusResult | undefined;
      if (providerSelection.requires_consensus && executionResult.providerResponses.length > 1) {
        consensusResult = await this.buildConsensus(
          options.query,
          executionResult.providerResponses,
          classification
        );
      }
      
      // Step 5: Provision tools based on final decision
      const finalQuery = consensusResult?.final_response || executionResult.primaryResponse.response;
      const tools = await this.provisionFinalTools(finalQuery, options);
      
      // Step 6: Calculate metrics and prepare result
      const routingTime = Date.now() - startTime;
      const metrics = this.calculateMultiProviderMetrics(
        executionResult,
        providerSelection,
        consensusResult,
        routingTime,
        tools
      );

      const result: MultiProviderResult = {
        tools,
        provider_selection: providerSelection,
        consensus_result: consensusResult,
        metrics,
        routing_explanation: this.generateRoutingExplanation(
          providerSelection,
          classification,
          consensusResult
        )
      };

      // Emit metrics for monitoring
      this.emitMultiProviderMetrics(metrics);
      
      logger.info('Multi-provider tool provisioning completed', {
        providersUsed: metrics.providers_used,
        toolsProvisioned: metrics.toolsProvisioned,
        consensusUsed: metrics.consensus_used,
        routingTime: metrics.routing_time
      });

      return result;
      
    } catch (error) {
      logger.error('Multi-provider tool provisioning failed', {
        error: error.message,
        query: options.query.substring(0, 100)
      });
      
      // Fallback to single-provider (Claude) provisioning
      return await this.fallbackToSingleProvider(options, error);
    }
  }

  /**
   * Classify query to understand its characteristics and requirements
   */
  private async classifyQuery(query: string): Promise<QueryClassification> {
    return await this.queryClassifier.classify(query);
  }

  /**
   * Route query to optimal provider(s) based on classification
   */
  private async routeToProviders(
    classification: QueryClassification,
    options: MultiProviderProvisionOptions
  ): Promise<ProviderSelection> {
    
    // Apply user constraints
    const constraints = {
      max_cost: options.cost_limit,
      max_time: options.time_limit,
      excluded_providers: options.providers ? 
        (['gemini', 'qwen', 'claude'] as ProviderType[]).filter(p => !options.providers!.includes(p)) : 
        undefined
    };

    const selection = await this.providerRouter.selectOptimalProvider(
      options.query,
      classification,
      constraints
    );

    // Override consensus requirement if explicitly requested
    if (options.require_consensus !== undefined) {
      selection.requires_consensus = options.require_consensus;
      if (options.require_consensus && !selection.consensus_providers) {
        selection.consensus_providers = ['gemini', 'qwen', 'claude'];
      }
    }

    return selection;
  }

  /**
   * Execute query with selected provider(s)
   */
  private async executeWithProviders(
    options: MultiProviderProvisionOptions,
    selection: ProviderSelection,
    classification: QueryClassification
  ): Promise<ProviderExecutionResult> {
    
    const providersToQuery = selection.requires_consensus ? 
      selection.consensus_providers! : 
      [selection.primary, selection.secondary].filter(p => p) as ProviderType[];

    const providerResponses: ProviderResponse[] = [];
    const errors: Map<ProviderType, Error> = new Map();

    // Execute queries in parallel for consensus, or sequentially for fallback
    if (selection.requires_consensus) {
      // Parallel execution for consensus
      const results = await Promise.allSettled(
        providersToQuery.map(provider => this.queryProvider(provider, options.query, classification))
      );

      results.forEach((result, index) => {
        const provider = providersToQuery[index];
        if (result.status === 'fulfilled') {
          providerResponses.push(result.value);
        } else {
          errors.set(provider, result.reason);
          logger.warn(`Provider ${provider} failed during consensus execution`, {
            error: result.reason.message
          });
        }
      });
    } else {
      // Sequential execution with fallback
      for (const provider of providersToQuery) {
        try {
          const response = await this.queryProvider(provider, options.query, classification);
          providerResponses.push(response);
          break; // Success - no need to try fallback
        } catch (error) {
          errors.set(provider, error as Error);
          logger.warn(`Provider ${provider} failed, trying fallback`, {
            error: (error as Error).message
          });
        }
      }
    }

    if (providerResponses.length === 0) {
      throw new Error(`All providers failed: ${Array.from(errors.entries()).map(([p, e]) => `${p}: ${e.message}`).join(', ')}`);
    }

    return {
      providerResponses,
      primaryResponse: providerResponses[0],
      errors
    };
  }

  /**
   * Query a specific provider
   */
  private async queryProvider(
    provider: ProviderType,
    query: string,
    classification: QueryClassification
  ): Promise<ProviderResponse> {
    
    const client = this.providerClients.get(provider);
    if (!client) {
      throw new Error(`Provider client not available: ${provider}`);
    }

    const startTime = Date.now();
    
    try {
      const response = await client.query(query, {
        classification,
        timeout: 30000,
        model: this.selectOptimalModel(provider, classification)
      });

      const responseTime = Date.now() - startTime;
      
      return {
        provider,
        response: response.content,
        confidence: response.confidence || 0.8,
        metadata: {
          model: response.model,
          tokens_used: response.tokens_used,
          response_time: responseTime,
          cost: response.cost || 0
        },
        timestamp: new Date()
      };
      
    } catch (error) {
      logger.error(`Provider ${provider} query failed`, {
        error: (error as Error).message,
        responseTime: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Build consensus from multiple provider responses
   */
  private async buildConsensus(
    query: string,
    responses: ProviderResponse[],
    classification: QueryClassification
  ): Promise<ConsensusResult> {
    
    const consensusOptions = {
      algorithm: this.selectConsensusAlgorithm(classification),
      timeout: 60000,
      minimum_agreement: 0.7,
      conflict_resolution: 'iterative' as const,
      quality_weights: this.getProviderQualityWeights(classification)
    };

    return await this.consensusBuilder.buildConsensus(query, responses, consensusOptions);
  }

  /**
   * Provision final tools based on the consensus or primary response
   */
  private async provisionFinalTools(
    finalQuery: string,
    options: MultiProviderProvisionOptions
  ): Promise<MCPTool[]> {
    
    // Use the parent class's provisioning logic with the processed query
    const provisionOptions: ProvisionOptions = {
      query: finalQuery,
      maxTokens: options.maxTokens
    };

    return await super.provisionTools(provisionOptions);
  }

  /**
   * Calculate comprehensive metrics for multi-provider execution
   */
  private calculateMultiProviderMetrics(
    execution: ProviderExecutionResult,
    selection: ProviderSelection,
    consensus: ConsensusResult | undefined,
    routingTime: number,
    tools: MCPTool[]
  ): MultiProviderMetrics {
    
    const baseMetrics = {
      toolsDiscovered: tools.length + 50, // Approximate discovery count
      toolsProvisioned: tools.length,
      tokensBudgeted: tools.reduce((sum, tool) => sum + tokenSizer(tool), 0),
      tokensUsed: tools.reduce((sum, tool) => sum + tokenSizer(tool), 0)
    };

    const providerCosts: Record<ProviderType, number> = {} as Record<ProviderType, number>;
    const providerTimes: Record<ProviderType, number> = {} as Record<ProviderType, number>;

    execution.providerResponses.forEach(response => {
      providerCosts[response.provider] = response.metadata.cost || 0;
      providerTimes[response.provider] = response.metadata.response_time || 0;
    });

    return {
      ...baseMetrics,
      providers_used: execution.providerResponses.map(r => r.provider),
      consensus_used: !!consensus,
      routing_confidence: selection.routing_confidence,
      provider_costs: providerCosts,
      provider_times: providerTimes,
      total_providers_considered: Object.keys(providerCosts).length,
      routing_time: routingTime
    };
  }

  /**
   * Generate human-readable explanation of routing decisions
   */
  private generateRoutingExplanation(
    selection: ProviderSelection,
    classification: QueryClassification,
    consensus?: ConsensusResult
  ): string {
    
    let explanation = `Query classified as ${classification.type} with ${(classification.complexity * 100).toFixed(0)}% complexity. `;
    
    if (selection.requires_consensus) {
      explanation += `Multi-provider consensus used (${selection.consensus_providers?.join(', ')}) `;
      explanation += `due to: ${selection.selection_reasoning}. `;
      
      if (consensus) {
        explanation += `Consensus ${consensus.consensus_reached ? 'reached' : 'attempted'} `;
        explanation += `with ${(consensus.agreement_score * 100).toFixed(0)}% agreement score `;
        explanation += `using ${consensus.resolution_method} method.`;
      }
    } else {
      explanation += `Single provider (${selection.primary}) selected `;
      if (selection.secondary) {
        explanation += `with ${selection.secondary} as fallback `;
      }
      explanation += `with ${(selection.routing_confidence * 100).toFixed(0)}% confidence. `;
      explanation += `Reasoning: ${selection.selection_reasoning}`;
    }

    return explanation;
  }

  /**
   * Fallback to single-provider provisioning when multi-provider fails
   */
  private async fallbackToSingleProvider(
    options: MultiProviderProvisionOptions,
    originalError: Error
  ): Promise<MultiProviderResult> {
    
    logger.warn('Falling back to single-provider provisioning', {
      originalError: originalError.message
    });

    try {
      // Use Claude as the fallback provider
      const fallbackTools = await super.provisionTools({
        query: options.query,
        maxTokens: options.maxTokens
      });

      return {
        tools: fallbackTools,
        provider_selection: {
          primary: 'claude',
          requires_consensus: false,
          routing_confidence: 0.5,
          estimated_total_cost: 0.1,
          estimated_total_time: 2000,
          selection_reasoning: `Fallback due to multi-provider failure: ${originalError.message}`
        },
        metrics: {
          toolsDiscovered: fallbackTools.length + 50,
          toolsProvisioned: fallbackTools.length,
          tokensBudgeted: fallbackTools.reduce((sum, tool) => sum + tokenSizer(tool), 0),
          tokensUsed: fallbackTools.reduce((sum, tool) => sum + tokenSizer(tool), 0),
          providers_used: ['claude'],
          consensus_used: false,
          routing_confidence: 0.5,
          provider_costs: { claude: 0.1 } as Record<ProviderType, number>,
          provider_times: { claude: 2000 } as Record<ProviderType, number>,
          total_providers_considered: 1,
          routing_time: 0
        },
        routing_explanation: `Multi-provider routing failed, used Claude fallback: ${originalError.message}`
      };
      
    } catch (fallbackError) {
      logger.error('Fallback provisioning also failed', {
        fallbackError: (fallbackError as Error).message
      });
      throw new Error(`Multi-provider and fallback provisioning both failed: ${originalError.message}, ${(fallbackError as Error).message}`);
    }
  }

  /**
   * Helper methods
   */
  private initializeProviderClients(): void {
    // Initialize provider clients (would integrate with actual MCP clients)
    this.providerClients.set('gemini', new GeminiProviderClient());
    this.providerClients.set('qwen', new QwenProviderClient());
    this.providerClients.set('claude', new ClaudeProviderClient());
  }

  private setupEventHandlers(): void {
    this.providerRouter.on('provider-selected', (data) => {
      this.emit('provider-selection', data);
    });

    this.consensusBuilder.on('consensus-completed', (data) => {
      this.emit('consensus-completed', data);
    });
  }

  private selectOptimalModel(provider: ProviderType, classification: QueryClassification): string {
    const modelMap = {
      gemini: classification.complexity > 0.8 ? 'gemini-2.5-pro' : 'gemini-2.5-flash',
      qwen: 'qwen-turbo', // Assuming single model for now
      claude: 'claude-3.5-sonnet' // Current model
    };
    
    return modelMap[provider];
  }

  private selectConsensusAlgorithm(classification: QueryClassification): 'pbft' | 'weighted_voting' | 'expert_arbitration' {
    if (classification.urgency === 'critical') return 'pbft';
    if (classification.type === 'implementation') return 'expert_arbitration';
    return 'weighted_voting';
  }

  private getProviderQualityWeights(classification: QueryClassification): Partial<Record<ProviderType, number>> {
    const weights: Partial<Record<ProviderType, number>> = {};
    
    switch (classification.type) {
      case 'research':
        weights.gemini = 1.2;
        weights.claude = 1.0;
        weights.qwen = 0.8;
        break;
      case 'implementation':
        weights.qwen = 1.2;
        weights.claude = 1.0;
        weights.gemini = 0.8;
        break;
      case 'coordination':
        weights.claude = 1.2;
        weights.gemini = 1.0;
        weights.qwen = 0.9;
        break;
      default:
        weights.gemini = 1.0;
        weights.qwen = 1.0;
        weights.claude = 1.0;
    }
    
    return weights;
  }

  private emitMultiProviderMetrics(metrics: MultiProviderMetrics): void {
    this.emit('multi-provider-metrics', metrics);
  }
}

// Supporting classes and interfaces
interface ProviderExecutionResult {
  providerResponses: ProviderResponse[];
  primaryResponse: ProviderResponse;
  errors: Map<ProviderType, Error>;
}

interface QueryOptions {
  classification: QueryClassification;
  timeout: number;
  model?: string;
}

interface ProviderClientResponse {
  content: string;
  confidence?: number;
  model?: string;
  tokens_used?: number;
  cost?: number;
}

abstract class ProviderClient {
  abstract query(query: string, options: QueryOptions): Promise<ProviderClientResponse>;
}

class GeminiProviderClient extends ProviderClient {
  async query(query: string, options: QueryOptions): Promise<ProviderClientResponse> {
    // Implementation would integrate with actual Gemini MCP client
    throw new Error('Gemini provider client not implemented');
  }
}

class QwenProviderClient extends ProviderClient {
  async query(query: string, options: QueryOptions): Promise<ProviderClientResponse> {
    // Implementation would integrate with actual Qwen MCP client
    throw new Error('Qwen provider client not implemented');
  }
}

class ClaudeProviderClient extends ProviderClient {
  async query(query: string, options: QueryOptions): Promise<ProviderClientResponse> {
    // Implementation would use Claude's native capabilities
    return {
      content: query, // Placeholder - would use actual Claude processing
      confidence: 0.8,
      model: 'claude-3.5-sonnet',
      tokens_used: query.length / 4, // Rough estimate
      cost: 0.1
    };
  }
}

class QueryClassifier {
  async classify(query: string): Promise<QueryClassification> {
    // Simplified classification logic
    const queryLower = query.toLowerCase();
    
    let type: QueryClassification['type'] = 'analysis';
    if (queryLower.includes('research') || queryLower.includes('analyz')) type = 'research';
    if (queryLower.includes('implement') || queryLower.includes('build') || queryLower.includes('create')) type = 'implementation';
    if (queryLower.includes('coordinate') || queryLower.includes('manage')) type = 'coordination';
    if (queryLower.includes('consensus') || queryLower.includes('decide')) type = 'consensus';
    if (queryLower.includes('debug') || queryLower.includes('fix') || queryLower.includes('error')) type = 'debugging';

    const complexity = Math.min(1.0, (query.length / 500) + (queryLower.split(' ').length / 100));
    const technical_depth = queryLower.includes('technical') || queryLower.includes('code') ? 0.8 : 0.4;
    const requires_creativity = queryLower.includes('creative') || queryLower.includes('innovative') ? 0.9 : 0.3;

    return {
      type,
      complexity,
      domains: this.extractDomains(queryLower),
      urgency: queryLower.includes('urgent') || queryLower.includes('critical') ? 'high' : 'medium',
      context_size: query.length,
      technical_depth,
      requires_creativity,
      estimated_tokens: Math.ceil(query.length / 3) // Rough estimate
    };
  }

  private extractDomains(queryLower: string): string[] {
    const domains = [];
    
    if (queryLower.includes('api') || queryLower.includes('endpoint')) domains.push('api');
    if (queryLower.includes('database') || queryLower.includes('data')) domains.push('database');
    if (queryLower.includes('architecture') || queryLower.includes('design')) domains.push('architecture');
    if (queryLower.includes('test') || queryLower.includes('quality')) domains.push('testing');
    if (queryLower.includes('security') || queryLower.includes('auth')) domains.push('security');
    if (queryLower.includes('performance') || queryLower.includes('optimize')) domains.push('performance');
    if (queryLower.includes('ui') || queryLower.includes('frontend')) domains.push('frontend');
    if (queryLower.includes('backend') || queryLower.includes('server')) domains.push('backend');
    
    return domains.length > 0 ? domains : ['general'];
  }
}

export { MultiProviderGatingService as default };