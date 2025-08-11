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
var formatter_exports = {};
__export(formatter_exports, {
  createAgentTable: () => createAgentTable,
  createTaskTable: () => createTaskTable,
  displayBanner: () => displayBanner,
  displayVersion: () => displayVersion,
  formatAgent: () => formatAgent,
  formatDuration: () => formatDuration,
  formatError: () => formatError,
  formatHealthStatus: () => formatHealthStatus,
  formatInfo: () => formatInfo,
  formatMemoryEntry: () => formatMemoryEntry,
  formatProgressBar: () => formatProgressBar,
  formatSpinner: () => formatSpinner,
  formatStatusIndicator: () => formatStatusIndicator,
  formatSuccess: () => formatSuccess,
  formatTask: () => formatTask,
  formatWarning: () => formatWarning
});
module.exports = __toCommonJS(formatter_exports);
var import_chalk = __toESM(require("chalk"), 1);
var import_cli_table3 = __toESM(require("cli-table3"), 1);
var process = __toESM(require("process"), 1);
function formatError(error) {
  if (error instanceof Error) {
    let message = error instanceof Error ? error.message : String(error);
    if ("code" in error) {
      message = `[${error.code}] ${message}`;
    }
    if ("details" in error && error.details) {
      message += "\n" + import_chalk.default.gray("Details: " + JSON.stringify(error.details, null, 2));
    }
    return message;
  }
  return String(error);
}
__name(formatError, "formatError");
function formatAgent(agent) {
  const lines = [
    import_chalk.default.cyan.bold(`Agent: ${agent.name}`),
    import_chalk.default.gray(`ID: ${agent.id}`),
    import_chalk.default.gray(`Type: ${agent.type}`),
    import_chalk.default.gray(`Priority: ${agent.priority}`),
    import_chalk.default.gray(`Max Tasks: ${agent.maxConcurrentTasks}`),
    import_chalk.default.gray(`Capabilities: ${agent.capabilities.join(", ")}`)
  ];
  return lines.join("\n");
}
__name(formatAgent, "formatAgent");
function formatTask(task) {
  const statusColor = {
    pending: import_chalk.default.gray,
    queued: import_chalk.default.yellow,
    assigned: import_chalk.default.blue,
    running: import_chalk.default.cyan,
    completed: import_chalk.default.green,
    failed: import_chalk.default.red,
    cancelled: import_chalk.default.magenta
  }[task.status] || import_chalk.default.white;
  const lines = [
    import_chalk.default.yellow.bold(`Task: ${task.description}`),
    import_chalk.default.gray(`ID: ${task.id}`),
    import_chalk.default.gray(`Type: ${task.type}`),
    statusColor(`Status: ${task.status}`),
    import_chalk.default.gray(`Priority: ${task.priority}`)
  ];
  if (task.assignedAgent) {
    lines.push(import_chalk.default.gray(`Assigned to: ${task.assignedAgent}`));
  }
  if (task.dependencies.length > 0) {
    lines.push(import_chalk.default.gray(`Dependencies: ${task.dependencies.join(", ")}`));
  }
  if (task.error) {
    lines.push(import_chalk.default.red(`Error: ${task.error}`));
  }
  return lines.join("\n");
}
__name(formatTask, "formatTask");
function formatMemoryEntry(entry) {
  const lines = [
    import_chalk.default.magenta.bold(`Memory Entry: ${entry.type}`),
    import_chalk.default.gray(`ID: ${entry.id}`),
    import_chalk.default.gray(`Agent: ${entry.agentId}`),
    import_chalk.default.gray(`Session: ${entry.sessionId}`),
    import_chalk.default.gray(`Timestamp: ${entry.timestamp.toISOString()}`),
    import_chalk.default.gray(`Version: ${entry.version}`)
  ];
  if (entry.tags.length > 0) {
    lines.push(import_chalk.default.gray(`Tags: ${entry.tags.join(", ")}`));
  }
  lines.push("", import_chalk.default.white("Content:"), entry.content);
  return lines.join("\n");
}
__name(formatMemoryEntry, "formatMemoryEntry");
function formatHealthStatus(health) {
  const statusColor = {
    healthy: import_chalk.default.green,
    degraded: import_chalk.default.yellow,
    unhealthy: import_chalk.default.red
  }[health.status];
  const lines = [
    statusColor.bold(`System Status: ${health.status.toUpperCase()}`),
    import_chalk.default.gray(`Checked at: ${health.timestamp.toISOString()}`),
    "",
    import_chalk.default.cyan.bold("Components:")
  ];
  for (const [name, component] of Object.entries(health.components)) {
    const compColor = {
      healthy: import_chalk.default.green,
      degraded: import_chalk.default.yellow,
      unhealthy: import_chalk.default.red
    }[component.status];
    lines.push(compColor(`  ${name}: ${component.status}`));
    if (component.error) {
      lines.push(import_chalk.default.red(`    Error: ${component.error}`));
    }
    if (component.metrics) {
      for (const [metric, value] of Object.entries(component.metrics)) {
        lines.push(import_chalk.default.gray(`    ${metric}: ${value}`));
      }
    }
  }
  return lines.join("\n");
}
__name(formatHealthStatus, "formatHealthStatus");
function createAgentTable(agents) {
  const table = new import_cli_table3.default({
    head: ["ID", "Name", "Type", "Priority", "Max Tasks"]
  });
  for (const agent of agents) {
    table.push([
      agent.id,
      agent.name,
      agent.type,
      agent.priority.toString(),
      agent.maxConcurrentTasks.toString()
    ]);
  }
  return table;
}
__name(createAgentTable, "createAgentTable");
function createTaskTable(tasks) {
  const table = new import_cli_table3.default({
    head: ["ID", "Type", "Description", "Status", "Agent"]
  });
  for (const task of tasks) {
    const statusCell = {
      pending: import_chalk.default.gray(task.status),
      queued: import_chalk.default.yellow(task.status),
      assigned: import_chalk.default.blue(task.status),
      running: import_chalk.default.cyan(task.status),
      completed: import_chalk.default.green(task.status),
      failed: import_chalk.default.red(task.status),
      cancelled: import_chalk.default.magenta(task.status)
    }[task.status] || task.status;
    table.push([
      task.id,
      task.type,
      task.description.substring(0, 40) + (task.description.length > 40 ? "..." : ""),
      statusCell,
      task.assignedAgent || "-"
    ]);
  }
  return table;
}
__name(createTaskTable, "createTaskTable");
function formatDuration(ms) {
  if (ms < 1e3) {
    return `${ms}ms`;
  }
  const seconds = Math.floor(ms / 1e3);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}
