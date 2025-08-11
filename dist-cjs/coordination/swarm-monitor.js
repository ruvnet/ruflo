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
var swarm_monitor_exports = {};
__export(swarm_monitor_exports, {
  SwarmMonitor: () => SwarmMonitor
});
module.exports = __toCommonJS(swarm_monitor_exports);
var import_node_events = require("node:events");
var os = __toESM(require("node:os"), 1);
var fs = __toESM(require("node:fs/promises"), 1);
var path = __toESM(require("node:path"), 1);
var import_logger = require("../core/logger.js");
class SwarmMonitor extends import_node_events.EventEmitter {
  static {
    __name(this, "SwarmMonitor");
  }
  logger;
  config;
  agentMetrics = /* @__PURE__ */ new Map();
  systemMetrics = [];
  alerts = [];
  monitoringInterval;
  startTime;
  taskStartTimes = /* @__PURE__ */ new Map();
  taskCompletionTimes = [];
  lastThroughputCheck;
  tasksInLastMinute = 0;
  constructor(config) {
    super();
    this.logger = new import_logger.Logger("SwarmMonitor");
    this.config = {
      updateInterval: 1e3,
      // 1 second
      metricsRetention: 24,
      // 24 hours
      cpuThreshold: 80,
      // 80%
      memoryThreshold: 85,
      // 85%
      stallTimeout: 3e5,
      // 5 minutes
      errorRateThreshold: 10,
      // 10%
      throughputThreshold: 1,
      // 1 task per minute minimum
      enableAlerts: true,
      enableHistory: true,
      historyPath: "./monitoring/history",
      ...config
    };
    this.startTime = Date.now();
    this.lastThroughputCheck = Date.now();
  }
  async start() {
    this.logger.info("Starting swarm monitoring...");
    if (this.config.enableHistory && this.config.historyPath) {
      await fs.mkdir(this.config.historyPath, { recursive: true });
    }
    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
    }, this.config.updateInterval);
    await this.collectMetrics();
  }
  stop() {
    this.logger.info("Stopping swarm monitoring...");
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = void 0;
    }
  }
  // Agent registration and tracking
  registerAgent(agentId, name) {
    this.agentMetrics.set(agentId, {
      id: agentId,
      name,
      status: "idle",
      taskCount: 0,
      successCount: 0,
      failureCount: 0,
      averageTaskDuration: 0,
      lastActivity: Date.now(),
      errorRate: 0
    });
    this.logger.debug(`Registered agent: ${name} (${agentId})`);
  }
  unregisterAgent(agentId) {
    const metrics = this.agentMetrics.get(agentId);
    if (metrics) {
      this.logger.debug(`Unregistered agent: ${metrics.name} (${agentId})`);
      this.agentMetrics.delete(agentId);
    }
  }
  // Task tracking
  taskStarted(agentId, taskId, taskDescription) {
    const metrics = this.agentMetrics.get(agentId);
    if (metrics) {
      metrics.status = "running";
      metrics.currentTask = taskDescription || taskId;
      metrics.startTime = Date.now();
      metrics.lastActivity = Date.now();
      metrics.taskCount++;
      this.taskStartTimes.set(taskId, Date.now());
      this.emit("task:started", { agentId, taskId, taskDescription });
    }
  }
  taskCompleted(agentId, taskId, outputSize) {
    const metrics = this.agentMetrics.get(agentId);
    const startTime = this.taskStartTimes.get(taskId);
    if (metrics && startTime) {
      const duration = Date.now() - startTime;
      metrics.status = "completed";
      metrics.endTime = Date.now();
      metrics.duration = duration;
      metrics.lastActivity = Date.now();
      metrics.successCount++;
      metrics.outputSize = outputSize;
      const totalDuration = metrics.averageTaskDuration * (metrics.successCount - 1) + duration;
      metrics.averageTaskDuration = totalDuration / metrics.successCount;
      metrics.errorRate = metrics.failureCount / metrics.taskCount * 100;
      this.taskCompletionTimes.push(Date.now());
      this.tasksInLastMinute++;
      this.taskStartTimes.delete(taskId);
      this.emit("task:completed", { agentId, taskId, duration, outputSize });
    }
  }
  taskFailed(agentId, taskId, error) {
    const metrics = this.agentMetrics.get(agentId);
    const startTime = this.taskStartTimes.get(taskId);
    if (metrics) {
      const duration = startTime ? Date.now() - startTime : 0;
      metrics.status = "failed";
      metrics.endTime = Date.now();
      metrics.duration = duration;
      metrics.lastActivity = Date.now();
      metrics.failureCount++;
      metrics.errorRate = metrics.failureCount / metrics.taskCount * 100;
      this.taskStartTimes.delete(taskId);
      this.emit("task:failed", { agentId, taskId, error, duration });
      if (metrics.errorRate > this.config.errorRateThreshold) {
        this.createAlert(
          "error_rate",
          "critical",
          `Agent ${metrics.name} has high error rate: ${metrics.errorRate.toFixed(1)}%`
        );
      }
    }
  }
  // Metrics collection
  async collectMetrics() {
    try {
      const cpuUsage = this.getCPUUsage();
      const memInfo = this.getMemoryInfo();
      const loadAvg = os.loadavg();
      const now = Date.now();
      const minuteAgo = now - 6e4;
      this.taskCompletionTimes = this.taskCompletionTimes.filter((time) => time > minuteAgo);
      const throughput = this.taskCompletionTimes.length;
      let totalTasks = 0;
      let completedTasks = 0;
      let failedTasks = 0;
      let activeAgents = 0;
      let totalDuration = 0;
      let durationCount = 0;
      for (const [agentId, metrics] of this.agentMetrics) {
        if (metrics.status === "running") {
          activeAgents++;
          const stallTime = now - metrics.lastActivity;
          if (stallTime > this.config.stallTimeout) {
            metrics.status = "stalled";
            this.createAlert(
              "stalled_agent",
              "warning",
              `Agent ${metrics.name} appears to be stalled (${Math.round(stallTime / 1e3)}s inactive)`
            );
          }
        }
        totalTasks += metrics.taskCount;
        completedTasks += metrics.successCount;
        failedTasks += metrics.failureCount;
        if (metrics.averageTaskDuration > 0) {
          totalDuration += metrics.averageTaskDuration * metrics.successCount;
          durationCount += metrics.successCount;
        }
      }
      const avgDuration = durationCount > 0 ? totalDuration / durationCount : 0;
      const pendingTasks = totalTasks - completedTasks - failedTasks;
      const systemMetrics = {
        timestamp: now,
        cpuUsage,
        memoryUsage: memInfo.usagePercent,
        totalMemory: memInfo.total,
        freeMemory: memInfo.free,
        loadAverage: loadAvg,
        activeAgents,
        totalTasks,
        completedTasks,
        failedTasks,
        pendingTasks,
        averageTaskDuration: avgDuration,
        throughput
      };
      this.systemMetrics.push(systemMetrics);
      if (this.config.enableAlerts) {
        this.checkThresholds(systemMetrics);
      }
      this.cleanOldMetrics();
      if (this.config.enableHistory) {
        await this.saveHistory(systemMetrics);
      }
      this.emit("metrics:updated", {
        system: systemMetrics,
        agents: Array.from(this.agentMetrics.values())
      });
    } catch (error) {
      this.logger.error("Error collecting metrics:", error);
    }
  }
  getCPUUsage() {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    cpus.forEach((cpu) => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });
    return 100 - Math.floor(totalIdle / totalTick * 100);
  }
  getMemoryInfo() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    const usagePercent = used / total * 100;
    return { total, free, used, usagePercent };
  }
  checkThresholds(metrics) {
    if (metrics.cpuUsage > this.config.cpuThreshold) {
      this.createAlert("high_cpu", "warning", `High CPU usage detected: ${metrics.cpuUsage}%`);
    }
    if (metrics.memoryUsage > this.config.memoryThreshold) {
      this.createAlert(
        "high_memory",
        "warning",
        `High memory usage detected: ${metrics.memoryUsage.toFixed(1)}%`
      );
    }
    if (metrics.activeAgents > 0 && metrics.throughput < this.config.throughputThreshold) {
      this.createAlert(
        "low_throughput",
        "warning",
        `Low throughput detected: ${metrics.throughput} tasks/min`
      );
    }
  }
  createAlert(type, level, message, details) {
    const alert = {
      id: `${type}_${Date.now()}`,
      timestamp: Date.now(),
      level,
      type,
      message,
      details
    };
    this.alerts.push(alert);
    this.emit("alert", alert);
    this.logger[level](message);
  }
  cleanOldMetrics() {
    const retentionTime = this.config.metricsRetention * 60 * 60 * 1e3;
    const cutoff = Date.now() - retentionTime;
    this.systemMetrics = this.systemMetrics.filter((m) => m.timestamp > cutoff);
    this.alerts = this.alerts.filter((a) => a.timestamp > cutoff);
  }
  async saveHistory(metrics) {
    if (!this.config.historyPath)
      return;
    try {
      const date = /* @__PURE__ */ new Date();
      const filename = `metrics_${date.toISOString().split("T")[0]}.jsonl`;
      const filepath = path.join(this.config.historyPath, filename);
      const line = JSON.stringify({
        ...metrics,
        agents: Array.from(this.agentMetrics.values())
      }) + "\n";
      await fs.appendFile(filepath, line);
    } catch (error) {
      this.logger.error("Error saving history:", error);
    }
  }
  // Getters for current state
  getSystemMetrics() {
    return this.systemMetrics[this.systemMetrics.length - 1];
  }
  getAgentMetrics(agentId) {
    if (agentId) {
      return this.agentMetrics.get(agentId);
    }
    return Array.from(this.agentMetrics.values());
  }
  getAlerts(since) {
    if (since) {
      return this.alerts.filter((a) => a.timestamp > since);
    }
    return this.alerts;
  }
  getHistoricalMetrics(hours = 1) {
    const since = Date.now() - hours * 60 * 60 * 1e3;
    return this.systemMetrics.filter((m) => m.timestamp > since);
  }
  // Summary statistics
  getSummary() {
    const current = this.getSystemMetrics();
    const uptime = Date.now() - this.startTime;
    const totalAgents = this.agentMetrics.size;
    const activeAgents = current?.activeAgents || 0;
    const totalTasks = current?.totalTasks || 0;
    const completedTasks = current?.completedTasks || 0;
    const failedTasks = current?.failedTasks || 0;
    const successRate = totalTasks > 0 ? completedTasks / totalTasks * 100 : 0;
    const averageDuration = current?.averageTaskDuration || 0;
    const currentThroughput = current?.throughput || 0;
    const alerts = this.alerts.filter((a) => a.timestamp > Date.now() - 36e5).length;
    return {
      uptime,
      totalAgents,
      activeAgents,
      totalTasks,
      completedTasks,
      failedTasks,
      successRate,
      averageDuration,
      currentThroughput,
      alerts
    };
  }
  // Export monitoring data
  async exportMetrics(filepath) {
    const data = {
      summary: this.getSummary(),
      systemMetrics: this.systemMetrics,
      agentMetrics: Array.from(this.agentMetrics.values()),
      alerts: this.alerts,
      exported: (/* @__PURE__ */ new Date()).toISOString()
    };
    await fs.writeFile(filepath, JSON.stringify(data, null, 2));
    this.logger.info(`Exported metrics to ${filepath}`);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SwarmMonitor
});
//# sourceMappingURL=swarm-monitor.js.map
