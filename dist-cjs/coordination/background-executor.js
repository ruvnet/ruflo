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
var background_executor_exports = {};
__export(background_executor_exports, {
  BackgroundExecutor: () => BackgroundExecutor
});
module.exports = __toCommonJS(background_executor_exports);
var import_node_child_process = require("node:child_process");
var import_node_events = require("node:events");
var import_logger = require("../core/logger.js");
var import_helpers = require("../utils/helpers.js");
var fs = __toESM(require("node:fs/promises"), 1);
var path = __toESM(require("node:path"), 1);
class BackgroundExecutor extends import_node_events.EventEmitter {
  static {
    __name(this, "BackgroundExecutor");
  }
  logger;
  config;
  tasks;
  processes;
  queue;
  isRunning = false;
  checkTimer;
  cleanupTimer;
  constructor(config = {}) {
    super();
    this.logger = new import_logger.Logger("BackgroundExecutor");
    this.config = {
      maxConcurrentTasks: 5,
      defaultTimeout: 3e5,
      // 5 minutes
      logPath: "./background-tasks",
      enablePersistence: true,
      checkInterval: 1e3,
      // 1 second
      cleanupInterval: 6e4,
      // 1 minute
      maxRetries: 3,
      ...config
    };
    this.tasks = /* @__PURE__ */ new Map();
    this.processes = /* @__PURE__ */ new Map();
    this.queue = [];
  }
  async start() {
    if (this.isRunning)
      return;
    this.logger.info("Starting background executor...");
    this.isRunning = true;
    if (this.config.enablePersistence) {
      await fs.mkdir(this.config.logPath, { recursive: true });
    }
    this.checkTimer = setInterval(() => {
      this.processQueue();
      this.checkRunningTasks();
    }, this.config.checkInterval);
    this.cleanupTimer = setInterval(() => {
      this.cleanupCompletedTasks();
    }, this.config.cleanupInterval);
    this.emit("executor:started");
  }
  async stop() {
    if (!this.isRunning)
      return;
    this.logger.info("Stopping background executor...");
    this.isRunning = false;
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = void 0;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = void 0;
    }
    for (const [taskId, process] of this.processes) {
      this.logger.warn(`Killing process for task ${taskId}`);
      process.kill("SIGTERM");
    }
    this.emit("executor:stopped");
  }
  async submitTask(type, command, args = [], options = {}) {
    const taskId = (0, import_helpers.generateId)("bgtask");
    const task = {
      id: taskId,
      type,
      command,
      args,
      options: {
        timeout: this.config.defaultTimeout,
        retries: this.config.maxRetries,
        ...options
      },
      status: "pending",
      retryCount: 0
    };
    this.tasks.set(taskId, task);
    this.queue.push(taskId);
    if (this.config.enablePersistence) {
      await this.saveTaskState(task);
    }
    this.logger.info(`Submitted background task: ${taskId} - ${command}`);
    this.emit("task:submitted", task);
    this.processQueue();
    return taskId;
  }
  async submitClaudeTask(prompt, tools = [], options = {}) {
    const args = ["-p", prompt];
    if (tools.length > 0) {
      args.push("--allowedTools", tools.join(","));
    }
    if (options.model) {
      args.push("--model", options.model);
    }
    if (options.maxTokens) {
      args.push("--max-tokens", options.maxTokens.toString());
    }
    args.push("--dangerously-skip-permissions");
    return this.submitTask("claude-spawn", "claude", args, {
      ...options,
      detached: true
      // Run in background
    });
  }
  async processQueue() {
    if (!this.isRunning)
      return;
    const runningTasks = Array.from(this.tasks.values()).filter(
      (t) => t.status === "running"
    ).length;
    const availableSlots = this.config.maxConcurrentTasks - runningTasks;
    for (let i = 0; i < availableSlots && this.queue.length > 0; i++) {
      const taskId = this.queue.shift();
      if (!taskId)
        continue;
      const task = this.tasks.get(taskId);
      if (!task || task.status !== "pending")
        continue;
      await this.executeTask(task);
    }
  }
  async executeTask(task) {
    try {
      task.status = "running";
      task.startTime = /* @__PURE__ */ new Date();
      this.logger.info(`Executing task ${task.id}: ${task.command} ${task.args.join(" ")}`);
      const logDir = path.join(this.config.logPath, task.id);
      if (this.config.enablePersistence) {
        await fs.mkdir(logDir, { recursive: true });
      }
      const process = (0, import_node_child_process.spawn)(task.command, task.args, {
        cwd: task.options?.cwd,
        env: { ...process.env, ...task.options?.env },
        detached: task.options?.detached,
        stdio: ["ignore", "pipe", "pipe"]
      });
      task.pid = process.pid;
      this.processes.set(task.id, process);
      let stdout = "";
      let stderr = "";
      process.stdout?.on("data", (data) => {
        stdout += data.toString();
        this.emit("task:output", { taskId: task.id, data: data.toString() });
      });
      process.stderr?.on("data", (data) => {
        stderr += data.toString();
        this.emit("task:error", { taskId: task.id, data: data.toString() });
      });
      process.on("close", async (code) => {
        task.endTime = /* @__PURE__ */ new Date();
        task.output = stdout;
        task.error = stderr;
        if (code === 0) {
          task.status = "completed";
          this.logger.info(`Task ${task.id} completed successfully`);
          this.emit("task:completed", task);
        } else {
          task.status = "failed";
          this.logger.error(`Task ${task.id} failed with code ${code}`);
          if (task.retryCount < (task.options?.retries || 0)) {
            task.retryCount++;
            task.status = "pending";
            this.queue.push(task.id);
            this.logger.info(
              `Retrying task ${task.id} (${task.retryCount}/${task.options?.retries})`
            );
            this.emit("task:retry", task);
          } else {
            this.emit("task:failed", task);
          }
        }
        this.processes.delete(task.id);
        if (this.config.enablePersistence) {
          await this.saveTaskOutput(task);
        }
      });
      if (task.options?.timeout) {
        setTimeout(() => {
          if (this.processes.has(task.id)) {
            this.logger.warn(`Task ${task.id} timed out after ${task.options?.timeout}ms`);
            process.kill("SIGTERM");
          }
        }, task.options.timeout);
      }
      if (task.options?.detached) {
        process.unref();
      }
      this.emit("task:started", task);
      if (this.config.enablePersistence) {
        await this.saveTaskState(task);
      }
    } catch (error) {
      task.status = "failed";
      task.error = String(error);
      task.endTime = /* @__PURE__ */ new Date();
      this.logger.error(`Failed to execute task ${task.id}:`, error);
      this.emit("task:failed", task);
      if (this.config.enablePersistence) {
        await this.saveTaskState(task);
      }
    }
  }
  checkRunningTasks() {
    const now = Date.now();
    for (const [taskId, task] of this.tasks) {
      if (task.status !== "running" || !task.startTime)
        continue;
      const runtime = now - task.startTime.getTime();
      const timeout = task.options?.timeout || this.config.defaultTimeout;
      if (runtime > timeout) {
        const process = this.processes.get(taskId);
        if (process) {
          this.logger.warn(`Killing timed out task ${taskId}`);
          process.kill("SIGTERM");
          setTimeout(() => {
            if (this.processes.has(taskId)) {
              process.kill("SIGKILL");
            }
          }, 5e3);
        }
      }
    }
  }
  cleanupCompletedTasks() {
    const cutoffTime = Date.now() - 36e5;
    for (const [taskId, task] of this.tasks) {
      if (task.status === "completed" || task.status === "failed") {
        if (task.endTime && task.endTime.getTime() < cutoffTime) {
          this.tasks.delete(taskId);
          this.logger.debug(`Cleaned up old task: ${taskId}`);
        }
      }
    }
  }
  async saveTaskState(task) {
    if (!this.config.enablePersistence)
      return;
    try {
      const taskFile = path.join(this.config.logPath, task.id, "task.json");
      await fs.writeFile(taskFile, JSON.stringify(task, null, 2));
    } catch (error) {
      this.logger.error(`Failed to save task state for ${task.id}:`, error);
    }
  }
  async saveTaskOutput(task) {
    if (!this.config.enablePersistence)
      return;
    try {
      const logDir = path.join(this.config.logPath, task.id);
      if (task.output) {
        await fs.writeFile(path.join(logDir, "stdout.log"), task.output);
      }
      if (task.error) {
        await fs.writeFile(path.join(logDir, "stderr.log"), task.error);
      }
      await this.saveTaskState(task);
    } catch (error) {
      this.logger.error(`Failed to save task output for ${task.id}:`, error);
    }
  }
  // Public API methods
  getTask(taskId) {
    return this.tasks.get(taskId);
  }
  getTasks(status) {
    const tasks = Array.from(this.tasks.values());
    return status ? tasks.filter((t) => t.status === status) : tasks;
  }
  async waitForTask(taskId, timeout) {
    return new Promise((resolve, reject) => {
      const task = this.tasks.get(taskId);
      if (!task) {
        reject(new Error("Task not found"));
        return;
      }
      if (task.status === "completed" || task.status === "failed") {
        resolve(task);
        return;
      }
      const timeoutHandle = timeout ? setTimeout(() => {
        reject(new Error("Wait timeout"));
      }, timeout) : void 0;
      const checkTask = /* @__PURE__ */ __name(() => {
        const currentTask = this.tasks.get(taskId);
        if (!currentTask) {
          if (timeoutHandle)
            clearTimeout(timeoutHandle);
          reject(new Error("Task disappeared"));
          return;
        }
        if (currentTask.status === "completed" || currentTask.status === "failed") {
          if (timeoutHandle)
            clearTimeout(timeoutHandle);
          resolve(currentTask);
        } else {
          setTimeout(checkTask, 100);
        }
      }, "checkTask");
      checkTask();
    });
  }
  async killTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error("Task not found");
    }
    const process = this.processes.get(taskId);
    if (process) {
      this.logger.info(`Killing task ${taskId}`);
      process.kill("SIGTERM");
      setTimeout(() => {
        if (this.processes.has(taskId)) {
          process.kill("SIGKILL");
        }
      }, 5e3);
    }
    task.status = "failed";
    task.error = "Task killed by user";
    task.endTime = /* @__PURE__ */ new Date();
    this.emit("task:killed", task);
  }
  getStatus() {
    const tasks = Array.from(this.tasks.values());
    return {
      running: tasks.filter((t) => t.status === "running").length,
      pending: tasks.filter((t) => t.status === "pending").length,
      completed: tasks.filter((t) => t.status === "completed").length,
      failed: tasks.filter((t) => t.status === "failed").length,
      queueLength: this.queue.length
    };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BackgroundExecutor
});
//# sourceMappingURL=background-executor.js.map
