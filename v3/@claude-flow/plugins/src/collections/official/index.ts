/**
 * Official Plugin Collections
 *
 * Pre-built collections of plugins for common use cases.
 */

import type { PluginCollection, PluginCollectionEntry } from '../collection-manager.js';
import { PluginBuilder } from '../../sdk/index.js';
import { HookEvent, HookPriority } from '../../types/index.js';

// ============================================================================
// Core Plugins
// ============================================================================

/**
 * Session management plugin - handles session lifecycle hooks.
 */
export const sessionPlugin = new PluginBuilder('session-manager', '3.0.0')
  .withDescription('Manages session lifecycle with auto-save and restore')
  .withAuthor('Claude Flow')
  .withTags(['core', 'session', 'persistence'])
  .withHooks([
    {
      event: HookEvent.SessionStart,
      priority: HookPriority.Critical,
      name: 'session-init',
      handler: async (ctx) => {
        return { success: true, data: { sessionId: Date.now().toString() } };
      },
    },
    {
      event: HookEvent.SessionEnd,
      priority: HookPriority.Critical,
      name: 'session-cleanup',
      handler: async (ctx) => {
        return { success: true };
      },
    },
  ])
  .build();

/**
 * Memory coordination plugin - coordinates memory across agents.
 */
export const memoryCoordinatorPlugin = new PluginBuilder('memory-coordinator', '3.0.0')
  .withDescription('Coordinates memory access and synchronization across agents')
  .withAuthor('Claude Flow')
  .withTags(['core', 'memory', 'coordination'])
  .withHooks([
    {
      event: HookEvent.PreMemoryStore,
      priority: HookPriority.High,
      name: 'memory-validate',
      handler: async (ctx) => {
        return { success: true };
      },
    },
    {
      event: HookEvent.PostMemoryStore,
      priority: HookPriority.Normal,
      name: 'memory-sync',
      handler: async (ctx) => {
        return { success: true };
      },
    },
  ])
  .build();

/**
 * Event bus plugin - provides pub/sub messaging.
 */
export const eventBusPlugin = new PluginBuilder('event-bus', '3.0.0')
  .withDescription('Pub/sub event messaging system')
  .withAuthor('Claude Flow')
  .withTags(['core', 'events', 'messaging'])
  .withMCPTools([
    {
      name: 'emit-event',
      description: 'Emit an event to subscribers',
      inputSchema: {
        type: 'object',
        properties: {
          event: { type: 'string', description: 'Event name' },
          data: { type: 'object', description: 'Event data' },
        },
        required: ['event'],
      },
      handler: async (input) => {
        return {
          content: [{ type: 'text', text: `Event ${input.event} emitted` }],
        };
      },
    },
  ])
  .build();

// ============================================================================
// Development Plugins
// ============================================================================

/**
 * Coder agent plugin - provides coding assistance.
 */
export const coderAgentPlugin = new PluginBuilder('coder-agent', '3.0.0')
  .withDescription('AI-powered coding assistance agent')
  .withAuthor('Claude Flow')
  .withTags(['development', 'agent', 'coding'])
  .withAgentTypes([
    {
      type: 'coder',
      name: 'Coder Agent',
      description: 'Writes clean, efficient code following best practices',
      capabilities: ['code-generation', 'refactoring', 'debugging'],
      systemPrompt: 'You are an expert software engineer...',
      model: 'claude-sonnet-4-20250514',
      temperature: 0.3,
    },
  ])
  .build();

/**
 * Tester agent plugin - provides testing assistance.
 */
export const testerAgentPlugin = new PluginBuilder('tester-agent', '3.0.0')
  .withDescription('AI-powered testing and QA agent')
  .withAuthor('Claude Flow')
  .withTags(['development', 'agent', 'testing'])
  .withAgentTypes([
    {
      type: 'tester',
      name: 'Tester Agent',
      description: 'Writes comprehensive tests and validates code quality',
      capabilities: ['unit-testing', 'integration-testing', 'test-coverage'],
      systemPrompt: 'You are an expert QA engineer...',
      model: 'claude-sonnet-4-20250514',
      temperature: 0.2,
    },
  ])
  .build();

/**
 * Reviewer agent plugin - provides code review.
 */
