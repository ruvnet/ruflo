/**
 * Agent system exports
 */

export { AgentManager } from './agent-manager.js';
export type { 
  AgentManagerConfig, 
  AgentTemplate, 
  AgentCluster, 
  AgentPool,
  ScalingPolicy,
  ScalingRule,
  AgentHealth,
  HealthIssue
} from './agent-manager.js';

export { AgentRegistry } from './agent-registry.js';
export type { 
  AgentRegistryEntry, 
  AgentQuery, 
  AgentStatistics 
} from './agent-registry.js';

export { AutoAgentCreator } from './auto-agent-creator.js';
export type { AgentCreationConfig } from './auto-agent-creator.js';

export { EnhancedAgentManager } from './enhanced-agent-manager.js';
export type { EnhancedAgentManagerConfig } from './enhanced-agent-manager.js';

// Re-export commonly used types
export type {
  AgentId,
  AgentType,
  AgentStatus,
  AgentState,
  AgentCapabilities,
  AgentConfig,
  AgentEnvironment,
  AgentMetrics,
  AgentError,
  TaskId,
  TaskDefinition
} from '../swarm/types.js';