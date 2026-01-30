/**
 * Type definitions for Claude Flow V3 Transport Layer
 *
 * Defines interfaces for batch request processing, protocol detection,
 * and transport layer optimization.
 *
 * @module @claude-flow/cli/transport/types
 * @version 3.0.0
 */

/**
 * Supported transport protocols
 */
export type TransportProtocol = 'stdio' | 'http' | 'websocket';

/**
 * Request processing modes
 */
export type ProcessingMode = 'single' | 'batch';

/**
 * Request priority levels
 */
export type RequestPriority = 'low' | 'normal' | 'high' | 'critical';

/**
 * Request complexity levels
 */
export type RequestComplexity = 'low' | 'medium' | 'high';

/**
 * Transport protocol capabilities
 */
export interface ProtocolCapabilities {
  /** Whether transport supports batch processing */
  supportsBatch: boolean;
  /** Maximum batch size for this transport */
  maxBatchSize: number;
  /** Average latency in milliseconds */
  latencyMs: number;
  /** Optional: Maximum concurrent connections */
  maxConnections?: number;
  /** Optional: Whether transport supports streaming */
  supportsStreaming?: boolean;
}

/**
 * Request pattern analysis result
 */
export interface RequestPattern {
  /** Pattern type classification */
  type: 'single' | 'batch-candidate' | 'streaming';
  /** Estimated request complexity */
  complexity: RequestComplexity;
  /** Request priority level */
  priority: RequestPriority;
  /** Request size in bytes */
  size: number;
  /** Number of related requests in recent history */
  relatedRequests: number;
  /** Potential for batch processing (0-1) */
  batchPotential: number;
  /** Optional: Expected response time */
  expectedLatency?: number;
  /** Optional: Resource requirements */
  resourceRequirements?: ResourceRequirements;
}

/**
 * Resource requirements for request processing
 */
export interface ResourceRequirements {
  /** CPU intensity (0-1) */
  cpuIntensity: number;
  /** Memory usage estimate in MB */
  memoryMB: number;
  /** I/O operations count */
  ioOperations: number;
  /** Network bandwidth estimate in KB/s */
  bandwidthKBps: number;
}

/**
 * Context for batch detection
 */
export interface BatchDetectionContext {
  /** User session identifier */
  sessionId?: string;
  /** Request priority override */
  priority?: RequestPriority;
  /** Whether request requires immediate response */
  requiresImmediateResponse?: boolean;
  /** Whether request has nested operations */
  hasNestedOperations?: boolean;
  /** Expected batch size if known */
  expectedBatchSize?: number;
  /** Client capabilities */
  clientCapabilities?: ClientCapabilities;
  /** Performance preferences */
  performancePreferences?: PerformancePreferences;
}

/**
 * Client capabilities for optimization
 */
export interface ClientCapabilities {
  /** Maximum concurrent requests client can handle */
  maxConcurrentRequests: number;
  /** Whether client supports batch responses */
  supportsBatchResponse: boolean;
  /** Client timeout preferences */
  timeoutMs: number;
  /** Whether client supports streaming responses */
  supportsStreaming?: boolean;
}

/**
 * Performance optimization preferences
 */
export interface PerformancePreferences {
  /** Prefer latency over throughput */
  optimizeForLatency: boolean;
  /** Prefer throughput over latency */
  optimizeForThroughput: boolean;
  /** Acceptable latency increase for batch efficiency */
  acceptableLatencyIncrease: number;
  /** Maximum memory usage limit */
  memoryLimitMB: number;
}

/**
 * Protocol detection result
 */
export interface DetectionResult {
  /** Detected transport protocol */
  transport: TransportProtocol;
  /** Recommended processing mode */
  processingMode: ProcessingMode;
  /** Analyzed request pattern */
  pattern: RequestPattern;
  /** Confidence score (0-1) */
  confidence: number;
  /** Optimization recommendations */
  recommendations: string[];
  /** Performance metrics */
  metrics?: TransportMetrics;
  /** Optional: Routing suggestions */
  routingSuggestions?: RoutingSuggestion[];
}

/**
 * Routing suggestion for request optimization
 */
export interface RoutingSuggestion {
  /** Suggestion type */
  type: 'batch-delay' | 'transport-upgrade' | 'priority-boost' | 'resource-scaling';
  /** Human-readable description */
  description: string;
  /** Expected performance impact */
  impact: {
    latencyChange: number; // Percentage change
    throughputChange: number; // Percentage change
    resourceChange: number; // Percentage change
  };
  /** Implementation effort required */
  effort: 'low' | 'medium' | 'high';
}

/**
 * Transport performance metrics
 */
export interface TransportMetrics {
  /** Request counts by transport-mode */
  requestCounts: Map<string, number>;
  /** Success rates by transport */
  successRates: Map<TransportProtocol, number>;
  /** Average latencies by transport-mode */
  averageLatencies: Map<string, number>;
  /** Batch processing efficiency */
  batchEfficiency: Map<TransportProtocol, number>;
  /** Error rates by transport */
  errorRates: Map<TransportProtocol, number>;
}

/**
 * Batch request configuration
 */