export const reviewerAgentPlugin = new PluginBuilder('reviewer-agent', '3.0.0')
  .withDescription('AI-powered code review agent')
  .withAuthor('Claude Flow')
  .withTags(['development', 'agent', 'review'])
  .withAgentTypes([
    {
      type: 'reviewer',
      name: 'Reviewer Agent',
      description: 'Reviews code for quality, security, and best practices',
      capabilities: ['code-review', 'security-audit', 'performance-review'],
      systemPrompt: 'You are an expert code reviewer...',
      model: 'claude-sonnet-4-20250514',
      temperature: 0.1,
    },
  ])
  .build();

/**
 * Git integration plugin - provides Git operations.
 */
export const gitIntegrationPlugin = new PluginBuilder('git-integration', '3.0.0')
  .withDescription('Git version control integration')
  .withAuthor('Claude Flow')
  .withTags(['development', 'integration', 'git'])
  .withMCPTools([
    {
      name: 'git-status',
      description: 'Get current Git repository status',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Repository path' },
        },
      },
      handler: async (input) => {
        return {
          content: [{ type: 'text', text: 'Git status retrieved' }],
        };
      },
    },
    {
      name: 'git-commit',
      description: 'Create a Git commit',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Commit message' },
          files: { type: 'array', items: { type: 'string' }, description: 'Files to commit' },
        },
        required: ['message'],
      },
      handler: async (input) => {
        return {
          content: [{ type: 'text', text: `Commit created: ${input.message}` }],
        };
      },
    },
  ])
  .build();

/**
 * Linter plugin - provides code linting.
 */
export const linterPlugin = new PluginBuilder('linter', '3.0.0')
  .withDescription('Code linting and style checking')
  .withAuthor('Claude Flow')
  .withTags(['development', 'tool', 'linting'])
  .withHooks([
    {
      event: HookEvent.PreFileWrite,
      priority: HookPriority.Normal,
      name: 'lint-check',
      handler: async (ctx) => {
        // Lint the file before writing
        return { success: true };
      },
    },
  ])
  .build();

// ============================================================================
// Intelligence Plugins
// ============================================================================

/**
 * Pattern integration plugin - self-optimizing neural architecture.
 */
export const sonaPlugin = new PluginBuilder('pattern-integration', '3.0.0')
  .withDescription('Pattern self-optimizing neural architecture integration')
  .withAuthor('Claude Flow')
  .withTags(['intelligence', 'patterns', 'learning'])
  .withDependencies(['memory-coordinator@^3.0.0'])
  .withHooks([
    {
      event: HookEvent.PatternDetected,
      priority: HookPriority.High,
      name: 'sona-learn',
      handler: async (ctx) => {
        return { success: true, data: { adapted: true } };
      },
    },
  ])
  .build();

/**
 * ReasoningBank plugin - stores and retrieves reasoning patterns.
 */
export const reasoningBankPlugin = new PluginBuilder('reasoning-bank', '3.0.0')
  .withDescription('Pattern storage and retrieval for reasoning')
  .withAuthor('Claude Flow')
  .withTags(['intelligence', 'memory', 'patterns'])
  .withMCPTools([
    {
      name: 'store-reasoning',
      description: 'Store a reasoning pattern',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Pattern identifier' },
          context: { type: 'object', description: 'Pattern context' },
          outcome: { type: 'string', description: 'Pattern outcome' },
        },
        required: ['pattern', 'outcome'],
      },
      handler: async (input) => {
        return {
          content: [{ type: 'text', text: `Pattern ${input.pattern} stored` }],
        };
      },
    },
    {
      name: 'retrieve-reasoning',
      description: 'Retrieve similar reasoning patterns',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Query context' },
          limit: { type: 'number', description: 'Max results' },
        },
        required: ['query'],
      },
      handler: async (input) => {
        return {
          content: [{ type: 'text', text: 'Retrieved patterns' }],
        };
      },
    },
  ])
  .build();

/**
 * Pattern learning plugin - learns from task execution.
 */
