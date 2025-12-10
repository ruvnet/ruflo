/**
 * A2A Protocol Type Definitions
 * Agent-to-Agent Communication Protocol
 */

// ===== CORE MESSAGE TYPES =====

export interface A2AMessage {
  // Protocol metadata
  protocol: 'A2A';
  version: string;
  messageId: string;
  timestamp: Date;
  
  // Routing information
  sender: AgentIdentity;
  receivers: AgentIdentity[];
  routing: RoutingInfo;
  
  // Message content
  type: MessageType;
  payload: any;
  metadata: MessageMetadata;
  
  // Delivery guarantees
  delivery: DeliveryGuarantee;
  priority: MessagePriority;
  ttl?: number;
  
  // Security
  signature?: string;
  encryption?: EncryptionInfo;
}

export interface AgentIdentity {
  id: string;
  type: AgentType;
  version: string;
  capabilities: AgentCapabilities;
  endpoint?: string;
  swarmId?: string;
  metadata?: Record<string, any>;
}

export interface AgentCapabilities {
  // Core capabilities
  codeGeneration: boolean;
  codeReview: boolean;
  testing: boolean;
  documentation: boolean;
  research: boolean;
  analysis: boolean;
  
  // Communication capabilities
  webSearch: boolean;
  apiIntegration: boolean;
  fileSystem: boolean;
  terminalAccess: boolean;
  
  // Specialized capabilities
  languages: string[];
  frameworks: string[];
  domains: string[];
  tools: string[];
  
  // Resource limits
  maxConcurrentTasks: number;
  maxMemoryUsage: number;
  maxExecutionTime: number;
  
  // Performance characteristics
  reliability: number; // 0-1 reliability score
  speed: number; // Relative speed rating
  quality: number; // Quality rating
}

export interface RoutingInfo {
  strategy: RoutingStrategy;
  hops: string[];
  cost: number;
  preferredChannels?: string[];
  fallbackStrategy?: RoutingStrategy;
}

export interface MessageMetadata {
  correlationId?: string;
  causationId?: string;
  replyTo?: string;
  contentType: string;
  encoding: string;
  size: number;
  compressed: boolean;
  encrypted: boolean;
  checksum?: string;
  route?: string[];
  deadLetterReason?: string;
  deadLetterTimestamp?: Date;
}

export interface EncryptionInfo {
  algorithm: string;
  keyId: string;
  iv?: string;
  tag?: string;
}

// ===== MESSAGE TYPES =====

export type MessageType = 
  // Core communication
  | 'request'           // Request-response pattern
  | 'response'          // Response to request
  | 'notification'      // Fire-and-forget message
  | 'broadcast'         // Broadcast to multiple agents
  
  // Task coordination
  | 'task_assignment'   // Assign task to agent
  | 'task_update'       // Update task status
  | 'task_result'       // Return task result
  | 'task_cancellation' // Cancel task
  
  // Memory operations
  | 'memory_store'      // Store data in shared memory
  | 'memory_retrieve'   // Retrieve data from memory
  | 'memory_query'      // Query memory with filters
  | 'memory_delete'     // Delete memory entry
  
  // Coordination
  | 'coordination_request'  // Request coordination
  | 'coordination_response' // Response to coordination
  | 'consensus_proposal'    // Propose consensus
  | 'consensus_vote'        // Vote on consensus
  
  // System events
  | 'agent_join'        // Agent joining swarm
  | 'agent_leave'        // Agent leaving swarm
  | 'heartbeat'          // Health check
  | 'error_report'       // Error notification
  
  // Custom types
  | 'custom';           // Custom message type

export type DeliveryGuarantee = 
  | 'best_effort'      // No delivery guarantee
  | 'at_least_once'    // Message delivered at least once
  | 'at_most_once'     // Message delivered at most once
  | 'exactly_once'     // Message delivered exactly once
  | 'ordered'          // Messages delivered in order
  | 'transactional';    // Atomic delivery

export type MessagePriority = 'low' | 'normal' | 'high' | 'critical';

export type RoutingStrategy = 
  | 'direct'           // Direct agent-to-agent
  | 'broadcast'        // Broadcast to all
  | 'multicast'        // Multicast to group
  | 'anycast'          // Any available agent
  | 'hierarchical'     // Through hierarchy
  | 'mesh'             // Peer-to-peer mesh
  | 'gossip'           // Gossip protocol
  | 'flooding';        // Flooding algorithm

