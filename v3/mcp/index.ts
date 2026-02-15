/**
 * V3 MCP Module
 *
 * MCP (Model Context Protocol) implementation for Claude-Flow V3.
 *
 * CANONICAL SOURCE: @claude-flow/integrations/src/mcp/
 *
 * Types are re-exported from the integrations package (single source of truth).
 * Server, tool-registry, session-manager, connection-pool, and transport
 * implementations in this directory are kept for the server-entry.ts workflow
 * which loads tools from ./tools/index.js.
 *
 * @module @claude-flow/mcp
 * @version 3.0.0
 */

// Core types (canonical source: @claude-flow/integrations)
export {
  // Protocol types
  type JsonRpcVersion,
  type RequestId,
  type MCPMessage,
  type MCPRequest,
  type MCPResponse,
  type MCPNotification,
  type MCPError,

  // Server configuration
  type TransportType,
  type AuthMethod,
  type AuthConfig,
  type LoadBalancerConfig,
  type ConnectionPoolConfig,
  type MCPServerConfig,

  // Session types
  type SessionState,
  type MCPSession,
  type MCPClientInfo,

  // Capability types
  type MCPCapabilities,
  type MCPProtocolVersion,
  type MCPInitializeParams,
  type MCPInitializeResult,

  // Tool types
  type JSONSchema,
  type ToolContext,
  type ToolHandler,
  type MCPTool,
  type ToolCallResult,
  type ToolRegistrationOptions,

  // Resource types (MCP 2025-11-25)
  type MCPResource,
  type ResourceContent,
  type ResourceTemplate,
  type ResourceListResult,
  type ResourceReadResult,

  // Prompt types (MCP 2025-11-25)
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

  // Task types (MCP 2025-11-25)
  type TaskState,
  type MCPTask,
  type TaskProgress,
  type TaskResult,

  // Pagination types
  type PaginatedRequest,
  type PaginatedResult,

  // Progress & Cancellation types
  type ProgressNotification,
  type CancellationParams,

  // Sampling types
  type SamplingMessage,
  type ModelPreferences,
  type CreateMessageRequest,
  type CreateMessageResult,

  // Roots types
  type Root,
  type RootsListResult,

  // Logging types
  type MCPLogLevel,
  type LoggingMessage,

  // Completion types
  type CompletionReference,
  type CompletionArgument,
  type CompletionResult,

  // Transport types
  type RequestHandler,
  type NotificationHandler,
  type TransportHealthStatus,
  type ITransport,

  // Connection pool types
  type ConnectionState,
  type PooledConnection,
  type ConnectionPoolStats,
  type IConnectionPool,

  // Metrics types
  type ToolCallMetrics,
  type MCPServerMetrics,
  type SessionMetrics,

  // Event types
  type MCPEventType,
  type MCPEvent,
  type EventHandler,

  // Logger
  type LogLevel,
  type ILogger,

  // Error handling
  ErrorCodes,
  MCPServerError,
} from './types.js';

// Server (local implementation that loads ./tools/ on startup)
export {
  MCPServer,
  IMCPServer,
  createMCPServer,
} from './server.js';

// Tool Registry
export {
  ToolRegistry,
  createToolRegistry,
  defineTool,
} from './tool-registry.js';

// Session Manager
export {
  SessionManager,
  SessionConfig,
  createSessionManager,
} from './session-manager.js';

// Connection Pool
export {
  ConnectionPool,
  createConnectionPool,
} from './connection-pool.js';

// Transport layer
export {
  // Factory
  createTransport,
  createInProcessTransport,
  TransportManager,
  createTransportManager,
  TransportConfig,
  DEFAULT_TRANSPORT_CONFIGS,

  // Specific transports
  StdioTransport,
  StdioTransportConfig,
  HttpTransport,
  HttpTransportConfig,
  WebSocketTransport,
  WebSocketTransportConfig,
} from './transport/index.js';

// Tools (unique to this module - not in integrations)
export {
  getAllTools,
  getV3Tools,
  getToolsByCategory,
  getToolByName,
  getToolsByTag,
  getToolStats,
  validateToolRegistration,
} from './tools/index.js';

/**
 * Quick start function to create and configure an MCP server
 */
export async function quickStart(
  config: Partial<import('./types.js').MCPServerConfig>,
  logger?: import('./types.js').ILogger
): Promise<import('./server.js').MCPServer> {
  const defaultLogger: import('./types.js').ILogger = logger || {
    debug: (msg: string, data?: unknown) => console.debug(`[DEBUG] ${msg}`, data || ''),
    info: (msg: string, data?: unknown) => console.info(`[INFO] ${msg}`, data || ''),
    warn: (msg: string, data?: unknown) => console.warn(`[WARN] ${msg}`, data || ''),
    error: (msg: string, data?: unknown) => console.error(`[ERROR] ${msg}`, data || ''),
  };

  const server = createMCPServer(config, defaultLogger);

  return server;
}

/**
 * Module version
 */
export const VERSION = '3.0.0';

/**
 * Module name
 */
export const MODULE_NAME = '@claude-flow/mcp';
