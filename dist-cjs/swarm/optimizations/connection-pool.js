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
var connection_pool_exports = {};
__export(connection_pool_exports, {
  ClaudeAPI: () => ClaudeAPI,
  ClaudeConnectionPool: () => ClaudeConnectionPool
});
module.exports = __toCommonJS(connection_pool_exports);
var import_node_events = require("node:events");
var import_logger = require("../../core/logger.js");
class ClaudeAPI {
  static {
    __name(this, "ClaudeAPI");
  }
  id;
  isHealthy;
  constructor() {
    this.id = `mock-api-${Date.now()}`;
    this.isHealthy = true;
  }
  async healthCheck() {
    return this.isHealthy;
  }
  async complete(options) {
    return {
      content: [{ text: `Mock response for: ${options.messages?.[0]?.content || "test"}` }],
      model: options.model || "claude-3-5-sonnet-20241022",
      usage: {
        input_tokens: 10,
        output_tokens: 20
      }
    };
  }
}
class ClaudeConnectionPool extends import_node_events.EventEmitter {
  static {
    __name(this, "ClaudeConnectionPool");
  }
  connections = /* @__PURE__ */ new Map();
  waitingQueue = [];
  config;
  logger;
  evictionTimer;
  isShuttingDown = false;
  constructor(config = {}) {
    super();
    this.config = {
      min: 2,
      max: 10,
      acquireTimeoutMillis: 3e4,
      idleTimeoutMillis: 3e4,
      evictionRunIntervalMillis: 1e4,
      testOnBorrow: true,
      ...config
    };
    this.logger = new import_logger.Logger(
      { level: "info", format: "json", destination: "console" },
      { component: "ClaudeConnectionPool" }
    );
    this.initialize();
  }
  async initialize() {
    for (let i = 0; i < this.config.min; i++) {
      await this.createConnection();
    }
    this.evictionTimer = setInterval(() => {
      this.evictIdleConnections();
    }, this.config.evictionRunIntervalMillis);
    this.logger.info("Connection pool initialized", {
      min: this.config.min,
      max: this.config.max
    });
  }
  async createConnection() {
    const id = `conn-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const api = new ClaudeAPI();
    const connection = {
      id,
      api,
      inUse: false,
      createdAt: /* @__PURE__ */ new Date(),
      lastUsedAt: /* @__PURE__ */ new Date(),
      useCount: 0
    };
    this.connections.set(id, connection);
    this.emit("connection:created", connection);
    return connection;
  }
  async acquire() {
    if (this.isShuttingDown) {
      throw new Error("Connection pool is shutting down");
    }
    for (const conn of this.connections.values()) {
      if (!conn.inUse) {
        conn.inUse = true;
        conn.lastUsedAt = /* @__PURE__ */ new Date();
        conn.useCount++;
        if (this.config.testOnBorrow) {
          const isHealthy = await this.testConnection(conn);
          if (!isHealthy) {
            await this.destroyConnection(conn);
            continue;
          }
        }
        this.emit("connection:acquired", conn);
        return conn;
      }
    }
    if (this.connections.size < this.config.max) {
      const conn = await this.createConnection();
      conn.inUse = true;
      conn.useCount++;
      this.emit("connection:acquired", conn);
      return conn;
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waitingQueue.findIndex((item) => item.resolve === resolve);
        if (index !== -1) {
          this.waitingQueue.splice(index, 1);
        }
        reject(new Error("Connection acquire timeout"));
      }, this.config.acquireTimeoutMillis);
      this.waitingQueue.push({ resolve, reject, timeout });
    });
  }
  async release(connection) {
    const conn = this.connections.get(connection.id);
    if (!conn) {
      this.logger.warn("Attempted to release unknown connection", { id: connection.id });
      return;
    }
    conn.inUse = false;
    conn.lastUsedAt = /* @__PURE__ */ new Date();
    this.emit("connection:released", conn);
    if (this.waitingQueue.length > 0) {
      const waiter = this.waitingQueue.shift();
      if (waiter) {
        clearTimeout(waiter.timeout);
        conn.inUse = true;
        conn.useCount++;
        waiter.resolve(conn);
      }
    }
  }
  async execute(fn) {
    const conn = await this.acquire();
    try {
      return await fn(conn.api);
    } finally {
      await this.release(conn);
    }
  }
  async testConnection(conn) {
    try {
      return true;
    } catch (error) {
      this.logger.warn("Connection health check failed", {
        id: conn.id,
        error: error instanceof Error ? error.message : "Unknown error"
      });
      return false;
    }
  }
  async destroyConnection(conn) {
    this.connections.delete(conn.id);
    this.emit("connection:destroyed", conn);
    if (this.connections.size < this.config.min && !this.isShuttingDown) {
      await this.createConnection();
    }
  }
  evictIdleConnections() {
    const now = Date.now();
    const idleThreshold = now - this.config.idleTimeoutMillis;
    for (const conn of this.connections.values()) {
      if (!conn.inUse && conn.lastUsedAt.getTime() < idleThreshold && this.connections.size > this.config.min) {
        this.destroyConnection(conn);
      }
    }
  }
  async drain() {
    this.isShuttingDown = true;
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = void 0;
    }
    for (const waiter of this.waitingQueue) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error("Connection pool is draining"));
    }
    this.waitingQueue = [];
    const maxWaitTime = 3e4;
    const startTime = Date.now();
    while (true) {
      const inUseCount = Array.from(this.connections.values()).filter((conn) => conn.inUse).length;
      if (inUseCount === 0)
        break;
      if (Date.now() - startTime > maxWaitTime) {
        this.logger.warn("Timeout waiting for connections to be released", { inUseCount });
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    for (const conn of this.connections.values()) {
      await this.destroyConnection(conn);
    }
    this.logger.info("Connection pool drained");
  }
  getStats() {
    const connections = Array.from(this.connections.values());
    return {
      total: connections.length,
      inUse: connections.filter((c) => c.inUse).length,
      idle: connections.filter((c) => !c.inUse).length,
      waitingQueue: this.waitingQueue.length,
      totalUseCount: connections.reduce((sum, c) => sum + c.useCount, 0)
    };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ClaudeAPI,
  ClaudeConnectionPool
});
//# sourceMappingURL=connection-pool.js.map
