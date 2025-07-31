/**
 * Centralized Type System Index
 * 
 * Single source of truth for all types used across the Claude Flow system.
 * This file consolidates types from various modules and provides a clean API.
 * 
 * ## Usage
 * 
 * Import types from this module instead of individual files:
 * 
 * ```typescript
 * // ✅ Preferred - consolidated import
 * import { AgentType, SwarmConfig, HookRegistration } from '../types/index.js';
 * 
 * // ❌ Avoid - individual file imports
 * import { AgentType } from '../constants/agent-types.js';
 * import { SwarmConfig } from '../swarm/types.js';
 * import { HookRegistration } from '../services/agentic-flow-hooks/types.js';
 * ```
 * 
 * ## Organization
 * 
 * Types are organized into logical sections:
 * - **Core Agent Types**: Centralized agent definitions and utilities
 * - **Hive Mind Types**: Swarm coordination, tasks, memory, consensus
 * - **Hook System Types**: Advanced hook system for workflow automation
 * - **System Configuration Types**: Configuration and infrastructure
 * - **Swarm System Types**: Advanced swarm coordination and monitoring
 * - **Maestro Types**: Specs-driven development workflow types
 * - **Type Utilities**: Generic utility types and helpers
 * 
 * @fileoverview Consolidated type definitions for Claude Flow
 * @version 1.0.0
 * @since 2024-01-01
 */

// ===== CORE AGENT TYPES =====
export type {
  AgentType,
} from '../constants/agent-types.js';

export {
  getValidAgentTypes,
  isValidAgentType,
  resolveLegacyAgentType,
  getAgentTypeSchema,
  LEGACY_AGENT_MAPPING,
} from '../constants/agent-types.js';

// ===== HIVE MIND TYPES =====
export type {
  // Configuration types
  SwarmTopology,
  QueenMode,
  HiveMindConfig,
  
  // Agent types (re-exported from centralized source)
  AgentStatus,
  AgentCapability,
  AgentConfig,
  AgentSpawnOptions,
  AgentEnvironment,
  
  // Task types
  TaskPriority,
  TaskStrategy,
  TaskStatus,
  Task,
  TaskSubmitOptions,
  TaskAssignment,
  
  // Communication types
  MessageType,
  MessagePriority,
  Message,
  CommunicationChannel,
  CommunicationStats,
  
  // Memory types
  MemoryEntry,
  MemoryNamespace,
  MemoryStats,
  MemorySearchOptions,
  MemoryPattern,
  
  // Consensus types
  ConsensusProposal,
  ConsensusVote,
  ConsensusResult,
  VotingStrategy,
  ConsensusMetrics,
  
  // Orchestration types
  ExecutionPlan,
  OrchestrationResult,
  ExecutionResult,
  
  // Queen coordination types
  QueenDecision,
  CoordinationStrategy,
  
  // Status and monitoring types
  SwarmStatus,
  
  // Neural pattern types
  NeuralPattern,
  
  // Performance types
  PerformanceMetric,
} from '../hive-mind/types.js';

export {
  isValidTaskStatus,
  isValidAgentStatus,
} from '../hive-mind/types.js';

// ===== HOOK SYSTEM TYPES =====
export type {
  // Core hook types
  AgenticHookContext,
  HookRegistration,
  HookPayload,
  AgenticHookType,
  HookHandlerResult,
  HookHandler,
  HookFilter,
  HookOptions,
  HookPipeline,
  PipelineStage,
  PipelineMetrics,
  SideEffect,
  
  // LLM hook types
  LLMHookType,
  LLMHookPayload,
  LLMRequest,
  LLMResponse,
  LLMMetrics,
  
  // Memory hook types
  MemoryHookType,
  MemoryHookPayload,
  
  // Neural hook types
  NeuralHookType,
  NeuralHookPayload,
  Pattern,
  TrainingData,
  Prediction,
  Adaptation,
  
  // Performance hook types
  PerformanceHookType,
  PerformanceHookPayload,
  BottleneckAnalysis,
  OptimizationSuggestion,
  
  // Workflow hook types
  WorkflowHookType,
  WorkflowHookPayload,
  WorkflowDecision,
  WorkflowMetrics,
  
  // Registry and management types
  HookRegistry,
  HookContextBuilder,
  PatternStore,
  TrainingState,
  
  // Legacy aliases (deprecated)
  AgenticHookContext as HookExecutionContext,
  HookRegistration as AgentHook,
  HookPayload as EventPayload,
  AgenticHookType as HookTrigger,
  HookHandlerResult as HookExecutionResult,
} from '../services/agentic-flow-hooks/types.js';

