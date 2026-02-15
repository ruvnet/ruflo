/**
 * V3 MCP Types - Re-exported from @claude-flow/integrations
 *
 * CANONICAL SOURCE: @claude-flow/integrations/src/mcp/types.ts
 *
 * This file previously contained a full duplicate of MCP type definitions.
 * All types are now consolidated in the integrations package to avoid drift.
 */

// Re-export everything from the canonical source
export {
  // Core Protocol Types
  type JsonRpcVersion,
  type RequestId,
  type MCPMessage,
  type MCPRequest,
  type MCPResponse,
  type MCPNotification,
  type MCPError,

  // Server Configuration
  type TransportType,
  type AuthMethod,
  type AuthConfig,
  type LoadBalancerConfig,
  type ConnectionPoolConfig,
  type MCPServerConfig,

  // Session Types
  type SessionState,
  type MCPSession,
  type MCPClientInfo,

  // Capability Types
  type MCPCapabilities,
  type MCPProtocolVersion,
  type MCPInitializeParams,
  type MCPInitializeResult,

  // Tool Types
  type JSONSchema,
  type ToolContext,
  type ToolHandler,
  type MCPTool,
  type ToolCallResult,
  type ToolRegistrationOptions,

  // Resource Types (MCP 2025-11-25)
  type MCPResource,
  type ResourceContent,
  type ResourceTemplate,
  type ResourceListResult,
  type ResourceReadResult,

  // Prompt Types (MCP 2025-11-25)
  type PromptArgument,
  type MCPPrompt,
  type PromptRole,
  type ContentAnnotations,
  type TextContent,
  type ImageContent,
  type AudioContent,
  type EmbeddedResource,
  type PromptContent,
  type PromptMessage,
  type PromptListResult,
  type PromptGetResult,

  // Task Types (MCP 2025-11-25)
  type TaskState,
  type MCPTask,
  type TaskProgress,
  type TaskResult,

  // Pagination Types
  type PaginatedRequest,
  type PaginatedResult,

  // Progress & Cancellation Types
  type ProgressNotification,
  type CancellationParams,

  // Sampling Types
  type SamplingMessage,
  type ModelPreferences,
  type CreateMessageRequest,
  type CreateMessageResult,

  // Roots Types
  type Root,
  type RootsListResult,

  // Logging Types
  type MCPLogLevel,
  type LoggingMessage,

  // Completion Types
  type CompletionReference,
  type CompletionArgument,
  type CompletionResult,

  // Transport Types
  type RequestHandler,
  type NotificationHandler,
  type TransportHealthStatus,
  type ITransport,

  // Connection Pool Types
  type ConnectionState,
  type PooledConnection,
  type ConnectionPoolStats,
  type IConnectionPool,

  // Metrics Types
  type ToolCallMetrics,
  type MCPServerMetrics,
  type SessionMetrics,

  // Event Types
  type MCPEventType,
  type MCPEvent,
  type EventHandler,

  // Logger Interface
  type LogLevel,
  type ILogger,

  // Error Codes & Error Class (value exports)
  ErrorCodes,
  MCPServerError,
} from '../@claude-flow/integrations/src/mcp/types.js';
