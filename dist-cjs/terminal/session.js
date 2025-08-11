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
var session_exports = {};
__export(session_exports, {
  TerminalSession: () => TerminalSession
});
module.exports = __toCommonJS(session_exports);
var import_errors = require("../utils/errors.js");
var import_helpers = require("../utils/helpers.js");
class TerminalSession {
  constructor(terminal, profile, commandTimeout, logger) {
    this.terminal = terminal;
    this.profile = profile;
    this.commandTimeout = commandTimeout;
    this.logger = logger;
    this.id = (0, import_helpers.generateId)("session");
    this.startTime = /* @__PURE__ */ new Date();
  }
  static {
    __name(this, "TerminalSession");
  }
  id;
  startTime;
  initialized = false;
  commandHistory = [];
  lastCommandTime;
  outputListeners = /* @__PURE__ */ new Set();
  get lastActivity() {
    return this.lastCommandTime || this.startTime;
  }
  async initialize() {
    if (this.initialized) {
      return;
    }
    this.logger.debug("Initializing terminal session", {
      sessionId: this.id,
      agentId: this.profile.id
    });
    try {
      await this.setupEnvironment();
      await this.runInitializationCommands();
      this.initialized = true;
      this.logger.info("Terminal session initialized", {
        sessionId: this.id,
        agentId: this.profile.id
      });
    } catch (error) {
      this.logger.error("Failed to initialize terminal session", error);
      throw error;
    }
  }
  async executeCommand(command) {
    if (!this.initialized) {
      throw new import_errors.TerminalCommandError("Session not initialized");
    }
    if (!this.terminal.isAlive()) {
      throw new import_errors.TerminalCommandError("Terminal is not alive");
    }
    this.logger.debug("Executing command", {
      sessionId: this.id,
      command: command.substring(0, 100)
    });
    try {
      this.notifyOutputListeners(`$ ${command}
`);
      const result = await (0, import_helpers.timeout)(
        this.terminal.executeCommand(command),
        this.commandTimeout,
        `Command timeout after ${this.commandTimeout}ms`
      );
      this.notifyOutputListeners(result);
      this.commandHistory.push(command);
      this.lastCommandTime = /* @__PURE__ */ new Date();
      this.logger.debug("Command executed successfully", {
        sessionId: this.id,
        outputLength: result.length
      });
      return result;
    } catch (error) {
      this.logger.error("Command execution failed", {
        sessionId: this.id,
        command,
        error
      });
      throw new import_errors.TerminalCommandError("Command execution failed", {
        command,
        error
      });
    }
  }
  async cleanup() {
    this.logger.debug("Cleaning up terminal session", { sessionId: this.id });
    try {
      await this.runCleanupCommands();
    } catch (error) {
      this.logger.warn("Error during session cleanup", {
        sessionId: this.id,
        error
      });
    }
  }
  isHealthy() {
    if (!this.terminal.isAlive()) {
      return false;
    }
    if (this.lastCommandTime) {
      const timeSinceLastCommand = Date.now() - this.lastCommandTime.getTime();
      if (timeSinceLastCommand > 3e5) {
        this.performHealthCheck().catch((error) => {
          this.logger.warn("Health check failed", { sessionId: this.id, error });
        });
      }
    }
    return true;
  }
  getCommandHistory() {
    return [...this.commandHistory];
  }
  async setupEnvironment() {
    const envVars = {
      CLAUDE_FLOW_SESSION: this.id,
      CLAUDE_FLOW_AGENT: this.profile.id,
      CLAUDE_FLOW_AGENT_TYPE: this.profile.type
    };
    for (const [key, value] of Object.entries(envVars)) {
      await this.terminal.executeCommand(`export ${key}="${value}"`);
    }
    if (this.profile.metadata?.workingDirectory) {
      await this.terminal.executeCommand(`cd "${this.profile.metadata.workingDirectory}"`);
    }
  }
  async runInitializationCommands() {
    if (this.profile.metadata?.initCommands) {
      const commands = this.profile.metadata.initCommands;
      for (const command of commands) {
        await this.terminal.executeCommand(command);
      }
    }
    await this.terminal.executeCommand('export PS1="[claude-flow]$ "');
  }
  async runCleanupCommands() {
    if (this.profile.metadata?.cleanupCommands) {
      const commands = this.profile.metadata.cleanupCommands;
      for (const command of commands) {
        try {
          await this.terminal.executeCommand(command);
        } catch {
        }
      }
    }
  }
  async performHealthCheck() {
    try {
      const result = await (0, import_helpers.timeout)(
        this.terminal.executeCommand('echo "HEALTH_CHECK_OK"'),
        5e3,
        "Health check timeout"
      );
      if (!result.includes("HEALTH_CHECK_OK")) {
        throw new Error("Invalid health check response");
      }
      this.lastCommandTime = /* @__PURE__ */ new Date();
    } catch (error) {
      throw new Error(
        `Health check failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  /**
   * Stream terminal output
   */
  streamOutput(callback) {
    this.outputListeners.add(callback);
    if (this.terminal.addOutputListener) {
      this.terminal.addOutputListener(callback);
    }
    return () => {
      this.outputListeners.delete(callback);
      if (this.terminal.removeOutputListener) {
        this.terminal.removeOutputListener(callback);
      }
    };
  }
  /**
   * Notify output listeners
   */
  notifyOutputListeners(output) {
    this.outputListeners.forEach((listener) => {
      try {
        listener(output);
      } catch (error) {
        this.logger.error("Error in output listener", { sessionId: this.id, error });
      }
    });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TerminalSession
});
//# sourceMappingURL=session.js.map
