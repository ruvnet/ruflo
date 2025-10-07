# Azure Agent Configuration Schema

## Overview
This document defines the complete configuration schema for the Azure Agent, including connection settings, behavior configuration, and operational parameters.

## Configuration Structure

```typescript
interface AzureAgentConfig {
  // Core connection settings
  connection: ConnectionConfig;

  // Azure authentication
  authentication: AuthenticationConfig;

  // Operational behavior
  behavior: BehaviorConfig;

  // Error handling and retry
  errorHandling: ErrorHandlingConfig;

  // Performance tuning
  performance: PerformanceConfig;

  // Integration settings
  integration: IntegrationConfig;

  // Logging and monitoring
  observability: ObservabilityConfig;

  // Security settings
  security: SecurityConfig;
}
```

## Connection Configuration

```typescript
interface ConnectionConfig {
  // MCP server connection
  mcpServer: {
    // Server URL or connection string
    url?: string;

    // Connection protocol
    protocol: 'websocket' | 'http' | 'stdio';

    // Timeout settings
    timeout: number; // milliseconds, default: 30000

    // Keepalive settings
    keepalive?: {
      enabled: boolean;
      interval: number; // milliseconds
      timeout: number; // milliseconds
    };

    // Reconnection settings
    reconnect?: {
      enabled: boolean;
      maxAttempts: number;
      backoff: BackoffStrategy;
    };
  };

  // Azure environment
  azure: {
    // Azure cloud environment
    environment: 'AzureCloud' | 'AzureUSGovernment' | 'AzureChinaCloud' | 'AzureGermanCloud';

    // Default subscription ID
    subscriptionId?: string;

    // Default tenant ID
    tenantId?: string;

    // Default resource group
    defaultResourceGroup?: string;

    // Default location
    defaultLocation?: string;

    // API version preferences
    apiVersions?: Record<string, string>;
  };
}

interface BackoffStrategy {
  type: 'exponential' | 'linear' | 'fixed';
  baseDelay: number; // milliseconds
  maxDelay: number; // milliseconds
  factor?: number; // for exponential backoff
}
```

## Authentication Configuration

```typescript
interface AuthenticationConfig {
  // Authentication method
  method: AuthMethod;

  // Credentials (method-specific)
  credentials: AuthCredentials;

  // Token caching
  tokenCache?: {
    enabled: boolean;
    location?: string; // file path or cache key
    ttl?: number; // seconds
  };

  // Token refresh
  tokenRefresh?: {
    enabled: boolean;
    threshold: number; // refresh when token expires in N seconds
  };
}

type AuthMethod =
  | 'azure-cli'           // Use Azure CLI credentials
  | 'managed-identity'    // Use Azure Managed Identity
  | 'service-principal'   // Use Service Principal
  | 'device-code'         // Use device code flow
  | 'interactive'         // Interactive browser login
  | 'environment';        // Use environment variables

type AuthCredentials =
  | AzureCliCredentials
  | ManagedIdentityCredentials
  | ServicePrincipalCredentials
  | DeviceCodeCredentials
  | InteractiveCredentials
  | EnvironmentCredentials;

interface ServicePrincipalCredentials {
  clientId: string;
  clientSecret?: string;
  certificatePath?: string;
  tenantId: string;
}

interface ManagedIdentityCredentials {
  clientId?: string; // User-assigned managed identity
}

interface AzureCliCredentials {
  // No credentials needed, uses Azure CLI
}

interface DeviceCodeCredentials {
  clientId: string;
  tenantId: string;
}

interface InteractiveCredentials {
  clientId: string;
  tenantId: string;
  redirectUri?: string;
}

interface EnvironmentCredentials {
  // Uses standard Azure environment variables:
  // AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID
}
```

## Behavior Configuration

