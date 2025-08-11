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
var metrics_exports = {};
__export(metrics_exports, {
  CoordinationMetricsCollector: () => CoordinationMetricsCollector
});
module.exports = __toCommonJS(metrics_exports);
var import_types = require("../utils/types.js");
class CoordinationMetricsCollector {
  constructor(logger, eventBus, collectionIntervalMs = 3e4) {
    this.logger = logger;
    this.eventBus = eventBus;
    this.collectionIntervalMs = collectionIntervalMs;
    this.setupEventHandlers();
  }
  static {
    __name(this, "CoordinationMetricsCollector");
  }
  samples = [];
  taskStartTimes = /* @__PURE__ */ new Map();
  messageStartTimes = /* @__PURE__ */ new Map();
  lockStartTimes = /* @__PURE__ */ new Map();
  collectionInterval;
  // Counters
  counters = {
    totalTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    cancelledTasks: 0,
    messagesSent: 0,
    messagesReceived: 0,
    conflictsDetected: 0,
    conflictsResolved: 0,
    workStealingEvents: 0,
    circuitBreakerTrips: 0,
    deadlockCount: 0,
    errors: 0
  };
  // Gauges
  gauges = {
    activeTasks: 0,
    activeAgents: 0,
    idleAgents: 0,
    busyAgents: 0,
    lockedResources: 0,
    freeResources: 0,
    lockContention: 0
  };
  // Histograms (for calculating averages)
  histograms = {
    taskDurations: [],
    messageDurations: [],
    lockDurations: [],
    coordinationLatencies: [],
    schedulingLatencies: []
  };
  /**
   * Start metrics collection
   */
  start() {
    this.logger.info("Starting coordination metrics collection");
    this.collectionInterval = setInterval(() => {
      this.collectMetrics();
    }, this.collectionIntervalMs);
  }
  /**
   * Stop metrics collection
   */
  stop() {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      delete this.collectionInterval;
    }
    this.logger.info("Stopped coordination metrics collection");
  }
  /**
   * Record a metric sample
   */
  recordMetric(metric, value, tags) {
    const sample = {
      timestamp: /* @__PURE__ */ new Date(),
      metric,
      value
    };
    if (tags !== void 0) {
      sample.tags = tags;
    }
    this.samples.push(sample);
    if (this.samples.length > 1e4) {
      this.samples = this.samples.slice(-5e3);
    }
  }
  /**
   * Get current metrics snapshot
   */
  getCurrentMetrics() {
    const now = /* @__PURE__ */ new Date();
    const minuteAgo = new Date(now.getTime() - 6e4);
    const recentSamples = this.samples.filter((s) => s.timestamp >= minuteAgo);
    const taskCompletions = recentSamples.filter((s) => s.metric === "task.completed").length;
    const errorCount = recentSamples.filter((s) => s.metric === "error").length;
    return {
      timestamp: now,
      taskMetrics: {
        totalTasks: this.counters.totalTasks,
        activeTasks: this.gauges.activeTasks,
        completedTasks: this.counters.completedTasks,
        failedTasks: this.counters.failedTasks,
        cancelledTasks: this.counters.cancelledTasks,
        avgTaskDuration: this.average(this.histograms.taskDurations),
        taskThroughput: taskCompletions,
        tasksByPriority: this.getTasksByPriority(),
        tasksByType: this.getTasksByType()
      },
      agentMetrics: {
        totalAgents: this.gauges.activeAgents + this.gauges.idleAgents,
        activeAgents: this.gauges.activeAgents,
        idleAgents: this.gauges.idleAgents,
        busyAgents: this.gauges.busyAgents,
        agentUtilization: this.calculateAgentUtilization(),
        avgTasksPerAgent: this.calculateAvgTasksPerAgent(),
        agentsByType: this.getAgentsByType()
      },
      resourceMetrics: {
        totalResources: this.gauges.lockedResources + this.gauges.freeResources,
        lockedResources: this.gauges.lockedResources,
        freeResources: this.gauges.freeResources,
        resourceUtilization: this.calculateResourceUtilization(),
        avgLockDuration: this.average(this.histograms.lockDurations),
        lockContention: this.gauges.lockContention,
        deadlockCount: this.counters.deadlockCount
      },
      coordinationMetrics: {
        messagesSent: this.counters.messagesSent,
        messagesReceived: this.counters.messagesReceived,
        messageLatency: this.average(this.histograms.messageDurations),
        conflictsDetected: this.counters.conflictsDetected,
        conflictsResolved: this.counters.conflictsResolved,
        workStealingEvents: this.counters.workStealingEvents,
        circuitBreakerTrips: this.counters.circuitBreakerTrips
      },
      performanceMetrics: {
        coordinationLatency: this.average(this.histograms.coordinationLatencies),
        schedulingLatency: this.average(this.histograms.schedulingLatencies),
        memoryUsage: this.getMemoryUsage(),
        cpuUsage: this.getCpuUsage(),
        errorRate: errorCount
      }
    };
  }
  /**
   * Get metric history for a specific metric
   */
  getMetricHistory(metric, since) {
    const cutoff = since || new Date(Date.now() - 36e5);
    return this.samples.filter((s) => s.metric === metric && s.timestamp >= cutoff);
  }
  /**
   * Get top metrics by value
   */
  getTopMetrics(limit = 10) {
    const recent = this.samples.filter(
      (s) => s.timestamp >= new Date(Date.now() - 3e5)
      // 5 minutes
    );
    const byMetric = /* @__PURE__ */ new Map();
    const timestamps = /* @__PURE__ */ new Map();
    for (const sample of recent) {
      byMetric.set(sample.metric, (byMetric.get(sample.metric) || 0) + sample.value);
      timestamps.set(sample.metric, sample.timestamp);
    }
    return Array.from(byMetric.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([metric, value]) => ({
      metric,
      value,
      timestamp: timestamps.get(metric)
    }));
  }
  /**
   * Set up event handlers to collect metrics
   */
  setupEventHandlers() {
    this.eventBus.on(import_types.SystemEvents.TASK_CREATED, () => {
      this.counters.totalTasks++;
      this.recordMetric("task.created", 1);
    });
    this.eventBus.on(import_types.SystemEvents.TASK_STARTED, (data) => {
      this.taskStartTimes.set(data.taskId, /* @__PURE__ */ new Date());
      this.gauges.activeTasks++;
      this.recordMetric("task.started", 1);
    });
    this.eventBus.on(import_types.SystemEvents.TASK_COMPLETED, (data) => {
      this.counters.completedTasks++;
      this.gauges.activeTasks = Math.max(0, this.gauges.activeTasks - 1);
      const startTime = this.taskStartTimes.get(data.taskId);
      if (startTime) {
        const duration = (/* @__PURE__ */ new Date()).getTime() - startTime.getTime();
        this.histograms.taskDurations.push(duration);
        this.taskStartTimes.delete(data.taskId);
      }
      this.recordMetric("task.completed", 1);
    });
    this.eventBus.on(import_types.SystemEvents.TASK_FAILED, (data) => {
      this.counters.failedTasks++;
      this.gauges.activeTasks = Math.max(0, this.gauges.activeTasks - 1);
      this.taskStartTimes.delete(data.taskId);
      this.recordMetric("task.failed", 1);
    });
    this.eventBus.on(import_types.SystemEvents.TASK_CANCELLED, (data) => {
      this.counters.cancelledTasks++;
      this.gauges.activeTasks = Math.max(0, this.gauges.activeTasks - 1);
      this.taskStartTimes.delete(data.taskId);
      this.recordMetric("task.cancelled", 1);
    });
    this.eventBus.on(import_types.SystemEvents.AGENT_SPAWNED, () => {
      this.gauges.activeAgents++;
      this.recordMetric("agent.spawned", 1);
    });
    this.eventBus.on(import_types.SystemEvents.AGENT_TERMINATED, () => {
      this.gauges.activeAgents = Math.max(0, this.gauges.activeAgents - 1);
      this.recordMetric("agent.terminated", 1);
    });
    this.eventBus.on(import_types.SystemEvents.AGENT_IDLE, () => {
      this.gauges.idleAgents++;
      this.gauges.busyAgents = Math.max(0, this.gauges.busyAgents - 1);
      this.recordMetric("agent.idle", 1);
    });
    this.eventBus.on(import_types.SystemEvents.AGENT_ACTIVE, () => {
      this.gauges.busyAgents++;
      this.gauges.idleAgents = Math.max(0, this.gauges.idleAgents - 1);
      this.recordMetric("agent.active", 1);
    });
    this.eventBus.on(import_types.SystemEvents.RESOURCE_ACQUIRED, (data) => {
      this.lockStartTimes.set(data.resourceId, /* @__PURE__ */ new Date());
      this.gauges.lockedResources++;
      this.gauges.freeResources = Math.max(0, this.gauges.freeResources - 1);
      this.recordMetric("resource.acquired", 1);
    });
    this.eventBus.on(import_types.SystemEvents.RESOURCE_RELEASED, (data) => {
      this.gauges.freeResources++;
      this.gauges.lockedResources = Math.max(0, this.gauges.lockedResources - 1);
      const startTime = this.lockStartTimes.get(data.resourceId);
      if (startTime) {
        const duration = (/* @__PURE__ */ new Date()).getTime() - startTime.getTime();
        this.histograms.lockDurations.push(duration);
        this.lockStartTimes.delete(data.resourceId);
      }
      this.recordMetric("resource.released", 1);
    });
    this.eventBus.on(import_types.SystemEvents.DEADLOCK_DETECTED, () => {
      this.counters.deadlockCount++;
      this.recordMetric("deadlock.detected", 1);
    });
    this.eventBus.on(import_types.SystemEvents.MESSAGE_SENT, (data) => {
      this.counters.messagesSent++;
      this.messageStartTimes.set(data.message.id, /* @__PURE__ */ new Date());
      this.recordMetric("message.sent", 1);
    });
    this.eventBus.on(import_types.SystemEvents.MESSAGE_RECEIVED, (data) => {
      this.counters.messagesReceived++;
      const startTime = this.messageStartTimes.get(data.message.id);
      if (startTime) {
        const duration = (/* @__PURE__ */ new Date()).getTime() - startTime.getTime();
        this.histograms.messageDurations.push(duration);
        this.messageStartTimes.delete(data.message.id);
      }
      this.recordMetric("message.received", 1);
    });
    this.eventBus.on("conflict:resource", () => {
      this.counters.conflictsDetected++;
      this.recordMetric("conflict.detected", 1);
    });
    this.eventBus.on("conflict:resolved", () => {
      this.counters.conflictsResolved++;
      this.recordMetric("conflict.resolved", 1);
    });
    this.eventBus.on("workstealing:request", () => {
      this.counters.workStealingEvents++;
      this.recordMetric("workstealing.event", 1);
    });
    this.eventBus.on("circuitbreaker:state-change", (data) => {
      if (data.to === "open") {
        this.counters.circuitBreakerTrips++;
        this.recordMetric("circuitbreaker.trip", 1);
      }
    });
    this.eventBus.on(import_types.SystemEvents.SYSTEM_ERROR, () => {
      this.counters.errors++;
      this.recordMetric("error", 1);
    });
  }
  /**
   * Collect comprehensive metrics
   */
  collectMetrics() {
    const metrics = this.getCurrentMetrics();
    this.eventBus.emit("metrics:coordination", metrics);
    this.logger.debug("Coordination metrics collected", {
      activeTasks: metrics.taskMetrics.activeTasks,
      activeAgents: metrics.agentMetrics.activeAgents,
      lockedResources: metrics.resourceMetrics.lockedResources,
      taskThroughput: metrics.taskMetrics.taskThroughput
    });
  }
  /**
   * Calculate average from array of numbers
   */
  average(values) {
    if (values.length === 0)
      return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }
  /**
   * Get tasks grouped by priority
   */
  getTasksByPriority() {
    const priorities = ["low", "medium", "high", "critical"];
    const result = {};
    for (const priority of priorities) {
      result[priority] = this.samples.filter(
        (s) => s.metric === "task.created" && s.tags?.priority === priority
      ).length;
    }
    return result;
  }
  /**
   * Get tasks grouped by type
   */
  getTasksByType() {
    const types = /* @__PURE__ */ new Set();
    for (const sample of this.samples) {
      if (sample.metric === "task.created" && sample.tags?.type) {
        types.add(sample.tags.type);
      }
    }
    const result = {};
    for (const type of types) {
      result[type] = this.samples.filter(
        (s) => s.metric === "task.created" && s.tags?.type === type
      ).length;
    }
    return result;
  }
  /**
   * Get agents grouped by type
   */
  getAgentsByType() {
    const types = /* @__PURE__ */ new Set();
    for (const sample of this.samples) {
      if (sample.metric === "agent.spawned" && sample.tags?.type) {
        types.add(sample.tags.type);
      }
    }
    const result = {};
    for (const type of types) {
      result[type] = this.samples.filter(
        (s) => s.metric === "agent.spawned" && s.tags?.type === type
      ).length;
    }
    return result;
  }
  /**
   * Calculate agent utilization percentage
   */
  calculateAgentUtilization() {
    const totalAgents = this.gauges.activeAgents + this.gauges.idleAgents;
    if (totalAgents === 0)
      return 0;
    return this.gauges.busyAgents / totalAgents * 100;
  }
  /**
   * Calculate average tasks per agent
   */
  calculateAvgTasksPerAgent() {
    const totalAgents = this.gauges.activeAgents + this.gauges.idleAgents;
    if (totalAgents === 0)
      return 0;
    return this.gauges.activeTasks / totalAgents;
  }
  /**
   * Calculate resource utilization percentage
   */
  calculateResourceUtilization() {
    const totalResources = this.gauges.lockedResources + this.gauges.freeResources;
    if (totalResources === 0)
      return 0;
    return this.gauges.lockedResources / totalResources * 100;
  }
  /**
   * Get current memory usage in MB
   */
  getMemoryUsage() {
    if (typeof process !== "undefined" && process.memoryUsage) {
      return process.memoryUsage().heapUsed / 1024 / 1024;
    }
    return 0;
  }
  /**
   * Get current CPU usage percentage
   */
  getCpuUsage() {
    if (typeof process !== "undefined" && process.cpuUsage) {
      const usage = process.cpuUsage();
      return (usage.user + usage.system) / 1e6;
    }
    return 0;
  }
  /**
   * Clear all metrics data
   */
  clearMetrics() {
    this.samples = [];
    this.taskStartTimes.clear();
    this.messageStartTimes.clear();
    this.lockStartTimes.clear();
    for (const key in this.counters) {
      this.counters[key] = 0;
    }
    for (const key in this.gauges) {
      this.gauges[key] = 0;
    }
    for (const key in this.histograms) {
      this.histograms[key] = [];
    }
    this.logger.info("Coordination metrics cleared");
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CoordinationMetricsCollector
});
//# sourceMappingURL=metrics.js.map
