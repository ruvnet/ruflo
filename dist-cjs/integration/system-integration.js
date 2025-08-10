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
var system_integration_exports = {};
__export(system_integration_exports, {
  SystemIntegration: () => SystemIntegration,
  systemIntegration: () => systemIntegration
});
module.exports = __toCommonJS(system_integration_exports);
var import_event_bus = require("../core/event-bus.js");
var import_logger = require("../core/logger.js");
var import_error_handler = require("../utils/error-handler.js");
class SystemIntegration {
  static {
    __name(this, "SystemIntegration");
  }
  static instance;
  eventBus;
  logger;
  orchestrator = null;
  configManager = null;
  memoryManager = null;
  agentManager = null;
  swarmCoordinator = null;
  taskEngine = null;
  monitor = null;
  mcpServer = null;
  initialized = false;
  componentStatuses = /* @__PURE__ */ new Map();
  constructor() {
    this.eventBus = import_event_bus.EventBus.getInstance();
    this.logger = new import_logger.Logger({ level: "info", format: "text", destination: "console" });
    try {
      this.configManager = {
        getInstance: () => ({ load: async () => {
        }, get: () => null, set: () => {
        } })
      };
    } catch (error) {
      this.logger.warn("ConfigManager not available, using mock");
      this.configManager = { load: async () => {
      }, get: () => null, set: () => {
      } };
    }
    this.setupEventHandlers();
  }
  static getInstance() {
    if (!SystemIntegration.instance) {
      SystemIntegration.instance = new SystemIntegration();
    }
    return SystemIntegration.instance;
  }
  /**
   * Initialize all system components in proper order
   */
  async initialize(config) {
    if (this.initialized) {
      this.logger.warn("System already initialized");
      return;
    }
    this.logger.info("\u{1F680} Starting Claude Flow v2.0.0 System Integration");
    try {
      await this.initializeCore(config);
      await this.initializeMemoryAndConfig();
      await this.initializeAgentsAndCoordination();
      await this.initializeTaskManagement();
      await this.initializeMonitoringAndMcp();
      await this.wireComponents();
      this.initialized = true;
      this.logger.info("\u2705 Claude Flow v2.0.0 System Integration Complete");
      this.eventBus.emit("system:ready", {
        timestamp: Date.now(),
        components: Array.from(this.componentStatuses.keys()),
        health: await this.getSystemHealth()
      });
    } catch (error) {
      this.logger.error("\u274C System Integration Failed:", (0, import_error_handler.getErrorMessage)(error));
      throw error;
    }
  }
  /**
   * Initialize core infrastructure components
   */
  async initializeCore(config) {
    this.logger.info("\u{1F527} Phase 1: Initializing Core Infrastructure");
    try {
      if (this.configManager && typeof this.configManager.load === "function") {
        await this.configManager.load();
        this.updateComponentStatus("config", "healthy", "Configuration loaded");
      } else {
        this.updateComponentStatus("config", "warning", "Configuration manager not available");
      }
      try {
        const { Orchestrator } = await import("../core/orchestrator-fixed.js");
        this.orchestrator = new Orchestrator(this.configManager, this.eventBus, this.logger);
        if (typeof this.orchestrator.initialize === "function") {
          await this.orchestrator.initialize();
        }
        this.updateComponentStatus("orchestrator", "healthy", "Orchestrator initialized");
      } catch (error) {
        this.logger.warn("Orchestrator not available:", (0, import_error_handler.getErrorMessage)(error));
        this.updateComponentStatus("orchestrator", "warning", "Orchestrator not available");
      }
      this.logger.info("\u2705 Core Infrastructure Ready");
    } catch (error) {
      this.logger.error("Core initialization failed:", (0, import_error_handler.getErrorMessage)(error));
      throw error;
    }
  }
  /**
   * Initialize memory and configuration management
   */
  async initializeMemoryAndConfig() {
    this.logger.info("\u{1F9E0} Phase 2: Initializing Memory and Configuration");
    try {
      try {
        const { MemoryManager: MemoryManager2 } = await import("../memory/manager.js");
        const memoryConfig = {
          backend: "sqlite",
          cacheSizeMB: 50,
          syncInterval: 3e4,
          // 30 seconds
          conflictResolution: "last-write",
          retentionDays: 30,
          sqlitePath: "./.swarm/memory.db"
        };
        this.memoryManager = new MemoryManager2(memoryConfig, this.eventBus, this.logger);
        if (typeof this.memoryManager.initialize === "function") {
          await this.memoryManager.initialize();
        }
        this.updateComponentStatus(
          "memory",
          "healthy",
          "Memory manager initialized with SQLite backend"
        );
        this.logger.info("Memory manager initialized successfully", {
          backend: memoryConfig.backend,
          cacheSizeMB: memoryConfig.cacheSizeMB,
          sqlitePath: memoryConfig.sqlitePath
        });
      } catch (error) {
        this.logger.warn("Memory manager initialization failed:", (0, import_error_handler.getErrorMessage)(error));
        this.updateComponentStatus("memory", "warning", "Memory manager not available");
      }
      this.logger.info("\u2705 Memory and Configuration Ready");
    } catch (error) {
      this.logger.error("Memory initialization failed:", (0, import_error_handler.getErrorMessage)(error));
      throw error;
    }
  }
  /**
   * Initialize agents and coordination systems
   */
  async initializeAgentsAndCoordination() {
    this.logger.info("\u{1F916} Phase 3: Initializing Agents and Coordination");
    try {
      try {
        const { AgentManager: AgentManager2 } = await import("../agents/agent-manager.js");
        this.agentManager = new AgentManager2(this.eventBus, this.logger);
        if (typeof this.agentManager.initialize === "function") {
          await this.agentManager.initialize();
        }
        this.updateComponentStatus("agents", "healthy", "Agent manager initialized");
      } catch (error) {
        this.logger.warn("Agent manager not available, using mock:", (0, import_error_handler.getErrorMessage)(error));
        const { MockAgentManager } = await import("./mock-components.js");
        this.agentManager = new MockAgentManager(this.eventBus, this.logger);
        await this.agentManager.initialize();
        this.updateComponentStatus("agents", "warning", "Using mock agent manager");
      }
      try {
        const { SwarmCoordinator } = await import("../coordination/swarm-coordinator.js");
        this.swarmCoordinator = new SwarmCoordinator(
          this.eventBus,
          this.logger,
          this.memoryManager
        );
        if (typeof this.swarmCoordinator.initialize === "function") {
          await this.swarmCoordinator.initialize();
        }
        this.updateComponentStatus("swarm", "healthy", "Swarm coordinator initialized");
      } catch (error) {
        this.logger.warn("Swarm coordinator not available, using mock:", (0, import_error_handler.getErrorMessage)(error));
        const { MockSwarmCoordinator } = await import("./mock-components.js");
        this.swarmCoordinator = new MockSwarmCoordinator(
          this.eventBus,
          this.logger,
          this.memoryManager
        );
        await this.swarmCoordinator.initialize();
        this.updateComponentStatus("swarm", "warning", "Using mock swarm coordinator");
      }
      this.logger.info("\u2705 Agents and Coordination Ready");
    } catch (error) {
      this.logger.error("Agents and coordination initialization failed:", (0, import_error_handler.getErrorMessage)(error));
      throw error;
    }
  }
  /**
   * Initialize task management system
   */
  async initializeTaskManagement() {
    this.logger.info("\u{1F4CB} Phase 4: Initializing Task Management");
    try {
      try {
        const { TaskEngine: TaskEngine2 } = await import("../task/engine.js");
        this.taskEngine = new TaskEngine2(this.eventBus, this.logger, this.memoryManager);
        if (typeof this.taskEngine.initialize === "function") {
          await this.taskEngine.initialize();
        }
        this.updateComponentStatus("tasks", "healthy", "Task engine initialized");
      } catch (error) {
        this.logger.warn("Task engine not available, using mock:", (0, import_error_handler.getErrorMessage)(error));
        const { MockTaskEngine } = await import("./mock-components.js");
        this.taskEngine = new MockTaskEngine(this.eventBus, this.logger, this.memoryManager);
        await this.taskEngine.initialize();
        this.updateComponentStatus("tasks", "warning", "Using mock task engine");
      }
      this.logger.info("\u2705 Task Management Ready");
    } catch (error) {
      this.logger.error("Task management initialization failed:", (0, import_error_handler.getErrorMessage)(error));
      throw error;
    }
  }
  /**
   * Initialize monitoring and MCP systems
   */
  async initializeMonitoringAndMcp() {
    this.logger.info("\u{1F4CA} Phase 5: Initializing Monitoring and MCP");
    try {
      try {
        const { RealTimeMonitor: RealTimeMonitor2 } = await import("../monitoring/real-time-monitor.js");
        this.monitor = new RealTimeMonitor2(this.eventBus, this.logger);
        if (typeof this.monitor.initialize === "function") {
          await this.monitor.initialize();
        }
        this.updateComponentStatus("monitor", "healthy", "Real-time monitor initialized");
      } catch (error) {
        this.logger.warn("Real-time monitor not available, using mock:", (0, import_error_handler.getErrorMessage)(error));
        const { MockRealTimeMonitor } = await import("./mock-components.js");
        this.monitor = new MockRealTimeMonitor(this.eventBus, this.logger);
        await this.monitor.initialize();
        this.updateComponentStatus("monitor", "warning", "Using mock monitor");
      }
      try {
        const { McpServer: McpServer2 } = await import("../mcp/server.js");
        this.mcpServer = new McpServer2(this.eventBus, this.logger);
        if (typeof this.mcpServer.initialize === "function") {
          await this.mcpServer.initialize();
        }
        this.updateComponentStatus("mcp", "healthy", "MCP server initialized");
      } catch (error) {
        this.logger.warn("MCP server not available, using mock:", (0, import_error_handler.getErrorMessage)(error));
        const { MockMcpServer } = await import("./mock-components.js");
        this.mcpServer = new MockMcpServer(this.eventBus, this.logger);
        await this.mcpServer.initialize();
        this.updateComponentStatus("mcp", "warning", "Using mock MCP server");
      }
      this.logger.info("\u2705 Monitoring and MCP Ready");
    } catch (error) {
      this.logger.error("Monitoring and MCP initialization failed:", (0, import_error_handler.getErrorMessage)(error));
      throw error;
    }
  }
  /**
   * Wire all components together for proper communication
   */
  async wireComponents() {
    this.logger.info("\u{1F517} Phase 6: Wiring Components");
    if (this.orchestrator && this.agentManager) {
      this.orchestrator.setAgentManager(this.agentManager);
      this.agentManager.setOrchestrator(this.orchestrator);
    }
    if (this.swarmCoordinator && this.agentManager && this.taskEngine) {
      this.swarmCoordinator.setAgentManager(this.agentManager);
      this.swarmCoordinator.setTaskEngine(this.taskEngine);
      this.taskEngine.setSwarmCoordinator(this.swarmCoordinator);
    }
    if (this.monitor) {
      this.monitor.attachToOrchestrator(this.orchestrator);
      this.monitor.attachToAgentManager(this.agentManager);
      this.monitor.attachToSwarmCoordinator(this.swarmCoordinator);
      this.monitor.attachToTaskEngine(this.taskEngine);
    }
    if (this.mcpServer) {
      this.mcpServer.attachToOrchestrator(this.orchestrator);
      this.mcpServer.attachToAgentManager(this.agentManager);
      this.mcpServer.attachToSwarmCoordinator(this.swarmCoordinator);
      this.mcpServer.attachToTaskEngine(this.taskEngine);
      this.mcpServer.attachToMemoryManager(this.memoryManager);
    }
    this.logger.info("\u2705 Component Wiring Complete");
  }
  /**
   * Setup event handlers for cross-component communication
   */
  setupEventHandlers() {
    this.eventBus.on("component:status", (event) => {
      this.updateComponentStatus(event.component, event.status, event.message);
    });
    this.eventBus.on("system:error", (event) => {
      this.logger.error(`System Error in ${event.component}:`, event.error);
      this.updateComponentStatus(event.component, "unhealthy", event.error.message);
    });
    this.eventBus.on("performance:metric", (event) => {
      this.logger.debug(`Performance Metric: ${event.metric} = ${event.value}`);
    });
  }
  /**
   * Update component status
   */
  updateComponentStatus(component, status, message) {
    const statusInfo = {
      component,
      status,
      message: message || "",
      timestamp: Date.now(),
      lastHealthCheck: Date.now()
    };
    this.componentStatuses.set(component, statusInfo);
    this.eventBus.emit("component:status:updated", statusInfo);
  }
  /**
   * Get system health status
   */
  async getSystemHealth() {
    const components = Array.from(this.componentStatuses.values());
    const healthyComponents = components.filter((c) => c.status === "healthy").length;
    const unhealthyComponents = components.filter((c) => c.status === "unhealthy").length;
    const warningComponents = components.filter((c) => c.status === "warning").length;
    let overallStatus = "healthy";
    if (unhealthyComponents > 0) {
      overallStatus = "unhealthy";
    } else if (warningComponents > 0) {
      overallStatus = "warning";
    }
    return {
      overall: overallStatus,
      components: Object.fromEntries(this.componentStatuses),
      metrics: {
        totalComponents: components.length,
        healthyComponents,
        unhealthyComponents,
        warningComponents,
        uptime: Date.now() - (this.initialized ? Date.now() : 0)
      },
      timestamp: Date.now()
    };
  }
  /**
   * Get specific component
   */
  getComponent(name) {
    switch (name) {
      case "orchestrator":
        return this.orchestrator;
      case "configManager":
        return this.configManager;
      case "memoryManager":
        return this.memoryManager;
      case "agentManager":
        return this.agentManager;
      case "swarmCoordinator":
        return this.swarmCoordinator;
      case "taskEngine":
        return this.taskEngine;
      case "monitor":
        return this.monitor;
      case "mcpServer":
        return this.mcpServer;
      case "eventBus":
        return this.eventBus;
      case "logger":
        return this.logger;
      default:
        return null;
    }
  }
  /**
   * Shutdown all components gracefully
   */
  async shutdown() {
    this.logger.info("\u{1F6D1} Shutting down Claude Flow v2.0.0");
    if (this.mcpServer) {
      await this.mcpServer.shutdown();
    }
    if (this.monitor) {
      await this.monitor.shutdown();
    }
    if (this.taskEngine) {
      await this.taskEngine.shutdown();
    }
    if (this.swarmCoordinator) {
      await this.swarmCoordinator.shutdown();
    }
    if (this.agentManager) {
      await this.agentManager.shutdown();
    }
    if (this.memoryManager) {
      await this.memoryManager.shutdown();
    }
    if (this.orchestrator) {
      await this.orchestrator.shutdown();
    }
    this.initialized = false;
    this.logger.info("\u2705 Claude Flow v2.0.0 Shutdown Complete");
  }
  /**
   * Check if system is ready
   */
  isReady() {
    return this.initialized;
  }
  /**
   * Get initialization status
   */
  getInitializationStatus() {
    return {
      initialized: this.initialized,
      components: Array.from(this.componentStatuses.keys()),
      health: this.initialized ? null : null
      // Will be populated after initialization
    };
  }
}
const systemIntegration = SystemIntegration.getInstance();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SystemIntegration,
  systemIntegration
});
//# sourceMappingURL=system-integration.js.map