```typescript
interface BehaviorConfig {
  // Execution mode
  mode: 'interactive' | 'automated' | 'dry-run';

  // Confirmation prompts
  confirmations: {
    destructiveOperations: boolean; // e.g., delete, purge
    costlyOperations: boolean; // operations with significant cost
    securityChanges: boolean; // security policy changes
    threshold?: number; // auto-approve below cost threshold
  };

  // Default behaviors
  defaults: {
    // Wait for operation completion
    waitForCompletion: boolean;

    // Poll interval for async operations
    pollInterval: number; // milliseconds

    // Maximum wait time
    maxWaitTime: number; // milliseconds

    // Output format
    outputFormat: 'json' | 'table' | 'minimal';

    // Verbose logging
    verbose: boolean;
  };

  // Resource tagging
  tagging: {
    // Auto-tag all resources
    enabled: boolean;

    // Default tags
    defaultTags: Record<string, string>;

    // Tag sources
    tagSources?: Array<'user' | 'git' | 'environment' | 'timestamp'>;
  };

  // Naming conventions
  naming: {
    // Enforce naming convention
    enforce: boolean;

    // Naming pattern
    pattern?: string; // e.g., "{env}-{service}-{resource}-{region}"

    // Allowed characters
    allowedChars?: RegExp;

    // Auto-generate names
    autoGenerate: boolean;
  };
}
```

## Error Handling Configuration

```typescript
interface ErrorHandlingConfig {
  // Retry configuration
  retry: {
    // Enable automatic retry
    enabled: boolean;

    // Maximum retry attempts
    maxAttempts: number;

    // Retry strategy
    strategy: RetryStrategy;

    // Retryable error categories
    retryableErrors: ErrorCategory[];

    // Backoff configuration
    backoff: BackoffStrategy;
  };

  // Rollback configuration
  rollback: {
    // Enable automatic rollback on failure
    enabled: boolean;

    // Rollback strategy
    strategy: 'full' | 'partial' | 'manual';

    // Save rollback checkpoints
    saveCheckpoints: boolean;

    // Checkpoint storage
    checkpointStorage?: string; // file path or database
  };

  // Error reporting
  reporting: {
    // Report errors to external service
    enabled: boolean;

    // Error tracking service
    service?: 'sentry' | 'applicationinsights' | 'custom';

    // Include stack traces
    includeStackTraces: boolean;

    // Include sensitive data
    includeSensitiveData: boolean;

    // Custom endpoint
    endpoint?: string;
  };

  // Fallback behaviors
  fallbacks: {
    // Use cached data on error
    useCachedData: boolean;

    // Continue on non-critical errors
    continueOnError: boolean;

    // Degraded mode operations
    degradedMode: boolean;
  };
}

type RetryStrategy = 'immediate' | 'exponential' | 'linear' | 'adaptive';

type ErrorCategory =
  | 'network'
  | 'authentication'
  | 'authorization'
  | 'validation'
  | 'throttling'
  | 'server_error'
  | 'not_found'
  | 'conflict'
  | 'timeout';
```

## Performance Configuration

```typescript
interface PerformanceConfig {
  // Caching configuration
  cache: {
    // Enable caching
    enabled: boolean;

    // Cache implementation
    implementation: 'memory' | 'redis' | 'file';

    // Cache settings
    settings: {
      // Maximum cache size (MB)
      maxSize?: number;

      // Default TTL (seconds)
      defaultTtl: number;

      // Per-resource TTL
      resourceTtl?: Record<string, number>;

      // Eviction policy
      evictionPolicy: 'lru' | 'lfu' | 'fifo';
    };

    // Redis configuration (if using Redis)
    redis?: {
      host: string;
      port: number;
      password?: string;
      db?: number;
    };
  };

  // Request batching
  batching: {
    // Enable request batching
    enabled: boolean;

    // Maximum batch size
    maxBatchSize: number;

    // Batch window (milliseconds)
    batchWindow: number;

    // Batch similar requests
    groupSimilar: boolean;
  };

  // Concurrency limits
  concurrency: {
    // Maximum concurrent requests
    maxConcurrent: number;

    // Per-resource-type limits
    perResourceType?: Record<string, number>;

    // Queue size
    queueSize: number;

    // Queue strategy
    queueStrategy: 'fifo' | 'priority';
  };

  // Rate limiting
  rateLimiting: {
    // Enable rate limiting
    enabled: boolean;

    // Requests per second
    requestsPerSecond: number;

    // Burst size
    burstSize: number;

    // Per-operation limits
    perOperation?: Record<string, number>;
  };

  // Connection pooling
  connectionPool: {
    // Enable connection pooling
    enabled: boolean;

    // Pool size
    size: number;

    // Idle timeout (seconds)
    idleTimeout: number;

    // Connection timeout (seconds)
    connectionTimeout: number;
  };

  // Streaming settings
  streaming: {
    // Enable streaming for large responses
    enabled: boolean;

    // Chunk size (bytes)
    chunkSize: number;

    // Buffer size
    bufferSize: number;
  };
}
```