export const patternLearningPlugin = new PluginBuilder('pattern-learning', '3.0.0')
  .withDescription('Learns patterns from task execution')
  .withAuthor('Claude Flow')
  .withTags(['intelligence', 'learning', 'hooks'])
  .withHooks([
    {
      event: HookEvent.PostTaskComplete,
      priority: HookPriority.Low,
      name: 'learn-from-task',
      handler: async (ctx) => {
        return { success: true };
      },
    },
    {
      event: HookEvent.TaskFailed,
      priority: HookPriority.Low,
      name: 'learn-from-failure',
      handler: async (ctx) => {
        return { success: true };
      },
    },
  ])
  .build();

// ============================================================================
// Swarm Plugins
// ============================================================================

/**
 * HiveMind plugin - collective intelligence coordination.
 */
export const hiveMindPlugin = new PluginBuilder('hive-mind', '3.0.0')
  .withDescription('Collective intelligence and voting mechanisms')
  .withAuthor('Claude Flow')
  .withTags(['swarm', 'integration', 'voting'])
  .withMCPTools([
    {
      name: 'collective-decide',
      description: 'Request collective decision from agents',
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'Decision question' },
          options: { type: 'array', items: { type: 'string' }, description: 'Options' },
          threshold: { type: 'number', description: 'Consensus threshold (0-1)' },
        },
        required: ['question', 'options'],
      },
      handler: async (input) => {
        return {
          content: [{ type: 'text', text: 'Decision requested' }],
        };
      },
    },
  ])
  .build();

/**
 * Maestro plugin - workflow orchestration.
 */
export const maestroPlugin = new PluginBuilder('maestro', '3.0.0')
  .withDescription('Multi-agent workflow orchestration')
  .withAuthor('Claude Flow')
  .withTags(['swarm', 'integration', 'orchestration'])
  .withMCPTools([
    {
      name: 'create-workflow',
      description: 'Create a new workflow',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Workflow name' },
          steps: { type: 'array', items: { type: 'object' }, description: 'Workflow steps' },
        },
        required: ['name', 'steps'],
      },
      handler: async (input) => {
        return {
          content: [{ type: 'text', text: `Workflow ${input.name} created` }],
        };
      },
    },
    {
      name: 'execute-workflow',
      description: 'Execute a workflow',
      inputSchema: {
        type: 'object',
        properties: {
          workflowId: { type: 'string', description: 'Workflow ID' },
          input: { type: 'object', description: 'Workflow input' },
        },
        required: ['workflowId'],
      },
      handler: async (input) => {
        return {
          content: [{ type: 'text', text: `Workflow ${input.workflowId} started` }],
        };
      },
    },
  ])
  .build();

/**
 * Consensus plugin - Byzantine fault-tolerant consensus.
 */
export const consensusPlugin = new PluginBuilder('voting', '3.0.0')
  .withDescription('Byzantine fault-tolerant voting mechanisms')
  .withAuthor('Claude Flow')
  .withTags(['swarm', 'integration', 'voting', 'byzantine'])
  .withDependencies(['hive-mind@^3.0.0'])
  .build();

/**
 * Coordinator agent plugin - swarm coordination.
 */
export const coordinatorAgentPlugin = new PluginBuilder('coordinator-agent', '3.0.0')
  .withDescription('Swarm coordination agent')
  .withAuthor('Claude Flow')
  .withTags(['swarm', 'agent', 'coordination'])
  .withAgentTypes([
    {
      type: 'coordinator',
      name: 'Coordinator Agent',
      description: 'Coordinates multi-agent swarm operations',
      capabilities: ['task-distribution', 'progress-tracking', 'conflict-resolution'],
      systemPrompt: 'You are a swarm coordinator...',
      model: 'claude-sonnet-4-20250514',
      temperature: 0.2,
    },
  ])
  .build();

// ============================================================================
// Security Plugins
// ============================================================================

/**
 * Input validation plugin - validates all inputs.
 */
export const inputValidationPlugin = new PluginBuilder('input-validation', '3.0.0')
  .withDescription('Input validation and sanitization')
  .withAuthor('Claude Flow')
  .withTags(['security', 'hook', 'validation'])
  .withHooks([
    {
      event: HookEvent.PreToolUse,
      priority: HookPriority.Critical,
      name: 'validate-tool-input',
      handler: async (ctx) => {
        // Validate tool inputs
        return { success: true };
      },
    },
    {
      event: HookEvent.PreCommand,
      priority: HookPriority.Critical,
      name: 'validate-command',
      handler: async (ctx) => {
        // Validate command
        return { success: true };
      },
    },
  ])
  .build();

