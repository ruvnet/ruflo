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
var prompt_manager_exports = {};
__export(prompt_manager_exports, {
  PromptManager: () => PromptManager,
  createPromptManager: () => createPromptManager,
  getDefaultPromptManager: () => getDefaultPromptManager
});
module.exports = __toCommonJS(prompt_manager_exports);
var path = __toESM(require("path"), 1);
var import_events = require("events");
var import_prompt_copier_enhanced = require("./prompt-copier-enhanced.js");
var import_prompt_utils = require("./prompt-utils.js");
var import_logger = require("../core/logger.js");
class PromptManager extends import_events.EventEmitter {
  static {
    __name(this, "PromptManager");
  }
  configManager;
  pathResolver;
  options;
  constructor(options = {}) {
    super();
    this.options = {
      configPath: options.configPath || ".prompt-config.json",
      basePath: options.basePath || process.cwd(),
      autoDiscovery: options.autoDiscovery ?? true,
      defaultProfile: options.defaultProfile || "sparc"
    };
    this.configManager = new import_prompt_utils.PromptConfigManager(
      path.resolve(this.options.basePath, this.options.configPath)
    );
    this.pathResolver = new import_prompt_utils.PromptPathResolver(this.options.basePath);
  }
  async initialize() {
    import_logger.logger.info("Initializing PromptManager...");
    await this.configManager.loadConfig();
    if (this.options.autoDiscovery) {
      const discovered = await this.pathResolver.discoverPromptDirectories();
      if (discovered.length > 0) {
        import_logger.logger.info(`Auto-discovered ${discovered.length} prompt directories`);
        const config = this.configManager.getConfig();
        const uniqueDirs = Array.from(
          /* @__PURE__ */ new Set([
            ...config.sourceDirectories,
            ...discovered.map((dir) => path.relative(this.options.basePath, dir))
          ])
        );
        await this.configManager.saveConfig({
          sourceDirectories: uniqueDirs
        });
      }
    }
    this.emit("initialized");
  }
  async copyPrompts(options = {}) {
    const config = this.configManager.getConfig();
    const profile = this.options.defaultProfile;
    const resolved = this.pathResolver.resolvePaths(
      config.sourceDirectories,
      config.destinationDirectory
    );
    if (resolved.sources.length === 0) {
      throw new Error("No valid source directories found");
    }
    const copyOptions = {
      source: resolved.sources[0],
      // Use first available source
      destination: resolved.destination,
      ...this.configManager.getProfile(profile),
      ...options
    };
    import_logger.logger.info("Starting prompt copy operation", {
      source: copyOptions.source,
      destination: copyOptions.destination,
      profile
    });
    this.emit("copyStart", copyOptions);
    try {
      const result = await (copyOptions.parallel ? (0, import_prompt_copier_enhanced.copyPromptsEnhanced)(copyOptions) : copyPrompts(copyOptions));
      this.emit("copyComplete", result);
      return result;
    } catch (error) {
      this.emit("copyError", error);
      throw error;
    }
  }
  async copyFromMultipleSources(options = {}) {
    const config = this.configManager.getConfig();
    const resolved = this.pathResolver.resolvePaths(
      config.sourceDirectories,
      config.destinationDirectory
    );
    const results = [];
    for (const source of resolved.sources) {
      try {
        const copyOptions = {
          source,
          destination: resolved.destination,
          ...this.configManager.getProfile(this.options.defaultProfile),
          ...options
        };
        import_logger.logger.info(`Copying from source: ${source}`);
        const result = await copyPrompts(copyOptions);
        results.push(result);
        this.emit("sourceComplete", { source, result });
      } catch (error) {
        import_logger.logger.error(`Failed to copy from ${source}:`, error);
        this.emit("sourceError", { source, error });
        results.push({
          success: false,
          totalFiles: 0,
          copiedFiles: 0,
          failedFiles: 0,
          skippedFiles: 0,
          errors: [
            {
              file: source,
              error: error instanceof Error ? error.message : String(error),
              phase: "read"
            }
          ],
          duration: 0
        });
      }
    }
    return results;
  }
  async validatePrompts(sourcePath) {
    const config = this.configManager.getConfig();
    const sources = sourcePath ? [sourcePath] : config.sourceDirectories;
    const resolved = this.pathResolver.resolvePaths(sources, config.destinationDirectory);
    let totalFiles = 0;
    let validFiles = 0;
    let invalidFiles = 0;
    const issues = [];
    for (const source of resolved.sources) {
      await this.validateDirectory(source, issues);
    }
    totalFiles = issues.length;
    validFiles = issues.filter((issue) => issue.issues.length === 0).length;
    invalidFiles = totalFiles - validFiles;
    const report = {
      totalFiles,
      validFiles,
      invalidFiles,
      issues: issues.filter((issue) => issue.issues.length > 0)
      // Only include files with issues
    };
    this.emit("validationComplete", report);
    return report;
  }
  async validateDirectory(dirPath, issues) {
    const fs = (await import("fs")).promises;
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isFile() && this.isPromptFile(entry.name)) {
          const result = await import_prompt_utils.PromptValidator.validatePromptFile(fullPath);
          issues.push({
            file: fullPath,
            issues: result.issues,
            metadata: result.metadata
          });
        } else if (entry.isDirectory()) {
          await this.validateDirectory(fullPath, issues);
        }
      }
    } catch (error) {
      import_logger.logger.error(`Failed to validate directory ${dirPath}:`, error);
    }
  }
  isPromptFile(fileName) {
    const config = this.configManager.getConfig();
    const patterns = config.defaultOptions.includePatterns;
    return patterns.some((pattern) => {
      const regex = pattern.replace(/\./g, "\\.").replace(/\*/g, ".*");
      return new RegExp(regex).test(fileName);
    });
  }
  async syncPrompts(options = {}) {
    const config = this.configManager.getConfig();
    const resolved = this.pathResolver.resolvePaths(
      config.sourceDirectories,
      config.destinationDirectory
    );
    const syncOptions = {
      bidirectional: false,
      deleteOrphaned: false,
      compareHashes: true,
      incrementalOnly: true,
      ...options
    };
    const forwardResult = await this.performIncrementalSync(
      resolved.sources[0],
      resolved.destination,
      syncOptions
    );
    let backwardResult;
    if (syncOptions.bidirectional) {
      backwardResult = await this.performIncrementalSync(
        resolved.destination,
        resolved.sources[0],
        syncOptions
      );
    }
    return {
      forward: forwardResult,
      backward: backwardResult
    };
  }
  async performIncrementalSync(source, destination, options) {
    return copyPrompts({
      source,
      destination,
      conflictResolution: "overwrite",
      verify: options.compareHashes
    });
  }
  async generateReport() {
    const config = this.configManager.getConfig();
    const resolved = this.pathResolver.resolvePaths(
      config.sourceDirectories,
      config.destinationDirectory
    );
    const sources = await Promise.all(
      resolved.sources.map(async (sourcePath) => {
        try {
          const fs = (await import("fs")).promises;
          const stats = await fs.stat(sourcePath);
          if (!stats.isDirectory()) {
            return { path: sourcePath, exists: false };
          }
          let fileCount = 0;
          let totalSize = 0;
          const scanDir = /* @__PURE__ */ __name(async (dir) => {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              if (entry.isFile() && this.isPromptFile(entry.name)) {
                const fileStats = await fs.stat(fullPath);
                fileCount++;
                totalSize += fileStats.size;
              } else if (entry.isDirectory()) {
                await scanDir(fullPath);
              }
            }
          }, "scanDir");
          await scanDir(sourcePath);
          return {
            path: sourcePath,
            exists: true,
            fileCount,
            totalSize
          };
        } catch {
          return { path: sourcePath, exists: false };
        }
      })
    );
    return {
      configuration: config,
      sources
    };
  }
  // Utility methods
  getConfig() {
    return this.configManager.getConfig();
  }
  async updateConfig(updates) {
    await this.configManager.saveConfig(updates);
  }
  getProfiles() {
    return this.configManager.listProfiles();
  }
  getProfile(name) {
    return this.configManager.getProfile(name);
  }
  async discoverPromptDirectories() {
    return this.pathResolver.discoverPromptDirectories();
  }
}
function createPromptManager(options) {
  return new PromptManager(options);
}
__name(createPromptManager, "createPromptManager");
let defaultManager = null;
function getDefaultPromptManager() {
  if (!defaultManager) {
    defaultManager = new PromptManager();
  }
  return defaultManager;
}
__name(getDefaultPromptManager, "getDefaultPromptManager");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PromptManager,
  createPromptManager,
  getDefaultPromptManager
});
//# sourceMappingURL=prompt-manager.js.map