## Integration Configuration

```typescript
interface IntegrationConfig {
  // Claude Flow integration
  claudeFlow: {
    // Enable integration
    enabled: boolean;

    // Hooks configuration
    hooks: {
      // Pre-operation hooks
      preTask: boolean;
      preEdit: boolean;

      // Post-operation hooks
      postTask: boolean;
      postEdit: boolean;

      // Session hooks
      sessionRestore: boolean;
      sessionEnd: boolean;

      // Notify hook
      notify: boolean;
    };

    // Memory integration
    memory: {
      // Enable memory storage
      enabled: boolean;

      // Memory namespace
      namespace: string;

      // Store operation results
      storeResults: boolean;

      // Store errors
      storeErrors: boolean;

      // Memory TTL (seconds)
      ttl?: number;
    };

    // Swarm coordination
    swarm: {
      // Enable swarm coordination
      enabled: boolean;

      // Swarm topology
      topology?: 'mesh' | 'hierarchical' | 'adaptive';

      // Agent role
      role?: string;

      // Coordination patterns
      patterns?: string[];
    };
  };

  // External integrations
  external: {
    // GitHub integration
    github?: {
      enabled: boolean;
      token?: string;
      repositories?: string[];
    };

    // Terraform integration
    terraform?: {
      enabled: boolean;
      stateBackend?: string;
      variables?: Record<string, any>;
    };

    // Kubernetes integration
    kubernetes?: {
      enabled: boolean;
      kubeconfig?: string;
      context?: string;
    };

    // CI/CD integration
    cicd?: {
      provider: 'github-actions' | 'azure-devops' | 'jenkins';
      webhooks?: boolean;
      notifications?: boolean;
    };
  };

  // Webhook endpoints
  webhooks?: {
    // Webhook URL
    url: string;

    // Events to send
    events: WebhookEvent[];

    // Authentication
    authentication?: {
      type: 'bearer' | 'basic' | 'apikey';
      credentials: any;
    };

    // Retry on failure
    retry?: boolean;
  }[];
}

type WebhookEvent =
  | 'operation.started'
  | 'operation.completed'
  | 'operation.failed'
  | 'resource.created'
  | 'resource.updated'
  | 'resource.deleted'
  | 'error.occurred';
```

## Observability Configuration

```typescript
interface ObservabilityConfig {
  // Logging configuration
  logging: {
    // Log level
    level: 'debug' | 'info' | 'warn' | 'error';

    // Log format
    format: 'json' | 'text' | 'pretty';

    // Log destination
    destination: 'console' | 'file' | 'both';

    // File path (if destination includes 'file')
    filePath?: string;

    // Log rotation
    rotation?: {
      enabled: boolean;
      maxSize: string; // e.g., "10m", "100k"
      maxFiles: number;
    };

    // Include sensitive data
    includeSensitive: boolean;

    // Structured logging fields
    fields?: Record<string, any>;
  };

  // Metrics configuration
  metrics: {
    // Enable metrics collection
    enabled: boolean;

    // Metrics exporter
    exporter: 'prometheus' | 'statsd' | 'applicationinsights' | 'custom';

    // Export endpoint
    endpoint?: string;

    // Collection interval (seconds)
    interval: number;

    // Custom metrics
    custom?: MetricDefinition[];
  };

  // Tracing configuration
  tracing: {
    // Enable distributed tracing
    enabled: boolean;

    // Tracing provider
    provider: 'opentelemetry' | 'applicationinsights' | 'jaeger';

    // Sampling rate (0.0 to 1.0)
    samplingRate: number;

    // Trace context propagation
    propagation: boolean;

    // Export endpoint
    endpoint?: string;
  };

  // Health checks
  healthChecks: {
    // Enable health check endpoint
    enabled: boolean;

    // Health check interval (seconds)
    interval: number;

    // Checks to perform
    checks: HealthCheck[];
  };
}

interface MetricDefinition {
  name: string;
  type: 'counter' | 'gauge' | 'histogram';
  description: string;
  labels?: string[];
}

interface HealthCheck {
  name: string;
  type: 'azure-connection' | 'mcp-server' | 'cache' | 'custom';
  timeout: number;
  critical: boolean;
}
```