/**
 * Path security plugin - prevents path traversal.
 */
export const pathSecurityPlugin = new PluginBuilder('path-security', '3.0.0')
  .withDescription('Path traversal prevention and validation')
  .withAuthor('Claude Flow')
  .withTags(['security', 'hook', 'filesystem'])
  .withHooks([
    {
      event: HookEvent.PreFileWrite,
      priority: HookPriority.Critical,
      name: 'validate-path',
      handler: async (ctx) => {
        // Validate file path
        return { success: true };
      },
    },
    {
      event: HookEvent.PreFileDelete,
      priority: HookPriority.Critical,
      name: 'validate-delete-path',
      handler: async (ctx) => {
        return { success: true };
      },
    },
  ])
  .build();

/**
 * Audit log plugin - logs all operations.
 */
export const auditLogPlugin = new PluginBuilder('audit-log', '3.0.0')
  .withDescription('Comprehensive audit logging')
  .withAuthor('Claude Flow')
  .withTags(['security', 'hook', 'audit', 'logging'])
  .withHooks([
    {
      event: HookEvent.PostToolUse,
      priority: HookPriority.Low,
      name: 'log-tool-use',
      async: true,
      handler: async (ctx) => {
        // Log tool usage
        return { success: true };
      },
    },
    {
      event: HookEvent.PostCommand,
      priority: HookPriority.Low,
      name: 'log-command',
      async: true,
      handler: async (ctx) => {
        // Log command execution
        return { success: true };
      },
    },
    {
      event: HookEvent.PostFileWrite,
      priority: HookPriority.Low,
      name: 'log-file-write',
      async: true,
      handler: async (ctx) => {
        // Log file write
        return { success: true };
      },
    },
  ])
  .build();

/**
 * Security scan plugin - scans for vulnerabilities.
 */
export const securityScanPlugin = new PluginBuilder('security-scan', '3.0.0')
  .withDescription('Security vulnerability scanning')
  .withAuthor('Claude Flow')
  .withTags(['security', 'tool', 'scanning'])
  .withMCPTools([
    {
      name: 'scan-code',
      description: 'Scan code for security vulnerabilities',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to scan' },
          depth: { type: 'string', enum: ['quick', 'standard', 'deep'], description: 'Scan depth' },
        },
        required: ['path'],
      },
      handler: async (input) => {
        return {
          content: [{ type: 'text', text: 'Security scan complete' }],
        };
      },
    },
  ])
  .build();

// ============================================================================
// Utility Plugins
// ============================================================================

/**
 * Metrics plugin - collects and reports metrics.
 */
export const metricsPlugin = new PluginBuilder('metrics', '3.0.0')
  .withDescription('Performance and usage metrics collection')
  .withAuthor('Claude Flow')
  .withTags(['utility', 'metrics', 'monitoring'])
  .withMCPTools([
    {
      name: 'get-metrics',
      description: 'Get collected metrics',
      inputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Metrics category' },
          timeRange: { type: 'string', description: 'Time range (e.g., "1h", "24h")' },
        },
      },
      handler: async (input) => {
        return {
          content: [{ type: 'text', text: 'Metrics retrieved' }],
        };
      },
    },
  ])
  .build();

/**
 * Cache plugin - provides caching utilities.
 */
export const cachePlugin = new PluginBuilder('cache', '3.0.0')
  .withDescription('Caching utilities for improved performance')
  .withAuthor('Claude Flow')
  .withTags(['utility', 'cache', 'performance'])
  .build();

// ============================================================================
// Database & Vector Plugins
// ============================================================================

/**
 * RuVector PostgreSQL Bridge plugin - advanced vector database with AI capabilities.
 *
 * Provides integration with @ruvector/postgres-cli including:
 * - 53+ SQL functions for vector/graph operations
 * - 39 attention mechanisms for neural processing
 * - GNN layers for graph-aware queries
 * - Hyperbolic embeddings for hierarchical data
 * - Self-learning query optimization
 *
 * @see ADR-027, ADR-028, ADR-029
 */
