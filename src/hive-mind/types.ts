/**
 * Hive Mind Type Definitions
 *
 * Core types and interfaces for the Hive Mind system.
 * This file imports centralized agent types and defines hive-mind specific types.
 */

// Import centralized agent types
import type { AgentType } from '../constants/agent-types.js';

// ===== SWARM CONFIGURATION TYPES =====

export type SwarmTopology = 'mesh' | 'hierarchical' | 'ring' | 'star' | 'specs-driven';
export type QueenMode = 'centralized' | 'distributed' | 'strategic';

export interface HiveMindConfig {
  name: string;
  topology: SwarmTopology;
  maxAgents: number;
  queenMode: QueenMode;
  memoryTTL: number;
  consensusThreshold: number;
  autoSpawn: boolean;
  enableConsensus?: boolean;
  enableMemory?: boolean;
  enableCommunication?: boolean;
  enabledFeatures?: string[];
  createdAt?: Date;
}

// ===== AGENT TYPES (Re-export centralized types) =====

// Re-export centralized AgentType
export type { AgentType } from '../constants/agent-types.js';

export type AgentStatus = 'idle' | 'busy' | 'active' | 'error' | 'offline';

/**
 * Comprehensive agent capabilities for hive mind operations
 */
export type AgentCapability =
  // Core coordination capabilities
  | 'task_management'
  | 'resource_allocation'
  | 'consensus_building'
  
  // Research and analysis capabilities
  | 'information_gathering'
  | 'pattern_recognition'
  | 'knowledge_synthesis'
  | 'data_analysis'
  | 'performance_metrics'
  | 'bottleneck_detection'
  
  // Development capabilities
  | 'code_generation'
  | 'refactoring'
  | 'debugging'
  | 'test_generation'
  | 'quality_assurance'
  | 'edge_case_detection'
  
  // Architecture capabilities
  | 'system_design'
  | 'architecture'
  | 'architecture_patterns'
  | 'integration_planning'
  
  // Review and quality capabilities
  | 'code_review'
  | 'standards_enforcement'
  | 'best_practices'
  
  // Optimization capabilities
  | 'performance_optimization'
  | 'resource_optimization'
  | 'algorithm_improvement'
  
  // Documentation capabilities
  | 'documentation_generation'
  | 'technical_writing'
  | 'api_docs'
  | 'user_guides'
  
  // Monitoring capabilities
  | 'system_monitoring'
  | 'health_checks'
  | 'alerting'
  
  // Specialized capabilities
  | 'domain_expertise'
  | 'custom_capabilities'
  | 'problem_solving'
  
  // Maestro specs-driven capabilities
  | 'requirements_analysis'
  | 'user_story_creation'
  | 'acceptance_criteria'
  | 'specs_driven_design'
  | 'workflow_orchestration'
  | 'governance';

export interface AgentConfig {
  id?: string;
  name: string;
  type: AgentType;
  swarmId: string;
  capabilities: AgentCapability[];
}

export interface AgentSpawnOptions {
  type: AgentType;
  name?: string;
  capabilities?: AgentCapability[];
  autoAssign?: boolean;
  config?: Partial<AgentConfig>;
  environment?: Partial<AgentEnvironment>;
}

export interface AgentEnvironment {
  workingDirectory?: string;
  environmentVariables?: Record<string, string>;
  resourceLimits?: {
    maxMemory?: number;
    maxCpu?: number;
    timeout?: number;
  };
}

// ===== TASK TYPES =====

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type TaskStrategy = 'parallel' | 'sequential' | 'adaptive' | 'consensus';
export type TaskStatus =
  | 'pending'
  | 'assigned'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface Task {
  id: string;
  swarmId: string;
  description: string;
  priority: TaskPriority;
  strategy: TaskStrategy;
  status: TaskStatus;
  progress: number;
  result?: any;
  error?: string;
  dependencies: string[];
  assignedAgents: string[];
  requireConsensus: boolean;
  consensusAchieved?: boolean;
  maxAgents: number;
  requiredCapabilities: AgentCapability[];
  createdAt: Date;
  assignedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  metadata: any;
}

