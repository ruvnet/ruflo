/**
 * Deferred Loading Configuration
 *
 * Based on Anthropic's Tool Search Tool pattern for 85% token reduction.
 * Tools marked with defer_loading: true are only loaded when explicitly invoked.
 *
 * @see https://www.anthropic.com/engineering/advanced-tool-use
 */

export interface DeferredToolConfig {
  name: string;
  defer_loading: boolean;
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  loadConditions?: {
    contextKeywords?: string[];
    previousToolCalls?: string[];
  };
}

/**
 * Core tools that are ALWAYS loaded immediately (defer_loading: false)
 * These are high-frequency, low-token tools essential for basic operations.
 */
export const CORE_TOOLS: DeferredToolConfig[] = [
  // System discovery - always needed
  {
    name: 'tools/search',
    defer_loading: false,
    priority: 'critical',
    category: 'system'
  },
  {
    name: 'system/status',
    defer_loading: false,
    priority: 'critical',
    category: 'system'
  },
  {
    name: 'system/health',
    defer_loading: false,
    priority: 'high',
    category: 'system'
  },

  // Agent management - frequently used
  {
    name: 'agents/spawn',
    defer_loading: false,
    priority: 'high',
    category: 'agents'
  },
  {
    name: 'agents/list',
    defer_loading: false,
    priority: 'high',
    category: 'agents'
  },
];

/**
 * Deferred tools that load on-demand (defer_loading: true)
 * These are specialized tools loaded only when explicitly needed.
 */
export const DEFERRED_TOOLS: DeferredToolConfig[] = [
  // Task management
  {
    name: 'tasks/create',
    defer_loading: true,
    priority: 'medium',
    category: 'tasks',
    loadConditions: {
      contextKeywords: ['task', 'create task', 'new task', 'assign', 'work']
    }
  },
  {
    name: 'tasks/list',
    defer_loading: true,
    priority: 'medium',
    category: 'tasks'
  },
  {
    name: 'tasks/status',
    defer_loading: true,
    priority: 'low',
    category: 'tasks'
  },
  {
    name: 'tasks/cancel',
    defer_loading: true,
    priority: 'low',
    category: 'tasks'
  },
  {
    name: 'tasks/assign',
    defer_loading: true,
    priority: 'low',
    category: 'tasks'
  },

  // Memory operations
  {
    name: 'memory/query',
    defer_loading: true,
    priority: 'medium',
    category: 'memory',
    loadConditions: {
      contextKeywords: ['memory', 'remember', 'recall', 'store', 'retrieve']
    }
  },
  {
    name: 'memory/store',
    defer_loading: true,
    priority: 'medium',
    category: 'memory'
  },
  {
    name: 'memory/delete',
    defer_loading: true,
    priority: 'low',
    category: 'memory'
  },
  {
    name: 'memory/export',
    defer_loading: true,
    priority: 'low',
    category: 'memory'
  },
  {
    name: 'memory/import',
    defer_loading: true,
    priority: 'low',
    category: 'memory'
  },

  // Workflow operations
  {
    name: 'workflow/execute',
    defer_loading: true,
    priority: 'medium',
    category: 'workflow',
    loadConditions: {
      contextKeywords: ['workflow', 'pipeline', 'orchestrate', 'automate']
    }
  },
  {
    name: 'workflow/create',
    defer_loading: true,
    priority: 'low',
    category: 'workflow'
  },
  {
    name: 'workflow/list',
    defer_loading: true,
    priority: 'low',
    category: 'workflow'
  },

  // Terminal operations
  {
    name: 'terminal/execute',
    defer_loading: true,
    priority: 'medium',
    category: 'terminal',
    loadConditions: {
      contextKeywords: ['terminal', 'shell', 'command', 'execute', 'run']
    }
  },
  {
    name: 'terminal/list',
    defer_loading: true,
    priority: 'low',
    category: 'terminal'
  },
  {
    name: 'terminal/create',
    defer_loading: true,
    priority: 'low',
    category: 'terminal'
  },

  // Configuration
  {
    name: 'config/get',
    defer_loading: true,
    priority: 'low',
    category: 'config'
  },
  {
    name: 'config/update',
    defer_loading: true,
    priority: 'low',
    category: 'config'
  },
  {
    name: 'config/validate',
    defer_loading: true,
    priority: 'low',
    category: 'config'
  },

  // Query control
  {
    name: 'query/control',
    defer_loading: true,
    priority: 'low',
    category: 'query'
  },
  {
    name: 'query/list',
    defer_loading: true,
    priority: 'low',
    category: 'query'
  },

  // Agent management (deferred subset)
  {
    name: 'agents/terminate',
    defer_loading: true,
    priority: 'low',
    category: 'agents'
  },
  {
    name: 'agents/info',
    defer_loading: true,
    priority: 'low',
    category: 'agents'
  },
  {
    name: 'agents/spawn_parallel',
    defer_loading: true,
    priority: 'medium',
    category: 'agents'
  },

  // Swarm operations
  {
    name: 'swarm/create-objective',
    defer_loading: true,
    priority: 'medium',
    category: 'swarm',
    loadConditions: {
      contextKeywords: ['swarm', 'objective', 'multi-agent', 'coordinate']
    }
  },
  {
    name: 'swarm/execute-objective',
    defer_loading: true,
    priority: 'medium',
    category: 'swarm'
  },
  {
    name: 'swarm/get-status',
    defer_loading: true,
    priority: 'medium',
    category: 'swarm'
  },
  {
    name: 'swarm/get-comprehensive-status',
    defer_loading: true,
    priority: 'low',
    category: 'swarm'
  },
  {
    name: 'swarm/emergency-stop',
    defer_loading: true,
    priority: 'low',
    category: 'swarm'
  },
  {
    name: 'dispatch_agent',
    defer_loading: true,
    priority: 'medium',
    category: 'swarm'
  },
  {
    name: 'swarm_status',
    defer_loading: true,
    priority: 'medium',
    category: 'swarm'
  },
  {
    name: 'agent/create',
    defer_loading: true,
    priority: 'medium',
    category: 'swarm'
  },
  {
    name: 'agent/list',
    defer_loading: true,
    priority: 'medium',
    category: 'swarm'
  },

  // Resource management
  {
    name: 'resource/register',
    defer_loading: true,
    priority: 'low',
    category: 'resource'
  },
  {
    name: 'resource/get-statistics',
    defer_loading: true,
    priority: 'low',
    category: 'resource'
  },

  // Messaging
  {
    name: 'message/send',
    defer_loading: true,
    priority: 'low',
    category: 'message'
  },
  {
    name: 'message/get-metrics',
    defer_loading: true,
    priority: 'low',
    category: 'message'
  },

  // Monitoring
  {
    name: 'monitor/get-metrics',
    defer_loading: true,
    priority: 'low',
    category: 'monitor'
  },
  {
    name: 'monitor/get-alerts',
    defer_loading: true,
    priority: 'low',
    category: 'monitor'
  },

  // System metrics
  {
    name: 'system/metrics',
    defer_loading: true,
    priority: 'low',
    category: 'system'
  },

  // Batch operations (programmatic calling)
  {
    name: 'batch/query-memories',
    defer_loading: true,
    priority: 'medium',
    category: 'batch'
  },
  {
    name: 'batch/create-tasks',
    defer_loading: true,
    priority: 'medium',
    category: 'batch'
  },
  {
    name: 'batch/agent-status',
    defer_loading: true,
    priority: 'medium',
    category: 'batch'
  },
];

