/**
 * V3 Hook System Types
 * Comprehensive type definitions for the enhanced hook system
 */

// ============================================
// Core Hook Types
// ============================================

/**
 * All available hook types in V3
 */
export type HookType =
  // Agent lifecycle hooks
  | 'agent:spawn:before'
  | 'agent:spawn:after'
  | 'agent:stop:before'
  | 'agent:stop:after'
  | 'agent:error'
  | 'agent:message'
  | 'agent:state-change'

  // Task hooks
  | 'task:create:before'
  | 'task:create:after'
  | 'task:start:before'
  | 'task:start:after'
  | 'task:complete'
  | 'task:fail'
  | 'task:decompose'
  | 'task:assign'

  // Swarm coordination hooks
  | 'swarm:init:before'
  | 'swarm:init:after'
  | 'swarm:coordinate:before'
  | 'swarm:coordinate:after'
  | 'swarm:consensus:start'
  | 'swarm:consensus:complete'
  | 'swarm:scale'
  | 'swarm:topology-change'

  // Memory hooks
  | 'memory:store:before'
  | 'memory:store:after'
  | 'memory:retrieve:before'
  | 'memory:retrieve:after'
  | 'memory:search:before'
  | 'memory:search:after'
  | 'memory:delete'
  | 'memory:sync'

  // Performance hooks
  | 'performance:benchmark:start'
  | 'performance:benchmark:end'
  | 'performance:metric'
  | 'performance:threshold-exceeded'
  | 'performance:optimize'

  // Learning/SONA hooks
  | 'learning:pattern:detected'
  | 'learning:pattern:stored'
  | 'learning:adapt'
  | 'learning:train:start'
  | 'learning:train:complete'
  | 'learning:feedback'

  // Session hooks
  | 'session:start'
  | 'session:end'
  | 'session:restore'
  | 'session:save'

  // MCP hooks
  | 'mcp:tool:call:before'
  | 'mcp:tool:call:after'
  | 'mcp:server:start'
  | 'mcp:server:stop'

  // General hooks
  | 'error'
  | 'warning'
  | 'log'
  | 'custom';

/**
 * Hook priority levels
 */
export type HookPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';

/**
 * Hook execution mode
 */
export type HookExecutionMode = 'sync' | 'async' | 'parallel' | 'sequential';

// ============================================
// Hook Context and Payload
// ============================================

/**
 * Base context available to all hooks
 */
export interface HookContext {
  /** Unique execution ID */
  executionId: string;
  /** Hook type being executed */
  hookType: HookType;
  /** Timestamp of hook execution */
  timestamp: number;
  /** Source of the hook trigger */
  source: string;
  /** Current session ID if available */
  sessionId?: string;
  /** Metadata from the trigger */
  metadata?: Record<string, unknown>;
  /** Parent context for nested hooks */
  parent?: HookContext;
}

/**
 * Agent-specific context
 */
export interface AgentHookContext extends HookContext {
  agentId: string;
  agentType: string;
  agentName: string;
  provider?: string;
  model?: string;
  capabilities?: string[];
}

/**
 * Task-specific context
 */
export interface TaskHookContext extends HookContext {
  taskId: string;
  taskDescription: string;
  taskPriority?: 'high' | 'medium' | 'low';
  assignedAgent?: string;
  dependencies?: string[];
  estimatedDuration?: number;
}

/**
 * Swarm-specific context
 */
export interface SwarmHookContext extends HookContext {
  swarmId: string;
  topology: string;
  agentCount: number;
  strategy: string;
  coordinatorId?: string;
}

/**
 * Memory-specific context
 */
export interface MemoryHookContext extends HookContext {
  namespace: string;
  key?: string;
  operation: 'store' | 'retrieve' | 'search' | 'delete' | 'sync';
  backend: string;
  isVector?: boolean;
}

/**
 * Performance-specific context
 */
export interface PerformanceHookContext extends HookContext {
  operation: string;
  duration?: number;
  metrics?: Record<string, number>;
  threshold?: number;
}

/**
 * Learning-specific context
 */
export interface LearningHookContext extends HookContext {
  patternId?: string;
  patternType?: string;
  confidence?: number;
  source?: string;
  rewardSignal?: number;
}

/**
 * Generic hook payload
 */
export interface HookPayload<T = unknown> {
  data: T;
  context: HookContext;
  modifiable?: boolean;
}

// ============================================
// Hook Handler Types
// ============================================

/**
 * Result returned by hook handlers
 */
