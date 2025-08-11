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
var fallback_coordinator_exports = {};
__export(fallback_coordinator_exports, {
  FallbackCoordinator: () => FallbackCoordinator
});
module.exports = __toCommonJS(fallback_coordinator_exports);
var import_node_events = require("node:events");
var import_node_child_process = require("node:child_process");
var import_node_util = require("node:util");
const execAsync = (0, import_node_util.promisify)(import_node_child_process.exec);
class FallbackCoordinator extends import_node_events.EventEmitter {
  constructor(logger, config) {
    super();
    this.logger = logger;
    this.config = { ...this.defaultConfig, ...config };
    this.state = {
      isFallbackActive: false,
      queuedOperations: 0,
      failedOperations: 0,
      successfulOperations: 0
    };
  }
  static {
    __name(this, "FallbackCoordinator");
  }
  operationQueue = [];
  state;
  notificationTimer;
  processingQueue = false;
  defaultConfig = {
    enableFallback: true,
    maxQueueSize: 100,
    queueTimeout: 3e5,
    // 5 minutes
    cliPath: "npx ruv-swarm",
    fallbackNotificationInterval: 3e4
    // 30 seconds
  };
  config;
  /**
   * Check if MCP is available
   */
  async isMCPAvailable() {
    try {
      const { stdout } = await execAsync(`${this.config.cliPath} status --json`);
      const status = JSON.parse(stdout);
      return status.connected === true;
    } catch (error) {
      this.logger.debug("MCP availability check failed", error);
      return false;
    }
  }
  /**
   * Enable CLI fallback mode
   */
  enableCLIFallback() {
    if (this.state.isFallbackActive) {
      this.logger.debug("Fallback already active");
      return;
    }
    this.logger.warn("Enabling CLI fallback mode");
    this.state.isFallbackActive = true;
    this.state.lastFallbackActivation = /* @__PURE__ */ new Date();
    this.startNotificationTimer();
    this.emit("fallbackEnabled", this.state);
  }
  /**
   * Disable CLI fallback mode
   */
  disableCLIFallback() {
    if (!this.state.isFallbackActive) {
      return;
    }
    this.logger.info("Disabling CLI fallback mode");
    this.state.isFallbackActive = false;
    this.stopNotificationTimer();
    this.emit("fallbackDisabled", this.state);
    if (this.operationQueue.length > 0) {
      this.processQueue().catch((error) => {
        this.logger.error("Error processing queue after fallback disabled", error);
      });
    }
  }
  /**
   * Queue an operation for later execution
   */
  queueOperation(operation) {
    if (!this.config.enableFallback) {
      this.logger.debug("Fallback disabled, operation not queued");
      return;
    }
    if (this.operationQueue.length >= this.config.maxQueueSize) {
      this.logger.warn("Operation queue full, removing oldest operation");
      this.operationQueue.shift();
      this.state.failedOperations++;
    }
    const queuedOp = {
      ...operation,
      id: this.generateOperationId(),
      timestamp: /* @__PURE__ */ new Date()
    };
    this.operationQueue.push(queuedOp);
    this.state.queuedOperations = this.operationQueue.length;
    this.logger.debug("Operation queued", {
      id: queuedOp.id,
      type: queuedOp.type,
      method: queuedOp.method,
      queueSize: this.operationQueue.length
    });
    this.emit("operationQueued", queuedOp);
    if (this.state.isFallbackActive && !this.processingQueue) {
      this.executeViaCliFallback(queuedOp).catch((error) => {
        this.logger.error("CLI fallback execution failed", { operation: queuedOp, error });
      });
    }
  }
  /**
   * Process all queued operations
   */
  async processQueue() {
    if (this.processingQueue || this.operationQueue.length === 0) {
      return;
    }
    this.processingQueue = true;
    this.logger.info("Processing operation queue", {
      queueSize: this.operationQueue.length
    });
    this.emit("queueProcessingStart", this.operationQueue.length);
    const results = {
      successful: 0,
      failed: 0
    };
    while (this.operationQueue.length > 0) {
      const operation = this.operationQueue.shift();
      if (this.isOperationExpired(operation)) {
        this.logger.warn("Operation expired", { id: operation.id });
        results.failed++;
        continue;
      }
      try {
        await this.replayOperation(operation);
        results.successful++;
        this.state.successfulOperations++;
      } catch (error) {
        this.logger.error("Failed to replay operation", {
          operation,
          error
        });
        results.failed++;
        this.state.failedOperations++;
        if (operation.retryable) {
          this.operationQueue.push(operation);
        }
      }
    }
    this.state.queuedOperations = this.operationQueue.length;
    this.processingQueue = false;
    this.logger.info("Queue processing complete", results);
    this.emit("queueProcessingComplete", results);
  }
  /**
   * Get current fallback state
   */
  getState() {
    return { ...this.state };
  }
  /**
   * Get queued operations
   */
  getQueuedOperations() {
    return [...this.operationQueue];
  }
  /**
   * Clear operation queue
   */
  clearQueue() {
    const clearedCount = this.operationQueue.length;
    this.operationQueue = [];
    this.state.queuedOperations = 0;
    this.logger.info("Operation queue cleared", { clearedCount });
    this.emit("queueCleared", clearedCount);
  }
  async executeViaCliFallback(operation) {
    this.logger.debug("Executing operation via CLI fallback", {
      id: operation.id,
      method: operation.method
    });
    try {
      const cliCommand = this.mapOperationToCli(operation);
      if (!cliCommand) {
        throw new Error(`No CLI mapping for operation: ${operation.method}`);
      }
      const { stdout, stderr } = await execAsync(cliCommand);
      if (stderr) {
        this.logger.warn("CLI command stderr", { stderr });
      }
      this.logger.debug("CLI fallback execution successful", {
        id: operation.id,
        stdout: stdout.substring(0, 200)
        // Log first 200 chars
      });
      this.state.successfulOperations++;
      this.emit("fallbackExecutionSuccess", { operation, result: stdout });
    } catch (error) {
      this.logger.error("CLI fallback execution failed", {
        operation,
        error
      });
      this.state.failedOperations++;
      this.emit("fallbackExecutionFailed", { operation, error });
      if (operation.retryable) {
        this.queueOperation(operation);
      }
    }
  }
  async replayOperation(operation) {
    this.logger.info("Replaying operation", {
      id: operation.id,
      method: operation.method
    });
    this.emit("replayOperation", operation);
  }
  mapOperationToCli(operation) {
    const mappings = {
      // Tool operations
      "tools/list": () => `${this.config.cliPath} tools list`,
      "tools/call": (params) => `${this.config.cliPath} tools call ${params.name} '${JSON.stringify(params.arguments)}'`,
      // Resource operations
      "resources/list": () => `${this.config.cliPath} resources list`,
      "resources/read": (params) => `${this.config.cliPath} resources read ${params.uri}`,
      // Session operations
      initialize: () => `${this.config.cliPath} session init`,
      shutdown: () => `${this.config.cliPath} session shutdown`,
      // Custom operations
      heartbeat: () => `${this.config.cliPath} health check`
    };
    const mapper = mappings[operation.method];
    return mapper ? mapper(operation.params) : null;
  }
  isOperationExpired(operation) {
    const age = Date.now() - operation.timestamp.getTime();
    return age > this.config.queueTimeout;
  }
  generateOperationId() {
    return `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  startNotificationTimer() {
    if (this.notificationTimer) {
      return;
    }
    this.notificationTimer = setInterval(() => {
      if (this.state.isFallbackActive && this.operationQueue.length > 0) {
        this.logger.info("Fallback mode active", {
          queuedOperations: this.operationQueue.length,
          duration: Date.now() - (this.state.lastFallbackActivation?.getTime() || 0)
        });
        this.emit("fallbackStatus", this.state);
      }
    }, this.config.fallbackNotificationInterval);
  }
  stopNotificationTimer() {
    if (this.notificationTimer) {
      clearInterval(this.notificationTimer);
      this.notificationTimer = void 0;
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  FallbackCoordinator
});
//# sourceMappingURL=fallback-coordinator.js.map