// ===== SYSTEM CONFIGURATION TYPES =====
export type {
  Config,
  LoggingConfig,
  OrchestratorMetrics,
  OrchestratorConfig,
  TerminalConfig,
  MemoryConfig,
  CoordinationConfig,
  MCPConfig,
  HealthStatus,
  ComponentHealth,
  Message as SystemMessage,
  Resource,
  MCPProtocolVersion,
  MCPCapabilities,
  MCPInitializeParams,
  MCPInitializeResult,
  MCPTool,
  MCPPrompt,
  MCPResource,
  MCPRequest,
  MCPResponse,
  MCPNotification,
  MCPError,
  MCPToolCall,
  MCPToolResult,
  MCPLogEntry,
  MCPSession,
  MCPAuthConfig,
  MCPLoadBalancerConfig,
  MCPMetrics,
  MCPContext,
  CredentialsConfig,
  SecurityConfig,
} from '../utils/types.js';

export {
  SystemEvents,
} from '../utils/types.js';

// ===== SWARM SYSTEM TYPES (Selected non-duplicates) =====
export type {
  // Swarm configuration types
  SwarmMode,
  SwarmStrategy,
  SwarmObjective,
  SwarmRequirements,
  SwarmConstraints,
  SwarmMilestone,
  TimeWindow,
  SwarmProgress,
  SwarmResults,
  SwarmMetrics,
  
  // Task coordination types
  TaskDependency,
  DependencyType,
  AgentSelectionStrategy,
  TaskSchedulingStrategy,
  LoadBalancingStrategy,
  FaultToleranceStrategy,
  CommunicationStrategy,
  
  // Memory management types
  SwarmMemory,
  MemoryPartition,
  MemoryType,
  AccessLevel,
  MemoryPermissions,
  ConsistencyLevel,
  
  // Monitoring types
  MonitoringConfig,
  SystemMetrics,
  Alert,
  AlertLevel,
  AlertType,
  
  // Event types
  SwarmEvent,
  EventType,
  SwarmEventEmitter,
  
  // Utility types
  SwarmConfig,
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from '../swarm/types.js';

export {
  SWARM_CONSTANTS,
  isAgentId,
  isTaskId,
  isSwarmEvent,
  isTaskDefinition,
  isAgentState,
} from '../swarm/types.js';

// ===== MAESTRO TYPES =====
export type {
  // Core maestro types
  MaestroSpec,
  WorkflowPhase,
  TaskItem,
  AgentProfile as MaestroAgentProfile,
  SteeringContext,
  MaestroWorkflowState,
  
  // Enhanced maestro types
  KiroEnhancedSpec,
  LivingDocumentationConfig,
  AgentHookConfig,
  ConsensusRequirements,
  PatternLearningConfig,
  SpecMetadata,
  EnhancedWorkflowPhase,
  QualityGate,
  QualityCriteria,
  
  // Living documentation types
  LivingDocumentationState,
  DocumentationChange,
  SyncConflict,
  
  // Consensus system types
  ConsensusSession,
  ConsensusParticipant,
  ConsensusRound,
  ConsensusDissent,
  
  // Hook system types
  AgentHookEvent,
  HookProcessingResult,
  
  // Pattern learning types
  PatternLearningData,
  SpecPattern,
  DesignPattern,
  ImplementationPattern,
  OutcomePattern,
  
  // Enhanced orchestrator types
  KiroEnhancedWorkflowState,
  QualityMetrics,
} from '../maestro/maestro-types.js';

// ===== TYPE UTILITIES =====

/**
 * Utility type to make all properties optional
 */
export type Partial<T> = {
  [P in keyof T]?: T[P];
};

/**
 * Utility type to make all properties required
 */
export type Required<T> = {
  [P in keyof T]-?: T[P];
};

/**
 * Utility type to pick specific properties from a type
 */
export type Pick<T, K extends keyof T> = {
  [P in K]: T[P];
};

/**
 * Utility type to omit specific properties from a type
 */
export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;

/**
 * Utility type for extracting the return type of a function
 */
export type ReturnType<T extends (...args: any) => any> = T extends (...args: any) => infer R ? R : any;

/**
 * Utility type for extracting parameter types from a function
 */
export type Parameters<T extends (...args: any) => any> = T extends (...args: infer P) => any ? P : never;

// ===== COMMON INTERFACES =====

/**
 * Base interface for entities with IDs
 */
export interface BaseEntity {
  id: string;
  createdAt: Date;
  updatedAt?: Date;
}

/**
 * Base interface for entities with metadata
 */
export interface BaseEntityWithMetadata extends BaseEntity {
  metadata?: Record<string, any>;
}

/**
 * Base interface for timestamped entities
 */
export interface Timestamped {
  timestamp: Date;
}

/**
 * Base interface for prioritized entities
 */
export interface Prioritized {
  priority: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Base interface for entities with status
 */
export interface WithStatus<T extends string> {
  status: T;
}

/**
 * Base interface for versioned entities
 */
export interface Versioned {
  version: string | number;
}

// ===== LEGACY COMPATIBILITY TYPES =====
// These types maintain backward compatibility with existing code

/**
 * @deprecated Use MemoryEntry from hive-mind types instead
 * 
 * Migration path:
 * ```typescript
 * // Old (deprecated)
 * import { LegacyMemoryEntry } from '../types/index.js';
 * 
 * // New (recommended)
 * import { MemoryEntry } from '../hive-mind/types.js';
 * ```
 */
export interface LegacyMemoryEntry {
  id: string;
  key: string;
  value: any;
  data?: any; // For backward compatibility - use 'value' instead
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  partition?: string; // Use 'namespace' in modern MemoryEntry
}

/**
 * @deprecated Use appropriate task types from hive-mind or swarm types instead
 * 
 * Migration path:
 * ```typescript
 * // Old (deprecated)
 * import { TaskId } from '../types/index.js';
 * const taskId: TaskId = 'simple-string';
 * 
 * // New (recommended)
 * import { TaskId } from '../swarm/types.js';
 * const taskId: TaskId = {
 *   id: 'task-123',
 *   swarmId: 'swarm-456', 
 *   sequence: 1,
 *   priority: 100
 * };
 * ```
 */
export type TaskId = string;

/**
 * Component monitoring types for backward compatibility
 */
export enum ComponentStatus {
  HEALTHY = 'healthy',
  WARNING = 'warning',
  ERROR = 'error',
  UNKNOWN = 'unknown',
}

/**
 * Alert types for monitoring - enhanced version of legacy AlertData
 */
export interface AlertData {
  id: string;
  level: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  timestamp: Date;
  component?: string;
  metadata?: Record<string, any>;
}

// ===== TYPE GUARDS =====

/**
 * Type guard to check if an object has an id property
 * 
 * @param obj - The object to check
 * @returns True if the object has a string id property
 * 
 * @example
 * ```typescript
 * const user = { id: '123', name: 'John' };
 * if (hasId(user)) {
 *   console.log(user.id); // TypeScript knows id is a string
 * }
 * ```
 */
export function hasId(obj: any): obj is { id: string } {
  return obj && typeof obj.id === 'string';
}

/**
 * Type guard to check if an object is timestamped
 * 
 * @param obj - The object to check
 * @returns True if the object has a Date timestamp property
 * 
 * @example
 * ```typescript
 * const event = { timestamp: new Date(), data: 'some data' };
 * if (isTimestamped(event)) {
 *   console.log(event.timestamp.toISOString()); // TypeScript knows timestamp is a Date
 * }
 * ```
 */
export function isTimestamped(obj: any): obj is Timestamped {
  return obj && obj.timestamp instanceof Date;
}

/**
 * Type guard to check if an object has priority
 * 
 * @param obj - The object to check
 * @returns True if the object has a valid priority level
 * 
 * @example
 * ```typescript
 * const task = { priority: 'high', description: 'Important task' };
 * if (isPrioritized(task)) {
 *   console.log(task.priority); // TypeScript knows priority is a valid level
 * }
 * ```
 */
export function isPrioritized(obj: any): obj is Prioritized {
  return obj && ['low', 'medium', 'high', 'critical'].includes(obj.priority);
}

/**
 * Type guard to check if an object has metadata
 * 
 * @param obj - The object to check
 * @returns True if the object has a metadata property that is an object
 * 
 * @example
 * ```typescript
 * const entity = { metadata: { source: 'api', version: 2 } };
 * if (hasMetadata(entity)) {
 *   console.log(entity.metadata.source); // TypeScript knows metadata exists
 * }
 * ```
 */
export function hasMetadata(obj: any): obj is { metadata: Record<string, any> } {
  return obj && typeof obj.metadata === 'object' && obj.metadata !== null;
}

// ===== EXPORTED CONSTANTS =====

/**
 * Common priority levels used across the system
 */
export const PRIORITY_LEVELS = ['low', 'medium', 'high', 'critical'] as const;

/**
 * Common status types used across the system
 */
export const COMMON_STATUS_TYPES = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
  MAX_AGENTS: 50,
  DEFAULT_TIMEOUT: 30000,
  DEFAULT_TTL: 3600000, // 1 hour
  MAX_RETRIES: 3,
} as const;