export interface TaskSubmitOptions {
  description: string;
  priority: TaskPriority;
  strategy: TaskStrategy;
  dependencies?: string[];
  assignTo?: string;
  requireConsensus?: boolean;
  maxAgents?: number;
  requiredCapabilities?: AgentCapability[];
  metadata?: any;
}

export interface TaskAssignment {
  role: string;
  requiredCapabilities: AgentCapability[];
  responsibilities: string[];
  expectedOutput: string;
  timeout: number;
  canRunParallel: boolean;
}

// ===== COMMUNICATION TYPES =====

export type MessageType =
  | 'direct'
  | 'broadcast'
  | 'consensus'
  | 'query'
  | 'response'
  | 'notification'
  | 'task_assignment'
  | 'progress_update'
  | 'coordination'
  | 'channel';

export type MessagePriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Message {
  id: string;
  fromAgentId: string;
  toAgentId: string | null;
  swarmId: string;
  type: MessageType;
  content: any;
  priority?: MessagePriority;
  timestamp: Date;
  requiresResponse: boolean;
}

export interface CommunicationChannel {
  name: string;
  description: string;
  type: 'public' | 'private';
  subscribers: string[];
  createdAt: Date;
}

export interface CommunicationStats {
  totalMessages: number;
  avgLatency: number;
  activeChannels: number;
  messagesByType: Record<MessageType, number>;
  throughput: number;
}

// ===== MEMORY TYPES =====

export interface MemoryEntry {
  key: string;
  namespace: string;
  value: string;
  ttl?: number;
  createdAt: Date;
  accessCount: number;
  lastAccessedAt: Date;
  expiresAt?: Date;
}

export interface MemoryNamespace {
  name: string;
  description: string;
  retentionPolicy: 'persistent' | 'time-based' | 'size-based';
  ttl?: number;
  maxEntries?: number;
  lastOperation?: string;
  lastOperationTime?: Date;
}

export interface MemoryStats {
  totalEntries: number;
  totalSize: number;
  byNamespace: Record<
    string,
    {
      entries: number;
      size: number;
      avgTTL: number;
    }
  >;
  cacheHitRate: number;
  avgAccessTime: number;
  hotKeys: string[];
}

export interface MemorySearchOptions {
  namespace?: string;
  pattern?: string;
  keyPrefix?: string;
  minAccessCount?: number;
  limit?: number;
  sortBy?: 'access' | 'recent' | 'created';
}

export interface MemoryPattern {
  type: 'co-access' | 'temporal' | 'frequency';
  keys: string[];
  confidence: number;
  frequency: number;
}

// ===== CONSENSUS TYPES =====

export interface ConsensusProposal {
  id: string;
  swarmId: string;
  taskId?: string;
  proposal: any;
  requiredThreshold: number;
  deadline?: Date;
  creator?: string;
  metadata?: Record<string, any>;
}

export interface ConsensusVote {
  proposalId: string;
  agentId: string;
  vote: boolean;
  reason?: string;
  timestamp: Date;
}

export interface ConsensusResult {
  proposalId: string;
  achieved: boolean;
  finalRatio: number;
  totalVotes: number;
  positiveVotes: number;
  negativeVotes: number;
  participationRate: number;
}

export interface VotingStrategy {
  name: string;
  description: string;
  threshold: number;
  recommend: (
    proposal: ConsensusProposal,
    analysis: any,
  ) => {
    vote: boolean;
    confidence: number;
    reasoning: string;
    factors: string[];
  };
}

export interface ConsensusMetrics {
  totalProposals: number;
  achievedConsensus: number;
  failedConsensus: number;
  avgVotingTime: number;
  avgParticipation: number;
}

