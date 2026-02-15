/**
 * @claude-flow/integrations
 *
 * External integration module consolidating Codex, MCP server,
 * browser automation, deployment, and agentic-flow integrations.
 *
 * Consolidated from:
 * - @claude-flow/codex (OpenAI Codex integration)
 * - @claude-flow/mcp (MCP server, stdio/SSE transports)
 * - @claude-flow/browser (browser automation tools)
 * - @claude-flow/deployment (release management)
 * - @claude-flow/integration (agentic-flow, token optimizer)
 *
 * Sub-modules are also available as namespaced imports:
 *   import { codex, mcp, browser, deployment, agenticFlow } from '@claude-flow/integrations';
 *
 * @module @claude-flow/integrations
 */

// ===== Namespaced sub-module exports (always conflict-free) =====
import * as codex from './codex/index.js';
import * as mcp from './mcp/index.js';
import * as browser from './browser/index.js';
import * as deployment from './deployment/index.js';
import * as agenticFlow from './agentic-flow/index.js';
export { codex, mcp, browser, deployment, agenticFlow };

// ===== Codex Integration (primary export — least conflicts) =====
export * from './codex/index.js';

// ===== MCP Server (selective to avoid collisions with codex) =====
export {
  MCPServer,
  createMCPServer,
  MCPRouter,
  SchemaValidator,
  StdioTransport,
  SSETransport,
} from './mcp/index.js';

export type {
  MCPServerConfig,
  MCPTool,
  ToolHandler,
  ToolContext,
  TransportType,
  TaskResult as MCPTaskResult,
  ValidationResult as MCPValidationResult,
  ValidationError as MCPValidationError,
} from './mcp/index.js';

// ===== Browser Automation =====
export * from './browser/index.js';

// ===== Deployment =====
export * from './deployment/index.js';

// ===== Agentic Flow Integration (selective to avoid collisions) =====
export {
  AgenticFlowAgent,
  createAgenticFlowAgent,
  AgenticFlowWorker,
  TokenOptimizer,
} from './agentic-flow/index.js';

export type {
  AgenticFlowConfig,
  AgentOutput,
  TaskResult as AgenticTaskResult,
  WorkerConfig as AgenticWorkerConfig,
  WorkerMetrics as AgenticWorkerMetrics,
} from './agentic-flow/index.js';
