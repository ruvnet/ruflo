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
var orchestration_integration_exports = {};
__export(orchestration_integration_exports, {
  MCPOrchestrationIntegration: () => MCPOrchestrationIntegration
});
module.exports = __toCommonJS(orchestration_integration_exports);
var import_node_events = require("node:events");
var import_types = require("../utils/types.js");
var import_errors = require("../utils/errors.js");
var import_server = require("./server.js");
var import_lifecycle_manager = require("./lifecycle-manager.js");
var import_performance_monitor = require("./performance-monitor.js");
var import_protocol_manager = require("./protocol-manager.js");
class MCPOrchestrationIntegration extends import_node_events.EventEmitter {
  constructor(mcpConfig, orchestrationConfig, components, logger) {
    super();
    this.mcpConfig = mcpConfig;
    this.orchestrationConfig = orchestrationConfig;
    this.components = components;
    this.logger = logger;
    this.orchestrationConfig = { ...this.defaultConfig, ...orchestrationConfig };
    this.initializeIntegration();
  }
  static {
    __name(this, "MCPOrchestrationIntegration");
  }
  server;
  lifecycleManager;
  performanceMonitor;
  protocolManager;
  integrationStatus = /* @__PURE__ */ new Map();
  healthCheckTimer;
  reconnectTimers = /* @__PURE__ */ new Map();
  defaultConfig = {
    enabledIntegrations: {
      orchestrator: true,
      swarm: true,
      agents: true,
      resources: true,
      memory: true,
      monitoring: true,
      terminals: true
    },
    autoStart: true,
    healthCheckInterval: 3e4,
    // 30 seconds
    reconnectAttempts: 3,
    reconnectDelay: 5e3,
    // 5 seconds
    enableMetrics: true,
    enableAlerts: true
  };
  /**
   * Start the MCP orchestration integration
   */
  async start() {
    this.logger.info("Starting MCP orchestration integration");
    try {
      this.protocolManager = new import_protocol_manager.MCPProtocolManager(this.logger);
      if (this.orchestrationConfig.enableMetrics) {
        this.performanceMonitor = new import_performance_monitor.MCPPerformanceMonitor(this.logger);
        this.setupPerformanceMonitoring();
      }
      this.server = new import_server.MCPServer(
        this.mcpConfig,
        this.components.eventBus || new import_node_events.EventEmitter(),
        this.logger,
        this.components.orchestrator,
        this.components.swarmCoordinator,
        this.components.agentManager,
        this.components.resourceManager,
        this.components.messageBus,
        this.components.monitor
      );
      this.lifecycleManager = new import_lifecycle_manager.MCPLifecycleManager(
        this.mcpConfig,
        this.logger,
        () => this.server
      );
      this.setupLifecycleHandlers();
      this.registerOrchestrationTools();
      if (this.orchestrationConfig.autoStart) {
        await this.lifecycleManager.start();
      }
      this.startHealthMonitoring();
      await this.setupComponentIntegrations();
      this.logger.info("MCP orchestration integration started successfully");
      this.emit("integrationStarted");
    } catch (error) {
      this.logger.error("Failed to start MCP orchestration integration", error);
      throw error;
    }
  }
  /**
   * Stop the MCP orchestration integration
   */
  async stop() {
    this.logger.info("Stopping MCP orchestration integration");
    try {
      this.stopHealthMonitoring();
      if (this.lifecycleManager) {
        await this.lifecycleManager.stop();
      }
      if (this.performanceMonitor) {
        this.performanceMonitor.stop();
      }
      for (const timer of this.reconnectTimers.values()) {
        clearTimeout(timer);
      }
      this.reconnectTimers.clear();
      this.logger.info("MCP orchestration integration stopped");
      this.emit("integrationStopped");
    } catch (error) {
      this.logger.error("Error stopping MCP orchestration integration", error);
      throw error;
    }
  }
  /**
   * Get integration status for all components
   */
  getIntegrationStatus() {
    return Array.from(this.integrationStatus.values());
  }
  /**
   * Get status for a specific component
   */
  getComponentStatus(component) {
    return this.integrationStatus.get(component);
  }
  /**
   * Get MCP server instance
   */
  getServer() {
    return this.server;
  }
  /**
   * Get lifecycle manager
   */
  getLifecycleManager() {
    return this.lifecycleManager;
  }
  /**
   * Get performance monitor
   */
  getPerformanceMonitor() {
    return this.performanceMonitor;
  }
  /**
   * Get protocol manager
   */
  getProtocolManager() {
    return this.protocolManager;
  }
  /**
   * Force reconnection to a component
   */
  async reconnectComponent(component) {
    const status = this.integrationStatus.get(component);
    if (!status || !status.enabled) {
      throw new import_errors.MCPError(`Component ${component} is not enabled`);
    }
    this.logger.info("Reconnecting to component", { component });
    try {
      await this.connectComponent(component);
      this.logger.info("Successfully reconnected to component", { component });
    } catch (error) {
      this.logger.error("Failed to reconnect to component", { component, error });
      throw error;
    }
  }
  /**
   * Enable/disable component integration
   */
  async setComponentEnabled(component, enabled) {
    const status = this.integrationStatus.get(component);
    if (!status) {
      throw new import_errors.MCPError(`Unknown component: ${component}`);
    }
    status.enabled = enabled;
    if (enabled) {
      await this.connectComponent(component);
    } else {
      await this.disconnectComponent(component);
    }
    this.logger.info("Component integration updated", { component, enabled });
    this.emit("componentToggled", { component, enabled });
  }
  initializeIntegration() {
    const components = [
      "orchestrator",
      "swarm",
      "agents",
      "resources",
      "memory",
      "monitoring",
      "terminals"
    ];
    for (const component of components) {
      this.integrationStatus.set(component, {
        component,
        enabled: this.orchestrationConfig.enabledIntegrations[component],
        connected: false,
        healthy: false,
        lastCheck: /* @__PURE__ */ new Date()
      });
    }
  }
  setupLifecycleHandlers() {
    if (!this.lifecycleManager)
      return;
    this.lifecycleManager.on("stateChange", (event) => {
      this.logger.info("MCP server state changed", {
        from: event.previousState,
        to: event.state,
        error: event.error?.message
      });
      if (this.components.eventBus) {
        this.components.eventBus.emit(import_types.SystemEvents.SYSTEM_HEALTHCHECK, {
          status: event.state === import_lifecycle_manager.LifecycleState.RUNNING ? "healthy" : "unhealthy",
          component: "mcp-server",
          timestamp: event.timestamp
        });
      }
      this.emit("lifecycleStateChanged", event);
    });
  }
  setupPerformanceMonitoring() {
    if (!this.performanceMonitor)
      return;
    this.performanceMonitor.on("metricsCollected", (metrics) => {
      if (this.components.monitor && typeof this.components.monitor.recordMetrics === "function") {
        this.components.monitor.recordMetrics("mcp", metrics);
      }
      this.emit("metricsCollected", metrics);
    });
    this.performanceMonitor.on("alertTriggered", (alert) => {
      this.logger.warn("MCP performance alert triggered", {
        alertId: alert.id,
        ruleName: alert.ruleName,
        severity: alert.severity,
        message: alert.message
      });
      if (this.orchestrationConfig.enableAlerts && this.components.monitor) {
        if (typeof this.components.monitor.sendAlert === "function") {
          this.components.monitor.sendAlert({
            source: "mcp",
            severity: alert.severity,
            message: alert.message,
            metadata: alert
          });
        }
      }
      this.emit("performanceAlert", alert);
    });
    this.performanceMonitor.on("optimizationSuggestion", (suggestion) => {
      this.logger.info("MCP optimization suggestion", {
        type: suggestion.type,
        priority: suggestion.priority,
        title: suggestion.title
      });
      this.emit("optimizationSuggestion", suggestion);
    });
  }
  registerOrchestrationTools() {
    if (!this.server)
      return;
    if (this.orchestrationConfig.enabledIntegrations.orchestrator && this.components.orchestrator) {
      this.registerOrchestratorTools();
    }
    if (this.orchestrationConfig.enabledIntegrations.swarm && this.components.swarmCoordinator) {
      this.registerSwarmTools();
    }
    if (this.orchestrationConfig.enabledIntegrations.agents && this.components.agentManager) {
      this.registerAgentTools();
    }
    if (this.orchestrationConfig.enabledIntegrations.resources && this.components.resourceManager) {
      this.registerResourceTools();
    }
    if (this.orchestrationConfig.enabledIntegrations.memory && this.components.memoryManager) {
      this.registerMemoryTools();
    }
    if (this.orchestrationConfig.enabledIntegrations.monitoring && this.components.monitor) {
      this.registerMonitoringTools();
    }
    if (this.orchestrationConfig.enabledIntegrations.terminals && this.components.terminalManager) {
      this.registerTerminalTools();
    }
  }
  registerOrchestratorTools() {
    const tools = [
      {
        name: "orchestrator/status",
        description: "Get orchestrator status and metrics",
        inputSchema: { type: "object", properties: {} },
        handler: async () => {
          if (typeof this.components.orchestrator?.getStatus === "function") {
            return await this.components.orchestrator.getStatus();
          }
          throw new import_errors.MCPError("Orchestrator status not available");
        }
      },
      {
        name: "orchestrator/tasks",
        description: "List all tasks in the orchestrator",
        inputSchema: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["pending", "running", "completed", "failed"] },
            limit: { type: "number", minimum: 1, maximum: 100 }
          }
        },
        handler: async (input) => {
          if (typeof this.components.orchestrator?.listTasks === "function") {
            return await this.components.orchestrator.listTasks(input);
          }
          throw new import_errors.MCPError("Orchestrator task listing not available");
        }
      }
    ];
    for (const tool of tools) {
      this.server.registerTool(tool);
    }
  }
  registerSwarmTools() {
    const tools = [
      {
        name: "swarm/status",
        description: "Get swarm coordinator status",
        inputSchema: { type: "object", properties: {} },
        handler: async () => {
          if (typeof this.components.swarmCoordinator?.getStatus === "function") {
            return await this.components.swarmCoordinator.getStatus();
          }
          throw new import_errors.MCPError("Swarm coordinator status not available");
        }
      },
      {
        name: "swarm/agents",
        description: "List active swarm agents",
        inputSchema: { type: "object", properties: {} },
        handler: async () => {
          if (typeof this.components.swarmCoordinator?.listAgents === "function") {
            return await this.components.swarmCoordinator.listAgents();
          }
          throw new import_errors.MCPError("Swarm agent listing not available");
        }
      }
    ];
    for (const tool of tools) {
      this.server.registerTool(tool);
    }
  }
  registerAgentTools() {
    const tools = [
      {
        name: "agents/list",
        description: "List all managed agents",
        inputSchema: { type: "object", properties: {} },
        handler: async () => {
          if (typeof this.components.agentManager?.listAgents === "function") {
            return await this.components.agentManager.listAgents();
          }
          throw new import_errors.MCPError("Agent listing not available");
        }
      },
      {
        name: "agents/spawn",
        description: "Spawn a new agent",
        inputSchema: {
          type: "object",
          properties: {
            profile: { type: "object" },
            config: { type: "object" }
          },
          required: ["profile"]
        },
        handler: async (input) => {
          if (typeof this.components.agentManager?.spawnAgent === "function") {
            return await this.components.agentManager.spawnAgent(input.profile, input.config);
          }
          throw new import_errors.MCPError("Agent spawning not available");
        }
      }
    ];
    for (const tool of tools) {
      this.server.registerTool(tool);
    }
  }
  registerResourceTools() {
    const tools = [
      {
        name: "resources/list",
        description: "List available resources",
        inputSchema: { type: "object", properties: {} },
        handler: async () => {
          if (typeof this.components.resourceManager?.listResources === "function") {
            return await this.components.resourceManager.listResources();
          }
          throw new import_errors.MCPError("Resource listing not available");
        }
      },
      {
        name: "resources/status",
        description: "Get resource manager status",
        inputSchema: { type: "object", properties: {} },
        handler: async () => {
          if (typeof this.components.resourceManager?.getStatus === "function") {
            return await this.components.resourceManager.getStatus();
          }
          throw new import_errors.MCPError("Resource manager status not available");
        }
      }
    ];
    for (const tool of tools) {
      this.server.registerTool(tool);
    }
  }
  registerMemoryTools() {
    const tools = [
      {
        name: "memory/query",
        description: "Query memory bank",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            namespace: { type: "string" },
            limit: { type: "number" }
          },
          required: ["query"]
        },
        handler: async (input) => {
          if (typeof this.components.memoryManager?.query === "function") {
            return await this.components.memoryManager.query(input);
          }
          throw new import_errors.MCPError("Memory query not available");
        }
      },
      {
        name: "memory/store",
        description: "Store data in memory bank",
        inputSchema: {
          type: "object",
          properties: {
            data: { type: "object" },
            namespace: { type: "string" },
            tags: { type: "array", items: { type: "string" } }
          },
          required: ["data"]
        },
        handler: async (input) => {
          if (typeof this.components.memoryManager?.store === "function") {
            return await this.components.memoryManager.store(input);
          }
          throw new import_errors.MCPError("Memory storage not available");
        }
      }
    ];
    for (const tool of tools) {
      this.server.registerTool(tool);
    }
  }
  registerMonitoringTools() {
    const tools = [
      {
        name: "monitoring/metrics",
        description: "Get system monitoring metrics",
        inputSchema: { type: "object", properties: {} },
        handler: async () => {
          if (typeof this.components.monitor?.getMetrics === "function") {
            return await this.components.monitor.getMetrics();
          }
          throw new import_errors.MCPError("Monitoring metrics not available");
        }
      },
      {
        name: "monitoring/alerts",
        description: "List active alerts",
        inputSchema: { type: "object", properties: {} },
        handler: async () => {
          if (typeof this.components.monitor?.getAlerts === "function") {
            return await this.components.monitor.getAlerts();
          }
          throw new import_errors.MCPError("Alert listing not available");
        }
      }
    ];
    for (const tool of tools) {
      this.server.registerTool(tool);
    }
  }
  registerTerminalTools() {
    const tools = [
      {
        name: "terminals/list",
        description: "List active terminal sessions",
        inputSchema: { type: "object", properties: {} },
        handler: async () => {
          if (typeof this.components.terminalManager?.listSessions === "function") {
            return await this.components.terminalManager.listSessions();
          }
          throw new import_errors.MCPError("Terminal session listing not available");
        }
      },
      {
        name: "terminals/execute",
        description: "Execute command in terminal",
        inputSchema: {
          type: "object",
          properties: {
            command: { type: "string" },
            sessionId: { type: "string" }
          },
          required: ["command"]
        },
        handler: async (input) => {
          if (typeof this.components.terminalManager?.execute === "function") {
            return await this.components.terminalManager.execute(input.command, input.sessionId);
          }
          throw new import_errors.MCPError("Terminal execution not available");
        }
      }
    ];
    for (const tool of tools) {
      this.server.registerTool(tool);
    }
  }
  async setupComponentIntegrations() {
    const promises = [];
    for (const [component, status] of this.integrationStatus.entries()) {
      if (status.enabled) {
        promises.push(this.connectComponent(component));
      }
    }
    await Promise.allSettled(promises);
  }
  async connectComponent(component) {
    const status = this.integrationStatus.get(component);
    if (!status)
      return;
    try {
      switch (component) {
        case "orchestrator":
          await this.connectOrchestrator();
          break;
        case "swarm":
          await this.connectSwarmCoordinator();
          break;
        case "agents":
          await this.connectAgentManager();
          break;
        case "resources":
          await this.connectResourceManager();
          break;
        case "memory":
          await this.connectMemoryManager();
          break;
        case "monitoring":
          await this.connectMonitor();
          break;
        case "terminals":
          await this.connectTerminalManager();
          break;
      }
      status.connected = true;
      status.healthy = true;
      status.lastCheck = /* @__PURE__ */ new Date();
      status.error = void 0;
      this.logger.info("Component connected", { component });
      this.emit("componentConnected", { component });
    } catch (error) {
      status.connected = false;
      status.healthy = false;
      status.error = error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Failed to connect component", { component, error });
      this.scheduleReconnect(component);
    }
  }
  async disconnectComponent(component) {
    const status = this.integrationStatus.get(component);
    if (!status)
      return;
    status.connected = false;
    status.healthy = false;
    status.lastCheck = /* @__PURE__ */ new Date();
    const timer = this.reconnectTimers.get(component);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(component);
    }
    this.logger.info("Component disconnected", { component });
    this.emit("componentDisconnected", { component });
  }
  scheduleReconnect(component) {
    const timer = this.reconnectTimers.get(component);
    if (timer)
      return;
    const reconnectTimer = setTimeout(async () => {
      this.reconnectTimers.delete(component);
      try {
        await this.connectComponent(component);
      } catch (error) {
      }
    }, this.orchestrationConfig.reconnectDelay);
    this.reconnectTimers.set(component, reconnectTimer);
  }
  startHealthMonitoring() {
    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthChecks();
    }, this.orchestrationConfig.healthCheckInterval);
  }
  stopHealthMonitoring() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = void 0;
    }
  }
  async performHealthChecks() {
    for (const [component, status] of this.integrationStatus.entries()) {
      if (!status.enabled || !status.connected)
        continue;
      try {
        const healthy = await this.checkComponentHealth(component);
        status.healthy = healthy;
        status.lastCheck = /* @__PURE__ */ new Date();
        status.error = void 0;
      } catch (error) {
        status.healthy = false;
        status.error = error instanceof Error ? error instanceof Error ? error.message : String(error) : "Health check failed";
        this.logger.warn("Component health check failed", { component, error });
      }
    }
  }
  async checkComponentHealth(component) {
    const componentInstance = this.getComponentInstance(component);
    if (!componentInstance)
      return false;
    if (typeof componentInstance.healthCheck === "function") {
      const result = await componentInstance.healthCheck();
      return result === true || typeof result === "object" && result.healthy === true;
    }
    return true;
  }
  getComponentInstance(component) {
    switch (component) {
      case "orchestrator":
        return this.components.orchestrator;
      case "swarm":
        return this.components.swarmCoordinator;
      case "agents":
        return this.components.agentManager;
      case "resources":
        return this.components.resourceManager;
      case "memory":
        return this.components.memoryManager;
      case "monitoring":
        return this.components.monitor;
      case "terminals":
        return this.components.terminalManager;
      default:
        return null;
    }
  }
  // Component-specific connection methods
  async connectOrchestrator() {
    if (!this.components.orchestrator) {
      throw new import_errors.MCPError("Orchestrator component not available");
    }
  }
  async connectSwarmCoordinator() {
    if (!this.components.swarmCoordinator) {
      throw new import_errors.MCPError("Swarm coordinator component not available");
    }
  }
  async connectAgentManager() {
    if (!this.components.agentManager) {
      throw new import_errors.MCPError("Agent manager component not available");
    }
  }
  async connectResourceManager() {
    if (!this.components.resourceManager) {
      throw new import_errors.MCPError("Resource manager component not available");
    }
  }
  async connectMemoryManager() {
    if (!this.components.memoryManager) {
      throw new import_errors.MCPError("Memory manager component not available");
    }
  }
  async connectMonitor() {
    if (!this.components.monitor) {
      throw new import_errors.MCPError("Monitor component not available");
    }
  }
  async connectTerminalManager() {
    if (!this.components.terminalManager) {
      throw new import_errors.MCPError("Terminal manager component not available");
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MCPOrchestrationIntegration
});
//# sourceMappingURL=orchestration-integration.js.map
