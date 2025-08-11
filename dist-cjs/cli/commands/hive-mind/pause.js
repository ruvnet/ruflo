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
var pause_exports = {};
__export(pause_exports, {
  pauseCommand: () => pauseCommand
});
module.exports = __toCommonJS(pause_exports);
var import_commander = require("commander");
var import_chalk = __toESM(require("chalk"), 1);
var import_session_manager = require("../../simple-commands/hive-mind/session-manager.js");
var import_inquirer = __toESM(require("inquirer"), 1);
const pauseCommand = new import_commander.Command("pause").description("Pause active hive mind sessions").option("-s, --session <id>", "Pause specific session by ID").action(async (options) => {
  const sessionManager = new import_session_manager.HiveMindSessionManager();
  try {
    if (options.session) {
      const sessionId = options.session;
      const session = await sessionManager.getSession(sessionId);
      if (!session) {
        console.log(import_chalk.default.red(`Session ${sessionId} not found`));
        return;
      }
      if (session.status === "paused") {
        console.log(import_chalk.default.yellow(`Session ${sessionId} is already paused`));
        return;
      }
      if (session.status !== "active") {
        console.log(
          import_chalk.default.yellow(`Session ${sessionId} is not active (status: ${session.status})`)
        );
        return;
      }
      console.log(import_chalk.default.cyan(`Pausing session ${sessionId}...`));
      const result = await sessionManager.pauseSession(sessionId);
      if (result) {
        console.log(import_chalk.default.green(`\u2713 Session ${sessionId} paused successfully`));
        console.log(import_chalk.default.gray(`Use 'claude-flow hive-mind resume -s ${sessionId}' to resume`));
      } else {
        console.log(import_chalk.default.red(`Failed to pause session ${sessionId}`));
      }
    } else {
      const sessions = await sessionManager.getActiveSessions();
      const activeSessions = sessions.filter((s) => s.status === "active");
      if (activeSessions.length === 0) {
        console.log(import_chalk.default.yellow("No active sessions found to pause"));
        return;
      }
      const { sessionId } = await import_inquirer.default.prompt([
        {
          type: "list",
          name: "sessionId",
          message: "Select session to pause:",
          choices: activeSessions.map((s) => ({
            name: `${s.swarm_name} (${s.id}) - ${s.completion_percentage}% complete`,
            value: s.id
          }))
        }
      ]);
      console.log(import_chalk.default.cyan(`Pausing session ${sessionId}...`));
      const result = await sessionManager.pauseSession(sessionId);
      if (result) {
        console.log(import_chalk.default.green(`\u2713 Session paused successfully`));
        console.log(import_chalk.default.gray(`Use 'claude-flow hive-mind resume -s ${sessionId}' to resume`));
      } else {
        console.log(import_chalk.default.red(`Failed to pause session`));
      }
    }
  } catch (error) {
    console.error(import_chalk.default.red("Error pausing session:"), error.message);
    process.exit(1);
  } finally {
    sessionManager.close();
  }
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  pauseCommand
});
//# sourceMappingURL=pause.js.map
