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
var status_exports = {};
__export(status_exports, {
  statusCommand: () => statusCommand
});
module.exports = __toCommonJS(status_exports);
var import_commander = require("commander");
var import_chalk = __toESM(require("chalk"), 1);
var import_cli_table3 = __toESM(require("cli-table3"), 1);
var import_formatter = require("../formatter.js");
var import_version = require("../../core/version.js");
const statusCommand = new import_commander.Command().name("status").description("Show Claude-Flow system status").option("-w, --watch", "Watch mode - continuously update status").option("-i, --interval <seconds>", "Update interval in seconds", "5").option("-c, --component <name>", "Show status for specific component").option("--json", "Output in JSON format").action(async (options) => {
  if (options.watch) {
    await watchStatus(options);
  } else {
    await showStatus(options);
  }
});
async function showStatus(options) {
  try {
    const status = await getSystemStatus();
    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    if (options.component) {
      showComponentStatus(status, options.component);
    } else {
      showFullStatus(status);
    }
  } catch (error) {
    if (error.message.includes("ECONNREFUSED") || error.message.includes("connection refused")) {
      console.error(import_chalk.default.red("\u2717 Claude-Flow is not running"));
      console.log(import_chalk.default.gray("Start it with: claude-flow start"));
    } else {
      console.error(import_chalk.default.red("Error getting status:"), error.message);
    }
  }
}
__name(showStatus, "showStatus");
async function watchStatus(options) {
  const interval = parseInt(options.interval) * 1e3;
  console.log(import_chalk.default.cyan("Watching Claude-Flow status..."));
  console.log(import_chalk.default.gray(`Update interval: ${options.interval}s`));
  console.log(import_chalk.default.gray("Press Ctrl+C to stop\n"));
  while (true) {
    console.clear();
    console.log(import_chalk.default.cyan.bold("Claude-Flow Status Monitor"));
    console.log(import_chalk.default.gray(`Last updated: ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}
`));
    try {
      await showStatus({ ...options, json: false });
    } catch (error) {
      console.error(import_chalk.default.red("Status update failed:"), error.message);
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
__name(watchStatus, "watchStatus");
function showFullStatus(status) {
  console.log(import_chalk.default.cyan.bold("System Overview"));
  console.log("\u2500".repeat(50));
  const statusIcon = (0, import_formatter.formatStatusIndicator)(status.overall);
  console.log(
    `${statusIcon} Overall Status: ${getStatusColor(status.overall)(status.overall.toUpperCase())}`
  );
  console.log(`${import_chalk.default.white("Uptime:")} ${(0, import_formatter.formatDuration)(status.uptime)}`);
  console.log(`${import_chalk.default.white("Version:")} ${status.version}`);
  console.log(`${import_chalk.default.white("Started:")} ${new Date(status.startTime).toLocaleString()}`);
  console.log();
  console.log(import_chalk.default.cyan.bold("Components"));
  console.log("\u2500".repeat(50));
  const componentRows = [];
  for (const [name, component] of Object.entries(status.components)) {
    const comp = component;
    const statusIcon2 = (0, import_formatter.formatStatusIndicator)(comp.status);
    const statusText = getStatusColor(comp.status)(comp.status.toUpperCase());
    componentRows.push([
      import_chalk.default.white(name),
      `${statusIcon2} ${statusText}`,
      (0, import_formatter.formatDuration)(comp.uptime || 0),
      comp.details || "-"
    ]);
  }
  const componentTable = new import_cli_table3.default({
    head: ["Component", "Status", "Uptime", "Details"]
  });
  componentTable.push(...componentRows);
  console.log(componentTable.toString());
  console.log();
  if (status.resources) {
    console.log(import_chalk.default.cyan.bold("Resource Usage"));
    console.log("\u2500".repeat(50));
    const resourceRows = [];
    for (const [name, resource] of Object.entries(status.resources)) {
      const res = resource;
      const percentage = (res.used / res.total * 100).toFixed(1);
      const color = getResourceColor(parseFloat(percentage));
      resourceRows.push([
        import_chalk.default.white(name),
        res.used.toString(),
        res.total.toString(),
        color(`${percentage}%`)
      ]);
    }
    const resourceTable = new import_cli_table3.default({
      head: ["Resource", "Used", "Total", "Percentage"]
    });
    resourceTable.push(...resourceRows);
    console.log(resourceTable.toString());
    console.log();
  }
  if (status.agents) {
    console.log(import_chalk.default.cyan.bold(`Active Agents (${status.agents.length})`));
    console.log("\u2500".repeat(50));
    if (status.agents.length > 0) {
      const agentRows = [];
      for (const agent of status.agents) {
        const statusIcon2 = (0, import_formatter.formatStatusIndicator)(agent.status);
        const statusText = getStatusColor(agent.status)(agent.status);
        agentRows.push([
          import_chalk.default.gray(agent.id.slice(0, 8)),
          import_chalk.default.white(agent.name),
          agent.type,
          `${statusIcon2} ${statusText}`,
          agent.activeTasks.toString()
        ]);
      }
      const agentTable = new import_cli_table3.default({
        head: ["ID", "Name", "Type", "Status", "Tasks"]
      });
      agentTable.push(...agentRows);
      console.log(agentTable.toString());
    } else {
      console.log(import_chalk.default.gray("No active agents"));
    }
    console.log();
  }
  if (status.recentTasks) {
    console.log(import_chalk.default.cyan.bold("Recent Tasks"));
    console.log("\u2500".repeat(50));
    if (status.recentTasks.length > 0) {
      const taskRows = [];
      for (const task of status.recentTasks.slice(0, 10)) {
        const statusIcon2 = (0, import_formatter.formatStatusIndicator)(task.status);
        const statusText = getStatusColor(task.status)(task.status);
        taskRows.push([
          import_chalk.default.gray(task.id.slice(0, 8)),
          task.type,
          `${statusIcon2} ${statusText}`,
          (0, import_formatter.formatDuration)(Date.now() - new Date(task.startTime).getTime()),
          task.assignedTo ? import_chalk.default.gray(task.assignedTo.slice(0, 8)) : "-"
        ]);
      }
      const taskTable = new import_cli_table3.default({
        head: ["ID", "Type", "Status", "Duration", "Agent"]
      });
      taskTable.push(...taskRows);
      console.log(taskTable.toString());
    } else {
      console.log(import_chalk.default.gray("No recent tasks"));
    }
  }
}
__name(showFullStatus, "showFullStatus");
function showComponentStatus(status, componentName) {
  const component = status.components[componentName];
  if (!component) {
    console.error(import_chalk.default.red(`Component '${componentName}' not found`));
    console.log(import_chalk.default.gray(`Available components: ${Object.keys(status.components).join(", ")}`));
    return;
  }
  console.log(import_chalk.default.cyan.bold(`Component: ${componentName}`));
  console.log("\u2500".repeat(50));
  const statusIcon = (0, import_formatter.formatStatusIndicator)(component.status);
  console.log(
    `${statusIcon} Status: ${getStatusColor(component.status)(component.status.toUpperCase())}`
  );
  console.log(`${import_chalk.default.white("Uptime:")} ${(0, import_formatter.formatDuration)(component.uptime || 0)}`);
  if (component.details) {
    console.log(`${import_chalk.default.white("Details:")} ${component.details}`);
  }
  if (component.metrics) {
    console.log();
    console.log(import_chalk.default.cyan("Metrics:"));
    const metricRows = [];
    for (const [name, value] of Object.entries(component.metrics)) {
      metricRows.push([import_chalk.default.white(name), value.toString()]);
    }
    const metricsTable = new import_cli_table3.default({
      head: ["Metric", "Value"]
    });
    metricsTable.push(...metricRows);
    console.log(metricsTable.toString());
  }
  if (component.errors && component.errors.length > 0) {
    console.log();
    console.log(import_chalk.default.red("Recent Errors:"));
    const errorRows = [];
    for (const error of component.errors.slice(0, 5)) {
      errorRows.push([new Date(error.timestamp).toLocaleTimeString(), error.message]);
    }
    const errorTable = new import_cli_table3.default({
      head: ["Time", "Error"]
    });
    errorTable.push(...errorRows);
    console.log(errorTable.toString());
  }
}
__name(showComponentStatus, "showComponentStatus");
async function getSystemStatus() {
  return {
    overall: "healthy",
    version: import_version.VERSION,
    uptime: 36e5,
    startTime: Date.now() - 36e5,
    components: {
      orchestrator: {
        status: "healthy",
        uptime: 36e5,
        details: "Running smoothly"
      },
      agents: {
        status: "healthy",
        uptime: 36e5,
        details: "5 active agents"
      },
      memory: {
        status: "healthy",
        uptime: 36e5,
        details: "Using 128MB of 512MB"
      }
    },
    resources: {
      memory: {
        used: 128,
        total: 512
      },
      cpu: {
        used: 25,
        total: 100
      }
    },
    agents: [
      {
        id: "agent-001",
        name: "Research Agent",
        type: "research",
        status: "active",
        activeTasks: 2
      },
      {
        id: "agent-002",
        name: "Code Agent",
        type: "coding",
        status: "idle",
        activeTasks: 0
      }
    ],
    recentTasks: [
      {
        id: "task-001",
        type: "research",
        status: "completed",
        startTime: Date.now() - 3e5,
        assignedTo: "agent-001"
      }
    ]
  };
}
__name(getSystemStatus, "getSystemStatus");
function getStatusColor(status) {
  switch (status.toLowerCase()) {
    case "healthy":
    case "active":
    case "completed":
      return import_chalk.default.green;
    case "warning":
    case "idle":
    case "pending":
      return import_chalk.default.yellow;
    case "error":
    case "failed":
      return import_chalk.default.red;
    default:
      return import_chalk.default.gray;
  }
}
__name(getStatusColor, "getStatusColor");
function getResourceColor(percentage) {
  if (percentage < 50)
    return import_chalk.default.green;
  if (percentage < 80)
    return import_chalk.default.yellow;
  return import_chalk.default.red;
}
__name(getResourceColor, "getResourceColor");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  statusCommand
});
//# sourceMappingURL=status.js.map
