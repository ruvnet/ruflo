/**
 * V3 CLI Services Index
 * Central registry for all background services
 */

export {
  WorkerDaemon,
  getDaemon,
  startDaemon,
  stopDaemon,
  type WorkerType,
} from './worker-daemon.js';

// Event Emitter Bridge for Dashboard
export {
  EventEmitterBridge,
  getEventEmitter,
  resetEventEmitter,
  type AgentStatusEvent,
  type TaskUpdateEvent,
  type MessageEvent,
  type MemoryOperationEvent,
  type TopologyChangeEvent,
  type MetricsUpdateEvent,
  type SwarmEvent,
  type ConsensusEvent,
  type ErrorEvent,
  type DashboardEvent,
  type EventServer as EventServerInterface,
  type EventListener,
  type BufferConfig,
  type AgentStatus,
  type AgentType,
  type TaskStatus as DashboardTaskStatus,
  type TaskPriority,
  type MessageType,
  type MessagePriority,
  type MemoryOperationType,
  type ExtendedMemoryOperationType,
  type TopologyType,
  type ErrorSeverity,
  type SystemMetrics,
  type AgentMetricsAggregate,
  type TaskMetricsAggregate,
  type MemoryMetricsAggregate,
  type AgentNode,
  type Connection,
  type VectorSearchResult,
  type TaskError,
  type TaskResult,
  type MessagePayload,
  type SwarmConfig,
} from './event-emitter.js';

export {
  HeadlessWorkerExecutor,
  HEADLESS_WORKER_TYPES,
  HEADLESS_WORKER_CONFIGS,
  LOCAL_WORKER_TYPES,
  LOCAL_WORKER_CONFIGS,
  ALL_WORKER_CONFIGS,
  isHeadlessWorker,
  isLocalWorker,
  getModelId,
  getWorkerConfig,
  type HeadlessWorkerType,
  type LocalWorkerType,
  type HeadlessWorkerConfig,
  type HeadlessExecutionResult,
  type HeadlessExecutorConfig,
  type HeadlessOptions,
  type PoolStatus,
  type SandboxMode,
  type ModelType,
  type OutputFormat,
  type ExecutionMode,
  type WorkerPriority,
  type WorkerConfig,
} from './headless-worker-executor.js';

// Container Worker Pool (Phase 3)
export {
  ContainerWorkerPool,
  type ContainerInfo,
  type ContainerPoolConfig,
  type ContainerExecutionOptions,
  type ContainerPoolStatus,
  type ContainerState,
} from './container-worker-pool.js';

// Worker Queue (Phase 4)
export {
  WorkerQueue,
  type QueueTask,
  type WorkerQueueConfig,
  type QueueStats,
  type WorkerRegistration,
  type TaskStatus,
} from './worker-queue.js';

// WebSocket Event Server
export {
  EventServer,
  getEventServer,
  startEventServer,
  stopEventServer,
  type EventServerConfig,
  type EventChannel,
  type ServerEvent,
  type ClientMessage,
  type ServerMessage,
} from './event-server.js';

// Re-export types
export type { default as WorkerDaemonType } from './worker-daemon.js';
export type { default as HeadlessWorkerExecutorType } from './headless-worker-executor.js';
export type { default as ContainerWorkerPoolType } from './container-worker-pool.js';
export type { default as WorkerQueueType } from './worker-queue.js';
