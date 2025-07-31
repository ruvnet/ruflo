/**
 * DEPRECATED: Legacy Hook System - Fully Migrated
 * 
 * This hook system has been COMPLETELY MIGRATED to the agentic-flow-hooks service.
 * All functionality is now available through the modern implementation at:
 * src/services/agentic-flow-hooks/
 * 
 * This file now serves as a complete redirect to the modern system.
 */

// Full re-export of the modern agentic-flow-hooks system
export {
  agenticHookManager,
  initializeAgenticFlowHooks,
  shutdownAgenticFlowHooks,
  getHookSystemStatus,
  createHookContext,
} from '../services/agentic-flow-hooks/index.js';

// Complete type re-exports with modern and legacy aliases
export type {
  // Modern types (preferred)
  AgenticHookContext,
  HookRegistration,
  HookPayload,
  AgenticHookType,
  HookHandlerResult,
  HookHandler,
  HookFilter,
  HookOptions,
  HookPipeline,
  PipelineStage,
  PipelineMetrics,
  SideEffect,
  
  // LLM Hook Types
  LLMHookType,
  LLMHookPayload,
  LLMRequest,
  LLMResponse,
  LLMMetrics,
  
  // Memory Hook Types
  MemoryHookType,
  MemoryHookPayload,
  
  // Neural Hook Types
  NeuralHookType,
  NeuralHookPayload,
  Pattern,
  TrainingData,
  Prediction,
  Adaptation,
  
  // Performance Hook Types
  PerformanceHookType,
  PerformanceHookPayload,
  PerformanceMetric,
  BottleneckAnalysis,
  OptimizationSuggestion,
  
  // Workflow Hook Types
  WorkflowHookType,
  WorkflowHookPayload,
  WorkflowDecision,
  WorkflowMetrics,
  
  // Legacy aliases (deprecated)
  AgenticHookContext as HookExecutionContext,
  HookRegistration as AgentHook,
  HookPayload as EventPayload,
  AgenticHookType as HookTrigger,
  HookHandlerResult as HookExecutionResult,
} from '../services/agentic-flow-hooks/types.js';

// ===== DEPRECATED LEGACY EXPORTS =====
// These exports are provided for backward compatibility only.
// Use the modern agentic-flow-hooks service instead.

/**
 * @deprecated Use the modern hook templates from agentic-flow-hooks service
 * Import from: '../services/agentic-flow-hooks/index.js'
 */
export const QUALITY_HOOKS = {
  CODE_QUALITY: { name: 'Code Quality Monitor', type: 'workflow-step', priority: 8, enabled: true },
  SECURITY_SCAN: { name: 'Security Scanner', type: 'workflow-step', priority: 9, enabled: true },
  DOCUMENTATION_SYNC: { name: 'Documentation Sync', type: 'workflow-step', priority: 7, enabled: true },
  PERFORMANCE_MONITOR: { name: 'Performance Monitor', type: 'workflow-step', priority: 6, enabled: true }
} as const;

/**
 * @deprecated Use the modern configuration from agentic-flow-hooks service
 * Import from: '../services/agentic-flow-hooks/index.js'
 */
export const DEFAULT_HOOK_CONFIG = {
  maxConcurrentHooks: 20,
  defaultTimeout: 30000,
  enableMetrics: true,
  enablePersistence: true,
  logLevel: 'info' as const
} as const;

/**
 * @deprecated Use the modern hook types from agentic-flow-hooks service
 * Import from: '../services/agentic-flow-hooks/types.js'
 */
export const HOOK_TRIGGERS = {
  FILE_SAVE: 'workflow-step',
  FILE_CHANGE: 'workflow-step', 
  TASK_COMPLETE: 'workflow-complete',
  AGENT_SPAWN: 'workflow-start'
} as const;

/**
 * @deprecated Use the centralized agent types from src/constants/agent-types.ts
 */
export const AGENT_TYPES = {
  QUALITY_ASSURANCE: 'quality_assurance',
  SECURITY_SCAN: 'security_scan'
} as const;

// ===== DEPRECATED LEGACY UTILITIES =====

/**
 * @deprecated Use agenticHookManager and createHookContext from agentic-flow-hooks service
 */
export class HookUtils {
  /**
   * @deprecated Use agenticHookManager.register() with HookFilter instead
   */
  static createFilePatternCondition() {
    throw new Error('HookUtils.createFilePatternCondition is deprecated. Use agenticHookManager.register() with HookFilter instead.');
  }

  /**
   * @deprecated Use agenticHookManager.register() with hook handlers instead
   */
  static createSpawnAgentAction() {
    throw new Error('HookUtils.createSpawnAgentAction is deprecated. Use agenticHookManager.register() with hook handlers instead.');
  }

  /**
   * @deprecated Use agenticHookManager.register() with workflow-step hooks instead
   */
  static createQualityHook() {
    throw new Error('HookUtils.createQualityHook is deprecated. Use agenticHookManager.register() with workflow-step hooks instead.');
  }

  /**
   * @deprecated Use agenticHookManager.register() with workflow-step hooks instead
   */
  static createSecurityHook() {
    throw new Error('HookUtils.createSecurityHook is deprecated. Use agenticHookManager.register() with workflow-step hooks instead.');
  }

  /**
   * @deprecated Use agenticHookManager.register() with workflow-step hooks instead
   */
  static createDocumentationHook() {
    throw new Error('HookUtils.createDocumentationHook is deprecated. Use agenticHookManager.register() with workflow-step hooks instead.');
  }

  /**
   * @deprecated Use agenticHookManager.register() with performance-metric hooks instead
   */
  static createPerformanceHook() {
    throw new Error('HookUtils.createPerformanceHook is deprecated. Use agenticHookManager.register() with performance-metric hooks instead.');
  }
}

/**
 * @deprecated Use initializeAgenticFlowHooks() and agenticHookManager instead
 */
export function createHookEngine() {
  throw new Error('createHookEngine is deprecated. Use initializeAgenticFlowHooks() and agenticHookManager instead.');
}

/**
 * @deprecated Use agenticHookManager.register() for individual hooks instead
 */
export async function setupDefaultHooks() {
  throw new Error('setupDefaultHooks is deprecated. Use agenticHookManager.register() for individual hooks instead.');
}

// Migration completed - all functionality moved to agentic-flow-hooks service
// For documentation, see: docs/maestro/specs/hooks-system/