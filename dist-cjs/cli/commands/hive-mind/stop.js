#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
var stop_exports = {};
__export(stop_exports, {
  stopCommand: () => stopCommand
});
module.exports = __toCommonJS(stop_exports);
var import_commander = require("commander");
var import_chalk = __toESM(require("chalk"), 1);
var import_session_manager = require("../../simple-commands/hive-mind/session-manager.js");
var import_inquirer = __toESM(require("inquirer"), 1);
const stopCommand = new import_commander.Command("stop").description("Stop active hive mind sessions").option("-s, --session <id>", "Stop specific session by ID").option("-a, --all", "Stop all active sessions").option("-f, --force", "Force stop without confirmation").action(async (options) => {
  const sessionManager = new import_session_manager.HiveMindSessionManager();
  try {
    if (options.all) {
      const sessions = await sessionManager.getActiveSessionsWithProcessInfo();
      if (sessions.length === 0) {
        console.log(import_chalk.default.yellow("No active sessions found"));
        return;
      }
      if (!options.force) {
        const { confirm } = await import_inquirer.default.prompt([
          {
            type: "confirm",
            name: "confirm",
            message: `Stop all ${sessions.length} active session(s)?`,
            default: false
          }
        ]);
        if (!confirm) {
          console.log(import_chalk.default.gray("Operation cancelled"));
          return;
        }
      }
      for (const session of sessions) {
        console.log(import_chalk.default.cyan(`Stopping session ${session.id}...`));
        await sessionManager.stopSession(session.id);
        console.log(import_chalk.default.green(`\u2713 Session ${session.id} stopped`));
      }
      console.log(import_chalk.default.green(`
\u2705 All sessions stopped successfully`));
    } else if (options.session) {
      const sessionId = options.session;
      const session = await sessionManager.getSession(sessionId);
      if (!session) {
        console.log(import_chalk.default.red(`Session ${sessionId} not found`));
        return;
      }
      if (session.status === "stopped") {
        console.log(import_chalk.default.yellow(`Session ${sessionId} is already stopped`));
        return;
      }
      if (!options.force) {
        const { confirm } = await import_inquirer.default.prompt([
          {
            type: "confirm",
            name: "confirm",
            message: `Stop session ${sessionId} (${session.swarm_name || "Unknown"})?`,
            default: false
          }
        ]);
        if (!confirm) {
          console.log(import_chalk.default.gray("Operation cancelled"));
          return;
        }
      }
      console.log(import_chalk.default.cyan(`Stopping session ${sessionId}...`));
      await sessionManager.stopSession(sessionId);
      console.log(import_chalk.default.green(`\u2713 Session ${sessionId} stopped successfully`));
    } else {
      const sessions = await sessionManager.getActiveSessionsWithProcessInfo();
      if (sessions.length === 0) {
        console.log(import_chalk.default.yellow("No active sessions found"));
        return;
      }
      const { sessionId } = await import_inquirer.default.prompt([
        {
          type: "list",
          name: "sessionId",
          message: "Select session to stop:",
          choices: sessions.map((s) => ({
            name: `${s.swarm_name} (${s.id}) - ${s.total_processes} process(es)`,
            value: s.id
          }))
        }
      ]);
      const { confirm } = await import_inquirer.default.prompt([
        {
          type: "confirm",
          name: "confirm",
          message: "Stop this session?",
          default: false
        }
      ]);
      if (!confirm) {
        console.log(import_chalk.default.gray("Operation cancelled"));
        return;
      }
      console.log(import_chalk.default.cyan(`Stopping session ${sessionId}...`));
      await sessionManager.stopSession(sessionId);
      console.log(import_chalk.default.green(`\u2713 Session stopped successfully`));
    }
    const cleanedCount = sessionManager.cleanupOrphanedProcesses();
    if (cleanedCount > 0) {
      console.log(import_chalk.default.blue(`
Cleaned up ${cleanedCount} orphaned session(s)`));
    }
  } catch (error) {
    console.error(import_chalk.default.red("Error stopping session:"), error.message);
    process.exit(1);
  } finally {
    sessionManager.close();
  }
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  stopCommand
});
//# sourceMappingURL=stop.js.map
