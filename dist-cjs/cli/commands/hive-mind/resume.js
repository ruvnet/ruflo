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
var resume_exports = {};
__export(resume_exports, {
  resumeCommand: () => resumeCommand
});
module.exports = __toCommonJS(resume_exports);
var import_commander = require("commander");
var import_chalk = __toESM(require("chalk"), 1);
var import_session_manager = require("../../simple-commands/hive-mind/session-manager.js");
var import_inquirer = __toESM(require("inquirer"), 1);
const resumeCommand = new import_commander.Command("resume").description("Resume paused hive mind sessions").option("-s, --session <id>", "Resume specific session by ID").action(async (options) => {
  const sessionManager = new import_session_manager.HiveMindSessionManager();
  try {
    if (options.session) {
      const sessionId = options.session;
      console.log(import_chalk.default.cyan(`Resuming session ${sessionId}...`));
      const session = await sessionManager.resumeSession(sessionId);
      console.log(import_chalk.default.green(`\u2713 Session ${sessionId} resumed successfully`));
      console.log(import_chalk.default.gray(`Swarm: ${session.swarm_name || "N/A"}`));
      console.log(import_chalk.default.gray(`Objective: ${session.objective || "N/A"}`));
      console.log(import_chalk.default.gray(`Progress: ${session.statistics.completionPercentage}%`));
    } else {
      const sessions = await sessionManager.getActiveSessions();
      const pausedSessions = sessions.filter((s) => s.status === "paused");
      if (pausedSessions.length === 0) {
        console.log(import_chalk.default.yellow("No paused sessions found to resume"));
        return;
      }
      const { sessionId } = await import_inquirer.default.prompt([
        {
          type: "list",
          name: "sessionId",
          message: "Select session to resume:",
          choices: pausedSessions.map((s) => ({
            name: `${s.swarm_name} (${s.id}) - ${s.completion_percentage}% complete`,
            value: s.id
          }))
        }
      ]);
      console.log(import_chalk.default.cyan(`Resuming session ${sessionId}...`));
      const session = await sessionManager.resumeSession(sessionId);
      console.log(import_chalk.default.green(`\u2713 Session resumed successfully`));
      console.log(import_chalk.default.gray(`Swarm: ${session.swarm_name || "N/A"}`));
      console.log(import_chalk.default.gray(`Objective: ${session.objective || "N/A"}`));
      console.log(import_chalk.default.gray(`Progress: ${session.statistics.completionPercentage}%`));
    }
  } catch (error) {
    console.error(import_chalk.default.red("Error resuming session:"), error.message);
    process.exit(1);
  } finally {
    sessionManager.close();
  }
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  resumeCommand
});
//# sourceMappingURL=resume.js.map