export interface HookResult<T = unknown> {
  /** Whether to continue execution */
  continue: boolean;
  /** Whether the payload was modified */
  modified: boolean;
  /** Modified payload data */
  data?: T;
  /** Error if any */
  error?: Error;
  /** Side effects to process */
  sideEffects?: SideEffect[];
  /** Metrics from this hook execution */
  metrics?: HookMetrics;
  /** Message for logging */
  message?: string;
}

/**
 * Hook handler function signature
 */
export type HookHandler<TPayload = unknown, TResult = unknown> = (
  payload: HookPayload<TPayload>,
  context: HookContext
) => Promise<HookResult<TResult>> | HookResult<TResult>;

/**
 * Async hook handler
 */
export type AsyncHookHandler<TPayload = unknown, TResult = unknown> = (
  payload: HookPayload<TPayload>,
  context: HookContext
) => Promise<HookResult<TResult>>;

/**
 * Sync hook handler
 */
export type SyncHookHandler<TPayload = unknown, TResult = unknown> = (
  payload: HookPayload<TPayload>,
  context: HookContext
) => HookResult<TResult>;

// ============================================
// Hook Registration
// ============================================

/**
 * Hook registration configuration
 */
export interface HookRegistration<TPayload = unknown, TResult = unknown> {
  /** Unique hook ID */
  id: string;
  /** Hook type to listen for */
  type: HookType;
  /** Hook name for display */
  name: string;
  /** Hook description */
  description?: string;
  /** Handler function */
  handler: HookHandler<TPayload, TResult>;
  /** Execution priority (higher = earlier) */
  priority: number;
  /** Priority level for readability */
  priorityLevel?: HookPriority;
  /** Whether hook is enabled */
  enabled: boolean;
  /** Execution mode */
  mode?: HookExecutionMode;
  /** Filter conditions */
  filter?: HookFilter;
  /** Hook options */
  options?: HookOptions;
  /** Tags for categorization */
  tags?: string[];
  /** Version requirement */
  version?: string;
}

/**
 * Hook filter conditions
 */
export interface HookFilter {
  /** Filter by agent types */
  agentTypes?: string[];
  /** Filter by task types */
  taskTypes?: string[];
  /** Filter by namespaces */
  namespaces?: string[];
  /** Filter by providers */
  providers?: string[];
  /** Filter by patterns */
  patterns?: RegExp[];
  /** Custom filter function */
  custom?: (context: HookContext) => boolean;
}

/**
 * Hook options
 */
export interface HookOptions {
  /** Timeout in milliseconds */
  timeout?: number;
  /** Number of retries on failure */
  retries?: number;
  /** Retry delay in milliseconds */
  retryDelay?: number;
  /** Whether to run in isolated context */
  isolated?: boolean;
  /** Cache configuration */
  cache?: {
    enabled: boolean;
    ttl: number;
    key: (payload: HookPayload) => string;
  };
  /** Error handler */
  onError?: (error: Error, context: HookContext) => void;
  /** Fallback handler on failure */
  fallback?: HookHandler;
  /** Dependencies on other hooks */
  dependsOn?: string[];
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

// ============================================
// Side Effects
// ============================================

/**
 * Side effect types
 */
export type SideEffectType =
  | 'memory'
  | 'neural'
  | 'metric'
  | 'notification'
  | 'log'
  | 'event'
  | 'spawn-agent'
  | 'create-task'
  | 'update-state'
  | 'external-call';

/**
 * Side effect definition
 */
export interface SideEffect {
  type: SideEffectType;
  action: string;
  data: Record<string, unknown>;
  priority?: HookPriority;
  async?: boolean;
}

// ============================================
// Hook Pipeline
// ============================================

/**
 * Pipeline stage
 */
export interface PipelineStage {
  name: string;
  hooks: HookRegistration[];
  parallel?: boolean;
  condition?: (context: HookContext) => boolean;
  transform?: (result: HookResult) => HookResult;
  onError?: 'skip' | 'abort' | 'retry';
}

/**
 * Hook pipeline configuration
 */
export interface HookPipeline {
  id: string;
  name: string;
  description?: string;
  stages: PipelineStage[];
  errorStrategy: 'fail-fast' | 'continue' | 'rollback';
  metrics: PipelineMetrics;
}

/**
 * Pipeline metrics
 */
export interface PipelineMetrics {
  executions: number;
  avgDuration: number;
  errorRate: number;
  throughput: number;
  lastExecution?: number;
}

// ============================================
// Hook Metrics
// ============================================

/**
 * Metrics from hook execution
 */
export interface HookMetrics {
  /** Execution duration in ms */
  duration: number;
  /** Whether result was cached */
  cached?: boolean;
  /** Memory used */
  memoryUsed?: number;
  /** Tokens processed */
  tokensProcessed?: number;
  /** Custom metrics */
  custom?: Record<string, number>;
}

/**
 * Aggregated hook statistics
 */
export interface HookStatistics {
  hookId: string;
  hookType: HookType;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageDuration: number;
  p50Duration: number;
  p95Duration: number;
  p99Duration: number;
  cacheHitRate: number;
  lastExecutedAt?: number;
  errorTypes?: Record<string, number>;
}

// ============================================
// Hook Events
// ============================================

/**
 * Hook event types
 */
export type HookEventType =
  | 'hook:registered'
  | 'hook:unregistered'
  | 'hook:executing'
  | 'hook:executed'
  | 'hook:error'
  | 'hook:timeout'
  | 'hook:retry'
  | 'pipeline:start'
  | 'pipeline:complete'
  | 'pipeline:error';

/**
 * Hook event
 */
export interface HookEvent {
  type: HookEventType;
  hookId?: string;
  hookType?: HookType;
  pipelineId?: string;
  timestamp: number;
  data?: unknown;
  error?: Error;
}

// ============================================
// Hook Manager Interface
// ============================================

/**
 * Hook manager interface
 */
export interface IHookManager {
  /** Register a hook */
  register(registration: HookRegistration): void;