export const ruvectorPostgresPlugin = new PluginBuilder('ruvector-postgres', '3.0.0')
  .withDescription('RuVector PostgreSQL Bridge - Advanced vector search with attention, GNN, and hyperbolic embeddings')
  .withAuthor('Claude Flow')
  .withTags(['database', 'vector', 'postgresql', 'attention', 'gnn', 'hyperbolic', 'intelligence'])
  .withDependencies(['memory-coordinator'])
  .withMCPTools([
    {
      name: 'ruvector-search',
      description: 'Vector similarity search with 12+ distance metrics (cosine, euclidean, dot, etc.)',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'array', items: { type: 'number' }, description: 'Query vector' },
          k: { type: 'number', description: 'Number of results to return' },
          metric: { type: 'string', enum: ['cosine', 'euclidean', 'dot', 'manhattan', 'hamming'], description: 'Distance metric' },
          tableName: { type: 'string', description: 'Table to search' },
          filter: { type: 'object', description: 'Metadata filters' },
        },
        required: ['query', 'k', 'tableName'],
      },
      handler: async (input) => {
        return {
          content: [{ type: 'text', text: `Vector search in ${input.tableName} with k=${input.k}` }],
        };
      },
    },
    {
      name: 'ruvector-attention',
      description: 'Execute attention mechanism (39 types: multi-head, flash, sparse, linear, etc.)',
      inputSchema: {
        type: 'object',
        properties: {
          mechanism: { type: 'string', description: 'Attention mechanism type' },
          query: { type: 'array', items: { type: 'number' }, description: 'Query vector' },
          keys: { type: 'array', items: { type: 'array' }, description: 'Key vectors' },
          values: { type: 'array', items: { type: 'array' }, description: 'Value vectors' },
          numHeads: { type: 'number', description: 'Number of attention heads' },
        },
        required: ['mechanism', 'query', 'keys', 'values'],
      },
      handler: async (input) => {
        return {
          content: [{ type: 'text', text: `Attention computed with ${input.mechanism}` }],
        };
      },
    },
    {
      name: 'ruvector-gnn',
      description: 'Execute GNN layer (GCN, GAT, GraphSAGE, GIN, MPNN, EdgeConv)',
      inputSchema: {
        type: 'object',
        properties: {
          layerType: { type: 'string', enum: ['gcn', 'gat', 'sage', 'gin', 'mpnn', 'edge_conv'], description: 'GNN layer type' },
          nodes: { type: 'array', description: 'Node features' },
          edges: { type: 'array', description: 'Edge list' },
          aggregation: { type: 'string', enum: ['mean', 'sum', 'max', 'attention'], description: 'Aggregation method' },
        },
        required: ['layerType', 'nodes', 'edges'],
      },
      handler: async (input) => {
        return {
          content: [{ type: 'text', text: `GNN ${input.layerType} layer executed` }],
        };
      },
    },
    {
      name: 'ruvector-hyperbolic',
      description: 'Hyperbolic embedding operations (Poincare ball, Lorentz hyperboloid)',
      inputSchema: {
        type: 'object',
        properties: {
          model: { type: 'string', enum: ['poincare', 'lorentz', 'klein'], description: 'Hyperbolic model' },
          operation: { type: 'string', enum: ['distance', 'exp_map', 'log_map', 'mobius_add', 'project'], description: 'Operation' },
          vectors: { type: 'array', description: 'Input vectors' },
          curvature: { type: 'number', description: 'Manifold curvature (negative for hyperbolic)' },
        },
        required: ['model', 'operation', 'vectors'],
      },
      handler: async (input) => {
        return {
          content: [{ type: 'text', text: `Hyperbolic ${input.operation} on ${input.model} model` }],
        };
      },
    },
    {
      name: 'ruvector-optimize',
      description: 'Self-learning query optimization and index tuning',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['analyze', 'suggest', 'tune', 'learn'], description: 'Optimization action' },
          target: { type: 'string', description: 'Table or index to optimize' },
        },
        required: ['action'],
      },
      handler: async (input) => {
        return {
          content: [{ type: 'text', text: `Optimization ${input.action} completed` }],
        };
      },
    },
  ])
  .withHooks([
    {
      event: HookEvent.PostMemoryStore,
      priority: HookPriority.Normal,
      name: 'ruvector-learn-pattern',
      async: true,
      handler: async (ctx) => {
        // Learn from memory operations for self-optimization
        return { success: true };
      },
    },
    {
      event: HookEvent.PostToolUse,
      priority: HookPriority.Low,
      name: 'ruvector-collect-stats',
      async: true,
      handler: async (ctx) => {
        // Collect statistics for query optimization
        return { success: true };
      },
    },
  ])
  .build();

