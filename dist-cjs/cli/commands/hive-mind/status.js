#!/usr/bin/env node
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
var import_HiveMind = require("../../../hive-mind/core/HiveMind.js");
var import_formatter = require("../../formatter.js");
var import_DatabaseManager = require("../../../hive-mind/core/DatabaseManager.js");
const statusCommand = new import_commander.Command("status").description("Display Hive Mind swarm status and metrics").option("-s, --swarm-id <id>", "Specific swarm ID to check").option("-d, --detailed", "Show detailed agent information", false).option("-m, --memory", "Show memory usage statistics", false).option("-t, --tasks", "Show task queue details", false).option("-p, --performance", "Show performance metrics", false).option("-w, --watch", "Watch status in real-time", false).option("-j, --json", "Output as JSON", false).action(async (options) => {
  try {
    const swarmId = options.swarmId || await getActiveSwarmId();
    if (!swarmId) {
      throw new Error("No active swarm found. Initialize a Hive Mind first.");
    }
    const hiveMind = await import_HiveMind.HiveMind.load(swarmId);
    const status = await hiveMind.getFullStatus();
    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    console.log("\n" + import_chalk.default.bold.yellow("\u{1F41D} Hive Mind Status"));
    console.log(import_chalk.default.gray("\u2501".repeat(60)));
    console.log((0, import_formatter.formatInfo)(`Swarm ID: ${status.swarmId}`));
    console.log((0, import_formatter.formatInfo)(`Name: ${status.name}`));
    console.log((0, import_formatter.formatInfo)(`Topology: ${status.topology}`));
    console.log((0, import_formatter.formatInfo)(`Queen Mode: ${status.queenMode}`));
    console.log((0, import_formatter.formatInfo)(`Status: ${getStatusEmoji(status.health)} ${status.health}`));
    console.log((0, import_formatter.formatInfo)(`Uptime: ${formatUptime(status.uptime)}`));
    console.log("\n" + import_chalk.default.bold("\u{1F465} Agent Summary"));
    const agentTable = new import_cli_table3.default({
      head: ["Type", "Total", "Active", "Idle", "Busy"],
      style: { head: ["cyan"] }
    });
    Object.entries(status.agentsByType).forEach(([type, count]) => {
      const active = status.agents.filter((a) => a.type === type && a.status === "active").length;
      const idle = status.agents.filter((a) => a.type === type && a.status === "idle").length;
      const busy = status.agents.filter((a) => a.type === type && a.status === "busy").length;
      agentTable.push([type, count, active, idle, busy]);
    });
    console.log(agentTable.toString());
    if (options.detailed) {
      console.log("\n" + import_chalk.default.bold("\u{1F916} Agent Details"));
      const detailTable = new import_cli_table3.default({
        head: ["Name", "Type", "Status", "Task", "Messages", "Uptime"],
        style: { head: ["cyan"] }
      });
      status.agents.forEach((agent) => {
        detailTable.push([
          agent.name,
          agent.type,
          getAgentStatusBadge(agent.status),
          agent.currentTask || "-",
          agent.messageCount,
          formatUptime(Date.now() - agent.createdAt)
        ]);
      });
      console.log(detailTable.toString());
    }
    if (options.tasks || status.tasks.length > 0) {
      console.log("\n" + import_chalk.default.bold("\u{1F4CB} Task Queue"));
      const taskTable = new import_cli_table3.default({
        head: ["ID", "Description", "Status", "Assigned To", "Progress"],
        style: { head: ["cyan"] }
      });
      status.tasks.forEach((task) => {
        taskTable.push([
          task.id.substring(0, 8),
          task.description.substring(0, 40) + (task.description.length > 40 ? "..." : ""),
          getTaskStatusBadge(task.status),
          task.assignedAgent || "-",
          `${task.progress}%`
        ]);
      });
      console.log(taskTable.toString());
      console.log((0, import_formatter.formatInfo)(`Total Tasks: ${status.taskStats.total}`));
      console.log(
        (0, import_formatter.formatInfo)(
          `Completed: ${status.taskStats.completed} | In Progress: ${status.taskStats.inProgress} | Pending: ${status.taskStats.pending}`
        )
      );
    }
    if (options.memory) {
      console.log("\n" + import_chalk.default.bold("\u{1F4BE} Memory Statistics"));
      const memTable = new import_cli_table3.default({
        head: ["Namespace", "Entries", "Size", "Avg TTL"],
        style: { head: ["cyan"] }
      });
      Object.entries(status.memoryStats.byNamespace).forEach(([ns, stats]) => {
        memTable.push([ns, stats.entries, formatBytes(stats.size), `${stats.avgTTL}s`]);
      });
      console.log(memTable.toString());
      console.log((0, import_formatter.formatInfo)(`Total Memory Usage: ${formatBytes(status.memoryStats.totalSize)}`));
      console.log((0, import_formatter.formatInfo)(`Total Entries: ${status.memoryStats.totalEntries}`));
    }
    if (options.performance) {
      console.log("\n" + import_chalk.default.bold("\u{1F4CA} Performance Metrics"));
      console.log((0, import_formatter.formatInfo)(`Avg Task Completion: ${status.performance.avgTaskCompletion}ms`));
      console.log((0, import_formatter.formatInfo)(`Message Throughput: ${status.performance.messageThroughput}/min`));
      console.log(
        (0, import_formatter.formatInfo)(`Consensus Success Rate: ${status.performance.consensusSuccessRate}%`)
      );
      console.log((0, import_formatter.formatInfo)(`Memory Hit Rate: ${status.performance.memoryHitRate}%`));
      console.log((0, import_formatter.formatInfo)(`Agent Utilization: ${status.performance.agentUtilization}%`));
    }
    console.log("\n" + import_chalk.default.bold("\u{1F4E1} Recent Communications"));
    console.log((0, import_formatter.formatInfo)(`Total Messages: ${status.communicationStats.totalMessages}`));
    console.log((0, import_formatter.formatInfo)(`Avg Latency: ${status.communicationStats.avgLatency}ms`));
    console.log((0, import_formatter.formatInfo)(`Active Channels: ${status.communicationStats.activeChannels}`));
    if (status.warnings.length > 0) {
      console.log("\n" + import_chalk.default.bold.yellow("\u26A0\uFE0F  Warnings"));
      status.warnings.forEach((warning) => {
        console.log((0, import_formatter.formatWarning)(warning));
      });
    }
    if (options.watch) {
      console.log("\n" + import_chalk.default.gray("Refreshing every 2 seconds... (Ctrl+C to exit)"));
      setInterval(async () => {
        console.clear();
        await statusCommand.parseAsync([...process.argv.slice(0, 2), ...process.argv.slice(3)]);
      }, 2e3);
    }
  } catch (error) {
    console.error((0, import_formatter.formatError)("Failed to get swarm status"));
    console.error((0, import_formatter.formatError)(error.message));
    process.exit(1);
  }
});
async function getActiveSwarmId() {
  const db = await import_DatabaseManager.DatabaseManager.getInstance();
  return db.getActiveSwarmId();
}
__name(getActiveSwarmId, "getActiveSwarmId");
function getStatusEmoji(health) {
  const emojis = {
    healthy: "\u{1F7E2}",
    degraded: "\u{1F7E1}",
    critical: "\u{1F534}",
    unknown: "\u26AA"
  };
  return emojis[health] || "\u26AA";
}
__name(getStatusEmoji, "getStatusEmoji");
function getAgentStatusBadge(status) {
  const badges = {
    active: import_chalk.default.green("\u25CF Active"),
    idle: import_chalk.default.yellow("\u25CF Idle"),
    busy: import_chalk.default.blue("\u25CF Busy"),
    error: import_chalk.default.red("\u25CF Error")
  };
  return badges[status] || import_chalk.default.gray("\u25CF Unknown");
}
__name(getAgentStatusBadge, "getAgentStatusBadge");
function getTaskStatusBadge(status) {
  const badges = {
    pending: import_chalk.default.gray("\u23F3 Pending"),
    assigned: import_chalk.default.yellow("\u{1F504} Assigned"),
    in_progress: import_chalk.default.blue("\u25B6\uFE0F  In Progress"),
    completed: import_chalk.default.green("\u2705 Completed"),
    failed: import_chalk.default.red("\u274C Failed")
  };
  return badges[status] || import_chalk.default.gray("\u2753 Unknown");
}
__name(getTaskStatusBadge, "getTaskStatusBadge");
function formatUptime(ms) {
  const seconds = Math.floor(ms / 1e3);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0)
    return `${days}d ${hours % 24}h`;
  if (hours > 0)
    return `${hours}h ${minutes % 60}m`;
  if (minutes > 0)
    return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
__name(formatUptime, "formatUptime");
function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size > 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}
__name(formatBytes, "formatBytes");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  statusCommand
});
//# sourceMappingURL=status.js.map
