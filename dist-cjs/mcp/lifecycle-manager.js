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
var lifecycle_manager_exports = {};
__export(lifecycle_manager_exports, {
  LifecycleState: () => LifecycleState,
  MCPLifecycleManager: () => MCPLifecycleManager
});
module.exports = __toCommonJS(lifecycle_manager_exports);
var import_node_events = require("node:events");
var import_errors = require("../utils/errors.js");
var LifecycleState = /* @__PURE__ */ ((LifecycleState2) => {
  LifecycleState2["STOPPED"] = "stopped";
  LifecycleState2["STARTING"] = "starting";
  LifecycleState2["RUNNING"] = "running";
  LifecycleState2["STOPPING"] = "stopping";
  LifecycleState2["RESTARTING"] = "restarting";
  LifecycleState2["ERROR"] = "error";
  return LifecycleState2;
})(LifecycleState || {});
class MCPLifecycleManager extends import_node_events.EventEmitter {
  constructor(mcpConfig, logger, serverFactory, config) {
    super();
    this.mcpConfig = mcpConfig;
    this.logger = logger;
    this.serverFactory = serverFactory;
    if (config) {
      Object.assign(this.config, config);
    }
    this.setupEventHandlers();
  }
  static {
    __name(this, "MCPLifecycleManager");
  }
  state = "stopped" /* STOPPED */;
  server;
  healthCheckTimer;
  startTime;
  lastRestart;
  restartAttempts = 0;
  shutdownPromise;
  history = [];
  config = {
    healthCheckInterval: 3e4,
    // 30 seconds
    gracefulShutdownTimeout: 1e4,
    // 10 seconds
    maxRestartAttempts: 3,
    restartDelay: 5e3,
    // 5 seconds
    enableAutoRestart: true,
    enableHealthChecks: true
  };
  /**
   * Start the MCP server
   */
  async start() {
    if (this.state !== "stopped" /* STOPPED */) {
      throw new import_errors.MCPError(`Cannot start server in state: ${this.state}`);
    }
    this.setState("starting" /* STARTING */);
    this.logger.info("Starting MCP server lifecycle manager");
    try {
      this.server = this.serverFactory();
      await this.server.start();
      this.startTime = /* @__PURE__ */ new Date();
      this.restartAttempts = 0;
      if (this.config.enableHealthChecks) {
        this.startHealthChecks();
      }
      this.setState("running" /* RUNNING */);
      this.logger.info("MCP server started successfully");
    } catch (error) {
      this.setState("error" /* ERROR */, error);
      this.logger.error("Failed to start MCP server", error);
      throw error;
    }
  }
  /**
   * Stop the MCP server gracefully
   */
  async stop() {
    if (this.state === "stopped" /* STOPPED */) {
      return;
    }
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }
    this.setState("stopping" /* STOPPING */);
    this.logger.info("Stopping MCP server");
    this.shutdownPromise = this.performShutdown();
    await this.shutdownPromise;
    this.shutdownPromise = void 0;
  }
  /**
   * Restart the MCP server
   */
  async restart() {
    if (this.state === "stopped" /* STOPPED */) {
      return this.start();
    }
    this.setState("restarting" /* RESTARTING */);
    this.logger.info("Restarting MCP server");
    try {
      await this.stop();
      if (this.config.restartDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.config.restartDelay));
      }
      await this.start();
      this.lastRestart = /* @__PURE__ */ new Date();
      this.restartAttempts++;
      this.logger.info("MCP server restarted successfully");
    } catch (error) {
      this.setState("error" /* ERROR */, error);
      this.logger.error("Failed to restart MCP server", error);
      throw error;
    }
  }
  /**
   * Perform comprehensive health check
   */
  async healthCheck() {
    const startTime = Date.now();
    const result = {
      healthy: false,
      state: this.state,
      uptime: this.getUptime(),
      lastRestart: this.lastRestart,
      components: {
        server: false,
        transport: false,
        sessions: false,
        tools: false,
        auth: false,
        loadBalancer: false
      }
    };
    try {
      if (!this.server || this.state !== "running" /* RUNNING */) {
        result.error = "Server not running";
        return result;
      }
      const serverHealth = await this.server.getHealthStatus();
      result.components.server = serverHealth.healthy;
      result.metrics = serverHealth.metrics;
      if (serverHealth.error) {
        result.error = serverHealth.error;
      }
      result.components.transport = serverHealth.metrics?.transportConnections !== void 0;
      result.components.sessions = serverHealth.metrics?.activeSessions !== void 0;
      result.components.tools = (serverHealth.metrics?.registeredTools || 0) > 0;
      result.components.auth = serverHealth.metrics?.authenticatedSessions !== void 0;
      result.components.loadBalancer = serverHealth.metrics?.rateLimitedRequests !== void 0;
      result.healthy = result.components.server && result.components.transport && result.components.sessions && result.components.tools;
      const checkDuration = Date.now() - startTime;
      if (result.metrics) {
        result.metrics.healthCheckDuration = checkDuration;
      }
      this.logger.debug("Health check completed", {
        healthy: result.healthy,
        duration: checkDuration,
        components: result.components
      });
      return result;
    } catch (error) {
      result.error = error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Health check failed", error);
      return result;
    }
  }
  /**
   * Get current server state
   */
  getState() {
    return this.state;
  }
  /**
   * Get server metrics
   */
  getMetrics() {
    return this.server?.getMetrics();
  }
  /**
   * Get active sessions
   */
  getSessions() {
    return this.server?.getSessions() || [];
  }
  /**
   * Get server uptime in milliseconds
   */
  getUptime() {
    return this.startTime ? Date.now() - this.startTime.getTime() : 0;
  }
  /**
   * Get lifecycle event history
   */
  getHistory() {
    return [...this.history];
  }
  /**
   * Force terminate server (emergency stop)
   */
  async forceStop() {
    this.logger.warn("Force stopping MCP server");
    this.stopHealthChecks();
    if (this.server) {
      try {
        await this.server.stop();
      } catch (error) {
        this.logger.error("Error during force stop", error);
      }
      this.server = void 0;
    }
    this.setState("stopped" /* STOPPED */);
    this.startTime = void 0;
  }
  /**
   * Enable or disable auto-restart
   */
  setAutoRestart(enabled) {
    this.config.enableAutoRestart = enabled;
    this.logger.info("Auto-restart", { enabled });
  }
  /**
   * Enable or disable health checks
   */
  setHealthChecks(enabled) {
    this.config.enableHealthChecks = enabled;
    if (enabled && this.state === "running" /* RUNNING */) {
      this.startHealthChecks();
    } else {
      this.stopHealthChecks();
    }
    this.logger.info("Health checks", { enabled });
  }
  setState(newState, error) {
    const previousState = this.state;
    this.state = newState;
    const event = {
      timestamp: /* @__PURE__ */ new Date(),
      state: newState,
      previousState,
      error
    };
    this.history.push(event);
    if (this.history.length > 100) {
      this.history.shift();
    }
    this.emit("stateChange", event);
    this.logger.info("State change", {
      from: previousState,
      to: newState,
      error: error?.message
    });
  }
  setupEventHandlers() {
    process.on("uncaughtException", (error) => {
      this.logger.error("Uncaught exception", error);
      this.handleServerError(error);
    });
    process.on("unhandledRejection", (reason) => {
      this.logger.error("Unhandled rejection", reason);
      this.handleServerError(reason instanceof Error ? reason : new Error(String(reason)));
    });
    process.on("SIGINT", () => {
      this.logger.info("Received SIGINT, shutting down gracefully");
      this.stop().catch((error) => {
        this.logger.error("Error during graceful shutdown", error);
        process.exit(1);
      });
    });
    process.on("SIGTERM", () => {
      this.logger.info("Received SIGTERM, shutting down gracefully");
      this.stop().catch((error) => {
        this.logger.error("Error during graceful shutdown", error);
        process.exit(1);
      });
    });
  }
  async handleServerError(error) {
    this.logger.error("Server error detected", error);
    this.setState("error" /* ERROR */, error);
    if (this.config.enableAutoRestart && this.restartAttempts < this.config.maxRestartAttempts) {
      this.logger.info("Attempting auto-restart", {
        attempt: this.restartAttempts + 1,
        maxAttempts: this.config.maxRestartAttempts
      });
      try {
        await this.restart();
      } catch (restartError) {
        this.logger.error("Auto-restart failed", restartError);
      }
    } else {
      this.logger.error("Max restart attempts reached or auto-restart disabled");
      await this.forceStop();
    }
  }
  startHealthChecks() {
    if (this.healthCheckTimer) {
      return;
    }
    this.healthCheckTimer = setInterval(async () => {
      try {
        const health = await this.healthCheck();
        if (!health.healthy && this.state === "running" /* RUNNING */) {
          this.logger.warn("Health check failed", health);
          this.handleServerError(new Error(health.error || "Health check failed"));
        }
      } catch (error) {
        this.logger.error("Health check error", error);
      }
    }, this.config.healthCheckInterval);
    this.logger.debug("Health checks started", { interval: this.config.healthCheckInterval });
  }
  stopHealthChecks() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = void 0;
      this.logger.debug("Health checks stopped");
    }
  }
  async performShutdown() {
    try {
      this.stopHealthChecks();
      const shutdownPromise = this.server?.stop() || Promise.resolve();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("Shutdown timeout")),
          this.config.gracefulShutdownTimeout
        );
      });
      await Promise.race([shutdownPromise, timeoutPromise]);
      this.server = void 0;
      this.setState("stopped" /* STOPPED */);
      this.startTime = void 0;
      this.logger.info("MCP server stopped successfully");
    } catch (error) {
      this.logger.error("Error during shutdown", error);
      await this.forceStop();
      throw error;
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LifecycleState,
  MCPLifecycleManager
});
//# sourceMappingURL=lifecycle-manager.js.map
