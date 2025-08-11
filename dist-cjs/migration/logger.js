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
var logger_exports = {};
__export(logger_exports, {
  MigrationLogger: () => MigrationLogger,
  logger: () => logger
});
module.exports = __toCommonJS(logger_exports);
var process = __toESM(require("node:process"));
var fs = __toESM(require("fs-extra"));
var path = __toESM(require("path"));
var chalk = __toESM(require("chalk"));
class MigrationLogger {
  static {
    __name(this, "MigrationLogger");
  }
  logFile;
  entries = [];
  constructor(logFile) {
    this.logFile = logFile;
  }
  info(message, context) {
    this.log("info", message, context);
    console.log(chalk.blue(`\u2139\uFE0F  ${message}`));
  }
  warn(message, context) {
    this.log("warn", message, context);
    console.log(chalk.yellow(`\u26A0\uFE0F  ${message}`));
  }
  error(message, error, context) {
    this.log("error", message, context, error?.stack);
    console.log(chalk.red(`\u274C ${message}`));
    if (error && (error instanceof Error ? error.message : String(error)) !== message) {
      console.log(chalk.red(`   ${error instanceof Error ? error.message : String(error)}`));
    }
  }
  success(message, context) {
    this.log("success", message, context);
    console.log(chalk.green(`\u2705 ${message}`));
  }
  debug(message, context) {
    if (process.env.DEBUG === "true" || process.env.NODE_ENV === "development") {
      this.log("debug", message, context);
      console.log(chalk.gray(`\u{1F50D} ${message}`));
    }
  }
  log(level, message, context, stack) {
    const entry = {
      timestamp: /* @__PURE__ */ new Date(),
      level,
      message,
      context,
      stack
    };
    this.entries.push(entry);
    if (this.logFile) {
      this.writeToFile(entry);
    }
  }
  async writeToFile(entry) {
    if (!this.logFile)
      return;
    try {
      const logDir = path.dirname(this.logFile);
      await fs.ensureDir(logDir);
      const logLine = JSON.stringify(entry) + "\n";
      await fs.appendFile(this.logFile, logLine);
    } catch (error) {
      console.error(
        "Failed to write to log file:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  async saveToFile(filePath) {
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeJson(filePath, this.entries, { spaces: 2 });
  }
  getEntries() {
    return [...this.entries];
  }
  getEntriesByLevel(level) {
    return this.entries.filter((entry) => entry.level === level);
  }
  clear() {
    this.entries = [];
  }
  printSummary() {
    const summary = {
      total: this.entries.length,
      info: this.getEntriesByLevel("info").length,
      warn: this.getEntriesByLevel("warn").length,
      error: this.getEntriesByLevel("error").length,
      success: this.getEntriesByLevel("success").length,
      debug: this.getEntriesByLevel("debug").length
    };
    console.log(chalk.bold("\n\u{1F4CA} Migration Log Summary"));
    console.log(chalk.gray("\u2500".repeat(30)));
    console.log(`Total entries: ${summary.total}`);
    console.log(`${chalk.blue("Info:")} ${summary.info}`);
    console.log(`${chalk.green("Success:")} ${summary.success}`);
    console.log(`${chalk.yellow("Warnings:")} ${summary.warn}`);
    console.log(`${chalk.red("Errors:")} ${summary.error}`);
    if (summary.debug > 0) {
      console.log(`${chalk.gray("Debug:")} ${summary.debug}`);
    }
    console.log(chalk.gray("\u2500".repeat(30)));
  }
}
const logger = new MigrationLogger();
if (process.env.NODE_ENV === "production") {
  const logFile = path.join(process.cwd(), "logs", "migration.log");
  logger["logFile"] = logFile;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MigrationLogger,
  logger
});
//# sourceMappingURL=logger.js.map
