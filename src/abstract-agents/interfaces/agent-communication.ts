/**
 * Agent Communication Protocol
 * Defines standardized communication patterns between abstract agents
 */

import type { AgentId, AgentMessage, AgentEvent, EventType } from './abstract-coding-agent.js';

// ===== COMMUNICATION PROTOCOL INTERFACES =====

export interface AgentCommunicationProtocol {
  // Message sending
  sendMessage(to: AgentId, message: AgentMessage): Promise<void>;
  sendBroadcast(message: AgentMessage): Promise<void>;
  sendMulticast(to: AgentId[], message: AgentMessage): Promise<void>;
  
  // Message receiving
  receiveMessage(): Promise<AgentMessage>;
  receiveMessages(filter?: MessageFilter): Promise<AgentMessage[]>;
  
  // Event handling
  publishEvent(event: AgentEvent): Promise<void>;
  subscribeToEvents(eventTypes: EventType[]): Promise<void>;
  unsubscribeFromEvents(eventTypes: EventType[]): Promise<void>;
  
  // Connection management
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  
  // Health and status
  getConnectionStatus(): Promise<ConnectionStatus>;
  getMessageQueueStatus(): Promise<QueueStatus>;
}

// ===== MESSAGE FILTERING =====

export interface MessageFilter {
  from?: AgentId[];
  to?: AgentId[];
  type?: string[];
  priority?: string[];
  correlationId?: string;
  timestampRange?: {
    start: Date;
    end: Date;
  };
  contentFilter?: ContentFilter;
}

export interface ContentFilter {
  field: string;
  operator: 'equals' | 'contains' | 'matches' | 'exists';
  value: any;
}

// ===== CONNECTION STATUS =====

export interface ConnectionStatus {
  connected: boolean;
  lastConnected?: Date;
  lastDisconnected?: Date;
  connectionCount: number;
  errors: ConnectionError[];
  latency: number;
  throughput: number;
}

export interface ConnectionError {
  type: string;
  message: string;
  timestamp: Date;
  resolved: boolean;
}

// ===== QUEUE STATUS =====

export interface QueueStatus {
  pendingMessages: number;
  processedMessages: number;
  failedMessages: number;
  averageProcessingTime: number;
  queueSize: number;
  maxQueueSize: number;
}

// ===== MESSAGE ROUTING =====

export interface MessageRouter {
  route(message: AgentMessage): Promise<RoutingResult>;
  addRoute(route: MessageRoute): void;
  removeRoute(routeId: string): void;
  getRoutes(): MessageRoute[];
}

export interface MessageRoute {
  id: string;
  pattern: RoutePattern;
  handler: RouteHandler;
  priority: number;
  enabled: boolean;
}

export interface RoutePattern {
  from?: AgentId[];
  to?: AgentId[];
  type?: string[];
  content?: ContentPattern;
}

export interface ContentPattern {
  field: string;
  pattern: string;
  caseSensitive?: boolean;
}

export type RouteHandler = (message: AgentMessage) => Promise<void>;

export interface RoutingResult {
  routed: boolean;
  routeId?: string;
  error?: string;
  latency: number;
}

// ===== EVENT SYSTEM =====

export interface EventBus {
  // Event publishing
  publish(event: AgentEvent): Promise<void>;
  publishBatch(events: AgentEvent[]): Promise<void>;
  
  // Event subscription
  subscribe(eventType: EventType, handler: EventHandler): string;
  subscribePattern(pattern: EventPattern, handler: EventHandler): string;
  unsubscribe(subscriptionId: string): void;
  
  // Event filtering
  filterEvents(filter: EventFilter): Promise<AgentEvent[]>;
  
  // Event history
  getEventHistory(filter?: EventFilter): Promise<AgentEvent[]>;
  clearEventHistory(olderThan?: Date): Promise<void>;
}

export interface EventPattern {
  type?: EventType[];
  source?: AgentId[];
  data?: DataPattern;
  timestampRange?: {
    start: Date;
    end: Date;
  };
}

export interface DataPattern {
  field: string;
  operator: 'equals' | 'contains' | 'matches' | 'exists';
  value: any;
}

export interface EventFilter {
  types?: EventType[];
  sources?: AgentId[];
  correlationId?: string;
  timestampRange?: {
    start: Date;
    end: Date;
  };
  dataFilter?: DataPattern[];
}

export type EventHandler = (event: AgentEvent) => Promise<void>;

// ===== COORDINATION PROTOCOLS =====

export interface CoordinationProtocol {
  // Task coordination
  requestTask(task: TaskRequest): Promise<TaskResponse>;
  delegateTask(task: TaskDelegation): Promise<TaskDelegationResult>;
  coordinateTask(task: TaskCoordination): Promise<CoordinationResult>;
  