/**
 * Get all tool configurations
 */
export function getAllToolConfigs(): DeferredToolConfig[] {
  return [...CORE_TOOLS, ...DEFERRED_TOOLS];
}

/**
 * Get configuration for a specific tool
 */
export function getToolConfig(toolName: string): DeferredToolConfig | undefined {
  return getAllToolConfigs().find(t => t.name === toolName);
}

/**
 * Check if a tool should be loaded immediately
 */
export function shouldLoadImmediately(toolName: string): boolean {
  const config = getToolConfig(toolName);
  return config ? !config.defer_loading : false;
}

/**
 * Check if a tool should be deferred
 */
export function shouldDefer(toolName: string): boolean {
  const config = getToolConfig(toolName);
  return config ? config.defer_loading : true; // Default to deferred for unknown tools
}

/**
 * Get tools by priority
 */
export function getToolsByPriority(priority: DeferredToolConfig['priority']): DeferredToolConfig[] {
  return getAllToolConfigs().filter(t => t.priority === priority);
}

/**
 * Get tools by category
 */
export function getToolsByCategory(category: string): DeferredToolConfig[] {
  return getAllToolConfigs().filter(t => t.category === category);
}

/**
 * Check if context suggests a tool should be loaded
 */
export function shouldLoadForContext(toolName: string, contextText: string): boolean {
  const config = getToolConfig(toolName);
  if (!config || !config.loadConditions?.contextKeywords) {
    return false;
  }

  const lowerContext = contextText.toLowerCase();
  return config.loadConditions.contextKeywords.some(
    keyword => lowerContext.includes(keyword.toLowerCase())
  );
}

/**
 * Calculate token savings statistics
 */
export function calculateTokenSavings(): {
  coreToolCount: number;
  deferredToolCount: number;
  totalTools: number;
  estimatedCoreTokens: number;
  estimatedDeferredTokens: number;
  estimatedSavings: number;
  savingsPercent: string;
} {
  const coreToolCount = CORE_TOOLS.length;
  const deferredToolCount = DEFERRED_TOOLS.length;
  const totalTools = coreToolCount + deferredToolCount;

  // Estimates: ~3000 tokens per full tool, ~40 tokens per metadata-only
  const tokensPerFullTool = 3000;
  const tokensPerMetadata = 40;

  const estimatedCoreTokens = coreToolCount * tokensPerFullTool;
  const estimatedDeferredTokens = deferredToolCount * tokensPerMetadata;

  const withoutDeferred = totalTools * tokensPerFullTool;
  const withDeferred = estimatedCoreTokens + estimatedDeferredTokens;
  const estimatedSavings = withoutDeferred - withDeferred;
  const savingsPercent = ((estimatedSavings / withoutDeferred) * 100).toFixed(1);

  return {
    coreToolCount,
    deferredToolCount,
    totalTools,
    estimatedCoreTokens,
    estimatedDeferredTokens,
    estimatedSavings,
    savingsPercent: `${savingsPercent}%`
  };
}