// ===== ORCHESTRATION TYPES =====

export interface ExecutionPlan {
  taskId: string;
  strategy: TaskStrategy;
  phases: string[];
  phaseAssignments: TaskAssignment[][];
  dependencies: string[];
  checkpoints: any[];
  parallelizable: boolean;
  estimatedDuration: number;
  resourceRequirements: any;
}

export interface OrchestrationResult {
  taskId: string;
  success: boolean;
  executionTime: number;
  phaseResults: any[];
  errors?: any[];
}

export interface ExecutionResult {
  success: boolean;
  data: any;
  executionTime: number;
  agentId: string;
  metadata?: any;
}

// ===== QUEEN COORDINATION TYPES =====

export interface QueenDecision {
  id: string;
  taskId: string;
  strategy: CoordinationStrategy;
  selectedAgents: string[];
  executionPlan: any;
  confidence: number;
  rationale: string;
  timestamp: Date;
}

export interface CoordinationStrategy {
  name: string;
  description: string;
  phases: string[];
  maxAgents: number;
  coordinationPoints: string[];
  suitable_for: string[];
}

// ===== STATUS AND MONITORING TYPES =====

export interface SwarmStatus {
  swarmId: string;
  name: string;
  topology: SwarmTopology;
  queenMode: QueenMode;
  health: 'healthy' | 'degraded' | 'critical' | 'unknown';
  uptime: number;
  agents: Array<{
    id: string;
    name: string;
    type: AgentType;
    status: AgentStatus;
    currentTask: string | null;
    messageCount: number;
    createdAt: number;
  }>;
  agentsByType: Record<AgentType, number>;
  tasks: Array<{
    id: string;
    description: string;
    status: TaskStatus;
    priority: TaskPriority;
    progress: number;
    assignedAgent: string | null;
  }>;
  taskStats: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    failed: number;
  };
  memoryStats: MemoryStats;
  communicationStats: CommunicationStats;
  performance: {
    avgTaskCompletion: number;
    messageThroughput: number;
    consensusSuccessRate: number;
    memoryHitRate: number;
    agentUtilization: number;
  };
  warnings: string[];
}

// ===== NEURAL PATTERN TYPES =====

export interface NeuralPattern {
  id: string;
  swarmId: string;
  patternType: 'coordination' | 'optimization' | 'prediction' | 'behavior';
  patternData: any;
  confidence: number;
  usageCount: number;
  successRate: number;
  createdAt: Date;
  lastUsedAt?: Date;
}

// ===== PERFORMANCE TYPES =====

export interface PerformanceMetric {
  swarmId: string;
  agentId?: string;
  metricType: string;
  metricValue: number;
  timestamp: Date;
  metadata?: any;
}

// ===== TYPE UTILITIES =====

/**
 * Type guard to check if a value is a valid AgentType
 */
export function isValidAgentType(type: string): type is AgentType {
  const validTypes = [
    'coordinator', 'researcher', 'coder', 'analyst', 'architect', 'tester',
    'reviewer', 'optimizer', 'documenter', 'monitor', 'specialist',
    'requirements_analyst', 'design_architect', 'task_planner',
    'implementation_coder', 'quality_reviewer', 'steering_documenter'
  ];
  return validTypes.includes(type as AgentType);
}

/**
 * Type guard to check if a value is a valid TaskStatus
 */
export function isValidTaskStatus(status: string): status is TaskStatus {
  const validStatuses: TaskStatus[] = ['pending', 'assigned', 'in_progress', 'completed', 'failed', 'cancelled'];
  return validStatuses.includes(status as TaskStatus);
}

/**
 * Type guard to check if a value is a valid AgentStatus
 */
export function isValidAgentStatus(status: string): status is AgentStatus {
  const validStatuses: AgentStatus[] = ['idle', 'busy', 'active', 'error', 'offline'];
  return validStatuses.includes(status as AgentStatus);
}