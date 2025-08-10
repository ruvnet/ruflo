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
var optimized_executor_exports = {};
__export(optimized_executor_exports, {
  OptimizedExecutor: () => OptimizedExecutor
});
module.exports = __toCommonJS(optimized_executor_exports);
var import_node_events = require("node:events");
var import_logger = require("../../core/logger.js");
var import_connection_pool = require("./connection-pool.js");
var import_async_file_manager = require("./async-file-manager.js");
var import_ttl_map = require("./ttl-map.js");
var import_circular_buffer = require("./circular-buffer.js");
var import_p_queue = __toESM(require("p-queue"), 1);
class OptimizedExecutor extends import_node_events.EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    const loggerConfig = process.env.CLAUDE_FLOW_ENV === "test" ? { level: "error", format: "json", destination: "console" } : { level: "info", format: "json", destination: "console" };
    this.logger = new import_logger.Logger(loggerConfig, { component: "OptimizedExecutor" });
    this.connectionPool = new import_connection_pool.ClaudeConnectionPool({
      min: config.connectionPool?.min || 2,
      max: config.connectionPool?.max || 10
    });
    this.fileManager = new import_async_file_manager.AsyncFileManager({
      write: config.fileOperations?.concurrency || 10,
      read: config.fileOperations?.concurrency || 20
    });
    this.executionQueue = new import_p_queue.default({
      concurrency: config.concurrency || 10
    });
    this.resultCache = new import_ttl_map.TTLMap({
      defaultTTL: config.caching?.ttl || 36e5,
      // 1 hour
      maxSize: config.caching?.maxSize || 1e3,
      onExpire: (key, value) => {
        this.logger.debug("Cache entry expired", { taskId: key });
      }
    });
    this.executionHistory = new import_circular_buffer.CircularBuffer(1e3);
    if (config.monitoring?.metricsInterval) {
      setInterval(() => {
        this.emitMetrics();
      }, config.monitoring.metricsInterval);
    }
  }
  static {
    __name(this, "OptimizedExecutor");
  }
  logger;
  connectionPool;
  fileManager;
  executionQueue;
  resultCache;
  executionHistory;
  metrics = {
    totalExecuted: 0,
    totalSucceeded: 0,
    totalFailed: 0,
    totalExecutionTime: 0,
    cacheHits: 0,
    cacheMisses: 0
  };
  activeExecutions = /* @__PURE__ */ new Set();
  async executeTask(task, agentId) {
    const startTime = Date.now();
    const taskKey = this.getTaskCacheKey(task);
    if (this.config.caching?.enabled) {
      const cached = this.resultCache.get(taskKey);
      if (cached) {
        this.metrics.cacheHits++;
        this.logger.debug("Cache hit for task", { taskId: task.id });
        return cached;
      }
      this.metrics.cacheMisses++;
    }
    this.activeExecutions.add(task.id);
    const result = await this.executionQueue.add(async () => {
      try {
        const executionResult = await this.connectionPool.execute(async (api) => {
          const response = await api.complete({
            messages: this.buildMessages(task),
            model: task.metadata?.model || "claude-3-5-sonnet-20241022",
            max_tokens: task.constraints.maxTokens || 4096,
            temperature: task.metadata?.temperature || 0.7
          });
          return {
            success: true,
            output: response.content[0]?.text || "",
            usage: {
              inputTokens: response.usage?.input_tokens || 0,
              outputTokens: response.usage?.output_tokens || 0
            }
          };
        });
        if (this.config.fileOperations?.outputDir) {
          const outputPath = `${this.config.fileOperations.outputDir}/${task.id}.json`;
          await this.fileManager.writeJSON(outputPath, {
            taskId: task.id,
            agentId: agentId.id,
            result: executionResult,
            timestamp: /* @__PURE__ */ new Date()
          });
        }
        const taskResult = {
          taskId: task.id,
          agentId: agentId.id,
          success: executionResult.success,
          output: executionResult.output,
          error: void 0,
          executionTime: Date.now() - startTime,
          tokensUsed: executionResult.usage,
          timestamp: /* @__PURE__ */ new Date()
        };
        if (this.config.caching?.enabled && executionResult.success) {
          this.resultCache.set(taskKey, taskResult);
        }
        this.metrics.totalExecuted++;
        this.metrics.totalSucceeded++;
        this.metrics.totalExecutionTime += taskResult.executionTime;
        this.executionHistory.push({
          taskId: task.id,
          duration: taskResult.executionTime,
          status: "success",
          timestamp: /* @__PURE__ */ new Date()
        });
        if (this.config.monitoring?.slowTaskThreshold && taskResult.executionTime > this.config.monitoring.slowTaskThreshold) {
          this.logger.warn("Slow task detected", {
            taskId: task.id,
            duration: taskResult.executionTime,
            threshold: this.config.monitoring.slowTaskThreshold
          });
        }
        this.emit("task:completed", taskResult);
        return taskResult;
      } catch (error) {
        this.metrics.totalExecuted++;
        this.metrics.totalFailed++;
        const errorResult = {
          taskId: task.id,
          agentId: agentId.id,
          success: false,
          output: "",
          error: {
            type: error instanceof Error ? error.constructor.name : "UnknownError",
            message: error instanceof Error ? error.message : "Unknown error",
            code: error.code,
            stack: error instanceof Error ? error.stack : void 0,
            context: { taskId: task.id, agentId: agentId.id },
            recoverable: this.isRecoverableError(error),
            retryable: this.isRetryableError(error)
          },
          executionTime: Date.now() - startTime,
          timestamp: /* @__PURE__ */ new Date()
        };
        this.executionHistory.push({
          taskId: task.id,
          duration: errorResult.executionTime,
          status: "failed",
          timestamp: /* @__PURE__ */ new Date()
        });
        this.emit("task:failed", errorResult);
        throw error;
      } finally {
        this.activeExecutions.delete(task.id);
      }
    });
    return result;
  }
  async executeBatch(tasks, agentId) {
    return Promise.all(tasks.map((task) => this.executeTask(task, agentId)));
  }
  buildMessages(task) {
    const messages = [];
    if (task.metadata?.systemPrompt) {
      messages.push({
        role: "system",
        content: task.metadata.systemPrompt
      });
    }
    messages.push({
      role: "user",
      content: task.objective
    });
    if (task.context) {
      if (task.context.previousResults?.length) {
        messages.push({
          role: "assistant",
          content: "Previous results:\n" + task.context.previousResults.map((r) => r.output).join("\n\n")
        });
      }
      if (task.context.relatedTasks?.length) {
        messages.push({
          role: "user",
          content: "Related context:\n" + task.context.relatedTasks.map((t) => t.objective).join("\n")
        });
      }
    }
    return messages;
  }
  getTaskCacheKey(task) {
    return `${task.type}-${task.objective}-${JSON.stringify(task.metadata || {})}`;
  }
  isRecoverableError(error) {
    if (!error)
      return false;
    if (error.code === "ECONNRESET" || error.code === "ETIMEDOUT" || error.code === "ENOTFOUND") {
      return true;
    }
    if (error.status === 429) {
      return true;
    }
    return false;
  }
  isRetryableError(error) {
    if (!error)
      return false;
    if (this.isRecoverableError(error)) {
      return true;
    }
    if (error.status >= 500 && error.status < 600) {
      return true;
    }
    return false;
  }
  getMetrics() {
    const history = this.executionHistory.getAll();
    const avgExecutionTime = this.metrics.totalExecuted > 0 ? this.metrics.totalExecutionTime / this.metrics.totalExecuted : 0;
    const cacheTotal = this.metrics.cacheHits + this.metrics.cacheMisses;
    const cacheHitRate = cacheTotal > 0 ? this.metrics.cacheHits / cacheTotal : 0;
    return {
      totalExecuted: this.metrics.totalExecuted,
      totalSucceeded: this.metrics.totalSucceeded,
      totalFailed: this.metrics.totalFailed,
      avgExecutionTime,
      cacheHitRate,
      queueLength: this.executionQueue.size,
      activeExecutions: this.activeExecutions.size
    };
  }
  emitMetrics() {
    const metrics = this.getMetrics();
    this.emit("metrics", metrics);
    this.logger.info("Executor metrics", metrics);
  }
  async waitForPendingExecutions() {
    await this.executionQueue.onIdle();
    await this.fileManager.waitForPendingOperations();
  }
  async shutdown() {
    this.logger.info("Shutting down optimized executor");
    this.executionQueue.clear();
    await this.waitForPendingExecutions();
    await this.connectionPool.drain();
    this.resultCache.destroy();
    this.logger.info("Optimized executor shut down");
  }
  /**
   * Get execution history for analysis
   */
  getExecutionHistory() {
    return this.executionHistory.snapshot();
  }
  /**
   * Get connection pool statistics
   */
  getConnectionPoolStats() {
    return this.connectionPool.getStats();
  }
  /**
   * Get file manager metrics
   */
  getFileManagerMetrics() {
    return this.fileManager.getMetrics();
  }
  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.resultCache.getStats();
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  OptimizedExecutor
});
//# sourceMappingURL=optimized-executor.js.map
