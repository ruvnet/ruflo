/**
 * AgentDB MCP Tools — Phase 6 of ADR-053
 *
 * Exposes AgentDB v3 controller operations as MCP tools.
 * Provides direct access to ReasoningBank, CausalGraph, SkillLibrary,
 * AttestationLog, and bridge health through the MCP protocol.
 *
 * @module v3/cli/mcp-tools/agentdb-tools
 */

import type { MCPTool } from './types.js';

// ===== agentdb_health — Controller health check =====

export const agentdbHealth: MCPTool = {
  name: 'agentdb_health',
  description: 'Get AgentDB v3 controller health status including cache stats and attestation count',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async () => {
    try {
      const bridge = await import('../memory/memory-bridge.js');
      const health = await bridge.bridgeHealthCheck();
      if (!health) {
        return { available: false, error: 'AgentDB bridge not available' };
      }
      return health;
    } catch (error) {
      return { available: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

// ===== agentdb_controllers — List all controllers =====

export const agentdbControllers: MCPTool = {
  name: 'agentdb_controllers',
  description: 'List all AgentDB v3 controllers and their initialization status',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async () => {
    try {
      const bridge = await import('../memory/memory-bridge.js');
      const controllers = await bridge.bridgeListControllers();
      if (!controllers) {
        return { available: false, controllers: [], error: 'Bridge not available' };
      }
      return {
        available: true,
        controllers,
        total: controllers.length,
        active: controllers.filter(c => c.enabled).length,
      };
    } catch (error) {
      return { available: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

// ===== agentdb_pattern_store — Store via ReasoningBank =====

export const agentdbPatternStore: MCPTool = {
  name: 'agentdb_pattern-store',
  description: 'Store a pattern directly via ReasoningBank controller',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Pattern description' },
      type: { type: 'string', description: 'Pattern type (e.g., task-routing, error-recovery)' },
      confidence: { type: 'number', description: 'Confidence score (0-1)' },
    },
    required: ['pattern'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const bridge = await import('../memory/memory-bridge.js');
      const result = await bridge.bridgeStorePattern({
        pattern: params.pattern as string,
        type: (params.type as string) || 'general',
        confidence: (params.confidence as number) || 0.8,
      });
      return result || { success: false, error: 'Bridge not available' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

// ===== agentdb_pattern_search — Search via ReasoningBank =====

export const agentdbPatternSearch: MCPTool = {
  name: 'agentdb_pattern-search',
  description: 'Search patterns via ReasoningBank controller with BM25+semantic hybrid',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      topK: { type: 'number', description: 'Number of results (default: 5)' },
      minConfidence: { type: 'number', description: 'Minimum score threshold (0-1)' },
    },
    required: ['query'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const bridge = await import('../memory/memory-bridge.js');
      const result = await bridge.bridgeSearchPatterns({
        query: params.query as string,
        topK: (params.topK as number) || 5,
        minConfidence: (params.minConfidence as number) || 0.3,
      });
      return result || { results: [], controller: 'unavailable' };
    } catch (error) {
      return { results: [], error: error instanceof Error ? error.message : String(error) };
    }
  },
};

// ===== agentdb_feedback — Record task feedback =====

export const agentdbFeedback: MCPTool = {
  name: 'agentdb_feedback',
  description: 'Record task feedback for learning via LearningSystem + ReasoningBank controllers',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task identifier' },
      success: { type: 'boolean', description: 'Whether task succeeded' },
      quality: { type: 'number', description: 'Quality score (0-1)' },
      agent: { type: 'string', description: 'Agent that performed the task' },
    },
    required: ['taskId'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const bridge = await import('../memory/memory-bridge.js');
      const result = await bridge.bridgeRecordFeedback({
        taskId: params.taskId as string,
        success: params.success !== false,
        quality: (params.quality as number) || 0.85,
        agent: params.agent as string | undefined,
      });
      return result || { success: false, error: 'Bridge not available' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

// ===== agentdb_causal_edge — Record causal relationships =====

export const agentdbCausalEdge: MCPTool = {
  name: 'agentdb_causal-edge',
  description: 'Record a causal edge between two memory entries via CausalMemoryGraph',
  inputSchema: {
    type: 'object',
    properties: {
      sourceId: { type: 'string', description: 'Source entry ID' },
      targetId: { type: 'string', description: 'Target entry ID' },
      relation: { type: 'string', description: 'Relationship type (e.g., caused, preceded, succeeded)' },
      weight: { type: 'number', description: 'Edge weight (0-1)' },
    },
    required: ['sourceId', 'targetId', 'relation'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const bridge = await import('../memory/memory-bridge.js');
      const result = await bridge.bridgeRecordCausalEdge({
        sourceId: params.sourceId as string,
        targetId: params.targetId as string,
        relation: params.relation as string,
        weight: params.weight as number | undefined,
      });
      return result || { success: false, error: 'Bridge not available' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

// ===== agentdb_route — Route via SemanticRouter =====

export const agentdbRoute: MCPTool = {
  name: 'agentdb_route',
  description: 'Route a task via AgentDB SemanticRouter or LearningSystem recommendAlgorithm',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Task description to route' },
      context: { type: 'string', description: 'Additional context' },
    },
    required: ['task'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const bridge = await import('../memory/memory-bridge.js');
      const result = await bridge.bridgeRouteTask({
        task: params.task as string,
        context: params.context as string | undefined,
      });
      return result || { route: 'general', confidence: 0.5, agents: ['coder'], controller: 'fallback' };
    } catch (error) {
      return { route: 'general', confidence: 0.5, agents: ['coder'], controller: 'error', error: error instanceof Error ? error.message : String(error) };
    }
  },
};

// ===== agentdb_session_start — Session with ReflexionMemory =====

export const agentdbSessionStart: MCPTool = {
  name: 'agentdb_session-start',
  description: 'Start a session with ReflexionMemory episodic replay',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session identifier' },
      context: { type: 'string', description: 'Session context for pattern retrieval' },
    },
    required: ['sessionId'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const bridge = await import('../memory/memory-bridge.js');
      const result = await bridge.bridgeSessionStart({
        sessionId: params.sessionId as string,
        context: params.context as string | undefined,
      });
      return result || { success: false, error: 'Bridge not available' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

// ===== agentdb_session_end — End session + NightlyLearner =====

export const agentdbSessionEnd: MCPTool = {
  name: 'agentdb_session-end',
  description: 'End session, persist to ReflexionMemory, trigger NightlyLearner consolidation',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session identifier' },
      summary: { type: 'string', description: 'Session summary' },
      tasksCompleted: { type: 'number', description: 'Number of tasks completed' },
    },
    required: ['sessionId'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const bridge = await import('../memory/memory-bridge.js');
      const result = await bridge.bridgeSessionEnd({
        sessionId: params.sessionId as string,
        summary: params.summary as string | undefined,
        tasksCompleted: params.tasksCompleted as number | undefined,
      });
      return result || { success: false, error: 'Bridge not available' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

// ===== Export all tools =====

export const agentdbTools: MCPTool[] = [
  agentdbHealth,
  agentdbControllers,
  agentdbPatternStore,
  agentdbPatternSearch,
  agentdbFeedback,
  agentdbCausalEdge,
  agentdbRoute,
  agentdbSessionStart,
  agentdbSessionEnd,
];