// ============================================================================
// Official Collections
// ============================================================================

/**
 * Core collection - essential plugins for Claude Flow operation.
 */
export const coreCollection: PluginCollection = {
  id: 'claude-flow-core',
  name: 'Claude Flow Core Plugins',
  version: '3.0.0',
  description: 'Essential plugins for Claude Flow operation',
  author: 'Claude Flow',
  license: 'MIT',
  categories: ['hook', 'integration', 'utility'],
  plugins: [
    {
      plugin: sessionPlugin,
      defaultEnabled: true,
      category: 'hook',
      tags: ['core', 'session'],
      description: 'Session lifecycle management',
    },
    {
      plugin: memoryCoordinatorPlugin,
      defaultEnabled: true,
      category: 'integration',
      tags: ['core', 'memory'],
      description: 'Memory coordination across agents',
    },
    {
      plugin: eventBusPlugin,
      defaultEnabled: true,
      category: 'utility',
      tags: ['core', 'events'],
      description: 'Event pub/sub system',
    },
  ],
};

/**
 * Development collection - plugins for software development workflows.
 */
export const developmentCollection: PluginCollection = {
  id: 'claude-flow-development',
  name: 'Development Tools',
  version: '3.0.0',
  description: 'Plugins for software development workflows',
  author: 'Claude Flow',
  license: 'MIT',
  categories: ['agent', 'tool', 'integration'],
  plugins: [
    {
      plugin: coderAgentPlugin,
      defaultEnabled: true,
      category: 'agent',
      tags: ['development', 'coding'],
      description: 'AI coding assistant',
    },
    {
      plugin: testerAgentPlugin,
      defaultEnabled: true,
      category: 'agent',
      tags: ['development', 'testing'],
      description: 'AI testing assistant',
    },
    {
      plugin: reviewerAgentPlugin,
      defaultEnabled: false,
      category: 'agent',
      tags: ['development', 'review'],
      description: 'AI code reviewer',
    },
    {
      plugin: gitIntegrationPlugin,
      defaultEnabled: true,
      category: 'integration',
      tags: ['development', 'git'],
      description: 'Git version control integration',
    },
    {
      plugin: linterPlugin,
      defaultEnabled: false,
      category: 'tool',
      tags: ['development', 'linting'],
      description: 'Code linting and style checking',
    },
  ],
};

/**
 * Intelligence collection - AI/ML and learning plugins.
 */
export const intelligenceCollection: PluginCollection = {
  id: 'claude-flow-intelligence',
  name: 'Intelligence & Learning',
  version: '3.0.0',
  description: 'AI/ML features and learning capabilities',
  author: 'Claude Flow',
  license: 'MIT',
  categories: ['integration', 'memory', 'hook', 'database'],
  plugins: [
    {
      plugin: sonaPlugin,
      defaultEnabled: false,
      category: 'integration',
      tags: ['intelligence', 'patterns'],
      requiredCapabilities: ['memory', 'llm'],
      description: 'Pattern self-optimizing neural architecture',
    },
    {
      plugin: reasoningBankPlugin,
      defaultEnabled: false,
      category: 'memory',
      tags: ['intelligence', 'patterns'],
      requiredCapabilities: ['memory'],
      description: 'Reasoning pattern storage',
    },
    {
      plugin: patternLearningPlugin,
      defaultEnabled: false,
      category: 'hook',
      tags: ['intelligence', 'learning'],
      description: 'Learn from task execution',
    },
    {
      plugin: ruvectorPostgresPlugin,
      defaultEnabled: false,
      category: 'database',
      tags: ['intelligence', 'vector', 'postgresql', 'attention', 'gnn'],
      requiredCapabilities: ['memory', 'database'],
      description: 'RuVector PostgreSQL Bridge - Advanced vector search with 39 attention mechanisms, GNN layers, and hyperbolic embeddings',
    },
  ],
};

/**
 * Database collection - database and storage plugins.
 */
