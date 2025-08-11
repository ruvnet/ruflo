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
var init_exports = {};
__export(init_exports, {
  initCommand: () => initCommand
});
module.exports = __toCommonJS(init_exports);
var import_commander = require("commander");
var import_chalk = __toESM(require("chalk"), 1);
var import_ora = __toESM(require("ora"), 1);
var import_HiveMind = require("../../../hive-mind/core/HiveMind.js");
var import_DatabaseManager = require("../../../hive-mind/core/DatabaseManager.js");
var import_formatter = require("../../formatter.js");
const initCommand = new import_commander.Command("init").description("Initialize a new Hive Mind swarm").option(
  "-t, --topology <type>",
  "Swarm topology (mesh, hierarchical, ring, star)",
  "hierarchical"
).option("-m, --max-agents <number>", "Maximum agents in swarm", "8").option("-n, --name <string>", "Swarm name", "hive-mind-" + Date.now()).option(
  "-q, --queen-mode <mode>",
  "Queen coordination mode (centralized, distributed)",
  "centralized"
).option("--memory-ttl <seconds>", "Default memory TTL in seconds", "86400").option("--consensus-threshold <percent>", "Consensus threshold percentage", "0.66").option("--auto-spawn", "Automatically spawn initial agents", false).action(async (options) => {
  const spinner = (0, import_ora.default)("Initializing Hive Mind...").start();
  try {
    const db = await import_DatabaseManager.DatabaseManager.getInstance();
    await db.initialize();
    const config = {
      name: options.name,
      topology: options.topology,
      maxAgents: parseInt(options.maxAgents, 10),
      queenMode: options.queenMode,
      memoryTTL: parseInt(options.memoryTtl, 10),
      consensusThreshold: parseFloat(options.consensusThreshold),
      autoSpawn: options.autoSpawn,
      createdAt: /* @__PURE__ */ new Date()
    };
    const hiveMind = new import_HiveMind.HiveMind(config);
    const swarmId = await hiveMind.initialize();
    spinner.succeed((0, import_formatter.formatSuccess)("Hive Mind initialized successfully!"));
    console.log("\n" + import_chalk.default.bold("\u{1F41D} Hive Mind Details:"));
    console.log((0, import_formatter.formatInfo)(`Swarm ID: ${swarmId}`));
    console.log((0, import_formatter.formatInfo)(`Name: ${config.name}`));
    console.log((0, import_formatter.formatInfo)(`Topology: ${config.topology}`));
    console.log((0, import_formatter.formatInfo)(`Queen Mode: ${config.queenMode}`));
    console.log((0, import_formatter.formatInfo)(`Max Agents: ${config.maxAgents}`));
    console.log((0, import_formatter.formatInfo)(`Consensus Threshold: ${config.consensusThreshold * 100}%`));
    if (options.autoSpawn) {
      console.log("\n" + import_chalk.default.bold("\u{1F680} Auto-spawning initial agents..."));
      await hiveMind.autoSpawnAgents();
      console.log((0, import_formatter.formatSuccess)("Initial agents spawned successfully!"));
    }
    console.log("\n" + import_chalk.default.bold("\u{1F4DD} Next Steps:"));
    console.log((0, import_formatter.formatInfo)("1. Spawn agents: ruv-swarm hive-mind spawn <type>"));
    console.log((0, import_formatter.formatInfo)('2. Submit task: ruv-swarm hive-mind task "Your task"'));
    console.log((0, import_formatter.formatInfo)("3. Check status: ruv-swarm hive-mind status"));
    console.log((0, import_formatter.formatInfo)("4. Interactive: ruv-swarm hive-mind wizard"));
  } catch (error) {
    spinner.fail((0, import_formatter.formatError)("Failed to initialize Hive Mind"));
    console.error((0, import_formatter.formatError)(error.message));
    process.exit(1);
  }
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  initCommand
});
//# sourceMappingURL=init.js.map
