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
var async_file_manager_exports = {};
__export(async_file_manager_exports, {
  AsyncFileManager: () => AsyncFileManager
});
module.exports = __toCommonJS(async_file_manager_exports);
var import_node_fs = require("node:fs");
var import_promises = require("node:stream/promises");
var import_node_fs2 = require("node:fs");
var import_node_stream = require("node:stream");
var import_node_path = require("node:path");
var import_p_queue = __toESM(require("p-queue"), 1);
var import_logger = require("../../core/logger.js");
class AsyncFileManager {
  constructor(concurrency = {
    write: 10,
    read: 20
  }) {
    this.concurrency = concurrency;
    this.writeQueue = new import_p_queue.default({ concurrency: this.concurrency.write });
    this.readQueue = new import_p_queue.default({ concurrency: this.concurrency.read });
    const loggerConfig = process.env.CLAUDE_FLOW_ENV === "test" ? { level: "error", format: "json", destination: "console" } : { level: "info", format: "json", destination: "console" };
    this.logger = new import_logger.Logger(loggerConfig, { component: "AsyncFileManager" });
  }
  static {
    __name(this, "AsyncFileManager");
  }
  writeQueue;
  readQueue;
  logger;
  metrics = {
    operations: /* @__PURE__ */ new Map(),
    totalBytes: 0,
    errors: 0
  };
  async writeFile(path, data) {
    const start = Date.now();
    return await this.writeQueue.add(async () => {
      try {
        await this.ensureDirectory((0, import_node_path.dirname)(path));
        if (data.length > 1024 * 1024) {
          await this.streamWrite(path, data);
        } else {
          await import_node_fs.promises.writeFile(path, data, "utf8");
        }
        const duration = Date.now() - start;
        const size = Buffer.byteLength(data);
        this.trackOperation("write", size);
        return {
          path,
          operation: "write",
          success: true,
          duration,
          size
        };
      } catch (error) {
        this.metrics.errors++;
        this.logger.error("Failed to write file", { path, error });
        return {
          path,
          operation: "write",
          success: false,
          duration: Date.now() - start,
          error
        };
      }
    });
  }
  async readFile(path) {
    const start = Date.now();
    return await this.readQueue.add(async () => {
      try {
        const data = await import_node_fs.promises.readFile(path, "utf8");
        const duration = Date.now() - start;
        const size = Buffer.byteLength(data);
        this.trackOperation("read", size);
        return {
          path,
          operation: "read",
          success: true,
          duration,
          size,
          data
        };
      } catch (error) {
        this.metrics.errors++;
        this.logger.error("Failed to read file", { path, error });
        return {
          path,
          operation: "read",
          success: false,
          duration: Date.now() - start,
          error
        };
      }
    });
  }
  async writeJSON(path, data, pretty = true) {
    const jsonString = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
    return this.writeFile(path, jsonString);
  }
  async readJSON(path) {
    const result = await this.readFile(path);
    if (result.success && result.data) {
      try {
        const parsed = JSON.parse(result.data);
        return { ...result, data: parsed };
      } catch (error) {
        return {
          ...result,
          success: false,
          error: new Error("Invalid JSON format")
        };
      }
    }
    return result;
  }
  async deleteFile(path) {
    const start = Date.now();
    return this.writeQueue.add(async () => {
      try {
        await import_node_fs.promises.unlink(path);
        this.trackOperation("delete", 0);
        return {
          path,
          operation: "delete",
          success: true,
          duration: Date.now() - start
        };
      } catch (error) {
        this.metrics.errors++;
        this.logger.error("Failed to delete file", { path, error });
        return {
          path,
          operation: "delete",
          success: false,
          duration: Date.now() - start,
          error
        };
      }
    });
  }
  async ensureDirectory(path) {
    const start = Date.now();
    try {
      await import_node_fs.promises.mkdir(path, { recursive: true });
      this.trackOperation("mkdir", 0);
      return {
        path,
        operation: "mkdir",
        success: true,
        duration: Date.now() - start
      };
    } catch (error) {
      this.metrics.errors++;
      this.logger.error("Failed to create directory", { path, error });
      return {
        path,
        operation: "mkdir",
        success: false,
        duration: Date.now() - start,
        error
      };
    }
  }
  async ensureDirectories(paths) {
    return Promise.all(paths.map((path) => this.ensureDirectory(path)));
  }
  async streamWrite(path, data) {
    const stream = (0, import_node_fs2.createWriteStream)(path);
    await (0, import_promises.pipeline)(import_node_stream.Readable.from(data), stream);
  }
  async streamRead(path) {
    return (0, import_node_fs2.createReadStream)(path);
  }
  async copyFile(source, destination) {
    const start = Date.now();
    return this.writeQueue.add(async () => {
      try {
        await this.ensureDirectory((0, import_node_path.dirname)(destination));
        await import_node_fs.promises.copyFile(source, destination);
        const stats = await import_node_fs.promises.stat(destination);
        this.trackOperation("write", stats.size);
        return {
          path: destination,
          operation: "write",
          success: true,
          duration: Date.now() - start,
          size: stats.size
        };
      } catch (error) {
        this.metrics.errors++;
        this.logger.error("Failed to copy file", { source, destination, error });
        return {
          path: destination,
          operation: "write",
          success: false,
          duration: Date.now() - start,
          error
        };
      }
    });
  }
  async moveFile(source, destination) {
    const copyResult = await this.copyFile(source, destination);
    if (copyResult.success) {
      await this.deleteFile(source);
    }
    return copyResult;
  }
  trackOperation(type, bytes) {
    const count = this.metrics.operations.get(type) || 0;
    this.metrics.operations.set(type, count + 1);
    this.metrics.totalBytes += bytes;
  }
  getMetrics() {
    return {
      operations: Object.fromEntries(this.metrics.operations),
      totalBytes: this.metrics.totalBytes,
      errors: this.metrics.errors,
      writeQueueSize: this.writeQueue.size,
      readQueueSize: this.readQueue.size,
      writeQueuePending: this.writeQueue.pending,
      readQueuePending: this.readQueue.pending
    };
  }
  async waitForPendingOperations() {
    await Promise.all([this.writeQueue.onIdle(), this.readQueue.onIdle()]);
  }
  clearQueues() {
    this.writeQueue.clear();
    this.readQueue.clear();
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AsyncFileManager
});
//# sourceMappingURL=async-file-manager.js.map
