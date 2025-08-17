/**
 * Graphiti Configuration for Claude-Flow
 * 
 * Enables knowledge graph-based memory and collective intelligence
 */

import { z } from 'zod';

export interface GraphitiConfiguration {
  enabled: boolean;
  mcp: {
    serverName: string;
    available: boolean;
  };
  memory: {
    adapter: {
      enabled: boolean;
      defaultGroupId: string;
      maxNodes: number;
      maxFacts: number;
      enableAutoSync: boolean;
      syncInterval: number;
      enableTemporalTracking: boolean;
      knowledgeRetentionDays: number;
    };
  };
  hiveMind: {
    integration: {
      enabled: boolean;
      enablePatternExtraction: boolean;
      enableInsightGeneration: boolean;
      enableKnowledgeEvolution: boolean;
      graphGroupPrefix: string;
      minPatternConfidence: number;
      insightGenerationInterval: number;
      knowledgeEvolutionThreshold: number;
    };
  };
  features: {
    episodeProcessing: boolean;
    nodeRelationships: boolean;
    temporalReasoning: boolean;
    collectiveIntelligence: boolean;
    knowledgeSharing: boolean;
    patternRecognition: boolean;
    insightGeneration: boolean;
  };
}

export const defaultGraphitiConfig: GraphitiConfiguration = {
  enabled: true,
  mcp: {
    serverName: 'graphiti',
    available: false // Will be checked at runtime
  },
  memory: {
    adapter: {
      enabled: true,
      defaultGroupId: 'claude_flow_default',
      maxNodes: 10000,
      maxFacts: 50000,
      enableAutoSync: true,
      syncInterval: 30000, // 30 seconds
      enableTemporalTracking: true,
      knowledgeRetentionDays: 90
    }
  },
  hiveMind: {
    integration: {
      enabled: true,
      enablePatternExtraction: true,
      enableInsightGeneration: true,
      enableKnowledgeEvolution: true,
      graphGroupPrefix: 'hivemind_',
      minPatternConfidence: 0.7,
      insightGenerationInterval: 60000, // 1 minute
      knowledgeEvolutionThreshold: 0.8
    }
  },
  features: {
    episodeProcessing: true,
    nodeRelationships: true,
    temporalReasoning: true,
    collectiveIntelligence: true,
    knowledgeSharing: true,
    patternRecognition: true,
    insightGeneration: true
  }
};

/**
 * Check if Graphiti MCP server is available
 */
export async function checkGraphitiAvailability(): Promise<boolean> {
  try {
    // Check if graphiti MCP tools are available in the global context
    // This would be replaced with actual MCP server check
    const hasTool = typeof (global as any).mcp__graphiti__add_memory === 'function';
    return hasTool;
  } catch (error) {
    console.warn('Graphiti MCP server not available:', error);
    return false;
  }
}

/**
 * Get Graphiti configuration with runtime checks and validation
 * Enhanced with ruvnet's suggestions for validation and sanitization
 */
export async function getGraphitiConfig(userConfig?: Partial<GraphitiConfiguration>): Promise<GraphitiConfiguration> {
  // Merge user config with defaults
  const config = { 
    ...defaultGraphitiConfig,
    ...userConfig 
  };
  
  // Validate configuration
  const validatedConfig = validateGraphitiConfig(config);
  
  // Sanitize configuration
  const sanitizedConfig = sanitizeGraphitiConfig(validatedConfig);
  
  // Runtime availability check
  sanitizedConfig.mcp.available = await checkGraphitiAvailability();
  
  if (!sanitizedConfig.mcp.available) {
    console.warn('Graphiti MCP server not available, some features will be limited');
    // Disable features that require MCP server
    sanitizedConfig.memory.adapter.enableAutoSync = false;
    sanitizedConfig.hiveMind.integration.enableKnowledgeEvolution = false;
  }
  
  return sanitizedConfig;
}

// Zod schema for configuration validation (as suggested by ruvnet)
export const GraphitiConfigSchema = z.object({
  enabled: z.boolean(),
  mcp: z.object({
    serverName: z.string().min(1, 'MCP server name cannot be empty'),
    available: z.boolean(),
  }),
  memory: z.object({
    adapter: z.object({
      enabled: z.boolean(),
      defaultGroupId: z.string().min(1, 'Default group ID cannot be empty'),
      maxNodes: z.number().positive('Max nodes must be positive'),
      maxFacts: z.number().positive('Max facts must be positive'),
      enableAutoSync: z.boolean(),
      syncInterval: z.number().min(1000, 'Sync interval must be at least 1 second'),
      enableTemporalTracking: z.boolean(),
      knowledgeRetentionDays: z.number().positive('Knowledge retention days must be positive'),
    }),
  }),
  hiveMind: z.object({
    integration: z.object({
      enabled: z.boolean(),
      enablePatternExtraction: z.boolean(),
      enableInsightGeneration: z.boolean(),
      enableKnowledgeEvolution: z.boolean(),
      graphGroupPrefix: z.string().min(1, 'Graph group prefix cannot be empty'),
      minPatternConfidence: z.number().min(0).max(1, 'Pattern confidence must be between 0 and 1'),
      insightGenerationInterval: z.number().min(1000, 'Insight generation interval must be at least 1 second'),
      knowledgeEvolutionThreshold: z.number().min(0).max(1, 'Knowledge evolution threshold must be between 0 and 1'),
    }),
  }),
  features: z.object({
    episodeProcessing: z.boolean(),
    nodeRelationships: z.boolean(),
    temporalReasoning: z.boolean(),
    collectiveIntelligence: z.boolean(),
    knowledgeSharing: z.boolean(),
    patternRecognition: z.boolean(),
    insightGeneration: z.boolean(),
  }),
});

/**
 * Validate Graphiti configuration with schema validation
 * Implements ruvnet's suggestion for configuration validation
 */
export function validateGraphitiConfig(config: unknown): GraphitiConfiguration {
  try {
    return GraphitiConfigSchema.parse(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(', ');
      throw new Error(`Invalid Graphiti configuration: ${issues}`);
    }
    throw error;
  }
}

/**
 * Sanitize connection strings and sensitive data
 * Implements ruvnet's suggestion for connection string sanitization
 */
export function sanitizeGraphitiConfig(config: GraphitiConfiguration): GraphitiConfiguration {
  const sanitized = JSON.parse(JSON.stringify(config));
  
  // Sanitize any potential connection strings or sensitive data
  if (sanitized.mcp?.serverName) {
    // Remove any potential credentials from server names
    sanitized.mcp.serverName = sanitized.mcp.serverName.replace(/\/\/.*:.*@/g, '//***:***@');
  }
  
  // Ensure group IDs are safe
  sanitized.memory.adapter.defaultGroupId = sanitized.memory.adapter.defaultGroupId
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .toLowerCase();
  
  sanitized.hiveMind.integration.graphGroupPrefix = sanitized.hiveMind.integration.graphGroupPrefix
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .toLowerCase();
  
  return sanitized;
}

export default defaultGraphitiConfig;