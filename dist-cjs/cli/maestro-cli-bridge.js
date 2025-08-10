"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var maestro_cli_bridge_exports = {};
__export(maestro_cli_bridge_exports, {
  MaestroCLIBridge: () => MaestroCLIBridge
});
module.exports = __toCommonJS(maestro_cli_bridge_exports);
var import_path = require("path");
var import_chalk = __toESM(require("chalk"), 1);
var import_events = require("events");
var import_agent_manager = require("../agents/agent-manager.js");
var import_orchestrator = require("../core/orchestrator.js");
var import_maestro_swarm_coordinator = require("../maestro/maestro-swarm-coordinator.js");
var import_agentic_flow_hooks = require("../services/agentic-flow-hooks/index.js");
class MaestroCLIBridge {
  constructor(bridgeConfig = {}) {
    this.bridgeConfig = bridgeConfig;
    this.bridgeConfig = {
      enablePerformanceMonitoring: true,
      initializationTimeout: 3e4,
      // 30 seconds
      cacheEnabled: true,
      logLevel: "info",
      ...this.bridgeConfig
    };
  }
  static {
    __name(this, "MaestroCLIBridge");
  }
  swarmCoordinator;
  initializationCache = /* @__PURE__ */ new Map();
  configCache;
  performanceMetrics = [];
  initialized = false;
  /**
   * Initialize orchestrator with parallel dependency loading and caching
   */
  async initializeOrchestrator() {
    const startTime = Date.now();
    try {
      if (this.swarmCoordinator && this.initialized) {
        console.log(import_chalk.default.green("\u2705 Using cached Maestro swarm coordinator"));
        return this.swarmCoordinator;
      }
      console.log(import_chalk.default.blue("\u{1F680} Initializing Maestro orchestrator..."));
      const [config, eventBus, logger, memoryManager, agentManager, mainOrchestrator] = await Promise.all([
        this.getOrCreateConfig(),
        this.getOrCreateEventBus(),
        this.getOrCreateLogger(),
        this.getOrCreateMemoryManager(),
        this.getOrCreateAgentManager(),
        this.getOrCreateMainOrchestrator()
      ]);
      const maestroConfig = this.getOptimizedMaestroConfig();
      this.swarmCoordinator = new import_maestro_swarm_coordinator.MaestroSwarmCoordinator(
        maestroConfig,
        eventBus,
        logger
      );
      await this.executeWithMonitoring("swarm_init", async () => {
        const swarmId = await this.swarmCoordinator.initialize();
        console.log(import_chalk.default.green(`\u2705 Native hive mind swarm initialized: ${swarmId}`));
      });
      this.initialized = true;
      const duration = Date.now() - startTime;
      console.log(import_chalk.default.green(`\u2705 Maestro orchestrator ready (${duration}ms)`));
      await this.reportPerformanceMetric("orchestrator_init", duration, true);
      return this.swarmCoordinator;
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.reportPerformanceMetric("orchestrator_init", duration, false, error instanceof Error ? error.message : String(error));
      console.error(import_chalk.default.red(`\u274C Failed to initialize Maestro orchestrator: ${error instanceof Error ? error.message : String(error)}`));
      throw error;
    }
  }
  /**
   * Execute operation with performance monitoring
   */
  async executeWithMonitoring(operation, fn, context) {
    if (!this.bridgeConfig.enablePerformanceMonitoring) {
      return await fn();
    }
    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;
    try {
      await this.executePerformanceHook("performance-metric", {
        metric: `${operation}_start`,
        value: startTime,
        unit: "timestamp",
        context: { operation, ...context }
      });
      const result = await fn();
      const endTime = Date.now();
      const endMemory = process.memoryUsage().heapUsed;
      const duration = endTime - startTime;
      const memoryDelta = endMemory - startMemory;
      await this.reportPerformanceMetric(operation, duration, true, void 0, memoryDelta);
      await this.executePerformanceHook("performance-metric", {
        metric: `${operation}_complete`,
        value: duration,
        unit: "milliseconds",
        context: {
          operation,
          success: true,
          memoryDelta: memoryDelta / 1024 / 1024,
          // MB
          ...context
        }
      });
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const memoryDelta = process.memoryUsage().heapUsed - startMemory;
      await this.reportPerformanceMetric(operation, duration, false, error instanceof Error ? error.message : String(error), memoryDelta);
      await this.executePerformanceHook("performance-metric", {
        metric: `${operation}_error`,
        value: duration,
        unit: "milliseconds",
        context: {
          operation,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          memoryDelta: memoryDelta / 1024 / 1024,
          // MB
          ...context
        }
      });
      throw error;
    }
  }
  /**
   * Get optimized Maestro configuration
   */
  getOptimizedMaestroConfig() {
    return {
      hiveMindConfig: {
        name: "maestro-specs-driven-swarm",
        topology: "specs-driven",
        queenMode: "strategic",
        maxAgents: 8,
        consensusThreshold: 0.66,
        memoryTTL: 864e5,
        autoSpawn: true,
        enableConsensus: true,
        enableMemory: true,
        enableCommunication: true
      },
      enableConsensusValidation: true,
      enableLivingDocumentation: true,
      enableSteeringIntegration: true,
      specsDirectory: (0, import_path.join)(process.cwd(), "docs", "maestro", "specs"),
      steeringDirectory: (0, import_path.join)(process.cwd(), "docs", "maestro", "steering")
    };
  }
  /**
   * Cached configuration management
   */
  async getOrCreateConfig() {
    const cacheKey = "config";
    if (this.bridgeConfig.cacheEnabled && this.initializationCache.has(cacheKey)) {
      return this.initializationCache.get(cacheKey);
    }
    const config = {
      env: "development",
      logLevel: this.bridgeConfig.logLevel || "info",
      enableMetrics: this.bridgeConfig.enablePerformanceMonitoring || true
    };
    if (this.bridgeConfig.cacheEnabled) {
      this.initializationCache.set(cacheKey, config);
    }
    return config;
  }
  /**
   * Cached event bus creation
   */
  async getOrCreateEventBus() {
    const cacheKey = "eventBus";
    if (this.bridgeConfig.cacheEnabled && this.initializationCache.has(cacheKey)) {
      return this.initializationCache.get(cacheKey);
    }
    const eventBus = new import_events.EventEmitter();
    if (this.bridgeConfig.cacheEnabled) {
      this.initializationCache.set(cacheKey, eventBus);
    }
    return eventBus;
  }
  /**
   * Cached logger creation
   */
  async getOrCreateLogger() {
    const cacheKey = "logger";
    if (this.bridgeConfig.cacheEnabled && this.initializationCache.has(cacheKey)) {
      return this.initializationCache.get(cacheKey);
    }
    const logger = {
      debug: (message, ...args) => {
        if (this.bridgeConfig.logLevel === "debug") {
          console.log(import_chalk.default.gray(`[DEBUG] ${message}`), ...args);
        }
      },
      info: (message, ...args) => {
        console.log(import_chalk.default.blue(`[INFO] ${message}`), ...args);
      },
      warn: (message, ...args) => {
        console.log(import_chalk.default.yellow(`[WARN] ${message}`), ...args);
      },
      error: (message, ...args) => {
        console.log(import_chalk.default.red(`[ERROR] ${message}`), ...args);
      },
      configure: async (config) => {
      },
      level: this.bridgeConfig.logLevel
    };
    if (this.bridgeConfig.cacheEnabled) {
      this.initializationCache.set(cacheKey, logger);
    }
    return logger;
  }
  /**
   * Cached memory manager creation
   */
  async getOrCreateMemoryManager() {
    const cacheKey = "memoryManager";
    if (this.bridgeConfig.cacheEnabled && this.initializationCache.has(cacheKey)) {
      return this.initializationCache.get(cacheKey);
    }
    const memoryManager = {
      initialize: async () => {
      },
      shutdown: async () => {
      },
      createBank: async (agentId) => `bank-${agentId}`,
      closeBank: async (bankId) => {
      },
      store: async (entry) => {
      },
      retrieve: async (id) => void 0,
      query: async (query) => [],
      update: async (id, updates) => {
      },
      delete: async (id) => {
      },
      getHealthStatus: async () => ({ healthy: true }),
      performMaintenance: async () => {
      }
    };
    if (this.bridgeConfig.cacheEnabled) {
      this.initializationCache.set(cacheKey, memoryManager);
    }
    return memoryManager;
  }
  /**
   * Cached agent manager creation
   */
  async getOrCreateAgentManager() {
    const cacheKey = "agentManager";
    if (this.bridgeConfig.cacheEnabled && this.initializationCache.has(cacheKey)) {
      return this.initializationCache.get(cacheKey);
    }
    const config = await this.getOrCreateConfig();
    const eventBus = await this.getOrCreateEventBus();
    const logger = await this.getOrCreateLogger();
    const memoryManager = await this.getOrCreateMemoryManager();
    const agentManager = new import_agent_manager.AgentManager(
      { maxAgents: 10 },
      // AgentManagerConfig
      logger,
      eventBus,
      memoryManager
      // Cast to DistributedMemorySystem
    );
    if (this.bridgeConfig.cacheEnabled) {
      this.initializationCache.set(cacheKey, agentManager);
    }
    return agentManager;
  }
  /**
   * Cached main orchestrator creation
   */
  async getOrCreateMainOrchestrator() {
    const cacheKey = "mainOrchestrator";
    if (this.bridgeConfig.cacheEnabled && this.initializationCache.has(cacheKey)) {
      return this.initializationCache.get(cacheKey);
    }
    const config = await this.getOrCreateConfig();
    const eventBus = await this.getOrCreateEventBus();
    const logger = await this.getOrCreateLogger();
    const memoryManager = await this.getOrCreateMemoryManager();
    const mockTerminalManager = {};
    const mockCoordinationManager = {};
    const mockMCPServer = {};
    const orchestrator = new import_orchestrator.Orchestrator(
      config,
      mockTerminalManager,
      memoryManager,
      mockCoordinationManager,
      mockMCPServer,
      eventBus,
      logger
    );
    if (this.bridgeConfig.cacheEnabled) {
      this.initializationCache.set(cacheKey, orchestrator);
    }
    return orchestrator;
  }
  /**
   * Execute performance hooks
   */
  async executePerformanceHook(type, data) {
    try {
      await import_agentic_flow_hooks.agenticHookManager.executeHooks(type, data, {
        sessionId: `maestro-cli-${Date.now()}`,
        timestamp: Date.now(),
        correlationId: `maestro-performance`,
        metadata: { source: "maestro-cli-bridge" },
        memory: { namespace: "maestro", provider: "memory", cache: /* @__PURE__ */ new Map() },
        neural: { modelId: "default", patterns: null, training: null },
        performance: { metrics: /* @__PURE__ */ new Map(), bottlenecks: [], optimizations: [] }
      });
    } catch (error) {
      console.warn(import_chalk.default.yellow(`\u26A0\uFE0F  Performance hook failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  }
  /**
   * Report performance metrics
   */
  async reportPerformanceMetric(operation, duration, success, error, memoryUsage) {
    const metric = {
      operation,
      duration,
      success,
      timestamp: Date.now(),
      memoryUsage,
      error
    };
    this.performanceMetrics.push(metric);
    if (this.performanceMetrics.length > 100) {
      this.performanceMetrics.shift();
    }
    if (this.bridgeConfig.logLevel === "debug") {
      const memoryInfo = memoryUsage ? ` (${(memoryUsage / 1024 / 1024).toFixed(2)}MB)` : "";
      console.log(
        import_chalk.default.gray(
          `[PERF] ${operation}: ${duration}ms ${success ? "\u2713" : "\u2717"}${memoryInfo}`
        )
      );
    }
  }
  /**
   * Get performance summary
   */
  getPerformanceSummary() {
    const successful = this.performanceMetrics.filter((m) => m.success);
    const failed = this.performanceMetrics.filter((m) => !m.success);
    const avgDuration = successful.length > 0 ? successful.reduce((sum, m) => sum + m.duration, 0) / successful.length : 0;
    return {
      totalOperations: this.performanceMetrics.length,
      successfulOperations: successful.length,
      failedOperations: failed.length,
      successRate: this.performanceMetrics.length > 0 ? successful.length / this.performanceMetrics.length * 100 : 0,
      averageDuration: Math.round(avgDuration),
      recentMetrics: this.performanceMetrics.slice(-10)
    };
  }
  /**
   * Validate configuration and environment
   */
  async validateConfiguration() {
    const issues = [];
    try {
      const nodeVersion = process.versions.node;
      const majorVersion = parseInt(nodeVersion.split(".")[0]);
      if (majorVersion < 16) {
        issues.push(`Node.js version ${nodeVersion} is not supported. Minimum required: 16.0.0`);
      }
      const memoryUsage = process.memoryUsage();
      const availableMemory = memoryUsage.heapTotal;
      if (availableMemory < 100 * 1024 * 1024) {
        issues.push("Low available memory detected. Maestro requires at least 100MB heap space");
      }
      const specsDir = (0, import_path.join)(process.cwd(), "docs", "maestro", "specs");
      try {
        const fs = await import("fs/promises");
        await fs.access(specsDir, fs.constants.F_OK);
      } catch {
      }
      return {
        valid: issues.length === 0,
        issues
      };
    } catch (error) {
      issues.push(`Configuration validation failed: ${error instanceof Error ? error.message : String(error)}`);
      return { valid: false, issues };
    }
  }
  /**
   * Clear caches and reset state
   */
  clearCache() {
    this.initializationCache.clear();
    this.configCache = void 0;
    this.initialized = false;
    console.log(import_chalk.default.gray("\u{1F9F9} Maestro CLI bridge cache cleared"));
  }
  /**
   * Shutdown and cleanup resources
   */
  async shutdown() {
    if (this.swarmCoordinator) {
      await this.swarmCoordinator.shutdown();
    }
    this.clearCache();
    this.performanceMetrics = [];
    console.log(import_chalk.default.green("\u2705 Maestro CLI bridge shutdown complete"));
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MaestroCLIBridge
});
//# sourceMappingURL=maestro-cli-bridge.js.map
