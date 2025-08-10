"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var optimizations_exports = {};
__export(optimizations_exports, {
  AsyncFileManager: () => import_async_file_manager.AsyncFileManager,
  CircularBuffer: () => import_circular_buffer.CircularBuffer,
  ClaudeConnectionPool: () => import_connection_pool.ClaudeConnectionPool,
  OptimizedExecutor: () => import_optimized_executor.OptimizedExecutor,
  TTLMap: () => import_ttl_map.TTLMap,
  createOptimizedSwarmStack: () => createOptimizedSwarmStack
});
module.exports = __toCommonJS(optimizations_exports);
var import_connection_pool = require("./connection-pool.js");
var import_async_file_manager = require("./async-file-manager.js");
var import_circular_buffer = require("./circular-buffer.js");
var import_ttl_map = require("./ttl-map.js");
var import_optimized_executor = require("./optimized-executor.js");
const createOptimizedSwarmStack = /* @__PURE__ */ __name((config) => {
  const connectionPool = new ClaudeConnectionPool(config?.connectionPool);
  const fileManager = new AsyncFileManager(config?.fileManager);
  const executor = new OptimizedExecutor({
    ...config?.executor,
    connectionPool: config?.connectionPool,
    fileOperations: config?.fileManager
  });
  return {
    connectionPool,
    fileManager,
    executor,
    shutdown: async () => {
      await executor.shutdown();
      await fileManager.waitForPendingOperations();
      await connectionPool.drain();
    }
  };
}, "createOptimizedSwarmStack");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AsyncFileManager,
  CircularBuffer,
  ClaudeConnectionPool,
  OptimizedExecutor,
  TTLMap,
  createOptimizedSwarmStack
});
//# sourceMappingURL=index.js.map
