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
var system_monitor_exports = {};
__export(system_monitor_exports, {
  SystemMonitor: () => SystemMonitor
});
module.exports = __toCommonJS(system_monitor_exports);
var import_chalk = __toESM(require("chalk"), 1);
var import_types = require("../../../utils/types.js");
var import_event_bus = require("../../../core/event-bus.js");
class SystemMonitor {
  static {
    __name(this, "SystemMonitor");
  }
  processManager;
  events = [];
  maxEvents = 100;
  metricsInterval;
  constructor(processManager) {
    this.processManager = processManager;
    this.setupEventListeners();
  }
  setupEventListeners() {
    import_event_bus.eventBus.on(import_types.SystemEvents.AGENT_SPAWNED, (data) => {
      this.addEvent({
        type: "agent_spawned",
        timestamp: Date.now(),
        data,
        level: "info"
      });
    });
    import_event_bus.eventBus.on(import_types.SystemEvents.AGENT_TERMINATED, (data) => {
      this.addEvent({
        type: "agent_terminated",
        timestamp: Date.now(),
        data,
        level: "warning"
      });
    });
    import_event_bus.eventBus.on(import_types.SystemEvents.TASK_ASSIGNED, (data) => {
      this.addEvent({
        type: "task_assigned",
        timestamp: Date.now(),
        data,
        level: "info"
      });
    });
    import_event_bus.eventBus.on(import_types.SystemEvents.TASK_COMPLETED, (data) => {
      this.addEvent({
        type: "task_completed",
        timestamp: Date.now(),
        data,
        level: "success"
      });
    });
    import_event_bus.eventBus.on(import_types.SystemEvents.TASK_FAILED, (data) => {
      this.addEvent({
        type: "task_failed",
        timestamp: Date.now(),
        data,
        level: "error"
      });
    });
    import_event_bus.eventBus.on(import_types.SystemEvents.SYSTEM_ERROR, (data) => {
      this.addEvent({
        type: "system_error",
        timestamp: Date.now(),
        data,
        level: "error"
      });
    });
    this.processManager.on("processStarted", ({ processId, process }) => {
      this.addEvent({
        type: "process_started",
        timestamp: Date.now(),
        data: { processId, processName: process.name },
        level: "success"
      });
    });
    this.processManager.on("processStopped", ({ processId }) => {
      this.addEvent({
        type: "process_stopped",
        timestamp: Date.now(),
        data: { processId },
        level: "warning"
      });
    });
    this.processManager.on("processError", ({ processId, error }) => {
      this.addEvent({
        type: "process_error",
        timestamp: Date.now(),
        data: { processId, error: error instanceof Error ? error.message : String(error) },
        level: "error"
      });
    });
  }
  addEvent(event) {
    this.events.unshift(event);
    if (this.events.length > this.maxEvents) {
      this.events.pop();
    }
  }
  start() {
    this.metricsInterval = setInterval(() => {
      this.collectMetrics();
    }, 5e3);
  }
  stop() {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
  }
  collectMetrics() {
    const processes = this.processManager.getAllProcesses();
    for (const process of processes) {
      if (process.status === "running") {
        process.metrics = {
          ...process.metrics,
          cpu: Math.random() * 50,
          memory: Math.random() * 200,
          uptime: process.startTime ? Date.now() - process.startTime : 0
        };
      }
    }
  }
  getRecentEvents(count = 10) {
    return this.events.slice(0, count);
  }
  printEventLog(count = 20) {
    console.log(import_chalk.default.cyan.bold("\u{1F4CA} Recent System Events"));
    console.log(import_chalk.default.gray("\u2500".repeat(80)));
    const events = this.getRecentEvents(count);
    for (const event of events) {
      const timestamp = new Date(event.timestamp).toLocaleTimeString();
      const icon = this.getEventIcon(event.type);
      const color = this.getEventColor(event.level);
      console.log(import_chalk.default.gray(timestamp), icon, color(this.formatEventMessage(event)));
    }
  }
  getEventIcon(type) {
    const icons = {
      agent_spawned: "\u{1F916}",
      agent_terminated: "\u{1F51A}",
      task_assigned: "\u{1F4CC}",
      task_completed: "\u2705",
      task_failed: "\u274C",
      system_error: "\u26A0\uFE0F",
      process_started: "\u25B6\uFE0F",
      process_stopped: "\u23F9\uFE0F",
      process_error: "\u{1F6A8}"
    };
    return icons[type] || "\u2022";
  }
  getEventColor(level) {
    switch (level) {
      case "success":
        return import_chalk.default.green;
      case "info":
        return import_chalk.default.blue;
      case "warning":
        return import_chalk.default.yellow;
      case "error":
        return import_chalk.default.red;
      default:
        return import_chalk.default.white;
    }
  }
  formatEventMessage(event) {
    switch (event.type) {
      case "agent_spawned":
        return `Agent spawned: ${event.data.agentId} (${event.data.profile?.type || "unknown"})`;
      case "agent_terminated":
        return `Agent terminated: ${event.data.agentId} - ${event.data.reason}`;
      case "task_assigned":
        return `Task ${event.data.taskId} assigned to ${event.data.agentId}`;
      case "task_completed":
        return `Task completed: ${event.data.taskId}`;
      case "task_failed":
        return `Task failed: ${event.data.taskId} - ${event.data.error?.message}`;
      case "system_error":
        return `System error in ${event.data.component}: ${event.data.error?.message}`;
      case "process_started":
        return `Process started: ${event.data.processName}`;
      case "process_stopped":
        return `Process stopped: ${event.data.processId}`;
      case "process_error":
        return `Process error: ${event.data.processId} - ${event.data.error}`;
      default:
        return JSON.stringify(event.data);
    }
  }
  printSystemHealth() {
    const stats = this.processManager.getSystemStats();
    const processes = this.processManager.getAllProcesses();
    console.log(import_chalk.default.cyan.bold("\u{1F3E5} System Health"));
    console.log(import_chalk.default.gray("\u2500".repeat(60)));
    const healthStatus = stats.errorProcesses === 0 ? import_chalk.default.green("\u25CF Healthy") : import_chalk.default.red(`\u25CF Unhealthy (${stats.errorProcesses} errors)`);
    console.log("Status:", healthStatus);
    console.log("Uptime:", this.formatUptime(stats.systemUptime));
    console.log();
    console.log(import_chalk.default.white.bold("Process Status:"));
    for (const process of processes) {
      const status = this.getProcessStatusIcon(process.status);
      const metrics = process.metrics;
      let line = `  ${status} ${process.name.padEnd(20)}`;
      if (metrics && process.status === "running") {
        line += import_chalk.default.gray(` CPU: ${metrics.cpu?.toFixed(1)}% `);
        line += import_chalk.default.gray(` MEM: ${metrics.memory?.toFixed(0)}MB`);
      }
      console.log(line);
    }
    console.log();
    console.log(import_chalk.default.white.bold("System Metrics:"));
    console.log(`  Active Processes: ${stats.runningProcesses}/${stats.totalProcesses}`);
    console.log(`  Recent Events: ${this.events.length}`);
    const recentErrors = this.events.filter((e) => e.level === "error").slice(0, 3);
    if (recentErrors.length > 0) {
      console.log();
      console.log(import_chalk.default.red.bold("Recent Errors:"));
      for (const error of recentErrors) {
        const time = new Date(error.timestamp).toLocaleTimeString();
        console.log(import_chalk.default.red(`  ${time} - ${this.formatEventMessage(error)}`));
      }
    }
  }
  getProcessStatusIcon(status) {
    switch (status) {
      case "running":
        return import_chalk.default.green("\u25CF");
      case "stopped":
        return import_chalk.default.gray("\u25CB");
      case "starting":
        return import_chalk.default.yellow("\u25D0");
      case "stopping":
        return import_chalk.default.yellow("\u25D1");
      case "error":
        return import_chalk.default.red("\u2717");
      default:
        return import_chalk.default.gray("?");
    }
  }
  formatUptime(ms) {
    const seconds = Math.floor(ms / 1e3);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SystemMonitor
});
//# sourceMappingURL=system-monitor.js.map