## Security Configuration

```typescript
interface SecurityConfig {
  // Encryption settings
  encryption: {
    // Encrypt sensitive data at rest
    atRest: boolean;

    // Encrypt sensitive data in transit
    inTransit: boolean;

    // Encryption algorithm
    algorithm?: 'AES-256' | 'AES-128';

    // Key source
    keySource?: 'keyvault' | 'local' | 'environment';

    // Key identifier
    keyId?: string;
  };

  // Audit logging
  audit: {
    // Enable audit logging
    enabled: boolean;

    // Audit log destination
    destination: 'file' | 'eventhub' | 'loganalytics';

    // Audit events
    events: AuditEvent[];

    // Include request/response bodies
    includePayloads: boolean;

    // Retention period (days)
    retentionDays?: number;
  };

  // Access control
  accessControl: {
    // Require MFA for sensitive operations
    requireMfa?: boolean;

    // IP whitelist
    ipWhitelist?: string[];

    // IP blacklist
    ipBlacklist?: string[];

    // Resource access policies
    policies?: AccessPolicy[];
  };

  // Data protection
  dataProtection: {
    // Mask sensitive data in logs
    maskSensitiveData: boolean;

    // Sensitive field patterns
    sensitivePatterns?: string[];

    // PII detection
    piiDetection: boolean;

    // Data residency enforcement
    residencyEnforcement?: {
      enabled: boolean;
      allowedRegions: string[];
    };
  };

  // Compliance
  compliance: {
    // Compliance standards
    standards?: Array<'HIPAA' | 'PCI-DSS' | 'GDPR' | 'SOC2'>;

    // Compliance checks
    checks?: ComplianceCheck[];

    // Automatic remediation
    autoRemediate: boolean;
  };
}

type AuditEvent =
  | 'authentication'
  | 'authorization'
  | 'resource.create'
  | 'resource.update'
  | 'resource.delete'
  | 'policy.change'
  | 'role.assignment'
  | 'secret.access';

interface AccessPolicy {
  resource: string;
  actions: string[];
  principals: string[];
  conditions?: Record<string, any>;
}

interface ComplianceCheck {
  standard: string;
  rule: string;
  enabled: boolean;
  severity: 'critical' | 'high' | 'medium' | 'low';
}
```

## Configuration Examples

### Example 1: Production Configuration

