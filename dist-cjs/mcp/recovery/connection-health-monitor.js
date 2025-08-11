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
var connection_health_monitor_exports = {};
__export(connection_health_monitor_exports, {
  ConnectionHealthMonitor: () => ConnectionHealthMonitor
});
module.exports = __toCommonJS(connection_health_monitor_exports);
var import_node_events = require("node:events");
class ConnectionHealthMonitor extends import_node_events.EventEmitter {
  constructor(client, logger, config) {
    super();
    this.client = client;
    this.logger = logger;
    this.config = { ...this.defaultConfig, ...config };
    this.healthStatus = {
      healthy: false,
      lastHeartbeat: /* @__PURE__ */ new Date(),
      missedHeartbeats: 0,
      latency: 0,
      connectionState: "disconnected"
    };
  }
  static {
    __name(this, "ConnectionHealthMonitor");
  }
  heartbeatTimer;
  timeoutTimer;
  lastHeartbeat = /* @__PURE__ */ new Date();
  missedHeartbeats = 0;
  currentLatency = 0;
  isMonitoring = false;
  healthStatus;
  defaultConfig = {
    heartbeatInterval: 5e3,
    heartbeatTimeout: 1e4,
    maxMissedHeartbeats: 3,
    enableAutoRecovery: true
  };
  config;
  /**
   * Start health monitoring
   */
  async start() {
    if (this.isMonitoring) {
      this.logger.warn("Health monitor already running");
      return;
    }
    this.logger.info("Starting connection health monitor", {
      config: this.config
    });
    this.isMonitoring = true;
    this.missedHeartbeats = 0;
    this.lastHeartbeat = /* @__PURE__ */ new Date();
    this.scheduleHeartbeat();
    this.updateHealthStatus("connected");
    this.emit("started");
  }
  /**
   * Stop health monitoring
   */
  async stop() {
    if (!this.isMonitoring) {
      return;
    }
    this.logger.info("Stopping connection health monitor");
    this.isMonitoring = false;
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = void 0;
    }
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = void 0;
    }
    this.updateHealthStatus("disconnected");
    this.emit("stopped");
  }
  /**
   * Get current health status
   */
  getHealthStatus() {
    return { ...this.healthStatus };
  }
  /**
   * Check connection health immediately
   */
  async checkHealth() {
    try {
      const startTime = Date.now();
      await this.sendHeartbeat();
      this.currentLatency = Date.now() - startTime;
      this.lastHeartbeat = /* @__PURE__ */ new Date();
      this.missedHeartbeats = 0;
      this.updateHealthStatus("connected", true);
      return this.getHealthStatus();
    } catch (error) {
      this.logger.error("Health check failed", error);
      this.handleHeartbeatFailure(error);
      return this.getHealthStatus();
    }
  }
  /**
   * Force a health check
   */
  async forceCheck() {
    this.logger.debug("Forcing health check");
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
    }
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
    }
    await this.performHeartbeat();
  }
  scheduleHeartbeat() {
    if (!this.isMonitoring) {
      return;
    }
    this.heartbeatTimer = setTimeout(() => {
      this.performHeartbeat().catch((error) => {
        this.logger.error("Heartbeat error", error);
      });
    }, this.config.heartbeatInterval);
  }
  async performHeartbeat() {
    if (!this.isMonitoring) {
      return;
    }
    this.logger.debug("Performing heartbeat");
    try {
      this.setHeartbeatTimeout();
      const startTime = Date.now();
      await this.sendHeartbeat();
      this.clearHeartbeatTimeout();
      this.currentLatency = Date.now() - startTime;
      this.lastHeartbeat = /* @__PURE__ */ new Date();
      this.missedHeartbeats = 0;
      this.logger.debug("Heartbeat successful", {
        latency: this.currentLatency
      });
      this.updateHealthStatus("connected", true);
      this.scheduleHeartbeat();
    } catch (error) {
      this.handleHeartbeatFailure(error);
    }
  }
  async sendHeartbeat() {
    await this.client.notify("heartbeat", {
      timestamp: Date.now(),
      sessionId: this.generateSessionId()
    });
  }
  setHeartbeatTimeout() {
    this.timeoutTimer = setTimeout(() => {
      this.handleHeartbeatTimeout();
    }, this.config.heartbeatTimeout);
  }
  clearHeartbeatTimeout() {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = void 0;
    }
  }
  handleHeartbeatTimeout() {
    this.logger.warn("Heartbeat timeout");
    this.handleHeartbeatFailure(new Error("Heartbeat timeout"));
  }
  handleHeartbeatFailure(error) {
    this.clearHeartbeatTimeout();
    this.missedHeartbeats++;
    this.logger.warn("Heartbeat failed", {
      missedHeartbeats: this.missedHeartbeats,
      maxMissed: this.config.maxMissedHeartbeats,
      error: error instanceof Error ? error.message : String(error)
    });
    if (this.missedHeartbeats >= this.config.maxMissedHeartbeats) {
      this.logger.error("Max missed heartbeats exceeded, connection unhealthy");
      this.updateHealthStatus(
        "disconnected",
        false,
        error instanceof Error ? error.message : String(error)
      );
      if (this.config.enableAutoRecovery) {
        this.emit("connectionLost", { error });
      }
    } else {
      const backoffDelay = this.config.heartbeatInterval * (this.missedHeartbeats + 1);
      this.logger.debug("Scheduling heartbeat with backoff", { delay: backoffDelay });
      this.heartbeatTimer = setTimeout(() => {
        this.performHeartbeat().catch((err) => {
          this.logger.error("Backoff heartbeat error", err);
        });
      }, backoffDelay);
    }
  }
  updateHealthStatus(connectionState, healthy, error) {
    const previousStatus = { ...this.healthStatus };
    this.healthStatus = {
      healthy: healthy ?? connectionState === "connected",
      lastHeartbeat: this.lastHeartbeat,
      missedHeartbeats: this.missedHeartbeats,
      latency: this.currentLatency,
      connectionState,
      error
    };
    if (previousStatus.healthy !== this.healthStatus.healthy || previousStatus.connectionState !== this.healthStatus.connectionState) {
      this.logger.info("Health status changed", {
        from: previousStatus.connectionState,
        to: this.healthStatus.connectionState,
        healthy: this.healthStatus.healthy
      });
      this.emit("healthChange", this.healthStatus, previousStatus);
    }
  }
  generateSessionId() {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  /**
   * Reset monitor state
   */
  reset() {
    this.missedHeartbeats = 0;
    this.currentLatency = 0;
    this.lastHeartbeat = /* @__PURE__ */ new Date();
    if (this.isMonitoring) {
      this.logger.debug("Resetting health monitor");
      this.clearHeartbeatTimeout();
      this.scheduleHeartbeat();
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ConnectionHealthMonitor
});
//# sourceMappingURL=connection-health-monitor.js.map
