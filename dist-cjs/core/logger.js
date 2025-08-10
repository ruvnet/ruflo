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
  LogLevel: () => LogLevel,
  Logger: () => Logger,
  logger: () => logger
});
module.exports = __toCommonJS(logger_exports);
var import_node_fs = require("node:fs");
var path = __toESM(require("node:path"), 1);
var import_node_buffer = require("node:buffer");
var import_node_process = __toESM(require("node:process"), 1);
var LogLevel = /* @__PURE__ */ ((LogLevel2) => {
  LogLevel2[LogLevel2["DEBUG"] = 0] = "DEBUG";
  LogLevel2[LogLevel2["INFO"] = 1] = "INFO";
  LogLevel2[LogLevel2["WARN"] = 2] = "WARN";
  LogLevel2[LogLevel2["ERROR"] = 3] = "ERROR";
  return LogLevel2;
})(LogLevel || {});
class Logger {
  static {
    __name(this, "Logger");
  }
  static instance;
  config;
  context;
  fileHandle;
  currentFileSize = 0;
  currentFileIndex = 0;
  isClosing = false;
  get level() {
    return this.config.level;
  }
  constructor(config = {
    level: "info",
    format: "json",
    destination: "console"
  }, context = {}) {
    if ((config.destination === "file" || config.destination === "both") && !config.filePath) {
      throw new Error("File path required for file logging");
    }
    this.config = config;
    this.context = context;
  }
  /**
   * Gets the singleton instance of the logger
   */
  static getInstance(config) {
    if (!Logger.instance) {
      if (!config) {
        const isTestEnv = import_node_process.default.env.CLAUDE_FLOW_ENV === "test";
        if (isTestEnv) {
          throw new Error("Logger configuration required for initialization");
        }
        config = {
          level: "info",
          format: "json",
          destination: "console"
        };
      }
      Logger.instance = new Logger(config);
    }
    return Logger.instance;
  }
  /**
   * Updates logger configuration
   */
  async configure(config) {
    this.config = config;
    if (this.fileHandle && config.destination !== "file" && config.destination !== "both") {
      await this.fileHandle.close();
      delete this.fileHandle;
    }
  }
  debug(message, meta) {
    this.log(0 /* DEBUG */, message, meta);
  }
  info(message, meta) {
    this.log(1 /* INFO */, message, meta);
  }
  warn(message, meta) {
    this.log(2 /* WARN */, message, meta);
  }
  error(message, error) {
    this.log(3 /* ERROR */, message, void 0, error);
  }
  /**
   * Creates a child logger with additional context
   */
  child(context) {
    return new Logger(this.config, { ...this.context, ...context });
  }
  /**
   * Properly close the logger and release resources
   */
  async close() {
    this.isClosing = true;
    if (this.fileHandle) {
      try {
        await this.fileHandle.close();
      } catch (error) {
        console.error("Error closing log file handle:", error);
      } finally {
        delete this.fileHandle;
      }
    }
  }
  log(level, message, data, error) {
    if (!this.shouldLog(level)) {
      return;
    }
    const entry = {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      level: LogLevel[level],
      message,
      context: this.context,
      data,
      error
    };
    const formatted = this.format(entry);
    if (this.config.destination === "console" || this.config.destination === "both") {
      this.writeToConsole(level, formatted);
    }
    if (this.config.destination === "file" || this.config.destination === "both") {
      this.writeToFile(formatted);
    }
  }
  shouldLog(level) {
    const configLevel = LogLevel[this.config.level.toUpperCase()];
    return level >= configLevel;
  }
  format(entry) {
    if (this.config.format === "json") {
      const jsonEntry = { ...entry };
      if (jsonEntry.error instanceof Error) {
        jsonEntry.error = {
          name: jsonEntry.error.name,
          message: jsonEntry.error.message,
          stack: jsonEntry.error.stack
        };
      }
      return JSON.stringify(jsonEntry);
    }
    const contextStr = Object.keys(entry.context).length > 0 ? ` ${JSON.stringify(entry.context)}` : "";
    const dataStr = entry.data !== void 0 ? ` ${JSON.stringify(entry.data)}` : "";
    const errorStr = entry.error !== void 0 ? entry.error instanceof Error ? `
  Error: ${entry.error.message}
  Stack: ${entry.error.stack}` : ` Error: ${JSON.stringify(entry.error)}` : "";
    return `[${entry.timestamp}] ${entry.level} ${entry.message}${contextStr}${dataStr}${errorStr}`;
  }
  writeToConsole(level, message) {
    switch (level) {
      case 0 /* DEBUG */:
        console.debug(message);
        break;
      case 1 /* INFO */:
        console.info(message);
        break;
      case 2 /* WARN */:
        console.warn(message);
        break;
      case 3 /* ERROR */:
        console.error(message);
        break;
    }
  }
  async writeToFile(message) {
    if (!this.config.filePath || this.isClosing) {
      return;
    }
    try {
      if (await this.shouldRotate()) {
        await this.rotate();
      }
      if (!this.fileHandle) {
        this.fileHandle = await import_node_fs.promises.open(this.config.filePath, "a");
      }
      const data = import_node_buffer.Buffer.from(message + "\n", "utf8");
      await this.fileHandle.write(data);
      this.currentFileSize += data.length;
    } catch (error) {
      console.error("Failed to write to log file:", error);
    }
  }
  async shouldRotate() {
    if (!this.config.maxFileSize || !this.config.filePath) {
      return false;
    }
    try {
      const stat = await import_node_fs.promises.stat(this.config.filePath);
      return stat.size >= this.config.maxFileSize;
    } catch {
      return false;
    }
  }
  async rotate() {
    if (!this.config.filePath || !this.config.maxFiles) {
      return;
    }
    if (this.fileHandle) {
      await this.fileHandle.close();
      delete this.fileHandle;
    }
    const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    const rotatedPath = `${this.config.filePath}.${timestamp}`;
    await import_node_fs.promises.rename(this.config.filePath, rotatedPath);
    await this.cleanupOldFiles();
    this.currentFileSize = 0;
  }
  async cleanupOldFiles() {
    if (!this.config.filePath || !this.config.maxFiles) {
      return;
    }
    const dir = path.dirname(this.config.filePath);
    const baseFileName = path.basename(this.config.filePath);
    try {
      const entries = await import_node_fs.promises.readdir(dir, { withFileTypes: true });
      const files = [];
      for (const entry of entries) {
        if (entry.isFile() && entry.name.startsWith(baseFileName + ".")) {
          files.push(entry.name);
        }
      }
      files.sort().reverse();
      const filesToRemove = files.slice(this.config.maxFiles - 1);
      for (const file of filesToRemove) {
        await import_node_fs.promises.unlink(path.join(dir, file));
      }
    } catch (error) {
      console.error("Failed to cleanup old log files:", error);
    }
  }
}
const logger = Logger.getInstance();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LogLevel,
  Logger,
  logger
});
//# sourceMappingURL=logger.js.map