export type AgentType = 
  | 'claude-code'      // Claude Code agent
  | 'codex'            // OpenAI Codex agent
  | 'gemini'           // Google Gemini agent
  | 'copilot'          // GitHub Copilot agent
  | 'custom';          // Custom agent type

// ===== PROTOCOL HANDLER INTERFACES =====

export interface A2AProtocolHandler {
  // Core operations
  sendMessage(message: A2AMessage): Promise<string>;
  receiveMessage(messageId: string): Promise<A2AMessage>;
  acknowledgeMessage(messageId: string): Promise<void>;
  
  // Routing
  routeMessage(message: A2AMessage): Promise<RoutingResult>;
  discoverAgents(filter?: AgentFilter): Promise<AgentIdentity[]>;
  
  // Memory integration
  storeInMemory(key: string, value: any, options?: MemoryOptions): Promise<void>;
  retrieveFromMemory(key: string, options?: MemoryOptions): Promise<any>;
  
  // Event integration
  emitEvent(event: A2AEvent): Promise<void>;
  subscribeToEvents(filter: EventFilter): Promise<string>;
  
  // Lifecycle
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface AgentAdapter {
  // Agent identification
  getIdentity(): AgentIdentity;
  getCapabilities(): AgentCapabilities;
  
  // Message handling
  canHandleMessage(type: MessageType): boolean;
  handleMessage(message: A2AMessage): Promise<A2AMessage | void>;
  
  // Tool integration
  getAvailableTools(): ToolDefinition[];
  executeTool(toolName: string, parameters: any): Promise<any>;
  
  // Memory access
  readMemory(key: string): Promise<any>;
  writeMemory(key: string, value: any): Promise<void>;
  
  // Event handling
  onEvent(event: A2AEvent): Promise<void>;
  
  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface A2ATransport {
  // Connection management
  connect(endpoint: string): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  
  // Message transmission
  send(message: A2AMessage): Promise<void>;
  receive(): Promise<A2AMessage>;
  
  // Event handling
  onMessage(handler: (message: A2AMessage) => void): void;
  onError(handler: (error: Error) => void): void;
  onDisconnect(handler: () => void): void;
  
  // Configuration
  configure(options: TransportOptions): void;
  getMetrics(): TransportMetrics;
}

// ===== SUPPORTING TYPES =====

export interface RoutingResult {
  targets: DeliveryTarget[];
  hops: string[];
  cost: number;
  estimatedLatency: number;
  success: boolean;
  error?: string;
}

export interface DeliveryTarget {
  type: 'agent' | 'channel' | 'queue' | 'topic';
  id: string;
  address?: string;
  priority?: number;
}

export interface AgentFilter {
  types?: AgentType[];
  capabilities?: Partial<AgentCapabilities>;
  swarmId?: string;
  tags?: string[];
  excludeIds?: string[];
}

export interface MemoryOptions {
  ttl?: number;
  consistency?: ConsistencyLevel;
  replicate?: boolean;
  notifyAgents?: AgentIdentity[];
}

export interface A2AEvent {
  id: string;
  type: string;
  timestamp: Date;
  source: AgentIdentity;
  data: any;
  targets?: AgentIdentity[];
}

export interface EventFilter {
  types?: string[];
  sources?: AgentIdentity[];
  data?: Record<string, any>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
  returns: any;
  capabilities: string[];
}

export interface TransportOptions {
  timeout?: number;
  retries?: number;
  compression?: boolean;
  encryption?: boolean;
  keepAlive?: boolean;
}

export interface TransportMetrics {
  messagesSent: number;
  messagesReceived: number;
  bytesTransferred: number;
  averageLatency: number;
  errorRate: number;
  connectionUptime: number;
}

export type ConsistencyLevel = 
  | 'strong'           // Strong consistency
  | 'eventual'         // Eventual consistency
  | 'weak'             // Weak consistency
  | 'session';         // Session consistency

// ===== ERROR TYPES =====

export interface A2AError extends Error {
  type: A2AErrorType;
  code: string;
  context: Record<string, any>;
  recoverable: boolean;
  retryable: boolean;
}

export type A2AErrorType = 
  | 'protocol_error'      // Protocol violation
  | 'delivery_error'      // Message delivery failed
  | 'authentication_error' // Authentication failed
  | 'authorization_error'   // Authorization failed
  | 'timeout_error'        // Operation timeout
  | 'network_error'        // Network connectivity issue
  | 'agent_error'          // Agent-specific error
  | 'memory_error'         // Memory operation failed
  | 'routing_error'        // Message routing failed
  | 'serialization_error';  // Message serialization failed

// ===== SECURITY TYPES =====

export interface A2AAuthentication {
  authenticateAgent(identity: AgentIdentity, credentials: any): Promise<boolean>;
  signMessage(message: A2AMessage, privateKey: string): Promise<string>;
  verifyMessage(message: A2AMessage, publicKey: string): Promise<boolean>;
  checkPermission(agent: AgentIdentity, resource: string, action: string): Promise<boolean>;
  issueToken(agent: AgentIdentity, scope: string[]): Promise<string>;
  validateToken(token: string): Promise<AgentIdentity | null>;
}

export interface A2AEncryption {
  encryptMessage(message: A2AMessage, key: string): Promise<A2AMessage>;
  decryptMessage(message: A2AMessage, key: string): Promise<A2AMessage>;
  generateKeyPair(): Promise<{ publicKey: string; privateKey: string }>;
  deriveSharedKey(publicKey: string, privateKey: string): Promise<string>;
  createSecureChannel(agents: AgentIdentity[]): Promise<string>;
  destroySecureChannel(channelId: string): Promise<void>;
}

// ===== PERFORMANCE TYPES =====

export interface A2ACompression {
  compressMessage(message: A2AMessage): Promise<A2AMessage>;
  decompressMessage(message: A2AMessage): Promise<A2AMessage>;
  algorithms: string[];
  selectAlgorithm(message: A2AMessage): string;
  estimateCompressionRatio(message: A2AMessage): number;
}

export interface A2ACaching {
  cacheMessage(message: A2AMessage, ttl: number): Promise<void>;
  getCachedMessage(messageId: string): Promise<A2AMessage | null>;
  cacheAgentCapabilities(agentId: string, capabilities: AgentCapabilities): Promise<void>;
  getCachedCapabilities(agentId: string): Promise<AgentCapabilities | null>;
  cacheMemoryEntry(key: string, value: any, ttl: number): Promise<void>;
  getCachedMemoryEntry(key: string): Promise<any | null>;
}

// ===== ERROR RECOVERY TYPES =====

export interface A2AErrorRecovery {
  retryMessage(message: A2AMessage, maxRetries: number): Promise<void>;
  fallbackDelivery(message: A2AMessage): Promise<void>;
  reportError(error: A2AError, context: any): Promise<void>;
  checkCircuitBreaker(agentId: string): Promise<boolean>;
  openCircuitBreaker(agentId: string): Promise<void>;
  closeCircuitBreaker(agentId: string): Promise<void>;
}

// ===== TESTING TYPES =====

export interface A2AProtocolTests {
  validateMessageFormat(message: A2AMessage): Promise<boolean>;
  testDeliveryGuarantee(guarantee: DeliveryGuarantee): Promise<boolean>;
  benchmarkMessageThroughput(): Promise<number>;
  benchmarkMessageLatency(): Promise<number>;
  testAgentCompatibility(agents: AgentAdapter[]): Promise<boolean>;
}

export interface A2AIntegrationTests {
  testEndToEndCommunication(agents: AgentAdapter[]): Promise<boolean>;
  testMemorySynchronization(): Promise<boolean>;
  testEventPropagation(): Promise<boolean>;
  testErrorHandling(): Promise<boolean>;
}

// ===== UTILITY TYPES =====

export interface A2AConfig {
  // Protocol settings
  version: string;
  timeout: number;
  maxRetries: number;
  
  // Security settings
  authentication: boolean;
  encryption: boolean;
  signing: boolean;
  
  // Performance settings
  compression: boolean;
  caching: boolean;
  compressionAlgorithm: string;
  
  // Transport settings
  transport: TransportOptions;
  
  // Memory settings
  memory: MemoryOptions;
  
  // Logging settings
  logging: {
    enabled: boolean;
    level: string;
    format: string;
  };
}

export interface A2AMetrics {
  // Message metrics
  messagesSent: number;
  messagesReceived: number;
  messagesDelivered: number;
  messagesFailed: number;
  
  // Performance metrics
  averageLatency: number;
  throughput: number;
  errorRate: number;
  
  // Agent metrics
  activeAgents: number;
  discoveredAgents: number;
  
  // Memory metrics
  memoryOperations: number;
  memoryHitRate: number;
  
  // Network metrics
  bytesTransferred: number;
  connectionCount: number;
}

// ===== TYPE GUARDS =====

export function isA2AMessage(obj: any): obj is A2AMessage {
  return obj && 
    obj.protocol === 'A2A' && 
    typeof obj.version === 'string' &&
    typeof obj.messageId === 'string' &&
    obj.timestamp instanceof Date &&
    isAgentIdentity(obj.sender) &&
    Array.isArray(obj.receivers) &&
    typeof obj.type === 'string';
}

export function isAgentIdentity(obj: any): obj is AgentIdentity {
  return obj &&
    typeof obj.id === 'string' &&
    typeof obj.type === 'string' &&
    typeof obj.version === 'string' &&
    isAgentCapabilities(obj.capabilities);
}

export function isAgentCapabilities(obj: any): obj is AgentCapabilities {
  return obj &&
    typeof obj.codeGeneration === 'boolean' &&
    typeof obj.codeReview === 'boolean' &&
    typeof obj.testing === 'boolean' &&
    typeof obj.documentation === 'boolean' &&
    typeof obj.research === 'boolean' &&
    typeof obj.analysis === 'boolean' &&
    Array.isArray(obj.languages) &&
    Array.isArray(obj.frameworks) &&
    Array.isArray(obj.domains) &&
    Array.isArray(obj.tools) &&
    typeof obj.maxConcurrentTasks === 'number' &&
    typeof obj.maxMemoryUsage === 'number' &&
    typeof obj.maxExecutionTime === 'number' &&
    typeof obj.reliability === 'number' &&
    typeof obj.speed === 'number' &&
    typeof obj.quality === 'number';
}

export function isA2AError(obj: any): obj is A2AError {
  return obj instanceof Error &&
    typeof obj.type === 'string' &&
    typeof obj.code === 'string' &&
    typeof obj.context === 'object' &&
    typeof obj.recoverable === 'boolean' &&
    typeof obj.retryable === 'boolean';
}

// ===== CONSTANTS =====

export const A2A_CONSTANTS = {
  // Protocol version
  PROTOCOL_VERSION: '1.0.0',
  
  // Message limits
  MAX_MESSAGE_SIZE: 1024 * 1024, // 1MB
  MAX_RECEIVERS: 1000,
  MAX_HOPS: 10,
  
  // Timeouts
  DEFAULT_TIMEOUT: 30000, // 30 seconds
  HEARTBEAT_INTERVAL: 10000, // 10 seconds
  DISCOVERY_INTERVAL: 60000, // 1 minute
  
  // Retry settings
  DEFAULT_MAX_RETRIES: 3,
  RETRY_BACKOFF_MULTIPLIER: 2,
  MAX_RETRY_DELAY: 30000, // 30 seconds
  
  // Compression
  COMPRESSION_THRESHOLD: 1024, // 1KB
  SUPPORTED_ALGORITHMS: ['gzip', 'brotli', 'lz4'],
  
  // Security
  SIGNATURE_ALGORITHM: 'RS256',
  ENCRYPTION_ALGORITHM: 'AES-256-GCM',
  
  // Performance
  CACHE_TTL: 300000, // 5 minutes
  METRICS_INTERVAL: 10000, // 10 seconds
  
  // Error codes
  ERROR_CODES: {
    PROTOCOL_VIOLATION: 'A2A_PROTOCOL_001',
    DELIVERY_FAILED: 'A2A_DELIVERY_001',
    AUTHENTICATION_FAILED: 'A2A_AUTH_001',
    AUTHORIZATION_FAILED: 'A2A_AUTH_002',
    TIMEOUT: 'A2A_TIMEOUT_001',
    NETWORK_ERROR: 'A2A_NETWORK_001',
    AGENT_ERROR: 'A2A_AGENT_001',
    MEMORY_ERROR: 'A2A_MEMORY_001',
    ROUTING_ERROR: 'A2A_ROUTING_001',
    SERIALIZATION_ERROR: 'A2A_SERIAL_001'
  }
} as const;

// ===== EXPORTS =====

export default {
  A2A_CONSTANTS,
  isA2AMessage,
  isAgentIdentity,
  isAgentCapabilities,
  isA2AError
};