  // Consensus protocols
  proposeConsensus(proposal: ConsensusProposal): Promise<ConsensusResult>;
  voteOnProposal(proposalId: string, vote: Vote): Promise<void>;
  getConsensusStatus(proposalId: string): Promise<ConsensusStatus>;
  
  // Conflict resolution
  reportConflict(conflict: ConflictReport): Promise<void>;
  resolveConflict(conflictId: string, resolution: ConflictResolution): Promise<void>;
  getConflictStatus(conflictId: string): Promise<ConflictStatus>;
}

export interface TaskRequest {
  id: string;
  requester: AgentId;
  task: any;
  requirements: TaskRequirements;
  deadline?: Date;
  priority: number;
}

export interface TaskResponse {
  requestId: string;
  responder: AgentId;
  accepted: boolean;
  reason?: string;
  estimatedTime?: number;
  requirements?: TaskRequirements;
}

export interface TaskDelegation {
  id: string;
  delegator: AgentId;
  delegatee: AgentId;
  task: any;
  constraints: TaskConstraints;
  deadline?: Date;
}

export interface TaskDelegationResult {
  delegationId: string;
  accepted: boolean;
  reason?: string;
  estimatedCompletion?: Date;
  progressUpdates?: boolean;
}

export interface TaskCoordination {
  id: string;
  coordinator: AgentId;
  participants: AgentId[];
  task: any;
  coordinationStrategy: CoordinationStrategy;
  dependencies: TaskDependency[];
}

export interface CoordinationResult {
  coordinationId: string;
  success: boolean;
  participants: AgentId[];
  results: Record<string, any>;
  conflicts?: ConflictReport[];
}

export interface TaskRequirements {
  capabilities: string[];
  resources: ResourceRequirements;
  quality: QualityRequirements;
  constraints: TaskConstraints;
}

export interface ResourceRequirements {
  cpu: number;
  memory: number;
  storage: number;
  network: number;
  tokens?: number;
}

export interface QualityRequirements {
  minQuality: number;
  testCoverage: number;
  documentation: boolean;
  review: boolean;
}

export interface TaskConstraints {
  deadline?: Date;
  maxDuration?: number;
  maxCost?: number;
  security?: SecurityConstraints;
  compliance?: string[];
}

export interface SecurityConstraints {
  encryption: boolean;
  authentication: boolean;
  authorization: string[];
  audit: boolean;
}

export interface TaskDependency {
  taskId: string;
  dependencyType: 'finish-start' | 'start-start' | 'finish-finish' | 'start-finish';
  constraint?: string;
}

export type CoordinationStrategy = 
  | 'sequential'
  | 'parallel'
  | 'pipeline'
  | 'consensus'
  | 'voting'
  | 'hierarchical'
  | 'peer-to-peer';

// ===== CONSENSUS PROTOCOLS =====

export interface ConsensusProposal {
  id: string;
  proposer: AgentId;
  proposal: any;
  type: ConsensusType;
  deadline: Date;
  participants: AgentId[];
  quorum: number;
}

export type ConsensusType = 
  | 'task-assignment'
  | 'resource-allocation'
  | 'conflict-resolution'
  | 'quality-assessment'
  | 'architecture-decision'
  | 'custom';

export interface ConsensusResult {
  proposalId: string;
  reached: boolean;
  decision?: any;
  votes: Vote[];
  quorumMet: boolean;
  deadline: Date;
}

export interface Vote {
  voter: AgentId;
  decision: 'approve' | 'reject' | 'abstain';
  reason?: string;
  timestamp: Date;
  weight?: number;
}

export interface ConsensusStatus {
  proposalId: string;
  status: 'pending' | 'reached' | 'failed' | 'expired';
  votesReceived: number;
  votesRequired: number;
  timeRemaining: number;
  currentDecision?: any;
}

// ===== CONFLICT RESOLUTION =====

export interface ConflictReport {
  id: string;
  reporter: AgentId;
  type: ConflictType;
  description: string;
  participants: AgentId[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
  context: any;
}

export type ConflictType = 
  | 'task-assignment'
  | 'resource-contention'
  | 'quality-disagreement'
  | 'architecture-conflict'
  | 'deadline-conflict'
  | 'dependency-conflict'
  | 'custom';

export interface ConflictResolution {
  conflictId: string;
  resolver: AgentId;
  resolution: any;
  method: ResolutionMethod;
  justification: string;
  timestamp: Date;
}

export type ResolutionMethod = 
  | 'arbitration'
  | 'voting'
  | 'consensus'
  | 'hierarchical'
  | 'automatic'
  | 'manual';

export interface ConflictStatus {
  conflictId: string;
  status: 'reported' | 'investigating' | 'resolving' | 'resolved' | 'escalated';
  assignedTo?: AgentId;
  resolution?: ConflictResolution;
  escalationLevel: number;
  timeToResolution?: number;
}

// ===== SYNCHRONIZATION =====

export interface SynchronizationProtocol {
  // State synchronization
  synchronizeState(state: AgentState): Promise<SynchronizationResult>;
  requestStateSync(requester: AgentId): Promise<void>;
  
