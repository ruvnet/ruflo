import { DiscoveryService } from './discovery-service.js';
import { MCPTool } from '../utils/types.js';
import { tokenSizer } from '../utils/token-sizer.js';
import { EventEmitter } from 'events';

interface ProvisionOptions {
  query: string;
  maxTokens: number;
}

interface GatingMetrics {
  toolsDiscovered: number;
  toolsProvisioned: number;
  tokensBudgeted: number;
  tokensUsed: number;
}

export class GatingService extends EventEmitter {
  constructor(private discoveryService: DiscoveryService) {
    super();
  }

  async provisionTools(options: ProvisionOptions): Promise<MCPTool[]> {
    const { query, maxTokens } = options;
    
    // Validate inputs and short-circuit on empty budgets/queries
    const normalizedQuery = query.trim();
    const safeMaxTokens = Math.max(0, Math.floor(maxTokens));
    
    if (!normalizedQuery || safeMaxTokens === 0) {
      // Emit metrics even for empty results
      this.emitMetrics({
        toolsDiscovered: 0,
        toolsProvisioned: 0,
        tokensBudgeted: safeMaxTokens,
        tokensUsed: 0
      });
      return [];
    }

    // Discover relevant tools
    const discoveredTools = await this.discoveryService.discoverTools({ 
      query: normalizedQuery 
    });

    // Provision tools based on token limit
    const provisionedTools = await this.discoveryService.provisionTools({
      tools: discoveredTools,
      maxTokens: safeMaxTokens,
    });
    
    // Calculate actual tokens used with canonical tokenSizer
    const tokensUsed = provisionedTools.reduce((sum, tool) => {
      return sum + tokenSizer(tool);
    }, 0);

    // Emit metrics for observability
    this.emitMetrics({
      toolsDiscovered: discoveredTools.length,
      toolsProvisioned: provisionedTools.length,
      tokensBudgeted: safeMaxTokens,
      tokensUsed: tokensUsed // Already an integer from tokenSizer
    });

    return provisionedTools;
  }
  
  private emitMetrics(metrics: GatingMetrics): void {
    // Emit metrics event for monitoring/logging
    this.emit('gating-metrics', metrics);
  }
}