export interface BatchRequestConfig {
  /** Maximum batch size */
  maxBatchSize: number;
  /** Maximum time to wait for batch completion (ms) */
  maxWaitTime: number;
  /** Minimum batch size to trigger batch processing */
  minBatchSize: number;
  /** Whether to enable adaptive batching */
  adaptiveBatching: boolean;
  /** Batch timeout strategy */
  timeoutStrategy: 'fail-fast' | 'partial-success' | 'retry-individual';
  /** Error handling strategy */
  errorHandling: 'abort-all' | 'continue-on-error' | 'isolate-errors';
}

/**
 * Individual request within a batch
 */
export interface BatchRequest {
  /** Unique identifier for this request */
  id: string;
  /** Request method/operation */
  method: string;
  /** Request parameters */
  params: Record<string, unknown>;
  /** Request priority within batch */
  priority: RequestPriority;
  /** Optional timeout override */
  timeoutMs?: number;
  /** Optional retry configuration */
  retry?: RetryConfig;
}

/**
 * Batch processing result
 */
export interface BatchResult {
  /** Batch processing metadata */
  meta: {
    batchId: string;
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    processingTimeMs: number;
    transport: TransportProtocol;
  };
  /** Individual request results */
  results: BatchRequestResult[];
  /** Overall batch status */
  status: 'completed' | 'partial' | 'failed';
  /** Any batch-level errors */
  errors?: BatchError[];
}

/**
 * Individual request result within batch
 */
export interface BatchRequestResult {
  /** Request identifier */
  id: string;
  /** Processing status */
  status: 'success' | 'error' | 'timeout' | 'cancelled';
  /** Result data (if successful) */
  result?: unknown;
  /** Error information (if failed) */
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  /** Processing metrics */
  metrics: {
    processingTimeMs: number;
    queueTimeMs: number;
    retryCount: number;
  };
}

/**
 * Batch-level error information
 */
export interface BatchError {
  /** Error code */
  code: string;
  /** Error message */
  message: string;
  /** Affected request IDs */
  affectedRequests: string[];
  /** Error severity */
  severity: 'warning' | 'error' | 'critical';
  /** Recovery suggestions */
  recoverySuggestions?: string[];
}

/**
 * Retry configuration for requests
 */
export interface RetryConfig {
  /** Maximum number of retries */
  maxRetries: number;
  /** Delay between retries (ms) */
  retryDelay: number;
  /** Exponential backoff multiplier */
  backoffMultiplier: number;
  /** Maximum retry delay (ms) */
  maxRetryDelay: number;
  /** Conditions that trigger retry */
  retryOn: ('timeout' | 'server-error' | 'network-error')[];
}

/**
 * Transport layer configuration
 */
export interface TransportConfig {
  /** Default transport protocol */
  defaultTransport: TransportProtocol;
  /** Transport-specific configurations */
  transports: {
    stdio?: StdioTransportConfig;
    http?: HttpTransportConfig;
    websocket?: WebSocketTransportConfig;
  };
  /** Batch processing configuration */
  batch: BatchRequestConfig;
  /** Performance monitoring */
  monitoring: {
    enabled: boolean;
    metricsRetentionMs: number;
    detailedLogging: boolean;
  };
  /** Security configuration */
  security?: TransportSecurityConfig;
}

/**
 * Stdio transport configuration
 */
export interface StdioTransportConfig {
  /** Buffer size for stdin/stdout */
  bufferSize: number;
  /** Enable binary mode */
  binaryMode: boolean;
  /** Line delimiter */
  lineDelimiter: string;
  /** Timeout for operations */
  timeoutMs: number;
}

/**
 * HTTP transport configuration
 */
export interface HttpTransportConfig {
  /** Server host */
  host: string;
  /** Server port */
  port: number;
  /** Request timeout */
  timeoutMs: number;
  /** Keep-alive settings */
  keepAlive: boolean;
  /** Maximum concurrent connections */
  maxConnections: number;
  /** Compression settings */
  compression: {
    enabled: boolean;
    level: number;
  };
}

/**
 * WebSocket transport configuration
 */
export interface WebSocketTransportConfig {
  /** WebSocket URL */
  url: string;
  /** Reconnection settings */
  reconnect: {
    enabled: boolean;
    maxAttempts: number;
    delayMs: number;
  };
  /** Ping/pong settings */
  heartbeat: {
    enabled: boolean;
    intervalMs: number;
    timeoutMs: number;
  };
  /** Message queue size */
  queueSize: number;
}

/**
 * Transport security configuration
 */
export interface TransportSecurityConfig {
  /** Enable TLS/SSL */
  tls: boolean;
  /** Certificate validation */
  validateCertificates: boolean;
  /** Allowed cipher suites */
  cipherSuites?: string[];
  /** Authentication configuration */
  auth?: {
    type: 'none' | 'basic' | 'bearer' | 'custom';
    credentials?: Record<string, string>;
  };
  /** Rate limiting */
  rateLimit?: {
    enabled: boolean;
    requestsPerMinute: number;
    burstSize: number;
  };
}

/**
 * Transport layer statistics
 */
export interface TransportStats {
  /** Current active connections */
  activeConnections: number;
  /** Total requests processed */
  totalRequests: number;
  /** Batch requests processed */
  batchRequests: number;
  /** Single requests processed */
  singleRequests: number;
  /** Average processing time */
  averageProcessingTimeMs: number;
  /** Current throughput (requests/second) */
  currentThroughput: number;
  /** Error rate (0-1) */
  errorRate: number;
  /** Memory usage in MB */
  memoryUsageMB: number;
  /** Last updated timestamp */
  lastUpdated: Date;
}