  // Data synchronization
  synchronizeData(data: SynchronizationData): Promise<DataSyncResult>;
  resolveDataConflict(conflict: DataConflict): Promise<DataConflictResolution>;
  
  // Clock synchronization
  synchronizeClock(): Promise<ClockSyncResult>;
  getGlobalTime(): Date;
}

export interface AgentState {
  agentId: AgentId;
  status: string;
  currentTask?: string;
  capabilities: any;
  metrics: any;
  lastUpdate: Date;
  version: number;
}

export interface SynchronizationResult {
  success: boolean;
  conflicts?: StateConflict[];
  resolvedConflicts?: StateConflictResolution[];
  syncTime: Date;
}

export interface StateConflict {
  field: string;
  localValue: any;
  remoteValue: any;
  conflictType: 'value' | 'version' | 'timestamp';
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface StateConflictResolution {
  conflict: StateConflict;
  resolution: any;
  method: 'local-wins' | 'remote-wins' | 'merge' | 'manual';
  timestamp: Date;
}

export interface SynchronizationData {
  type: string;
  data: any;
  metadata: DataMetadata;
  version: number;
  checksum: string;
}

export interface DataMetadata {
  source: AgentId;
  timestamp: Date;
  size: number;
  format: string;
  compression?: string;
}

export interface DataSyncResult {
  success: boolean;
  conflicts?: DataConflict[];
  syncTime: Date;
  bytesTransferred: number;
}

export interface DataConflict {
  field: string;
  localData: any;
  remoteData: any;
  conflictType: 'value' | 'version' | 'checksum';
  timestamp: Date;
}

export interface DataConflictResolution {
  conflict: DataConflict;
  resolution: any;
  method: 'local-wins' | 'remote-wins' | 'merge' | 'manual';
  timestamp: Date;
}

export interface ClockSyncResult {
  success: boolean;
  localTime: Date;
  globalTime: Date;
  offset: number;
  accuracy: number;
}

// ===== SECURITY PROTOCOLS =====

export interface SecurityProtocol {
  // Authentication
  authenticate(credentials: AuthenticationCredentials): Promise<AuthenticationResult>;
  refreshToken(token: string): Promise<TokenRefreshResult>;
  revokeToken(token: string): Promise<void>;
  
  // Authorization
  authorize(action: string, resource: string): Promise<AuthorizationResult>;
  checkPermission(permission: string): Promise<boolean>;
  
  // Encryption
  encrypt(data: any, key?: string): Promise<EncryptedData>;
  decrypt(encryptedData: EncryptedData, key?: string): Promise<any>;
  
  // Audit
  auditEvent(event: AuditEvent): Promise<void>;
  getAuditLog(filter?: AuditFilter): Promise<AuditLogEntry[]>;
}

export interface AuthenticationCredentials {
  type: 'api-key' | 'oauth' | 'jwt' | 'certificate' | 'custom';
  credentials: Record<string, string>;
  metadata?: any;
}

export interface AuthenticationResult {
  success: boolean;
  token?: string;
  expiresAt?: Date;
  permissions?: string[];
  error?: string;
}

export interface TokenRefreshResult {
  success: boolean;
  newToken?: string;
  expiresAt?: Date;
  error?: string;
}

export interface AuthorizationResult {
  authorized: boolean;
  reason?: string;
  permissions?: string[];
  restrictions?: string[];
}

export interface EncryptedData {
  data: string;
  algorithm: string;
  keyId?: string;
  iv?: string;
  tag?: string;
}

export interface AuditEvent {
  id: string;
  timestamp: Date;
  agentId: AgentId;
  action: string;
  resource: string;
  result: 'success' | 'failure' | 'error';
  details: any;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditFilter {
  agentId?: AgentId[];
  action?: string[];
  resource?: string[];
  result?: string[];
  timestampRange?: {
    start: Date;
    end: Date;
  };
}

export interface AuditLogEntry {
  id: string;
  timestamp: Date;
  agentId: AgentId;
  action: string;
  resource: string;
  result: string;
  details: any;
  ipAddress?: string;
  userAgent?: string;
}

// ===== EXPORTS =====

export default {
  AgentCommunicationProtocol,
  MessageRouter,
  EventBus,
  CoordinationProtocol,
  SynchronizationProtocol,
  SecurityProtocol,
};