"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
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
var import_worker_threads = require("worker_threads");
var fs = __toESM(require("fs/promises"), 1);
var path = __toESM(require("path"), 1);
var import_crypto = require("crypto");
async function copyFile(file) {
  try {
    const destDir = path.dirname(file.destPath);
    await fs.mkdir(destDir, { recursive: true });
    await fs.copyFile(file.sourcePath, file.destPath);
    if (file.permissions) {
      await fs.chmod(file.destPath, file.permissions);
    }
    let hash;
    if (file.verify) {
      const content = await fs.readFile(file.destPath);
      hash = (0, import_crypto.createHash)("sha256").update(content).digest("hex");
    }
    return {
      success: true,
      file: file.sourcePath,
      hash
    };
  } catch (error) {
    return {
      success: false,
      file: file.sourcePath,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
__name(copyFile, "copyFile");
async function main() {
  const data = import_worker_threads.workerData;
  if (!import_worker_threads.parentPort) {
    throw new Error("This script must be run as a worker thread");
  }
  for (const file of data.files) {
    const result = await copyFile(file);
    import_worker_threads.parentPort.postMessage(result);
  }
}
__name(main, "main");
main().catch((error) => {
  if (import_worker_threads.parentPort) {
    import_worker_threads.parentPort.postMessage({
      success: false,
      file: "worker",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
//# sourceMappingURL=copy-worker.js.map
