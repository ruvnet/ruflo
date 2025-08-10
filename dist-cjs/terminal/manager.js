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
var manager_exports = {};
__export(manager_exports, {
  TerminalManager: () => TerminalManager
});
module.exports = __toCommonJS(manager_exports);
var process = __toESM(require("node:process"), 1);
var import_errors = require("../utils/errors.js");
var import_vscode = require("./adapters/vscode.js");
var import_native = require("./adapters/native.js");
var import_pool = require("./pool.js");
var import_session = require("./session.js");
class TerminalManager {
  constructor(config, eventBus, logger) {
    this.config = config;
    this.eventBus = eventBus;
    this.logger = logger;
    this.adapter = this.createAdapter();
    this.pool = new import_pool.TerminalPool(
      this.config.poolSize,
      this.config.recycleAfter,
      this.adapter,
      this.logger
    );
  }
  static {
    __name(this, "TerminalManager");
  }
  adapter;
  pool;
  sessions = /* @__PURE__ */ new Map();
  initialized = false;
  async initialize() {
    if (this.initialized) {
      return;
    }
    this.logger.info("Initializing terminal manager...");
    try {
      await this.adapter.initialize();
      await this.pool.initialize();
      this.initialized = true;
      this.logger.info("Terminal manager initialized");
    } catch (error) {
      this.logger.error("Failed to initialize terminal manager", error);
      throw new import_errors.TerminalError("Terminal manager initialization failed", { error });
    }
  }
  async shutdown() {
    if (!this.initialized) {
      return;
    }
    this.logger.info("Shutting down terminal manager...");
    try {
      const sessionIds = Array.from(this.sessions.keys());
      await Promise.all(sessionIds.map((id) => this.terminateTerminal(id)));
      await this.pool.shutdown();
      await this.adapter.shutdown();
      this.initialized = false;
      this.logger.info("Terminal manager shutdown complete");
    } catch (error) {
      this.logger.error("Error during terminal manager shutdown", error);
      throw error;
    }
  }
  async spawnTerminal(profile) {
    if (!this.initialized) {
      throw new import_errors.TerminalError("Terminal manager not initialized");
    }
    this.logger.debug("Spawning terminal", { agentId: profile.id });
    try {
      const terminal = await this.pool.acquire();
      const session = new import_session.TerminalSession(
        terminal,
        profile,
        this.config.commandTimeout,
        this.logger
      );
      await session.initialize();
      this.sessions.set(session.id, session);
      this.logger.info("Terminal spawned", {
        terminalId: session.id,
        agentId: profile.id
      });
      return session.id;
    } catch (error) {
      this.logger.error("Failed to spawn terminal", error);
      throw new import_errors.TerminalSpawnError("Failed to spawn terminal", { error });
    }
  }
  async terminateTerminal(terminalId) {
    const session = this.sessions.get(terminalId);
    if (!session) {
      throw new import_errors.TerminalError(`Terminal not found: ${terminalId}`);
    }
    this.logger.debug("Terminating terminal", { terminalId });
    try {
      await session.cleanup();
      await this.pool.release(session.terminal);
      this.sessions.delete(terminalId);
      this.logger.info("Terminal terminated", { terminalId });
    } catch (error) {
      this.logger.error("Failed to terminate terminal", error);
      throw error;
    }
  }
  async executeCommand(terminalId, command) {
    const session = this.sessions.get(terminalId);
    if (!session) {
      throw new import_errors.TerminalError(`Terminal not found: ${terminalId}`);
    }
    return await session.executeCommand(command);
  }
  async getHealthStatus() {
    try {
      const poolHealth = await this.pool.getHealthStatus();
      const activeSessions = this.sessions.size;
      const healthySessions = Array.from(this.sessions.values()).filter(
        (session) => session.isHealthy()
      ).length;
      const metrics = {
        activeSessions,
        healthySessions,
        poolSize: poolHealth.size,
        availableTerminals: poolHealth.available,
        recycledTerminals: poolHealth.recycled
      };
      const healthy = poolHealth.healthy && healthySessions === activeSessions;
      if (healthy) {
        return {
          healthy,
          metrics
        };
      } else {
        return {
          healthy,
          metrics,
          error: "Some terminals are unhealthy"
        };
      }
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }
  async performMaintenance() {
    if (!this.initialized) {
      return;
    }
    this.logger.debug("Performing terminal manager maintenance");
    try {
      const deadSessions = Array.from(this.sessions.entries()).filter(
        ([_, session]) => !session.isHealthy()
      );
      for (const [terminalId, _] of deadSessions) {
        this.logger.warn("Cleaning up dead terminal session", { terminalId });
        await this.terminateTerminal(terminalId).catch(
          (error) => this.logger.error("Failed to clean up terminal", { terminalId, error })
        );
      }
      await this.pool.performMaintenance();
      this.eventBus.emit("terminal:maintenance", {
        deadSessions: deadSessions.length,
        activeSessions: this.sessions.size,
        poolStatus: await this.pool.getHealthStatus()
      });
      this.logger.debug("Terminal manager maintenance completed");
    } catch (error) {
      this.logger.error("Error during terminal manager maintenance", error);
    }
  }
  /**
   * Get all active sessions
   */
  getActiveSessions() {
    return Array.from(this.sessions.values()).map((session) => ({
      id: session.id,
      agentId: session.profile.id,
      terminalId: session.terminal.id,
      startTime: session.startTime,
      status: session.isHealthy() ? "active" : "error",
      lastActivity: session.lastActivity,
      memoryBankId: ""
      // TODO: Link to memory bank
    }));
  }
  /**
   * Get session by ID
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }
  /**
   * Stream terminal output
   */
  async streamOutput(terminalId, callback) {
    const session = this.sessions.get(terminalId);
    if (!session) {
      throw new import_errors.TerminalError(`Terminal not found: ${terminalId}`);
    }
    return session.streamOutput(callback);
  }
  createAdapter() {
    switch (this.config.type) {
      case "vscode":
        return new import_vscode.VSCodeAdapter(this.logger);
      case "native":
        return new import_native.NativeAdapter(this.logger);
      case "auto":
        if (this.isVSCodeEnvironment()) {
          this.logger.info("Detected VSCode environment, using VSCode adapter");
          return new import_vscode.VSCodeAdapter(this.logger);
        } else {
          this.logger.info("Using native terminal adapter");
          return new import_native.NativeAdapter(this.logger);
        }
      default:
        throw new import_errors.TerminalError(`Unknown terminal type: ${this.config.type}`);
    }
  }
  isVSCodeEnvironment() {
    return process.env.TERM_PROGRAM === "vscode" || process.env.VSCODE_PID !== void 0 || process.env.VSCODE_IPC_HOOK !== void 0;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TerminalManager
});
//# sourceMappingURL=manager.js.map