```yaml
connection:
  mcpServer:
    protocol: websocket
    timeout: 60000
    keepalive:
      enabled: true
      interval: 30000
    reconnect:
      enabled: true
      maxAttempts: 5
      backoff:
        type: exponential
        baseDelay: 1000
        maxDelay: 30000

  azure:
    environment: AzureCloud
    defaultLocation: eastus

authentication:
  method: managed-identity
  credentials: {}
  tokenCache:
    enabled: true
    ttl: 3600

behavior:
  mode: automated
  confirmations:
    destructiveOperations: true
    costlyOperations: true
    securityChanges: true
    threshold: 100
  defaults:
    waitForCompletion: true
    pollInterval: 5000
    maxWaitTime: 600000
    outputFormat: json
    verbose: false
  tagging:
    enabled: true
    defaultTags:
      environment: production
      managedBy: azure-agent
    tagSources:
      - user
      - git
      - timestamp

errorHandling:
  retry:
    enabled: true
    maxAttempts: 3
    strategy: exponential
    retryableErrors:
      - network
      - throttling
      - server_error
    backoff:
      type: exponential
      baseDelay: 1000
      maxDelay: 30000
  rollback:
    enabled: true
    strategy: full
    saveCheckpoints: true
  reporting:
    enabled: true
    service: applicationinsights
    includeStackTraces: true
    includeSensitiveData: false

performance:
  cache:
    enabled: true
    implementation: redis
    settings:
      defaultTtl: 300
      evictionPolicy: lru
    redis:
      host: cache.redis.azure.com
      port: 6380
  batching:
    enabled: true
    maxBatchSize: 50
    batchWindow: 1000
  concurrency:
    maxConcurrent: 10
    queueSize: 100
    queueStrategy: priority
  rateLimiting:
    enabled: true
    requestsPerSecond: 100
    burstSize: 150

integration:
  claudeFlow:
    enabled: true
    hooks:
      preTask: true
      postTask: true
      postEdit: true
      notify: true
    memory:
      enabled: true
      namespace: swarm/azure-agent
      storeResults: true
      ttl: 86400
    swarm:
      enabled: true
      topology: mesh

observability:
  logging:
    level: info
    format: json
    destination: both
    filePath: /var/log/azure-agent.log
    rotation:
      enabled: true
      maxSize: 100m
      maxFiles: 10
    includeSensitive: false
  metrics:
    enabled: true
    exporter: applicationinsights
    interval: 60
  tracing:
    enabled: true
    provider: applicationinsights
    samplingRate: 0.1
  healthChecks:
    enabled: true
    interval: 30
    checks:
      - name: azure-connection
        type: azure-connection
        timeout: 5000
        critical: true
      - name: mcp-server
        type: mcp-server
        timeout: 5000
        critical: true

security:
  encryption:
    atRest: true
    inTransit: true
    algorithm: AES-256
    keySource: keyvault
  audit:
    enabled: true
    destination: loganalytics
    events:
      - authentication
      - authorization
      - resource.delete
      - policy.change
      - role.assignment
    includePayloads: false
    retentionDays: 90
  dataProtection:
    maskSensitiveData: true
    piiDetection: true
  compliance:
    standards:
      - SOC2
      - GDPR
    autoRemediate: false
```

### Example 2: Development Configuration

```yaml
connection:
  mcpServer:
    protocol: stdio
    timeout: 30000

  azure:
    environment: AzureCloud
    defaultLocation: eastus2
    defaultResourceGroup: dev-rg

authentication:
  method: azure-cli
  credentials: {}

behavior:
  mode: interactive
  confirmations:
    destructiveOperations: true
    costlyOperations: false
    securityChanges: false
  defaults:
    waitForCompletion: true
    pollInterval: 2000
    maxWaitTime: 300000
    outputFormat: table
    verbose: true
  tagging:
    enabled: true
    defaultTags:
      environment: development
      developer: local

errorHandling:
  retry:
    enabled: true
    maxAttempts: 2
    strategy: immediate
  rollback:
    enabled: true
    strategy: full
  reporting:
    enabled: false

performance:
  cache:
    enabled: true
    implementation: memory
    settings:
      defaultTtl: 60
      maxSize: 100
  concurrency:
    maxConcurrent: 5

integration:
  claudeFlow:
    enabled: true
    hooks:
      preTask: true
      postTask: true
    memory:
      enabled: true
      namespace: swarm/azure-agent-dev

observability:
  logging:
    level: debug
    format: pretty
    destination: console
    includeSensitive: false
  metrics:
    enabled: false
  tracing:
    enabled: false

security:
  dataProtection:
    maskSensitiveData: true
  audit:
    enabled: false
```

## Configuration Loading

### Priority Order
1. Command-line arguments (highest priority)
2. Environment variables
3. Configuration file (specified path)
4. Default configuration file (`~/.azure-agent/config.yaml`)
5. Built-in defaults (lowest priority)

### Environment Variables
All configuration options can be set via environment variables using the prefix `AZURE_AGENT_`:

```bash
AZURE_AGENT_CONNECTION_AZURE_SUBSCRIPTION_ID=xxx
AZURE_AGENT_AUTHENTICATION_METHOD=managed-identity
AZURE_AGENT_BEHAVIOR_MODE=automated
AZURE_AGENT_LOGGING_LEVEL=debug
```

### Configuration Validation
The agent validates all configuration on startup:
- Required fields must be present
- Values must match allowed types and ranges
- Conflicting options are detected
- Security misconfigurations are flagged

### Hot Reload
Certain configuration changes can be applied without restart:
- Logging level
- Cache settings
- Rate limiting
- Performance tuning

Critical settings require restart:
- Authentication
- MCP server connection
- Security settings
