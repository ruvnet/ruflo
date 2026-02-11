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
 * @module @claude-flow/integrations
 */

// ===== Codex Integration =====
export * from './codex/index.js';

// ===== MCP Server =====
export * from './mcp/index.js';

// ===== Browser Automation =====
export * from './browser/index.js';

// ===== Deployment =====
export * from './deployment/index.js';

// ===== Agentic Flow Integration =====
export * from './agentic-flow/index.js';
