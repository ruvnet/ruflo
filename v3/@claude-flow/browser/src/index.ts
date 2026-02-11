/**
 * @claude-flow/browser
 * Browser automation for AI agents - integrates agent-browser with claude-flow swarms
 *
 * Features:
 * - 50+ MCP tools for browser automation
 * - AI-optimized snapshots with element refs (@e1, @e2)
 * - Multi-session support for swarm coordination
 * - Trajectory tracking for ReasoningBank/pattern learning
 * - Integration with agentic-flow optimizations
 *
 * @example
 * ```typescript
 * import { createBrowserService, browserTools } from '@claude-flow/browser';
 *
 * // Create a browser service
 * const browser = createBrowserService({ sessionId: 'my-session' });
 *
 * // Start a trajectory for learning
 * const trajectoryId = browser.startTrajectory('Login to dashboard');
 *
 * // Perform actions
 * await browser.open('https://example.com/login');
 * await browser.snapshot({ interactive: true });
 * await browser.fill('@e1', 'user@example.com');
 * await browser.fill('@e2', 'password');
 * await browser.click('@e3');
 *
 * // End trajectory
 * const trajectory = browser.endTrajectory(true, 'Login successful');
 * ```
 */

// Domain types
export * from './domain/types.js';

// Infrastructure
export { AgentBrowserAdapter } from './infrastructure/agent-browser-adapter.js';
export type { AgentBrowserAdapterOptions } from './infrastructure/agent-browser-adapter.js';

// ReasoningBank integration
export {
  ReasoningBankAdapter,
  getReasoningBank,
  type BrowserPattern,
  type PatternStep,
} from './infrastructure/reasoningbank-adapter.js';

// Hooks integration
export {
  preBrowseHook,
  postBrowseHook,
  browserHooks,
  type PreBrowseInput,
  type PreBrowseResult,
  type PostBrowseInput,
  type PostBrowseResult,
} from './infrastructure/hooks-integration.js';

// Memory integration (HNSW semantic search)
export {
  ClaudeFlowMemoryAdapter,
  BrowserMemoryManager,
  createMemoryManager,
  getMemoryAdapter,
  type BrowserMemoryEntry,
  type MemorySearchResult,
  type MemoryStats,
  type MemorySearchOptions,
  type MemoryFilter,
  type IMemoryAdapter,
} from './infrastructure/memory-integration.js';

// Security integration (AIDefence)
export {
  BrowserSecurityScanner,
  getSecurityScanner,
  isUrlSafe,
  containsPII,
  type ThreatScanResult,
  type Threat,
  type ThreatType,
  type PIIMatch,
  type PIIType,
  type SecurityConfig,
} from './infrastructure/security-integration.js';

// Workflow templates
export {
  WorkflowManager,
  getWorkflowManager,
  listWorkflows,
  getWorkflow,
  WORKFLOW_TEMPLATES,
  type WorkflowTemplate,
  type WorkflowCategory,
  type WorkflowStep,
  type WorkflowVariable,
  type WorkflowExecution,
  type WorkflowStepResult,
  type BrowserAction,
} from './infrastructure/workflow-templates.js';

// Application services
export {
  BrowserService,
  BrowserSwarmCoordinator,
  createBrowserService,
  createBrowserSwarm,
  type BrowserServiceConfig,
} from './application/browser-service.js';

// MCP tools
export { browserTools } from './mcp-tools/browser-tools.js';
export type { MCPTool } from './mcp-tools/browser-tools.js';

// Re-export main classes as defaults
import { BrowserService, createBrowserService, createBrowserSwarm } from './application/browser-service.js';
import { browserTools } from './mcp-tools/browser-tools.js';
import { browserHooks, preBrowseHook, postBrowseHook } from './infrastructure/hooks-integration.js';
import { getReasoningBank } from './infrastructure/reasoningbank-adapter.js';
import { getMemoryAdapter, createMemoryManager } from './infrastructure/memory-integration.js';
import { getSecurityScanner, isUrlSafe, containsPII } from './infrastructure/security-integration.js';
import { getWorkflowManager, listWorkflows, getWorkflow } from './infrastructure/workflow-templates.js';

export default {
  // Services
  BrowserService,
  createBrowserService,
  createBrowserSwarm,

  // MCP tools
  browserTools,

  // Hooks
  browserHooks,
  preBrowseHook,
  postBrowseHook,

  // Learning
  getReasoningBank,

  // Memory (HNSW-indexed)
  getMemoryAdapter,
  createMemoryManager,

  // Security (AIDefence)
  getSecurityScanner,
  isUrlSafe,
  containsPII,

  // Workflows
  getWorkflowManager,
  listWorkflows,
  getWorkflow,
};
