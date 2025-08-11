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
var prompt_copier_enhanced_exports = {};
__export(prompt_copier_enhanced_exports, {
  EnhancedPromptCopier: () => EnhancedPromptCopier,
  copyPromptsEnhanced: () => copyPromptsEnhanced
});
module.exports = __toCommonJS(prompt_copier_enhanced_exports);
const import_meta = {};
var import_node_path = require("node:path");
var import_node_url = require("node:url");
var fs = __toESM(require("fs/promises"), 1);
var path = __toESM(require("path"), 1);
var import_worker_threads = require("worker_threads");
var import_prompt_copier = require("./prompt-copier.js");
var import_logger = require("../core/logger.js");
const __dirname = (0, import_node_path.dirname)((0, import_node_url.fileURLToPath)(import_meta.url));
class EnhancedPromptCopier extends import_prompt_copier.PromptCopier {
  static {
    __name(this, "EnhancedPromptCopier");
  }
  workerPool;
  workerResults = /* @__PURE__ */ new Map();
  constructor(options) {
    super(options);
  }
  async copyFilesParallel() {
    const workerCount = Math.min(this.options.maxWorkers, this.fileQueue.length);
    this.workerPool = await this.initializeWorkerPool(workerCount);
    try {
      await this.processWithWorkerPool();
    } finally {
      await this.terminateWorkers();
    }
  }
  async initializeWorkerPool(workerCount) {
    const workers = [];
    const pool = {
      workers,
      busy: /* @__PURE__ */ new Set(),
      queue: []
    };
    for (let i = 0; i < workerCount; i++) {
      const worker = new import_worker_threads.Worker(path.join(__dirname, "workers", "copy-worker.js"), {
        workerData: { workerId: i }
      });
      worker.on("message", (result) => {
        this.handleWorkerResult(result, i, pool);
      });
      worker.on("error", (error) => {
        import_logger.logger.error(`Worker ${i} error:`, error);
        this.errors.push({
          file: "worker",
          error: error instanceof Error ? error.message : String(error),
          phase: "write"
        });
      });
      workers.push(worker);
    }
    return pool;
  }
  async processWithWorkerPool() {
    const chunkSize = Math.max(
      1,
      Math.floor(this.fileQueue.length / this.workerPool.workers.length / 2)
    );
    const chunks = [];
    for (let i = 0; i < this.fileQueue.length; i += chunkSize) {
      chunks.push(this.fileQueue.slice(i, i + chunkSize));
    }
    const promises = [];
    for (const chunk of chunks) {
      promises.push(this.processChunkWithWorker(chunk));
    }
    await Promise.all(promises);
  }
  async processChunkWithWorker(chunk) {
    return new Promise((resolve, reject) => {
      const pool = this.workerPool;
      const tryAssignWork = /* @__PURE__ */ __name(() => {
        const availableWorkerIndex = pool.workers.findIndex((_, index) => !pool.busy.has(index));
        if (availableWorkerIndex === -1) {
          pool.queue.push(tryAssignWork);
          return;
        }
        pool.busy.add(availableWorkerIndex);
        const workerData = {
          files: chunk.map((file) => ({
            sourcePath: file.path,
            destPath: path.join(this.options.destination, file.relativePath),
            permissions: this.options.preservePermissions ? file.permissions : void 0,
            verify: this.options.verify
          })),
          workerId: availableWorkerIndex
        };
        let remainingFiles = chunk.length;
        const chunkResults = [];
        const messageHandler = /* @__PURE__ */ __name((result) => {
          chunkResults.push(result);
          remainingFiles--;
          if (remainingFiles === 0) {
            pool.workers[availableWorkerIndex].off("message", messageHandler);
            pool.busy.delete(availableWorkerIndex);
            if (pool.queue.length > 0) {
              const nextWork = pool.queue.shift();
              nextWork();
            }
            this.processChunkResults(chunk, chunkResults);
            resolve();
          }
        }, "messageHandler");
        pool.workers[availableWorkerIndex].on("message", messageHandler);
        pool.workers[availableWorkerIndex].postMessage(workerData);
      }, "tryAssignWork");
      tryAssignWork();
    });
  }
  processChunkResults(chunk, results) {
    for (const result of results) {
      if (result.success) {
        this.copiedFiles.add(result.file);
        if (result.hash) {
          this.workerResults.set(result.file, { hash: result.hash });
        }
      } else {
        this.errors.push({
          file: result.file,
          error: result.error,
          phase: "write"
        });
      }
    }
    if (this.options.progressCallback) {
      this.options.progressCallback(
        this.copiedFiles.size,
        this.totalFiles
      );
    }
  }
  handleWorkerResult(result, workerId, pool) {
    import_logger.logger.debug(`Worker ${workerId} result:`, result);
  }
  async terminateWorkers() {
    if (!this.workerPool)
      return;
    const terminationPromises = this.workerPool.workers.map((worker) => worker.terminate());
    await Promise.all(terminationPromises);
    this.workerPool = void 0;
  }
  // Override verification to use worker results
  async verifyFiles() {
    import_logger.logger.info("Verifying copied files...");
    for (const file of this.fileQueue) {
      if (!this.copiedFiles.has(file.path))
        continue;
      try {
        const destPath = path.join(this.options.destination, file.relativePath);
        if (!await this.fileExists(destPath)) {
          throw new Error("Destination file not found");
        }
        const destStats = await fs.stat(destPath);
        const sourceStats = await fs.stat(file.path);
        if (destStats.size !== sourceStats.size) {
          throw new Error(`Size mismatch: ${destStats.size} != ${sourceStats.size}`);
        }
        const workerResult = this.workerResults.get(file.path);
        if (workerResult?.hash) {
          const sourceHash = await this.calculateFileHash(file.path);
          if (sourceHash !== workerResult.hash) {
            throw new Error(`Hash mismatch: ${sourceHash} != ${workerResult.hash}`);
          }
        }
      } catch (error) {
        this.errors.push({
          file: file.path,
          error: error instanceof Error ? error.message : String(error),
          phase: "verify"
        });
      }
    }
  }
}
async function copyPromptsEnhanced(options) {
  const copier = new EnhancedPromptCopier(options);
  return copier.copy();
}
__name(copyPromptsEnhanced, "copyPromptsEnhanced");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  EnhancedPromptCopier,
  copyPromptsEnhanced
});
//# sourceMappingURL=prompt-copier-enhanced.js.map
