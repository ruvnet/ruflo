#!/usr/bin/env node
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var hive_mind_exports = {};
__export(hive_mind_exports, {
  hiveMindCommand: () => hiveMindCommand,
  initCommand: () => import_init.initCommand,
  pauseCommand: () => import_pause.pauseCommand,
  psCommand: () => import_ps.psCommand,
  resumeCommand: () => import_resume.resumeCommand,
  spawnCommand: () => import_spawn.spawnCommand,
  statusCommand: () => import_status.statusCommand,
  stopCommand: () => import_stop.stopCommand,
  taskCommand: () => import_task.taskCommand,
  wizardCommand: () => import_wizard.wizardCommand
});
module.exports = __toCommonJS(hive_mind_exports);
var import_commander = require("commander");
var import_init = require("./init.js");
var import_spawn = require("./spawn.js");
var import_status = require("./status.js");
var import_task = require("./task.js");
var import_wizard = require("./wizard.js");
var import_stop = require("./stop.js");
var import_pause = require("./pause.js");
var import_resume = require("./resume.js");
var import_ps = require("./ps.js");
const hiveMindCommand = new import_commander.Command("hive-mind").description("Hive Mind collective intelligence swarm management").addCommand(import_init.initCommand).addCommand(import_spawn.spawnCommand).addCommand(import_status.statusCommand).addCommand(import_task.taskCommand).addCommand(import_wizard.wizardCommand).addCommand(import_stop.stopCommand).addCommand(import_pause.pauseCommand).addCommand(import_resume.resumeCommand).addCommand(import_ps.psCommand);
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  hiveMindCommand,
  initCommand,
  pauseCommand,
  psCommand,
  resumeCommand,
  spawnCommand,
  statusCommand,
  stopCommand,
  taskCommand,
  wizardCommand
});
//# sourceMappingURL=index.js.map