  /** Unregister a hook */
  unregister(hookId: string): void;

  /** Execute hooks for a type */
  execute<T>(type: HookType, payload: T, context?: Partial<HookContext>): Promise<HookResult<T>[]>;

  /** Get hooks by type */
  getHooks(type: HookType): HookRegistration[];

  /** Get hook by ID */
  getHook(hookId: string): HookRegistration | undefined;

  /** Enable/disable hook */
  setEnabled(hookId: string, enabled: boolean): void;

  /** Get hook statistics */
  getStatistics(hookId?: string): HookStatistics | HookStatistics[];

  /** Clear all hooks */
  clear(): void;

  /** Create a pipeline */
  createPipeline(config: Partial<HookPipeline>): HookPipeline;

  /** Execute a pipeline */
  executePipeline(pipelineId: string, payload: unknown, context?: Partial<HookContext>): Promise<HookResult[]>;
}

// ============================================
// Hook Composition Types
// ============================================

/**
 * Hook chain configuration
 */
export interface HookChain {
  id: string;
  name: string;
  hooks: HookRegistration[];
  mode: 'serial' | 'waterfall' | 'parallel' | 'race';
  stopOnError?: boolean;
  timeout?: number;
}

/**
 * Hook composition result
 */
export interface CompositionResult<T = unknown> {
  success: boolean;
  results: HookResult<T>[];
  aggregatedData?: T;
  errors: Error[];
  duration: number;
  hookCount: number;
}

/**
 * Hook combinator functions
 */
export interface HookCombinators {
  /** Run hooks in sequence, passing result to next */
  pipe<T>(...handlers: HookHandler<T>[]): HookHandler<T>;

  /** Run hooks in parallel */
  parallel<T>(...handlers: HookHandler<T>[]): HookHandler<T>;

  /** Run first successful hook */
  race<T>(...handlers: HookHandler<T>[]): HookHandler<T>;

  /** Run hooks and merge results */
  merge<T>(...handlers: HookHandler<T>[]): HookHandler<T>;

  /** Apply condition before running hook */
  when<T>(condition: (ctx: HookContext) => boolean, handler: HookHandler<T>): HookHandler<T>;

  /** Retry hook on failure */
  retry<T>(handler: HookHandler<T>, attempts: number, delay?: number): HookHandler<T>;

  /** Add timeout to hook */
  timeout<T>(handler: HookHandler<T>, ms: number): HookHandler<T>;

  /** Cache hook results */
  cache<T>(handler: HookHandler<T>, ttl: number, keyFn?: (payload: HookPayload<T>) => string): HookHandler<T>;
}

// ============================================
// Error Types
// ============================================

/**
 * Hook error
 */
export class HookError extends Error {
  constructor(
    message: string,
    public hookId: string,
    public hookType: HookType,
    public cause?: Error
  ) {
    super(message);
    this.name = 'HookError';
  }
}

/**
 * Hook timeout error
 */
export class HookTimeoutError extends HookError {
  constructor(hookId: string, hookType: HookType, timeout: number) {
    super(`Hook ${hookId} timed out after ${timeout}ms`, hookId, hookType);
    this.name = 'HookTimeoutError';
  }
}

/**
 * Hook validation error
 */
export class HookValidationError extends Error {
  constructor(
    message: string,
    public field: string,
    public value?: unknown
  ) {
    super(message);
    this.name = 'HookValidationError';
  }
}
