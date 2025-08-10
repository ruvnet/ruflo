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
var client_exports = {};
__export(client_exports, {
  MCPClient: () => MCPClient
});
module.exports = __toCommonJS(client_exports);
var import_node_events = require("node:events");
var import_logger = require("../core/logger.js");
var import_recovery = require("./recovery/index.js");
class MCPClient extends import_node_events.EventEmitter {
  static {
    __name(this, "MCPClient");
  }
  transport;
  timeout;
  connected = false;
  recoveryManager;
  pendingRequests = /* @__PURE__ */ new Map();
  constructor(config) {
    super();
    this.transport = config.transport;
    this.timeout = config.timeout || 3e4;
    if (config.enableRecovery) {
      this.recoveryManager = new import_recovery.RecoveryManager(
        this,
        config.mcpConfig || {},
        import_logger.logger,
        config.recoveryConfig
      );
      this.setupRecoveryHandlers();
    }
  }
  async connect() {
    try {
      await this.transport.connect();
      this.connected = true;
      import_logger.logger.info("MCP Client connected");
      if (this.recoveryManager) {
        await this.recoveryManager.start();
      }
      this.emit("connected");
    } catch (error) {
      import_logger.logger.error("Failed to connect MCP client", error);
      this.connected = false;
      if (this.recoveryManager) {
        await this.recoveryManager.forceRecovery();
      }
      throw error;
    }
  }
  async disconnect() {
    if (this.connected) {
      if (this.recoveryManager) {
        await this.recoveryManager.stop();
      }
      await this.transport.disconnect();
      this.connected = false;
      import_logger.logger.info("MCP Client disconnected");
      this.emit("disconnected");
    }
  }
  async request(method, params) {
    const request = {
      jsonrpc: "2.0",
      method,
      params,
      id: Math.random().toString(36).slice(2)
    };
    if (this.recoveryManager && !this.connected) {
      await this.recoveryManager.handleRequest(request);
    }
    if (!this.connected) {
      throw new Error("Client not connected");
    }
    const requestPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.timeout);
      this.pendingRequests.set(request.id, { resolve, reject, timer });
    });
    try {
      const response = await this.transport.sendRequest(request);
      const pending = this.pendingRequests.get(request.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(request.id);
      }
      if ("error" in response) {
        throw new Error(response.error);
      }
      return response.result;
    } catch (error) {
      const pending = this.pendingRequests.get(request.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(request.id);
      }
      throw error;
    }
  }
  async notify(method, params) {
    if (method === "heartbeat") {
      const notification2 = {
        jsonrpc: "2.0",
        method,
        params
      };
      if (this.transport.sendNotification) {
        await this.transport.sendNotification(notification2);
      }
      return;
    }
    if (!this.connected) {
      throw new Error("Client not connected");
    }
    const notification = {
      jsonrpc: "2.0",
      method,
      params
    };
    if (this.transport.sendNotification) {
      await this.transport.sendNotification(notification);
    } else {
      throw new Error("Transport does not support notifications");
    }
  }
  isConnected() {
    return this.connected;
  }
  /**
   * Get recovery status if recovery is enabled
   */
  getRecoveryStatus() {
    return this.recoveryManager?.getStatus();
  }
  /**
   * Force a recovery attempt
   */
  async forceRecovery() {
    if (!this.recoveryManager) {
      throw new Error("Recovery not enabled");
    }
    return this.recoveryManager.forceRecovery();
  }
  setupRecoveryHandlers() {
    if (!this.recoveryManager) {
      return;
    }
    this.recoveryManager.on("recoveryStart", ({ trigger }) => {
      import_logger.logger.info("Recovery started", { trigger });
      this.emit("recoveryStart", { trigger });
    });
    this.recoveryManager.on("recoveryComplete", ({ success, duration }) => {
      if (success) {
        import_logger.logger.info("Recovery completed successfully", { duration });
        this.connected = true;
        this.emit("recoverySuccess", { duration });
      } else {
        import_logger.logger.error("Recovery failed");
        this.emit("recoveryFailed", { duration });
      }
    });
    this.recoveryManager.on("fallbackActivated", (state) => {
      import_logger.logger.warn("Fallback mode activated", state);
      this.emit("fallbackActivated", state);
    });
    this.recoveryManager.on("healthChange", (newStatus, oldStatus) => {
      this.emit("healthChange", newStatus, oldStatus);
    });
  }
  /**
   * Cleanup resources
   */
  async cleanup() {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Client cleanup"));
    }
    this.pendingRequests.clear();
    if (this.recoveryManager) {
      await this.recoveryManager.cleanup();
    }
    await this.disconnect();
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MCPClient
});
//# sourceMappingURL=client.js.map
