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
var scheduler_exports = {};
__export(scheduler_exports, {
  TaskScheduler: () => TaskScheduler
});
module.exports = __toCommonJS(scheduler_exports);
var import_types = require("../utils/types.js");
var import_errors = require("../utils/errors.js");
class TaskScheduler {
  constructor(config, eventBus, logger) {
    this.config = config;
    this.eventBus = eventBus;
    this.logger = logger;
  }
  static {
    __name(this, "TaskScheduler");
  }
  tasks = /* @__PURE__ */ new Map();
  agentTasks = /* @__PURE__ */ new Map();
  // agentId -> taskIds
  taskDependencies = /* @__PURE__ */ new Map();
  // taskId -> dependent taskIds
  completedTasks = /* @__PURE__ */ new Set();
  async initialize() {
    this.logger.info("Initializing task scheduler");
    setInterval(() => this.cleanup(), 6e4);
  }
  async shutdown() {
    this.logger.info("Shutting down task scheduler");
    const taskIds = Array.from(this.tasks.keys());
    await Promise.all(taskIds.map((id) => this.cancelTask(id, "Scheduler shutdown")));
    this.tasks.clear();
    this.agentTasks.clear();
    this.taskDependencies.clear();
    this.completedTasks.clear();
  }
  async assignTask(task, agentId) {
    this.logger.info("Assigning task", { taskId: task.id, agentId });
    if (task.dependencies.length > 0) {
      const unmetDependencies = task.dependencies.filter(
        (depId) => !this.completedTasks.has(depId)
      );
      if (unmetDependencies.length > 0) {
        throw new import_errors.TaskDependencyError(task.id, unmetDependencies);
      }
    }
    const scheduledTask = {
      task: { ...task, status: "assigned", assignedAgent: agentId },
      agentId,
      attempts: 0
    };
    this.tasks.set(task.id, scheduledTask);
    if (!this.agentTasks.has(agentId)) {
      this.agentTasks.set(agentId, /* @__PURE__ */ new Set());
    }
    this.agentTasks.get(agentId).add(task.id);
    for (const depId of task.dependencies) {
      if (!this.taskDependencies.has(depId)) {
        this.taskDependencies.set(depId, /* @__PURE__ */ new Set());
      }
      this.taskDependencies.get(depId).add(task.id);
    }
    this.startTask(task.id);
  }
  async completeTask(taskId, result) {
    const scheduled = this.tasks.get(taskId);
    if (!scheduled) {
      throw new import_errors.TaskError(`Task not found: ${taskId}`);
    }
    this.logger.info("Task completed", { taskId, agentId: scheduled.agentId });
    scheduled.task.status = "completed";
    scheduled.task.output = result;
    scheduled.task.completedAt = /* @__PURE__ */ new Date();
    if (scheduled.timeout) {
      clearTimeout(scheduled.timeout);
    }
    this.tasks.delete(taskId);
    this.agentTasks.get(scheduled.agentId)?.delete(taskId);
    this.completedTasks.add(taskId);
    const dependents = this.taskDependencies.get(taskId);
    if (dependents) {
      for (const dependentId of dependents) {
        const dependent = this.tasks.get(dependentId);
        if (dependent && this.canStartTask(dependent.task)) {
          this.startTask(dependentId);
        }
      }
    }
  }
  async failTask(taskId, error) {
    const scheduled = this.tasks.get(taskId);
    if (!scheduled) {
      throw new import_errors.TaskError(`Task not found: ${taskId}`);
    }
    this.logger.error("Task failed", {
      taskId,
      agentId: scheduled.agentId,
      attempt: scheduled.attempts,
      error
    });
    if (scheduled.timeout) {
      clearTimeout(scheduled.timeout);
    }
    scheduled.attempts++;
    scheduled.lastAttempt = /* @__PURE__ */ new Date();
    if (scheduled.attempts < this.config.maxRetries) {
      this.logger.info("Retrying task", {
        taskId,
        attempt: scheduled.attempts,
        maxRetries: this.config.maxRetries
      });
      const retryDelay = this.config.retryDelay * Math.pow(2, scheduled.attempts - 1);
      setTimeout(() => {
        this.startTask(taskId);
      }, retryDelay);
    } else {
      scheduled.task.status = "failed";
      scheduled.task.error = error;
      scheduled.task.completedAt = /* @__PURE__ */ new Date();
      this.tasks.delete(taskId);
      this.agentTasks.get(scheduled.agentId)?.delete(taskId);
      await this.cancelDependentTasks(taskId, "Parent task failed");
    }
  }
  async cancelTask(taskId, reason) {
    const scheduled = this.tasks.get(taskId);
    if (!scheduled) {
      return;
    }
    this.logger.info("Cancelling task", { taskId, reason });
    if (scheduled.timeout) {
      clearTimeout(scheduled.timeout);
    }
    scheduled.task.status = "cancelled";
    scheduled.task.completedAt = /* @__PURE__ */ new Date();
    this.eventBus.emit(import_types.SystemEvents.TASK_CANCELLED, { taskId, reason });
    this.tasks.delete(taskId);
    this.agentTasks.get(scheduled.agentId)?.delete(taskId);
    await this.cancelDependentTasks(taskId, "Parent task cancelled");
  }
  async cancelAgentTasks(agentId) {
    const taskIds = this.agentTasks.get(agentId);
    if (!taskIds) {
      return;
    }
    this.logger.info("Cancelling all tasks for agent", {
      agentId,
      taskCount: taskIds.size
    });
    const promises = Array.from(taskIds).map(
      (taskId) => this.cancelTask(taskId, "Agent terminated")
    );
    await Promise.all(promises);
    this.agentTasks.delete(agentId);
  }
  async rescheduleAgentTasks(agentId) {
    const taskIds = this.agentTasks.get(agentId);
    if (!taskIds || taskIds.size === 0) {
      return;
    }
    this.logger.info("Rescheduling tasks for agent", {
      agentId,
      taskCount: taskIds.size
    });
    for (const taskId of taskIds) {
      const scheduled = this.tasks.get(taskId);
      if (scheduled && scheduled.task.status === "running") {
        scheduled.task.status = "queued";
        scheduled.attempts = 0;
        this.eventBus.emit(import_types.SystemEvents.TASK_CREATED, {
          task: scheduled.task
        });
      }
    }
  }
  getAgentTaskCount(agentId) {
    return this.agentTasks.get(agentId)?.size || 0;
  }
  async getHealthStatus() {
    const activeTasks = this.tasks.size;
    const completedTasks = this.completedTasks.size;
    const agentsWithTasks = this.agentTasks.size;
    const tasksByStatus = {
      pending: 0,
      queued: 0,
      assigned: 0,
      running: 0,
      completed: completedTasks,
      failed: 0,
      cancelled: 0
    };
    for (const scheduled of this.tasks.values()) {
      tasksByStatus[scheduled.task.status]++;
    }
    return {
      healthy: true,
      metrics: {
        activeTasks,
        completedTasks,
        agentsWithTasks,
        ...tasksByStatus
      }
    };
  }
  async getAgentTasks(agentId) {
    const taskIds = this.agentTasks.get(agentId);
    if (!taskIds) {
      return [];
    }
    const tasks = [];
    for (const taskId of taskIds) {
      const scheduled = this.tasks.get(taskId);
      if (scheduled) {
        tasks.push(scheduled.task);
      }
    }
    return tasks;
  }
  async performMaintenance() {
    this.logger.debug("Performing task scheduler maintenance");
    this.cleanup();
    const now = /* @__PURE__ */ new Date();
    for (const [taskId, scheduled] of this.tasks) {
      if (scheduled.task.status === "running" && scheduled.task.startedAt) {
        const runtime = now.getTime() - scheduled.task.startedAt.getTime();
        if (runtime > this.config.resourceTimeout * 2) {
          this.logger.warn("Found stuck task", {
            taskId,
            runtime,
            agentId: scheduled.agentId
          });
          await this.failTask(taskId, new import_errors.TaskTimeoutError(taskId, runtime));
        }
      }
    }
  }
  startTask(taskId) {
    const scheduled = this.tasks.get(taskId);
    if (!scheduled) {
      return;
    }
    scheduled.task.status = "running";
    scheduled.task.startedAt = /* @__PURE__ */ new Date();
    this.eventBus.emit(import_types.SystemEvents.TASK_STARTED, {
      taskId,
      agentId: scheduled.agentId
    });
    const timeoutMs = this.config.resourceTimeout;
    scheduled.timeout = setTimeout(() => {
      this.failTask(taskId, new import_errors.TaskTimeoutError(taskId, timeoutMs));
    }, timeoutMs);
  }
  canStartTask(task) {
    return task.dependencies.every((depId) => this.completedTasks.has(depId));
  }
  async cancelDependentTasks(taskId, reason) {
    const dependents = this.taskDependencies.get(taskId);
    if (!dependents) {
      return;
    }
    for (const dependentId of dependents) {
      await this.cancelTask(dependentId, reason);
    }
  }
  cleanup() {
    if (this.completedTasks.size > 1e3) {
      const toRemove = this.completedTasks.size - 1e3;
      const iterator = this.completedTasks.values();
      for (let i = 0; i < toRemove; i++) {
        const result = iterator.next();
        if (!result.done && result.value) {
          this.completedTasks.delete(result.value);
          this.taskDependencies.delete(result.value);
        }
      }
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TaskScheduler
});
//# sourceMappingURL=scheduler.js.map
