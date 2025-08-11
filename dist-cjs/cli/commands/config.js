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
var config_exports = {};
__export(config_exports, {
  configCommand: () => configCommand,
  default: () => config_default
});
module.exports = __toCommonJS(config_exports);
var import_commander = require("commander");
var import_chalk = __toESM(require("chalk"), 1);
var import_config = require("../../core/config.js");
const configManager = import_config.ConfigManager.getInstance();
const configCommand = new import_commander.Command("config").description("Configuration management commands");
configCommand.command("get").arguments("<key>").description("Get configuration value").action(async (key) => {
  try {
    const value = configManager.getValue(key);
    console.log(import_chalk.default.green("\u2713"), `${key}:`, JSON.stringify(value, null, 2));
  } catch (error) {
    console.error(import_chalk.default.red("Failed to get configuration:"), error.message);
    process.exit(1);
  }
});
configCommand.command("set").arguments("<key> <value>").description("Set configuration value").action(async (key, value) => {
  try {
    let parsedValue = value;
    try {
      parsedValue = JSON.parse(value);
    } catch {
    }
    await configManager.set(key, parsedValue);
    console.log(
      import_chalk.default.green("\u2713"),
      `Configuration updated: ${key} = ${JSON.stringify(parsedValue)}`
    );
  } catch (error) {
    console.error(import_chalk.default.red("Failed to set configuration:"), error.message);
    process.exit(1);
  }
});
configCommand.command("list").description("List all configuration values").option("--json", "Output as JSON").action(async (options) => {
  try {
    const config = await configManager.getAll();
    if (options.json) {
      console.log(JSON.stringify(config, null, 2));
    } else {
      console.log(import_chalk.default.cyan.bold("Configuration:"));
      console.log("\u2500".repeat(40));
      for (const [key, value] of Object.entries(config)) {
        console.log(`${import_chalk.default.yellow(key)}: ${JSON.stringify(value)}`);
      }
    }
  } catch (error) {
    console.error(import_chalk.default.red("Failed to list configuration:"), error.message);
    process.exit(1);
  }
});
configCommand.command("reset").description("Reset configuration to defaults").option("--force", "Skip confirmation").action(async (options) => {
  try {
    if (!options.force) {
      console.log(import_chalk.default.yellow("This will reset all configuration to defaults."));
    }
    await configManager.reset();
    console.log(import_chalk.default.green("\u2713"), "Configuration reset to defaults");
  } catch (error) {
    console.error(import_chalk.default.red("Failed to reset configuration:"), error.message);
    process.exit(1);
  }
});
var config_default = configCommand;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  configCommand
});
//# sourceMappingURL=config.js.map