__name(formatDuration, "formatDuration");
function displayBanner(version) {
  const banner = `
${import_chalk.default.cyan.bold("\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557")}
${import_chalk.default.cyan.bold("\u2551")}             ${import_chalk.default.white.bold("\u{1F9E0} Claude-Flow")} ${import_chalk.default.gray("v" + version)}                        ${import_chalk.default.cyan.bold("\u2551")}
${import_chalk.default.cyan.bold("\u2551")}          ${import_chalk.default.gray("Advanced AI Agent Orchestration")}               ${import_chalk.default.cyan.bold("\u2551")}
${import_chalk.default.cyan.bold("\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D")}
`;
  console.log(banner);
}
__name(displayBanner, "displayBanner");
function displayVersion(version, buildDate) {
  const info = [
    import_chalk.default.cyan.bold("Claude-Flow Version Information"),
    "",
    import_chalk.default.white("Version:    ") + import_chalk.default.yellow(version),
    import_chalk.default.white("Build Date: ") + import_chalk.default.yellow(buildDate),
    import_chalk.default.white("Runtime:    ") + import_chalk.default.yellow("Node.js " + process.version),
    import_chalk.default.white("Platform:   ") + import_chalk.default.yellow(process.platform),
    import_chalk.default.white("Arch:       ") + import_chalk.default.yellow(process.arch),
    "",
    import_chalk.default.gray("Components:"),
    import_chalk.default.white("  \u2022 Multi-Agent Orchestration"),
    import_chalk.default.white("  \u2022 Memory Management"),
    import_chalk.default.white("  \u2022 Terminal Integration"),
    import_chalk.default.white("  \u2022 MCP Server"),
    import_chalk.default.white("  \u2022 Task Coordination"),
    "",
    import_chalk.default.blue("Homepage: ") + import_chalk.default.underline("https://github.com/ruvnet/claude-flow")
  ];
  console.log(info.join("\n"));
}
__name(displayVersion, "displayVersion");
function formatProgressBar(current, total, width = 40, label) {
  const percentage = Math.min(100, current / total * 100);
  const filled = Math.floor(percentage / 100 * width);
  const empty = width - filled;
  const bar = import_chalk.default.green("\u2588".repeat(filled)) + import_chalk.default.gray("\u2591".repeat(empty));
  const percent = percentage.toFixed(1).padStart(5) + "%";
  let result = `[${bar}] ${percent}`;
  if (label) {
    result = `${label}: ${result}`;
  }
  return result;
}
__name(formatProgressBar, "formatProgressBar");
function formatStatusIndicator(status) {
  const indicators = {
    success: import_chalk.default.green("\u2713"),
    error: import_chalk.default.red("\u2717"),
    warning: import_chalk.default.yellow("\u26A0"),
    info: import_chalk.default.blue("\u2139"),
    running: import_chalk.default.cyan("\u27F3"),
    pending: import_chalk.default.gray("\u25CB")
  };
  return indicators[status] || status;
}
__name(formatStatusIndicator, "formatStatusIndicator");
function formatSuccess(message) {
  return import_chalk.default.green("\u2713") + " " + import_chalk.default.white(message);
}
__name(formatSuccess, "formatSuccess");
function formatInfo(message) {
  return import_chalk.default.blue("\u2139") + " " + import_chalk.default.white(message);
}
__name(formatInfo, "formatInfo");
function formatWarning(message) {
  return import_chalk.default.yellow("\u26A0") + " " + import_chalk.default.white(message);
}
__name(formatWarning, "formatWarning");
function formatSpinner(message, frame = 0) {
  const frames = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
  const spinner = import_chalk.default.cyan(frames[frame % frames.length]);
  return `${spinner} ${message}`;
}
__name(formatSpinner, "formatSpinner");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createAgentTable,
  createTaskTable,
  displayBanner,
  displayVersion,
  formatAgent,
  formatDuration,
  formatError,
  formatHealthStatus,
  formatInfo,
  formatMemoryEntry,
  formatProgressBar,
  formatSpinner,
  formatStatusIndicator,
  formatSuccess,
  formatTask,
  formatWarning
});
//# sourceMappingURL=formatter.js.map