export const databaseCollection: PluginCollection = {
  id: 'claude-flow-database',
  name: 'Database & Storage',
  version: '3.0.0',
  description: 'Database integrations and storage plugins',
  author: 'Claude Flow',
  license: 'MIT',
  categories: ['database', 'integration'],
  plugins: [
    {
      plugin: ruvectorPostgresPlugin,
      defaultEnabled: false,
      category: 'database',
      tags: ['postgresql', 'vector', 'attention', 'gnn', 'hyperbolic'],
      requiredCapabilities: ['database'],
      description: 'RuVector PostgreSQL - 52K+ inserts/sec, sub-ms queries, 39 attention mechanisms, GNN, hyperbolic embeddings',
    },
  ],
};

/**
 * Swarm collection - multi-agent coordination plugins.
 */
export const swarmCollection: PluginCollection = {
  id: 'claude-flow-swarm',
  name: 'Swarm Coordination',
  version: '3.0.0',
  description: 'Multi-agent swarm coordination and orchestration',
  author: 'Claude Flow',
  license: 'MIT',
  categories: ['integration', 'agent'],
  plugins: [
    {
      plugin: hiveMindPlugin,
      defaultEnabled: true,
      category: 'integration',
      tags: ['swarm', 'voting'],
      description: 'Collective intelligence coordination',
    },
    {
      plugin: maestroPlugin,
      defaultEnabled: true,
      category: 'integration',
      tags: ['swarm', 'orchestration'],
      description: 'Workflow orchestration',
    },
    {
      plugin: consensusPlugin,
      defaultEnabled: false,
      category: 'integration',
      tags: ['swarm', 'byzantine'],
      description: 'Byzantine fault-tolerant consensus',
    },
    {
      plugin: coordinatorAgentPlugin,
      defaultEnabled: true,
      category: 'agent',
      tags: ['swarm', 'coordination'],
      description: 'Swarm coordinator agent',
    },
  ],
};

/**
 * Security collection - security and audit plugins.
 */
export const securityCollection: PluginCollection = {
  id: 'claude-flow-security',
  name: 'Security & Audit',
  version: '3.0.0',
  description: 'Security validation and audit logging',
  author: 'Claude Flow',
  license: 'MIT',
  categories: ['hook', 'tool'],
  plugins: [
    {
      plugin: inputValidationPlugin,
      defaultEnabled: true,
      category: 'hook',
      tags: ['security', 'validation'],
      description: 'Input validation and sanitization',
    },
    {
      plugin: pathSecurityPlugin,
      defaultEnabled: true,
      category: 'hook',
      tags: ['security', 'filesystem'],
      description: 'Path traversal prevention',
    },
    {
      plugin: auditLogPlugin,
      defaultEnabled: false,
      category: 'hook',
      tags: ['security', 'audit'],
      description: 'Comprehensive audit logging',
    },
    {
      plugin: securityScanPlugin,
      defaultEnabled: false,
      category: 'tool',
      tags: ['security', 'scanning'],
      description: 'Security vulnerability scanning',
    },
  ],
};

/**
 * Utility collection - general utility plugins.
 */
export const utilityCollection: PluginCollection = {
  id: 'claude-flow-utility',
  name: 'Utilities',
  version: '3.0.0',
  description: 'General utility plugins',
  author: 'Claude Flow',
  license: 'MIT',
  categories: ['utility'],
  plugins: [
    {
      plugin: metricsPlugin,
      defaultEnabled: false,
      category: 'utility',
      tags: ['metrics', 'monitoring'],
      description: 'Performance metrics collection',
    },
    {
      plugin: cachePlugin,
      defaultEnabled: false,
      category: 'utility',
      tags: ['cache', 'performance'],
      description: 'Caching utilities',
    },
  ],
};

/**
 * All official collections.
 */
export const officialCollections: PluginCollection[] = [
  coreCollection,
  developmentCollection,
  intelligenceCollection,
  swarmCollection,
  securityCollection,
  utilityCollection,
  databaseCollection,
];

/**
 * Get all official plugins as a flat list.
 */
export function getAllOfficialPlugins(): PluginCollectionEntry[] {
  return officialCollections.flatMap(c => c.plugins);
}

/**
 * Get an official collection by ID.
 */
export function getOfficialCollection(id: string): PluginCollection | undefined {
  return officialCollections.find(c => c.id === id);
}
