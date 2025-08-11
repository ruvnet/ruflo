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
var monitor_exports = {};
__export(monitor_exports, {
  monitorCommand: () => monitorCommand
});
module.exports = __toCommonJS(monitor_exports);
var import_commander = require("commander");
var import_node_fs = require("node:fs");
var import_fs = require("fs");
var import_chalk = __toESM(require("chalk"), 1);
var import_cli_table3 = __toESM(require("cli-table3"), 1);
var import_formatter = require("../formatter.js");
const monitorCommand = new import_commander.Command().description("Start live monitoring dashboard").option("-i, --interval <seconds>", "Update interval in seconds", "2").option("-c, --compact", "Compact view mode").option("--no-graphs", "Disable ASCII graphs").option("--focus <component:string>", "Focus on specific component").action(async (options) => {
  await startMonitorDashboard(options);
});
class Dashboard {
  constructor(options) {
    this.options = options;
    this.options.threshold = this.options.threshold || 80;
  }
  static {
    __name(this, "Dashboard");
  }
  data = [];
  maxDataPoints = 60;
  // 2 minutes at 2-second intervals
  running = true;
  alerts = [];
  startTime = Date.now();
  exportData = [];
  async start() {
    process.stdout.write("\x1B[?25l");
    console.clear();
    const cleanup = /* @__PURE__ */ __name(() => {
      this.running = false;
      process.stdout.write("\x1B[?25h");
      console.log("\n" + import_chalk.default.gray("Monitor stopped"));
      process.exit(0);
    }, "cleanup");
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
    await this.monitoringLoop();
  }
  async monitoringLoop() {
    while (this.running) {
      try {
        const data = await this.collectData();
        this.data.push(data);
        if (this.data.length > this.maxDataPoints) {
          this.data = this.data.slice(-this.maxDataPoints);
        }
        this.render();
        await new Promise((resolve) => setTimeout(resolve, this.options.interval * 1e3));
      } catch (error) {
        this.renderError(error);
        await new Promise((resolve) => setTimeout(resolve, this.options.interval * 1e3));
      }
    }
  }
  async collectData() {
    const timestamp = /* @__PURE__ */ new Date();
    const cpuUsage = 10 + Math.random() * 20;
    const memoryUsage = 200 + Math.random() * 100;
    return {
      timestamp,
      system: {
        cpu: cpuUsage,
        memory: memoryUsage,
        agents: 3 + Math.floor(Math.random() * 3),
        tasks: 5 + Math.floor(Math.random() * 10)
      },
      components: {
        orchestrator: { status: "healthy", load: Math.random() * 100 },
        terminal: { status: "healthy", load: Math.random() * 100 },
        memory: { status: "healthy", load: Math.random() * 100 },
        coordination: { status: "healthy", load: Math.random() * 100 },
        mcp: { status: "healthy", load: Math.random() * 100 }
      },
      agents: this.generateMockAgents(),
      tasks: this.generateMockTasks(),
      events: this.generateMockEvents()
    };
  }
  render() {
    console.clear();
    const latest = this.data[this.data.length - 1];
    if (!latest)
      return;
    this.renderHeader(latest);
    if (this.options.focus) {
      this.renderFocusedComponent(latest, this.options.focus);
    } else {
      this.renderSystemOverview(latest);
      this.renderComponentsStatus(latest);
      if (!this.options.compact) {
        this.renderAgentsAndTasks(latest);
        this.renderRecentEvents(latest);
        if (!this.options.noGraphs) {
          this.renderPerformanceGraphs();
        }
      }
    }
    this.renderFooter();
  }
  renderHeader(data) {
    const time = data.timestamp.toLocaleTimeString();
    console.log(import_chalk.default.cyan.bold("Claude-Flow Live Monitor") + import_chalk.default.gray(` - ${time}`));
    console.log("\u2550".repeat(80));
  }
  renderSystemOverview(data) {
    console.log(import_chalk.default.white.bold("System Overview"));
    console.log("\u2500".repeat(40));
    const cpuBar = (0, import_formatter.formatProgressBar)(data.system.cpu, 100, 20, "CPU");
    const memoryBar = (0, import_formatter.formatProgressBar)(data.system.memory, 1024, 20, "Memory");
    console.log(`${cpuBar} ${data.system.cpu.toFixed(1)}%`);
    console.log(`${memoryBar} ${data.system.memory.toFixed(0)}MB`);
    console.log(`${import_chalk.default.white("Agents:")} ${data.system.agents} active`);
    console.log(`${import_chalk.default.white("Tasks:")} ${data.system.tasks} in queue`);
    console.log();
  }
  renderComponentsStatus(data) {
    console.log(import_chalk.default.white.bold("Components"));
    console.log("\u2500".repeat(40));
    const tableData = [];
    for (const [name, component] of Object.entries(data.components)) {
      const statusIcon = (0, import_formatter.formatStatusIndicator)(component.status);
      const loadBar = this.createMiniProgressBar(component.load, 100, 10);
      tableData.push({
        Component: name,
        Status: `${statusIcon} ${component.status}`,
        Load: `${loadBar} ${component.load.toFixed(0)}%`
      });
    }
    console.table(tableData);
    console.log();
  }
  renderAgentsAndTasks(data) {
    console.log(import_chalk.default.white.bold("Active Agents"));
    console.log("\u2500".repeat(40));
    if (data.agents.length > 0) {
      const agentTable = new import_cli_table3.default({
        head: ["Agent ID", "Type", "Status", "Tasks"],
        style: { border: [], head: [] }
      });
      for (const agent of data.agents.slice(0, 5)) {
        const statusIcon = (0, import_formatter.formatStatusIndicator)(agent.status);
        agentTable.push([
          import_chalk.default.gray(agent.id.substring(0, 8) + "..."),
          import_chalk.default.cyan(agent.type),
          `${statusIcon} ${agent.status}`,
          agent.activeTasks.toString()
        ]);
      }
      console.log(agentTable.toString());
    } else {
      console.log(import_chalk.default.gray("No active agents"));
    }
    console.log();
    console.log(import_chalk.default.white.bold("Recent Tasks"));
    console.log("\u2500".repeat(40));
    if (data.tasks.length > 0) {
      const taskTable = new import_cli_table3.default({
        head: ["Task ID", "Type", "Status", "Duration"],
        style: { border: [], head: [] }
      });
      for (const task of data.tasks.slice(0, 5)) {
        const statusIcon = (0, import_formatter.formatStatusIndicator)(task.status);
        taskTable.push([
          import_chalk.default.gray(task.id.substring(0, 8) + "..."),
          import_chalk.default.white(task.type),
          `${statusIcon} ${task.status}`,
          task.duration ? (0, import_formatter.formatDuration)(task.duration) : "-"
        ]);
      }
      console.log(taskTable.toString());
    } else {
      console.log(import_chalk.default.gray("No recent tasks"));
    }
    console.log();
  }
  renderRecentEvents(data) {
    console.log(import_chalk.default.white.bold("Recent Events"));
    console.log("\u2500".repeat(40));
    if (data.events.length > 0) {
      for (const event of data.events.slice(0, 3)) {
        const time = new Date(event.timestamp).toLocaleTimeString();
        const icon = this.getEventIcon(event.type);
        console.log(`${import_chalk.default.gray(time)} ${icon} ${event.message}`);
      }
    } else {
      console.log(import_chalk.default.gray("No recent events"));
    }
    console.log();
  }
  renderPerformanceGraphs() {
    console.log(import_chalk.default.white.bold("Performance (Last 60s)"));
    console.log("\u2500".repeat(40));
    if (this.data.length >= 2) {
      console.log(import_chalk.default.cyan("CPU Usage:"));
      console.log(
        this.createSparkline(
          this.data.map((d) => d.system.cpu),
          30
        )
      );
      console.log(import_chalk.default.cyan("Memory Usage:"));
      console.log(
        this.createSparkline(
          this.data.map((d) => d.system.memory),
          30
        )
      );
    } else {
      console.log(import_chalk.default.gray("Collecting data..."));
    }
    console.log();
  }
  renderFocusedComponent(data, componentName) {
    const component = data.components[componentName];
    if (!component) {
      console.log(import_chalk.default.red(`Component '${componentName}' not found`));
      return;
    }
    console.log(import_chalk.default.white.bold(`${componentName} Details`));
    console.log("\u2500".repeat(40));
    const statusIcon = (0, import_formatter.formatStatusIndicator)(component.status);
    console.log(`${statusIcon} Status: ${component.status}`);
    console.log(
      `Load: ${(0, import_formatter.formatProgressBar)(component.load, 100, 30)} ${component.load.toFixed(1)}%`
    );
    console.log();
  }
  renderFooter() {
    console.log("\u2500".repeat(80));
    console.log(
      import_chalk.default.gray("Press Ctrl+C to exit \u2022 Update interval: ") + import_chalk.default.yellow(`${this.options.interval}s`)
    );
  }
  renderError(error) {
    console.clear();
    console.log(import_chalk.default.red.bold("Monitor Error"));
    console.log("\u2500".repeat(40));
    if (error.message.includes("ECONNREFUSED")) {
      console.log(import_chalk.default.red("\u2717 Cannot connect to Claude-Flow"));
      console.log(import_chalk.default.gray("Make sure Claude-Flow is running with: claude-flow start"));
    } else {
      console.log(import_chalk.default.red("Error:"), error.message);
    }
    console.log("\n" + import_chalk.default.gray("Retrying in ") + import_chalk.default.yellow(`${this.options.interval}s...`));
  }
  createMiniProgressBar(current, max, width) {
    const filled = Math.floor(current / max * width);
    const empty = width - filled;
    return import_chalk.default.green("\u2588".repeat(filled)) + import_chalk.default.gray("\u2591".repeat(empty));
  }
  createSparkline(data, width) {
    if (data.length < 2)
      return import_chalk.default.gray("\u2581".repeat(width));
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const chars = ["\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"];
    const recent = data.slice(-width);
    return recent.map((value) => {
      const normalized = (value - min) / range;
      const charIndex = Math.floor(normalized * (chars.length - 1));
      return import_chalk.default.cyan(chars[charIndex]);
    }).join("");
  }
  getEventIcon(type) {
    const icons = {
      agent_spawned: import_chalk.default.green("\u2197"),
      agent_terminated: import_chalk.default.red("\u2199"),
      task_completed: import_chalk.default.green("\u2713"),
      task_failed: import_chalk.default.red("\u2717"),
      task_assigned: import_chalk.default.blue("\u2192"),
      system_warning: import_chalk.default.yellow("\u26A0"),
      system_error: import_chalk.default.red("\u2717")
    };
    return icons[type] || import_chalk.default.blue("\u2022");
  }
  generateMockAgents() {
    return [
      {
        id: "agent-001",
        type: "coordinator",
        status: "active",
        activeTasks: Math.floor(Math.random() * 5) + 1
      },
      {
        id: "agent-002",
        type: "researcher",
        status: "active",
        activeTasks: Math.floor(Math.random() * 8) + 1
      },
      {
        id: "agent-003",
        type: "implementer",
        status: Math.random() > 0.7 ? "idle" : "active",
        activeTasks: Math.floor(Math.random() * 3)
      }
    ];
  }
  generateMockTasks() {
    const types = ["research", "implementation", "analysis", "coordination"];
    const statuses = ["running", "pending", "completed", "failed"];
    return Array.from({ length: 8 }, (_, i) => ({
      id: `task-${String(i + 1).padStart(3, "0")}`,
      type: types[Math.floor(Math.random() * types.length)],
      status: statuses[Math.floor(Math.random() * statuses.length)],
      duration: Math.random() > 0.5 ? Math.floor(Math.random() * 12e4) : null
    }));
  }
  generateMockEvents() {
    const events = [
      { type: "task_completed", message: "Research task completed successfully" },
      { type: "agent_spawned", message: "New implementer agent spawned" },
      { type: "task_assigned", message: "Task assigned to coordinator agent" },
      { type: "system_warning", message: "High memory usage detected" }
    ];
    const eventTypes = [
      {
        type: "task_completed",
        message: "Research task completed successfully",
        level: "info"
      },
      { type: "agent_spawned", message: "New implementer agent spawned", level: "info" },
      {
        type: "task_assigned",
        message: "Task assigned to coordinator agent",
        level: "info"
      },
      { type: "system_warning", message: "High memory usage detected", level: "warn" },
      {
        type: "task_failed",
        message: "Analysis task failed due to timeout",
        level: "error"
      },
      { type: "system_info", message: "System health check completed", level: "info" },
      { type: "memory_gc", message: "Garbage collection triggered", level: "debug" },
      { type: "network_event", message: "MCP connection established", level: "info" }
    ];
    const components = ["orchestrator", "terminal", "memory", "coordination", "mcp"];
    return Array.from({ length: 6 + Math.floor(Math.random() * 4) }, (_, i) => {
      const event = eventTypes[Math.floor(Math.random() * eventTypes.length)];
      return {
        ...event,
        timestamp: Date.now() - i * Math.random() * 3e5,
        // Random intervals up to 5 minutes
        component: Math.random() > 0.3 ? components[Math.floor(Math.random() * components.length)] : void 0
      };
    }).sort((a, b) => b.timestamp - a.timestamp);
  }
  async checkSystemRunning() {
    try {
      return await (0, import_fs.existsSync)(".claude-flow.pid");
    } catch {
      return false;
    }
  }
  async getRealSystemData() {
    return null;
  }
  generateComponentStatus() {
    const components = ["orchestrator", "terminal", "memory", "coordination", "mcp"];
    const statuses = ["healthy", "degraded", "error"];
    const result = {};
    for (const component of components) {
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      const hasErrors = Math.random() > 0.8;
      result[component] = {
        status,
        load: Math.random() * 100,
        uptime: Math.random() * 36e5,
        // Up to 1 hour
        errors: hasErrors ? Math.floor(Math.random() * 5) : 0,
        lastError: hasErrors ? "Connection timeout" : void 0
      };
    }
    return result;
  }
  checkAlerts(data) {
    const newAlerts = [];
    if (data.system.cpu > this.options.threshold) {
      newAlerts.push({
        id: "cpu-high",
        type: "warning",
        message: `CPU usage high: ${data.system.cpu.toFixed(1)}%`,
        component: "system",
        timestamp: Date.now(),
        acknowledged: false
      });
    }
    if (data.system.memory > 800) {
      newAlerts.push({
        id: "memory-high",
        type: "warning",
        message: `Memory usage high: ${data.system.memory.toFixed(0)}MB`,
        component: "system",
        timestamp: Date.now(),
        acknowledged: false
      });
    }
    for (const [name, component] of Object.entries(data.components)) {
      if (component.status === "error") {
        newAlerts.push({
          id: `component-error-${name}`,
          type: "error",
          message: `Component ${name} is in error state`,
          component: name,
          timestamp: Date.now(),
          acknowledged: false
        });
      }
      if (component.load > this.options.threshold) {
        newAlerts.push({
          id: `component-load-${name}`,
          type: "warning",
          message: `Component ${name} load high: ${component.load.toFixed(1)}%`,
          component: name,
          timestamp: Date.now(),
          acknowledged: false
        });
      }
    }
    this.alerts = [...this.alerts, ...newAlerts].filter((alert) => Date.now() - alert.timestamp < 3e5).slice(-10);
  }
  async exportMonitoringData() {
    try {
      const exportData = {
        metadata: {
          exportTime: (/* @__PURE__ */ new Date()).toISOString(),
          duration: (0, import_formatter.formatDuration)(Date.now() - this.startTime),
          dataPoints: this.exportData.length,
          interval: this.options.interval
        },
        data: this.exportData,
        alerts: this.alerts
      };
      await import_node_fs.promises.writeFile(this.options.export, JSON.stringify(exportData, null, 2));
      console.log(import_chalk.default.green(`\u2713 Monitoring data exported to ${this.options.export}`));
    } catch (error) {
      console.error(import_chalk.default.red("Failed to export data:"), error.message);
    }
  }
}
async function startMonitorDashboard(options) {
  if (options.interval < 1) {
    console.error(import_chalk.default.red("Update interval must be at least 1 second"));
    return;
  }
  if (options.threshold < 1 || options.threshold > 100) {
    console.error(import_chalk.default.red("Threshold must be between 1 and 100"));
    return;
  }
  if (options.export) {
    try {
      await import_node_fs.promises.writeFile(options.export, "");
      await Deno.remove(options.export);
    } catch {
      console.error(import_chalk.default.red(`Cannot write to export file: ${options.export}`));
      return;
    }
  }
  const dashboard = new Dashboard(options);
  await dashboard.start();
}
__name(startMonitorDashboard, "startMonitorDashboard");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  monitorCommand
});
//# sourceMappingURL=monitor.js.map
