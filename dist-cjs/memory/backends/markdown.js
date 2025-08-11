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
var markdown_exports = {};
__export(markdown_exports, {
  MarkdownBackend: () => MarkdownBackend
});
module.exports = __toCommonJS(markdown_exports);
var import_fs = require("fs");
var import_path = __toESM(require("path"), 1);
var import_errors = require("../../utils/errors.js");
class MarkdownBackend {
  constructor(baseDir, logger) {
    this.baseDir = baseDir;
    this.logger = logger;
    this.indexPath = import_path.default.join(this.baseDir, "index.json");
  }
  static {
    __name(this, "MarkdownBackend");
  }
  entries = /* @__PURE__ */ new Map();
  indexPath;
  async initialize() {
    this.logger.info("Initializing Markdown backend", { baseDir: this.baseDir });
    try {
      await import_fs.promises.mkdir(this.baseDir, { recursive: true });
      await import_fs.promises.mkdir(import_path.default.join(this.baseDir, "agents"), { recursive: true });
      await import_fs.promises.mkdir(import_path.default.join(this.baseDir, "sessions"), { recursive: true });
      await this.loadIndex();
      this.logger.info("Markdown backend initialized");
    } catch (error) {
      throw new import_errors.MemoryBackendError("Failed to initialize Markdown backend", { error });
    }
  }
  async shutdown() {
    this.logger.info("Shutting down Markdown backend");
    await this.saveIndex();
    this.entries.clear();
  }
  async store(entry) {
    try {
      this.entries.set(entry.id, entry);
      await this.writeEntryToFile(entry);
      await this.saveIndex();
    } catch (error) {
      throw new import_errors.MemoryBackendError("Failed to store entry", { error });
    }
  }
  async retrieve(id) {
    return this.entries.get(id);
  }
  async update(id, entry) {
    if (!this.entries.has(id)) {
      throw new import_errors.MemoryBackendError(`Entry not found: ${id}`);
    }
    await this.store(entry);
  }
  async delete(id) {
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }
    try {
      this.entries.delete(id);
      const filePath = this.getEntryFilePath(entry);
      await import_fs.promises.unlink(filePath);
      await this.saveIndex();
    } catch (error) {
      throw new import_errors.MemoryBackendError("Failed to delete entry", { error });
    }
  }
  async query(query) {
    let results = Array.from(this.entries.values());
    if (query.agentId) {
      results = results.filter((e) => e.agentId === query.agentId);
    }
    if (query.sessionId) {
      results = results.filter((e) => e.sessionId === query.sessionId);
    }
    if (query.type) {
      results = results.filter((e) => e.type === query.type);
    }
    if (query.tags && query.tags.length > 0) {
      results = results.filter((e) => query.tags.some((tag) => e.tags.includes(tag)));
    }
    if (query.startTime) {
      results = results.filter((e) => e.timestamp.getTime() >= query.startTime.getTime());
    }
    if (query.endTime) {
      results = results.filter((e) => e.timestamp.getTime() <= query.endTime.getTime());
    }
    if (query.search) {
      const searchLower = query.search.toLowerCase();
      results = results.filter(
        (e) => e.content.toLowerCase().includes(searchLower) || e.tags.some((tag) => tag.toLowerCase().includes(searchLower))
      );
    }
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    const start = query.offset || 0;
    const limit = query.limit || results.length;
    results = results.slice(start, start + limit);
    return results;
  }
  async getAllEntries() {
    return Array.from(this.entries.values());
  }
  async getHealthStatus() {
    try {
      await import_fs.promises.stat(this.baseDir);
      const entryCount = this.entries.size;
      let totalSizeBytes = 0;
      for (const entry of this.entries.values()) {
        const filePath = this.getEntryFilePath(entry);
        try {
          const stat = await import_fs.promises.stat(filePath);
          totalSizeBytes += stat.size;
        } catch {
        }
      }
      return {
        healthy: true,
        metrics: {
          entryCount,
          totalSizeBytes
        }
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }
  async loadIndex() {
    try {
      const content = await import_fs.promises.readFile(this.indexPath, "utf-8");
      const index = JSON.parse(content);
      for (const [id, entry] of Object.entries(index)) {
        entry.timestamp = new Date(entry.timestamp);
        this.entries.set(id, entry);
      }
      this.logger.info("Loaded memory index", { entries: this.entries.size });
    } catch (error) {
      if (error.code !== "ENOENT") {
        this.logger.warn("Failed to load index", { error });
      }
    }
  }
  async saveIndex() {
    const index = {};
    for (const [id, entry] of this.entries) {
      index[id] = entry;
    }
    const content = JSON.stringify(index, null, 2);
    await import_fs.promises.writeFile(this.indexPath, content, "utf-8");
  }
  async writeEntryToFile(entry) {
    const filePath = this.getEntryFilePath(entry);
    const dirPath = import_path.default.dirname(filePath);
    await import_fs.promises.mkdir(dirPath, { recursive: true });
    const content = this.entryToMarkdown(entry);
    await import_fs.promises.writeFile(filePath, content, "utf-8");
  }
  getEntryFilePath(entry) {
    const date = entry.timestamp.toISOString().split("T")[0];
    const time = entry.timestamp.toISOString().split("T")[1].replace(/:/g, "-").split(".")[0];
    return import_path.default.join(this.baseDir, "agents", entry.agentId, date, `${time}_${entry.id}.md`);
  }
  entryToMarkdown(entry) {
    const lines = [
      `# Memory Entry: ${entry.id}`,
      "",
      `**Agent**: ${entry.agentId}`,
      `**Session**: ${entry.sessionId}`,
      `**Type**: ${entry.type}`,
      `**Timestamp**: ${entry.timestamp.toISOString()}`,
      `**Version**: ${entry.version}`,
      ""
    ];
    if (entry.parentId) {
      lines.push(`**Parent**: ${entry.parentId}`, "");
    }
    if (entry.tags.length > 0) {
      lines.push(`**Tags**: ${entry.tags.join(", ")}`, "");
    }
    lines.push("## Content", "", entry.content, "");
    if (Object.keys(entry.context).length > 0) {
      lines.push("## Context", "", "```json");
      lines.push(JSON.stringify(entry.context, null, 2));
      lines.push("```", "");
    }
    if (entry.metadata && Object.keys(entry.metadata).length > 0) {
      lines.push("## Metadata", "", "```json");
      lines.push(JSON.stringify(entry.metadata, null, 2));
      lines.push("```", "");
    }
    return lines.join("\n");
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MarkdownBackend
});
//# sourceMappingURL=markdown.js.map
