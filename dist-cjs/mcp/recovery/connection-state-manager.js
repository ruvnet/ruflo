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
var connection_state_manager_exports = {};
__export(connection_state_manager_exports, {
  ConnectionStateManager: () => ConnectionStateManager
});
module.exports = __toCommonJS(connection_state_manager_exports);
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
class ConnectionStateManager {
  constructor(logger, config) {
    this.logger = logger;
    this.config = { ...this.defaultConfig, ...config };
    this.statePath = (0, import_node_path.join)(this.config.stateDirectory, "connection-state.json");
    this.metricsPath = (0, import_node_path.join)(this.config.stateDirectory, "connection-metrics.json");
    this.initialize().catch((error) => {
      this.logger.error("Failed to initialize state manager", error);
    });
  }
  static {
    __name(this, "ConnectionStateManager");
  }
  currentState;
  connectionHistory = [];
  metrics = {
    totalConnections: 0,
    totalDisconnections: 0,
    totalReconnections: 0,
    averageSessionDuration: 0,
    averageReconnectionTime: 0,
    connectionHistory: []
  };
  persistenceTimer;
  statePath;
  metricsPath;
  defaultConfig = {
    enablePersistence: true,
    stateDirectory: ".mcp-state",
    maxHistorySize: 1e3,
    persistenceInterval: 6e4
    // 1 minute
  };
  config;
  /**
   * Initialize the state manager
   */
  async initialize() {
    if (!this.config.enablePersistence) {
      return;
    }
    try {
      await import_node_fs.promises.mkdir(this.config.stateDirectory, { recursive: true });
      await this.loadState();
      await this.loadMetrics();
      this.startPersistenceTimer();
      this.logger.info("Connection state manager initialized", {
        stateDirectory: this.config.stateDirectory
      });
    } catch (error) {
      this.logger.error("Failed to initialize state manager", error);
    }
  }
  /**
   * Save current connection state
   */
  saveState(state) {
    this.currentState = {
      ...state,
      metadata: {
        ...state.metadata,
        lastSaved: (/* @__PURE__ */ new Date()).toISOString()
      }
    };
    this.logger.debug("Connection state saved", {
      sessionId: state.sessionId,
      pendingRequests: state.pendingRequests.length
    });
    if (state.pendingRequests.length > 0) {
      this.persistState().catch((error) => {
        this.logger.error("Failed to persist critical state", error);
      });
    }
  }
  /**
   * Restore previous connection state
   */
  restoreState() {
    if (!this.currentState) {
      this.logger.debug("No state to restore");
      return null;
    }
    this.logger.info("Restoring connection state", {
      sessionId: this.currentState.sessionId,
      pendingRequests: this.currentState.pendingRequests.length
    });
    return { ...this.currentState };
  }
  /**
   * Record a connection event
   */
  recordEvent(event) {
    const fullEvent = {
      ...event,
      timestamp: /* @__PURE__ */ new Date()
    };
    this.connectionHistory.push(fullEvent);
    if (this.connectionHistory.length > this.config.maxHistorySize) {
      this.connectionHistory = this.connectionHistory.slice(-this.config.maxHistorySize);
    }
    this.updateMetrics(fullEvent);
    this.logger.debug("Connection event recorded", {
      type: event.type,
      sessionId: event.sessionId
    });
  }
  /**
   * Get connection metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      connectionHistory: [...this.connectionHistory]
    };
  }
  /**
   * Clear a specific session state
   */
  clearSession(sessionId) {
    if (this.currentState?.sessionId === sessionId) {
      this.currentState = void 0;
      this.logger.info("Session state cleared", { sessionId });
      this.persistState().catch((error) => {
        this.logger.error("Failed to persist cleared state", error);
      });
    }
  }
  /**
   * Add a pending request
   */
  addPendingRequest(request) {
    if (!this.currentState) {
      this.logger.warn("No active state to add pending request");
      return;
    }
    this.currentState.pendingRequests.push(request);
    this.logger.debug("Pending request added", {
      requestId: request.id,
      method: request.method,
      total: this.currentState.pendingRequests.length
    });
  }
  /**
   * Remove a pending request
   */
  removePendingRequest(requestId) {
    if (!this.currentState) {
      return;
    }
    this.currentState.pendingRequests = this.currentState.pendingRequests.filter(
      (req) => req.id !== requestId
    );
  }
  /**
   * Get pending requests
   */
  getPendingRequests() {
    return this.currentState?.pendingRequests || [];
  }
  /**
   * Update session metadata
   */
  updateMetadata(metadata) {
    if (!this.currentState) {
      return;
    }
    this.currentState.metadata = {
      ...this.currentState.metadata,
      ...metadata
    };
  }
  /**
   * Calculate session duration
   */
  getSessionDuration(sessionId) {
    const connectEvent = this.connectionHistory.find(
      (e) => e.sessionId === sessionId && e.type === "connect"
    );
    const disconnectEvent = this.connectionHistory.find(
      (e) => e.sessionId === sessionId && e.type === "disconnect"
    );
    if (!connectEvent) {
      return null;
    }
    const endTime = disconnectEvent ? disconnectEvent.timestamp : /* @__PURE__ */ new Date();
    return endTime.getTime() - connectEvent.timestamp.getTime();
  }
  /**
   * Get reconnection time for a session
   */
  getReconnectionTime(sessionId) {
    const disconnectEvent = this.connectionHistory.find(
      (e) => e.sessionId === sessionId && e.type === "disconnect"
    );
    const reconnectEvent = this.connectionHistory.find(
      (e) => e.sessionId === sessionId && e.type === "reconnect" && e.timestamp > (disconnectEvent?.timestamp || /* @__PURE__ */ new Date(0))
    );
    if (!disconnectEvent || !reconnectEvent) {
      return null;
    }
    return reconnectEvent.timestamp.getTime() - disconnectEvent.timestamp.getTime();
  }
  updateMetrics(event) {
    switch (event.type) {
      case "connect":
        this.metrics.totalConnections++;
        break;
      case "disconnect":
        this.metrics.totalDisconnections++;
        const duration = this.getSessionDuration(event.sessionId);
        if (duration !== null) {
          this.metrics.lastConnectionDuration = duration;
          const totalDuration = this.metrics.averageSessionDuration * (this.metrics.totalDisconnections - 1) + duration;
          this.metrics.averageSessionDuration = totalDuration / this.metrics.totalDisconnections;
        }
        break;
      case "reconnect":
        this.metrics.totalReconnections++;
        const reconnectTime = this.getReconnectionTime(event.sessionId);
        if (reconnectTime !== null) {
          const totalTime = this.metrics.averageReconnectionTime * (this.metrics.totalReconnections - 1) + reconnectTime;
          this.metrics.averageReconnectionTime = totalTime / this.metrics.totalReconnections;
        }
        break;
    }
  }
  async loadState() {
    try {
      const data = await import_node_fs.promises.readFile(this.statePath, "utf-8");
      const state = JSON.parse(data);
      state.lastConnected = new Date(state.lastConnected);
      if (state.lastDisconnected) {
        state.lastDisconnected = new Date(state.lastDisconnected);
      }
      this.currentState = state;
      this.logger.info("Connection state loaded", {
        sessionId: state.sessionId,
        pendingRequests: state.pendingRequests.length
      });
    } catch (error) {
      if (error.code !== "ENOENT") {
        this.logger.error("Failed to load connection state", error);
      }
    }
  }
  async loadMetrics() {
    try {
      const data = await import_node_fs.promises.readFile(this.metricsPath, "utf-8");
      const loaded = JSON.parse(data);
      loaded.connectionHistory = loaded.connectionHistory.map((event) => ({
        ...event,
        timestamp: new Date(event.timestamp)
      }));
      this.metrics = loaded;
      this.connectionHistory = loaded.connectionHistory;
      this.logger.info("Connection metrics loaded", {
        totalConnections: this.metrics.totalConnections,
        historySize: this.connectionHistory.length
      });
    } catch (error) {
      if (error.code !== "ENOENT") {
        this.logger.error("Failed to load connection metrics", error);
      }
    }
  }
  async persistState() {
    if (!this.config.enablePersistence) {
      return;
    }
    try {
      if (this.currentState) {
        await import_node_fs.promises.writeFile(this.statePath, JSON.stringify(this.currentState, null, 2), "utf-8");
      }
      await import_node_fs.promises.writeFile(
        this.metricsPath,
        JSON.stringify(
          {
            ...this.metrics,
            connectionHistory: this.connectionHistory
          },
          null,
          2
        ),
        "utf-8"
      );
      this.logger.debug("State and metrics persisted");
    } catch (error) {
      this.logger.error("Failed to persist state", error);
    }
  }
  startPersistenceTimer() {
    if (this.persistenceTimer) {
      return;
    }
    this.persistenceTimer = setInterval(() => {
      this.persistState().catch((error) => {
        this.logger.error("Periodic persistence failed", error);
      });
    }, this.config.persistenceInterval);
  }
  /**
   * Cleanup resources
   */
  async cleanup() {
    if (this.persistenceTimer) {
      clearInterval(this.persistenceTimer);
      this.persistenceTimer = void 0;
    }
    await this.persistState();
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ConnectionStateManager
});
//# sourceMappingURL=connection-state-manager.js.map
