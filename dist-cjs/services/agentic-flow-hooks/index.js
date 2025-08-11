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
var __reExport = (target, mod, secondTarget) => (__copyProps(target, mod, "default"), secondTarget && __copyProps(secondTarget, mod, "default"));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var agentic_flow_hooks_exports = {};
__export(agentic_flow_hooks_exports, {
  agenticHookManager: () => import_hook_manager2.agenticHookManager,
  createHookContext: () => createHookContext,
  getHookSystemStatus: () => getHookSystemStatus,
  initializeAgenticFlowHooks: () => initializeAgenticFlowHooks,
  shutdownAgenticFlowHooks: () => shutdownAgenticFlowHooks
});
module.exports = __toCommonJS(agentic_flow_hooks_exports);
var import_hook_manager = require("./hook-manager.js");
var import_llm_hooks = require("./llm-hooks.js");
var import_memory_hooks = require("./memory-hooks.js");
var import_neural_hooks = require("./neural-hooks.js");
var import_performance_hooks = require("./performance-hooks.js");
var import_workflow_hooks = require("./workflow-hooks.js");
var import_logger = require("../../core/logger.js");
__reExport(agentic_flow_hooks_exports, require("./types.js"), module.exports);
var import_hook_manager2 = require("./hook-manager.js");
__reExport(agentic_flow_hooks_exports, require("./llm-hooks.js"), module.exports);
__reExport(agentic_flow_hooks_exports, require("./memory-hooks.js"), module.exports);
__reExport(agentic_flow_hooks_exports, require("./neural-hooks.js"), module.exports);
__reExport(agentic_flow_hooks_exports, require("./performance-hooks.js"), module.exports);
__reExport(agentic_flow_hooks_exports, require("./workflow-hooks.js"), module.exports);
const logger = new import_logger.Logger({
  level: "info",
  format: "text",
  destination: "console"
}, { prefix: "AgenticFlowHooks" });
async function initializeAgenticFlowHooks() {
  logger.info("Initializing agentic-flow hook system...");
  try {
    (0, import_llm_hooks.registerLLMHooks)();
    logger.debug("LLM hooks registered");
    (0, import_memory_hooks.registerMemoryHooks)();
    logger.debug("Memory hooks registered");
    (0, import_neural_hooks.registerNeuralHooks)();
    logger.debug("Neural hooks registered");
    (0, import_performance_hooks.registerPerformanceHooks)();
    logger.debug("Performance hooks registered");
    (0, import_workflow_hooks.registerWorkflowHooks)();
    logger.debug("Workflow hooks registered");
    await setupDefaultPipelines();
    startMetricsCollection();
    logger.info("Agentic-flow hook system initialized successfully");
  } catch (error) {
    logger.error("Failed to initialize agentic-flow hooks:", error);
    throw error;
  }
}
__name(initializeAgenticFlowHooks, "initializeAgenticFlowHooks");
async function setupDefaultPipelines() {
  import_hook_manager.agenticHookManager.createPipeline({
    id: "llm-call-pipeline",
    name: "LLM Call Pipeline",
    stages: [
      {
        name: "pre-call",
        hooks: import_hook_manager.agenticHookManager.getHooks("pre-llm-call"),
        parallel: false
      },
      {
        name: "call-execution",
        hooks: [],
        // Actual LLM call happens here
        parallel: false
      },
      {
        name: "post-call",
        hooks: import_hook_manager.agenticHookManager.getHooks("post-llm-call"),
        parallel: true
      }
    ],
    errorStrategy: "continue"
  });
  import_hook_manager.agenticHookManager.createPipeline({
    id: "memory-operation-pipeline",
    name: "Memory Operation Pipeline",
    stages: [
      {
        name: "validation",
        hooks: import_hook_manager.agenticHookManager.getHooks("pre-memory-store"),
        parallel: false
      },
      {
        name: "storage",
        hooks: import_hook_manager.agenticHookManager.getHooks("post-memory-store"),
        parallel: true
      },
      {
        name: "sync",
        hooks: import_hook_manager.agenticHookManager.getHooks("memory-sync"),
        parallel: true,
        condition: (ctx) => ctx.metadata.crossProvider === true
      }
    ],
    errorStrategy: "rollback"
  });
  import_hook_manager.agenticHookManager.createPipeline({
    id: "workflow-execution-pipeline",
    name: "Workflow Execution Pipeline",
    stages: [
      {
        name: "initialization",
        hooks: import_hook_manager.agenticHookManager.getHooks("workflow-start"),
        parallel: false
      },
      {
        name: "execution",
        hooks: [
          ...import_hook_manager.agenticHookManager.getHooks("workflow-step"),
          ...import_hook_manager.agenticHookManager.getHooks("workflow-decision")
        ],
        parallel: false
      },
      {
        name: "completion",
        hooks: import_hook_manager.agenticHookManager.getHooks("workflow-complete"),
        parallel: true
      }
    ],
    errorStrategy: "fail-fast"
  });
}
__name(setupDefaultPipelines, "setupDefaultPipelines");
function startMetricsCollection() {
  setInterval(() => {
    const metrics = import_hook_manager.agenticHookManager.getMetrics();
    logger.debug("Hook system metrics:", {
      totalHooks: metrics["hooks.count"],
      totalExecutions: metrics["hooks.executions"],
      errorRate: metrics["hooks.errors"] / metrics["hooks.executions"] || 0,
      cacheHitRate: metrics["hooks.cacheHits"] / metrics["hooks.executions"] || 0
    });
    import_hook_manager.agenticHookManager.emit("metrics:collected", metrics);
  }, 3e4);
}
__name(startMetricsCollection, "startMetricsCollection");
async function shutdownAgenticFlowHooks() {
  logger.info("Shutting down agentic-flow hook system...");
  try {
    const maxWaitTime = 1e4;
    const startTime = Date.now();
    while (import_hook_manager.agenticHookManager.getMetrics()["executions.active"] > 0) {
      if (Date.now() - startTime > maxWaitTime) {
        logger.warn("Timeout waiting for active executions to complete");
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    import_hook_manager.agenticHookManager.removeAllListeners();
    logger.info("Agentic-flow hook system shut down successfully");
  } catch (error) {
    logger.error("Error during hook system shutdown:", error);
    throw error;
  }
}
__name(shutdownAgenticFlowHooks, "shutdownAgenticFlowHooks");
function getHookSystemStatus() {
  const metrics = import_hook_manager.agenticHookManager.getMetrics();
  return {
    initialized: metrics["hooks.count"] > 0,
    metrics,
    pipelines: [
      "llm-call-pipeline",
      "memory-operation-pipeline",
      "workflow-execution-pipeline"
    ],
    activeExecutions: metrics["executions.active"] || 0
  };
}
__name(getHookSystemStatus, "getHookSystemStatus");
function createHookContext() {
  class ContextBuilder {
    static {
      __name(this, "ContextBuilder");
    }
    context = {
      timestamp: Date.now(),
      correlationId: this.generateCorrelationId(),
      metadata: {}
    };
    withSession(sessionId) {
      this.context.sessionId = sessionId;
      return this;
    }
    withMemory(namespace, provider) {
      this.context.memory = {
        namespace,
        provider,
        cache: /* @__PURE__ */ new Map()
      };
      return this;
    }
    withNeural(modelId) {
      this.context.neural = {
        modelId,
        patterns: this.createPatternStore(),
        training: {
          epoch: 0,
          loss: 0,
          accuracy: 0,
          learningRate: 1e-3,
          optimizer: "adam",
          checkpoints: []
        }
      };
      return this;
    }
    withPerformance(metrics) {
      const metricsMap = /* @__PURE__ */ new Map();
      metrics.forEach((m) => metricsMap.set(m.name, m));
      this.context.performance = {
        metrics: metricsMap,
        bottlenecks: [],
        optimizations: []
      };
      return this;
    }
    withMetadata(metadata) {
      this.context.metadata = { ...this.context.metadata, ...metadata };
      return this;
    }
    build() {
      if (!this.context.sessionId) {
        this.context.sessionId = this.generateSessionId();
      }
      if (!this.context.memory) {
        this.context.memory = {
          namespace: "default",
          provider: "memory",
          cache: /* @__PURE__ */ new Map()
        };
      }
      if (!this.context.neural) {
        this.context.neural = {
          modelId: "default",
          patterns: this.createPatternStore(),
          training: {
            epoch: 0,
            loss: 0,
            accuracy: 0,
            learningRate: 1e-3,
            optimizer: "adam",
            checkpoints: []
          }
        };
      }
      if (!this.context.performance) {
        this.context.performance = {
          metrics: /* @__PURE__ */ new Map(),
          bottlenecks: [],
          optimizations: []
        };
      }
      return this.context;
    }
    generateCorrelationId() {
      return `corr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    generateSessionId() {
      return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    createPatternStore() {
      const patterns = /* @__PURE__ */ new Map();
      return {
        add(pattern) {
          patterns.set(pattern.id, pattern);
        },
        get(id) {
          return patterns.get(id);
        },
        findSimilar(pattern, threshold) {
          const results = [];
          for (const p of patterns.values()) {
            if (p.type === pattern.type && p.confidence >= threshold) {
              results.push(p);
            }
          }
          return results;
        },
        getByType(type) {
          return Array.from(patterns.values()).filter((p) => p.type === type);
        },
        prune(maxAge) {
          const cutoff = Date.now() - maxAge;
          for (const [id, pattern] of patterns) {
            if (pattern.context.timestamp < cutoff) {
              patterns.delete(id);
            }
          }
        },
        export() {
          return Array.from(patterns.values());
        },
        import(newPatterns) {
          for (const pattern of newPatterns) {
            patterns.set(pattern.id, pattern);
          }
        }
      };
    }
  }
  return new ContextBuilder();
}
__name(createHookContext, "createHookContext");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  agenticHookManager,
  createHookContext,
  getHookSystemStatus,
  initializeAgenticFlowHooks,
  shutdownAgenticFlowHooks,
  ...require("./types.js"),
  ...require("./llm-hooks.js"),
  ...require("./memory-hooks.js"),
  ...require("./neural-hooks.js"),
  ...require("./performance-hooks.js"),
  ...require("./workflow-hooks.js")
});
//# sourceMappingURL=index.js.map
