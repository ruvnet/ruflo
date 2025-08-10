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
var ps_exports = {};
__export(ps_exports, {
  psCommand: () => psCommand
});
module.exports = __toCommonJS(ps_exports);
var import_commander = require("commander");
var import_chalk = __toESM(require("chalk"), 1);
var import_session_manager = require("../../simple-commands/hive-mind/session-manager.js");
var import_cli_table3 = __toESM(require("cli-table3"), 1);
const psCommand = new import_commander.Command("ps").description("Show active hive mind sessions and processes").option("-a, --all", "Show all sessions including stopped ones").option("-v, --verbose", "Show detailed process information").action(async (options) => {
  const sessionManager = new import_session_manager.HiveMindSessionManager();
  try {
    const sessions = options.all ? sessionManager.getActiveSessionsWithProcessInfo() : sessionManager.getActiveSessionsWithProcessInfo().filter((s) => s.status === "active" || s.status === "paused");
    if (sessions.length === 0) {
      console.log(import_chalk.default.yellow("No sessions found"));
      return;
    }
    const cleanedCount = sessionManager.cleanupOrphanedProcesses();
    if (cleanedCount > 0) {
      console.log(import_chalk.default.blue(`Cleaned up ${cleanedCount} orphaned session(s)
`));
    }
    const table = new import_cli_table3.default({
      head: [
        import_chalk.default.cyan("Session ID"),
        import_chalk.default.cyan("Swarm"),
        import_chalk.default.cyan("Status"),
        import_chalk.default.cyan("Parent PID"),
        import_chalk.default.cyan("Child PIDs"),
        import_chalk.default.cyan("Progress"),
        import_chalk.default.cyan("Duration")
      ],
      style: {
        head: [],
        border: ["gray"]
      }
    });
    for (const session of sessions) {
      const duration = (/* @__PURE__ */ new Date()).getTime() - new Date(session.created_at).getTime();
      const durationStr = formatDuration(duration);
      const statusColor = session.status === "active" ? import_chalk.default.green : session.status === "paused" ? import_chalk.default.yellow : session.status === "stopped" ? import_chalk.default.red : import_chalk.default.gray;
      table.push([
        session.id.substring(0, 20) + "...",
        session.swarm_name,
        statusColor(session.status),
        session.parent_pid || "-",
        session.child_pids.length > 0 ? session.child_pids.join(", ") : "-",
        `${session.completion_percentage}%`,
        durationStr
      ]);
    }
    console.log(table.toString());
    if (options.verbose) {
      console.log("\n" + import_chalk.default.bold("Detailed Session Information:"));
      for (const session of sessions) {
        console.log("\n" + import_chalk.default.cyan(`Session: ${session.id}`));
        console.log(import_chalk.default.gray(`  Objective: ${session.objective || "N/A"}`));
        console.log(import_chalk.default.gray(`  Created: ${new Date(session.created_at).toLocaleString()}`));
        console.log(import_chalk.default.gray(`  Updated: ${new Date(session.updated_at).toLocaleString()}`));
        if (session.paused_at) {
          console.log(import_chalk.default.gray(`  Paused: ${new Date(session.paused_at).toLocaleString()}`));
        }
        console.log(import_chalk.default.gray(`  Agents: ${session.agent_count || 0}`));
        console.log(
          import_chalk.default.gray(
            `  Tasks: ${session.task_count || 0} (${session.completed_tasks || 0} completed)`
          )
        );
        if (session.child_pids.length > 0) {
          console.log(import_chalk.default.gray(`  Active Processes:`));
          for (const pid of session.child_pids) {
            console.log(import_chalk.default.gray(`    - PID ${pid}`));
          }
        }
      }
    }
    const activeSessions = sessions.filter((s) => s.status === "active").length;
    const pausedSessions = sessions.filter((s) => s.status === "paused").length;
    const totalProcesses = sessions.reduce((sum, s) => sum + s.total_processes, 0);
    console.log("\n" + import_chalk.default.bold("Summary:"));
    console.log(import_chalk.default.gray(`  Active sessions: ${activeSessions}`));
    console.log(import_chalk.default.gray(`  Paused sessions: ${pausedSessions}`));
    console.log(import_chalk.default.gray(`  Total processes: ${totalProcesses}`));
  } catch (error) {
    console.error(import_chalk.default.red("Error listing sessions:"), error.message);
    process.exit(1);
  } finally {
    sessionManager.close();
  }
});
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1e3);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}
__name(formatDuration, "formatDuration");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  psCommand
});
//# sourceMappingURL=ps.js.map
