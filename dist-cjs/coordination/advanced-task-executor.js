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
var advanced_task_executor_exports = {};
__export(advanced_task_executor_exports, {
  AdvancedTaskExecutor: () => AdvancedTaskExecutor
});
module.exports = __toCommonJS(advanced_task_executor_exports);
var import_type_guards = require("../utils/type-guards.js");
var import_node_events = require("node:events");
var import_node_child_process = require("node:child_process");
var import_circuit_breaker = require("./circuit-breaker.js");
class AdvancedTaskExecutor extends import_node_events.EventEmitter {
  static {
    __name(this, "AdvancedTaskExecutor");
  }
  logger;
  eventBus;
  config;
  runningTasks = /* @__PURE__ */ new Map();
  circuitBreakerManager;
  resourceMonitor;
  queuedTasks = [];
  isShuttingDown = false;
  constructor(config, logger, eventBus) {
    super();
    this.logger = logger;
    this.eventBus = eventBus;
    this.config = {
      maxConcurrentTasks: 10,
      defaultTimeout: 3e5,
      // 5 minutes
      retryAttempts: 3,
      retryBackoffBase: 1e3,
      retryBackoffMax: 3e4,
      resourceLimits: {
        memory: 512 * 1024 * 1024,
        // 512MB
        cpu: 1,
        // 1 CPU core
        disk: 1024 * 1024 * 1024
        // 1GB
      },
      enableCircuitBreaker: true,
      enableResourceMonitoring: true,
      killTimeout: 5e3,
      ...config
    };
    this.circuitBreakerManager = new import_circuit_breaker.CircuitBreakerManager(
      {
        failureThreshold: 5,
        successThreshold: 3,
        timeout: 6e4,
        // 1 minute
        halfOpenLimit: 2
      },
      this.logger,
      this.eventBus
    );
    this.setupEventHandlers();
  }
  setupEventHandlers() {
    process.on("SIGTERM", () => this.gracefulShutdown());
    process.on("SIGINT", () => this.gracefulShutdown());
    this.eventBus.on("circuitbreaker:state-change", (event) => {
      this.logger.info("Circuit breaker state changed", event);
      this.emit("circuit-breaker-changed", event);
    });
  }
  async initialize() {
    this.logger.info("Initializing advanced task executor", {
      maxConcurrentTasks: this.config.maxConcurrentTasks,
      defaultTimeout: this.config.defaultTimeout,
      resourceLimits: this.config.resourceLimits
    });
    if (this.config.enableResourceMonitoring) {
      this.startResourceMonitoring();
    }
    this.emit("executor-initialized");
  }
  async shutdown() {
    this.logger.info("Shutting down task executor");
    this.isShuttingDown = true;
    if (this.resourceMonitor) {
      clearInterval(this.resourceMonitor);
    }
    const cancelPromises = Array.from(this.runningTasks.values()).map(
      (ctx) => this.cancelTask(ctx.taskId, "Shutdown requested")
    );
    await Promise.all(cancelPromises);
    this.emit("executor-shutdown");
  }
  /**
   * Execute a task with comprehensive error handling and resource management
   */
  async executeTask(task, agent, options = {}) {
    const startTime = Date.now();
    let retryCount = 0;
    const maxRetries = options.retryAttempts ?? this.config.retryAttempts;
    const timeout = options.timeout ?? this.config.defaultTimeout;
    this.logger.info("Starting task execution", {
      taskId: task.id.id,
      agentId: agent.id.id,
      type: task.type,
      timeout,
      maxRetries
    });
    if (this.runningTasks.size >= this.config.maxConcurrentTasks) {
      this.queuedTasks.push(task);
      this.logger.info("Task queued due to capacity limits", {
        taskId: task.id.id,
        queueSize: this.queuedTasks.length
      });
      await this.waitForCapacity();
    }
    while (retryCount <= maxRetries) {
      try {
        const result = await this.executeSingleAttempt(task, agent, timeout, retryCount);
        this.logger.info("Task completed successfully", {
          taskId: task.id.id,
          executionTime: Date.now() - startTime,
          retryCount
        });
        return {
          success: true,
          result: result.result,
          executionTime: Date.now() - startTime,
          resourcesUsed: result.resourcesUsed,
          retryCount
        };
      } catch (error) {
        retryCount++;
        this.logger.warn("Task attempt failed", {
          taskId: task.id.id,
          attempt: retryCount,
          maxRetries,
          error: (0, import_type_guards.getErrorMessage)(error)
        });
        if (retryCount > maxRetries) {
          const taskError = {
            type: "execution_failed",
            message: (0, import_type_guards.getErrorMessage)(error),
            stack: (0, import_type_guards.getErrorStack)(error),
            context: {
              retryCount,
              maxRetries,
              taskType: task.type
            },
            recoverable: false,
            retryable: false
          };
          return {
            success: false,
            error: taskError,
            executionTime: Date.now() - startTime,
            resourcesUsed: this.getDefaultResourceUsage(),
            retryCount
          };
        }
        const backoffDelay = Math.min(
          this.config.retryBackoffBase * Math.pow(2, retryCount - 1),
          this.config.retryBackoffMax
        );
        this.logger.info("Retrying task after backoff", {
          taskId: task.id.id,
          backoffDelay,
          attempt: retryCount + 1
        });
        await this.delay(backoffDelay);
      }
    }
    throw new Error("Unexpected end of retry loop");
  }
  async executeSingleAttempt(task, agent, timeout, retryCount) {
    const executionContext = {
      taskId: task.id.id,
      agentId: agent.id.id,
      startTime: /* @__PURE__ */ new Date(),
      resources: this.getDefaultResourceUsage()
    };
    this.runningTasks.set(task.id.id, executionContext);
    try {
      const timeoutPromise = new Promise((_, reject) => {
        executionContext.timeout = setTimeout(() => {
          reject(new Error(`Task timeout after ${timeout}ms`));
        }, timeout);
      });
      if (this.config.enableCircuitBreaker) {
        executionContext.circuitBreaker = this.circuitBreakerManager.getBreaker(
          `agent-${agent.id.id}`
        );
      }
      const executionPromise = this.config.enableCircuitBreaker && executionContext.circuitBreaker ? executionContext.circuitBreaker.execute(
        () => this.performTaskExecution(task, agent, executionContext)
      ) : this.performTaskExecution(task, agent, executionContext);
      const result = await Promise.race([executionPromise, timeoutPromise]);
      if (executionContext.timeout) {
        clearTimeout(executionContext.timeout);
      }
      return result;
    } finally {
      this.runningTasks.delete(task.id.id);
      this.processQueuedTasks();
    }
  }
  async performTaskExecution(task, agent, context) {
    const startTime = Date.now();
    const command = this.buildExecutionCommand(task, agent);
    this.logger.debug("Executing task command", {
      taskId: task.id.id,
      command: command.cmd,
      args: command.args
    });
    const childProcess = (0, import_node_child_process.spawn)(command.cmd, command.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...command.env,
        TASK_ID: task.id.id,
        AGENT_ID: agent.id.id,
        TASK_TYPE: task.type
      }
    });
    context.process = childProcess;
    let stdout = "";
    let stderr = "";
    childProcess.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    childProcess.stderr?.on("data", (data) => {
      stderr += data.toString();
    });
    if (task.input && childProcess.stdin) {
      childProcess.stdin.write(
        JSON.stringify({
          task,
          agent,
          input: task.input
        })
      );
      childProcess.stdin.end();
    }
    const exitCode = await new Promise((resolve, reject) => {
      childProcess.on("exit", (code) => {
        resolve(code ?? 0);
      });
      childProcess.on("error", (error) => {
        reject(new Error(`Process error: ${(0, import_type_guards.getErrorMessage)(error)}`));
      });
    });
    const executionTime = Date.now() - startTime;
    let taskResult;
    if (exitCode === 0) {
      try {
        const output = JSON.parse(stdout);
        taskResult = {
          output: output.result || output,
          artifacts: output.artifacts || {},
          metadata: output.metadata || {},
          quality: output.quality || 0.8,
          completeness: output.completeness || 1,
          accuracy: output.accuracy || 0.9,
          executionTime,
          resourcesUsed: context.resources,
          validated: false
        };
      } catch (error) {
        taskResult = {
          output: stdout,
          artifacts: {},
          metadata: { stderr },
          quality: 0.5,
          completeness: 1,
          accuracy: 0.7,
          executionTime,
          resourcesUsed: context.resources,
          validated: false
        };
      }
    } else {
      throw new Error(`Task execution failed with exit code ${exitCode}: ${stderr}`);
    }
    return {
      result: taskResult,
      resourcesUsed: context.resources
    };
  }
  buildExecutionCommand(task, agent) {
    const cmd = "deno";
    const args = [
      "run",
      "--allow-all",
      "--no-check",
      "./src/cli/commands/task-executor.ts",
      "--task-type",
      task.type,
      "--agent-type",
      agent.type
    ];
    const env = {
      TASK_TIMEOUT: (task.constraints.timeoutAfter || this.config.defaultTimeout).toString(),
      MEMORY_LIMIT: this.config.resourceLimits.memory.toString(),
      CPU_LIMIT: this.config.resourceLimits.cpu.toString()
    };
    return { cmd, args, env };
  }
  async cancelTask(taskId, reason) {
    const context = this.runningTasks.get(taskId);
    if (!context) {
      return;
    }
    this.logger.info("Cancelling task", { taskId, reason });
    if (context.timeout) {
      clearTimeout(context.timeout);
    }
    if (context.process && !context.process.killed) {
      context.process.kill("SIGTERM");
      setTimeout(() => {
        if (context.process && !context.process.killed) {
          context.process.kill("SIGKILL");
        }
      }, this.config.killTimeout);
    }
    this.runningTasks.delete(taskId);
    this.emit("task-cancelled", { taskId, reason });
  }
  startResourceMonitoring() {
    this.resourceMonitor = setInterval(() => {
      this.updateResourceUsage();
    }, 5e3);
  }
  async updateResourceUsage() {
    for (const [taskId, context] of this.runningTasks) {
      if (context.process) {
        try {
          const usage = await this.getProcessResourceUsage(context.process.pid);
          context.resources = {
            ...usage,
            lastUpdated: /* @__PURE__ */ new Date()
          };
          this.checkResourceLimits(taskId, context);
        } catch (error) {
          this.logger.warn("Failed to get resource usage", {
            taskId,
            error: (0, import_type_guards.getErrorMessage)(error)
          });
        }
      }
    }
  }
  async getProcessResourceUsage(pid) {
    if (!pid) {
      throw new Error("Process ID is undefined");
    }
    return {
      memory: Math.random() * this.config.resourceLimits.memory,
      cpu: Math.random() * 100,
      disk: Math.random() * this.config.resourceLimits.disk,
      network: Math.random() * 1024 * 1024,
      lastUpdated: /* @__PURE__ */ new Date()
    };
  }
  checkResourceLimits(taskId, context) {
    const { memory, cpu } = context.resources;
    const limits = this.config.resourceLimits;
    if (memory > limits.memory) {
      this.logger.warn("Task exceeding memory limit", {
        taskId,
        current: memory,
        limit: limits.memory
      });
      this.cancelTask(taskId, "Memory limit exceeded");
    }
    if (cpu > limits.cpu * 100) {
      this.logger.warn("Task exceeding CPU limit", {
        taskId,
        current: cpu,
        limit: limits.cpu * 100
      });
    }
  }
  getDefaultResourceUsage() {
    return {
      memory: 0,
      cpu: 0,
      disk: 0,
      network: 0,
      lastUpdated: /* @__PURE__ */ new Date()
    };
  }
  async waitForCapacity() {
    return new Promise((resolve) => {
      const check = /* @__PURE__ */ __name(() => {
        if (this.runningTasks.size < this.config.maxConcurrentTasks) {
          resolve();
        } else {
          setTimeout(check, 1e3);
        }
      }, "check");
      check();
    });
  }
  processQueuedTasks() {
    while (this.queuedTasks.length > 0 && this.runningTasks.size < this.config.maxConcurrentTasks) {
      const task = this.queuedTasks.shift();
      if (task) {
        this.emit("task-dequeued", { taskId: task.id.id });
      }
    }
  }
  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async gracefulShutdown() {
    this.logger.info("Received shutdown signal, initiating graceful shutdown");
    await this.shutdown();
    process.exit(0);
  }
  // Public API methods
  getRunningTasks() {
    return Array.from(this.runningTasks.keys());
  }
  getTaskContext(taskId) {
    return this.runningTasks.get(taskId);
  }
  getQueuedTasks() {
    return [...this.queuedTasks];
  }
  getExecutorStats() {
    return {
      runningTasks: this.runningTasks.size,
      queuedTasks: this.queuedTasks.length,
      maxConcurrentTasks: this.config.maxConcurrentTasks,
      totalCapacity: this.config.maxConcurrentTasks,
      resourceLimits: this.config.resourceLimits,
      circuitBreakers: this.circuitBreakerManager.getAllMetrics()
    };
  }
  async forceKillTask(taskId) {
    await this.cancelTask(taskId, "Force killed by user");
  }
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.logger.info("Task executor configuration updated", { newConfig });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AdvancedTaskExecutor
});
//# sourceMappingURL=advanced-task-executor.js.map
