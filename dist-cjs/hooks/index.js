"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var hooks_exports = {};
__export(hooks_exports, {
  AGENT_TYPES: () => AGENT_TYPES,
  DEFAULT_HOOK_CONFIG: () => DEFAULT_HOOK_CONFIG,
  HOOK_TRIGGERS: () => HOOK_TRIGGERS,
  HookUtils: () => HookUtils,
  QUALITY_HOOKS: () => QUALITY_HOOKS,
  agenticHookManager: () => import_agentic_flow_hooks.agenticHookManager,
  createHookEngine: () => createHookEngine,
  initializeAgenticFlowHooks: () => import_agentic_flow_hooks.initializeAgenticFlowHooks,
  setupDefaultHooks: () => setupDefaultHooks
});
module.exports = __toCommonJS(hooks_exports);
var import_agentic_flow_hooks = require("../services/agentic-flow-hooks/index.js");
const QUALITY_HOOKS = {
  CODE_QUALITY: {
    name: "Code Quality Monitor",
    description: "Automatically runs code quality checks on file changes",
    type: "workflow-step",
    priority: 8,
    enabled: true
  },
  SECURITY_SCAN: {
    name: "Security Scanner",
    description: "Scans for security vulnerabilities and credential leaks",
    type: "workflow-step",
    priority: 9,
    enabled: true
  },
  DOCUMENTATION_SYNC: {
    name: "Documentation Sync",
    description: "Automatically updates documentation when specifications change",
    type: "workflow-step",
    priority: 7,
    enabled: true
  },
  PERFORMANCE_MONITOR: {
    name: "Performance Monitor",
    description: "Analyzes performance impact of code changes",
    type: "workflow-step",
    priority: 6,
    enabled: true
  }
};
const DEFAULT_HOOK_CONFIG = {
  maxConcurrentHooks: 10,
  defaultThrottleMs: 1e3,
  defaultDebounceMs: 500,
  eventQueueSize: 1e3,
  agentPoolSize: 50,
  enableMetrics: true,
  enablePersistence: true,
  logLevel: "info",
  watchPatterns: ["**/*.md", "**/*.ts", "**/*.js", "**/*.json"],
  ignorePatterns: ["node_modules/**", ".git/**", "dist/**", "build/**"]
};
const HOOK_TRIGGERS = {
  FILE_SAVE: "workflow-step",
  FILE_CHANGE: "workflow-step",
  FILE_CREATE: "workflow-start",
  FILE_DELETE: "workflow-complete",
  TASK_COMPLETE: "workflow-complete",
  TASK_FAIL: "workflow-error",
  SPEC_UPDATE: "workflow-step",
  CODE_CHANGE: "workflow-step",
  AGENT_SPAWN: "workflow-start",
  WORKFLOW_PHASE: "workflow-step",
  TIME_INTERVAL: "performance-metric"
};
const AGENT_TYPES = {
  QUALITY_ASSURANCE: "quality_assurance",
  SECURITY_SCAN: "security_scan",
  DOCUMENTATION_SYNC: "documentation_sync",
  PERFORMANCE_ANALYSIS: "performance_analysis"
};
class HookUtils {
  static {
    __name(this, "HookUtils");
  }
  /**
   * @deprecated Use agenticHookManager.register() instead
   */
  static createFilePatternCondition(pattern) {
    console.warn("HookUtils.createFilePatternCondition is deprecated. Use agenticHookManager.register() with proper HookFilter instead.");
    return { type: "file_pattern", pattern };
  }
  /**
   * @deprecated Use agenticHookManager.register() instead
   */
  static createSpawnAgentAction(agentType, config) {
    console.warn("HookUtils.createSpawnAgentAction is deprecated. Use agenticHookManager.register() with proper hook handlers instead.");
    return { type: "spawn_agent", agentType, agentConfig: config };
  }
  /**
   * @deprecated Use agenticHookManager.register() instead
   */
  static createQualityHook(options) {
    console.warn("HookUtils.createQualityHook is deprecated. Use agenticHookManager.register() with workflow-step hooks instead.");
    return QUALITY_HOOKS.CODE_QUALITY;
  }
  /**
   * @deprecated Use agenticHookManager.register() instead  
   */
  static createSecurityHook(options) {
    console.warn("HookUtils.createSecurityHook is deprecated. Use agenticHookManager.register() with workflow-step hooks instead.");
    return QUALITY_HOOKS.SECURITY_SCAN;
  }
  /**
   * @deprecated Use agenticHookManager.register() instead
   */
  static createDocumentationHook(options) {
    console.warn("HookUtils.createDocumentationHook is deprecated. Use agenticHookManager.register() with workflow-step hooks instead.");
    return QUALITY_HOOKS.DOCUMENTATION_SYNC;
  }
  /**
   * @deprecated Use agenticHookManager.register() instead
   */
  static createPerformanceHook(options) {
    console.warn("HookUtils.createPerformanceHook is deprecated. Use agenticHookManager.register() with performance-metric hooks instead.");
    return QUALITY_HOOKS.PERFORMANCE_MONITOR;
  }
}
function createHookEngine(config) {
  console.warn("createHookEngine is deprecated. Use initializeAgenticFlowHooks() and agenticHookManager instead.");
  return {
    registerHook: () => console.warn("Use agenticHookManager.register() instead"),
    start: () => console.warn("Hooks are automatically initialized with agenticHookManager"),
    stop: () => console.warn("Use agenticHookManager shutdown methods instead")
  };
}
__name(createHookEngine, "createHookEngine");
async function setupDefaultHooks(engine) {
  console.warn("setupDefaultHooks is deprecated. Use agenticHookManager.register() to register specific hooks instead.");
  console.info("Consider migrating to agentic-flow-hooks for advanced pipeline management and neural integration.");
  return 4;
}
__name(setupDefaultHooks, "setupDefaultHooks");
console.info(`
\u{1F504} MIGRATION NOTICE: Hook System Consolidation

The legacy hook system in src/hooks/ has been consolidated with the advanced
agentic-flow-hooks system for better performance and functionality.

\u2705 New System Features:
  - Advanced pipeline management
  - Neural pattern learning  
  - Performance optimization
  - Memory coordination hooks
  - LLM integration hooks

\u{1F4D6} Migration Guide:
  - Replace AgentHookEngine with agenticHookManager
  - Update hook registrations to use modern HookRegistration interface
  - Leverage new hook types: LLM, memory, neural, performance, workflow
  - See docs/maestro/specs/hooks-refactoring-plan.md for details

\u{1F680} Get Started:
  import { agenticHookManager, initializeAgenticFlowHooks } from '../services/agentic-flow-hooks/'
  await initializeAgenticFlowHooks()
  agenticHookManager.register({ ... })
`);
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AGENT_TYPES,
  DEFAULT_HOOK_CONFIG,
  HOOK_TRIGGERS,
  HookUtils,
  QUALITY_HOOKS,
  agenticHookManager,
  createHookEngine,
  initializeAgenticFlowHooks,
  setupDefaultHooks
});
//# sourceMappingURL=index.js.map
