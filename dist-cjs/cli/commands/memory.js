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
var memory_exports = {};
__export(memory_exports, {
  SimpleMemoryManager: () => SimpleMemoryManager,
  memoryCommand: () => memoryCommand
});
module.exports = __toCommonJS(memory_exports);
var import_chalk = __toESM(require("chalk"), 1);
var import_commander = require("commander");
var import_node_fs = require("node:fs");
class SimpleMemoryManager {
  static {
    __name(this, "SimpleMemoryManager");
  }
  filePath = "./memory/memory-store.json";
  data = {};
  async load() {
    try {
      const content = await import_node_fs.promises.readFile(this.filePath, "utf-8");
      this.data = JSON.parse(content);
    } catch {
      this.data = {};
    }
  }
  async save() {
    await import_node_fs.promises.mkdir("./memory", { recursive: true });
    await import_node_fs.promises.writeFile(this.filePath, JSON.stringify(this.data, null, 2));
  }
  async store(key, value, namespace = "default") {
    await this.load();
    if (!this.data[namespace]) {
      this.data[namespace] = [];
    }
    this.data[namespace] = this.data[namespace].filter((e) => e.key !== key);
    this.data[namespace].push({
      key,
      value,
      namespace,
      timestamp: Date.now()
    });
    await this.save();
  }
  async query(search, namespace) {
    await this.load();
    const results = [];
    const namespaces = namespace ? [namespace] : Object.keys(this.data);
    for (const ns of namespaces) {
      if (this.data[ns]) {
        for (const entry of this.data[ns]) {
          if (entry.key.includes(search) || entry.value.includes(search)) {
            results.push(entry);
          }
        }
      }
    }
    return results;
  }
  async getStats() {
    await this.load();
    let totalEntries = 0;
    const namespaceStats = {};
    for (const [namespace, entries] of Object.entries(this.data)) {
      namespaceStats[namespace] = entries.length;
      totalEntries += entries.length;
    }
    return {
      totalEntries,
      namespaces: Object.keys(this.data).length,
      namespaceStats,
      sizeBytes: new TextEncoder().encode(JSON.stringify(this.data)).length
    };
  }
  async exportData(filePath) {
    await this.load();
    await import_node_fs.promises.writeFile(filePath, JSON.stringify(this.data, null, 2));
  }
  async importData(filePath) {
    const content = await import_node_fs.promises.readFile(filePath, "utf8");
    this.data = JSON.parse(content);
    await this.save();
  }
  async cleanup(daysOld = 30) {
    await this.load();
    const cutoffTime = Date.now() - daysOld * 24 * 60 * 60 * 1e3;
    let removedCount = 0;
    for (const namespace of Object.keys(this.data)) {
      const before = this.data[namespace].length;
      this.data[namespace] = this.data[namespace].filter((e) => e.timestamp > cutoffTime);
      removedCount += before - this.data[namespace].length;
    }
    await this.save();
    return removedCount;
  }
}
const memoryCommand = new import_commander.Command().name("memory").description("Manage memory bank").action(() => {
  memoryCommand.help();
});
memoryCommand.command("store").description("Store information in memory").arguments("<key> <value>").option("-n, --namespace <namespace>", "Target namespace", "default").action(async (key, value, options) => {
  try {
    const memory = new SimpleMemoryManager();
    await memory.store(key, value, options.namespace);
    console.log(import_chalk.default.green("\u2705 Stored successfully"));
    console.log(`\u{1F4DD} Key: ${key}`);
    console.log(`\u{1F4E6} Namespace: ${options.namespace}`);
    console.log(`\u{1F4BE} Size: ${new TextEncoder().encode(value).length} bytes`);
  } catch (error) {
    console.error(import_chalk.default.red("Failed to store:"), error.message);
  }
});
memoryCommand.command("query").description("Search memory entries").arguments("<search>").option("-n, --namespace <namespace>", "Filter by namespace").option("-l, --limit <limit>", "Limit results", "10").action(async (search, options) => {
  try {
    const memory = new SimpleMemoryManager();
    const results = await memory.query(search, options.namespace);
    if (results.length === 0) {
      console.log(import_chalk.default.yellow("No results found"));
      return;
    }
    console.log(import_chalk.default.green(`\u2705 Found ${results.length} results:`));
    const limited = results.slice(0, parseInt(options.limit));
    for (const entry of limited) {
      console.log(import_chalk.default.blue(`
\u{1F4CC} ${entry.key}`));
      console.log(`   Namespace: ${entry.namespace}`);
      console.log(
        `   Value: ${entry.value.substring(0, 100)}${entry.value.length > 100 ? "..." : ""}`
      );
      console.log(`   Stored: ${new Date(entry.timestamp).toLocaleString()}`);
    }
    if (results.length > parseInt(options.limit)) {
      console.log(
        import_chalk.default.gray(`
... and ${results.length - parseInt(options.limit)} more results`)
      );
    }
  } catch (error) {
    console.error(import_chalk.default.red("Failed to query:"), error.message);
  }
});
memoryCommand.command("export").description("Export memory to file").arguments("<file>").action(async (file, options) => {
  try {
    const memory = new SimpleMemoryManager();
    await memory.exportData(file);
    const stats = await memory.getStats();
    console.log(import_chalk.default.green("\u2705 Memory exported successfully"));
    console.log(`\u{1F4C1} File: ${file}`);
    console.log(`\u{1F4CA} Entries: ${stats.totalEntries}`);
    console.log(`\u{1F4BE} Size: ${(stats.sizeBytes / 1024).toFixed(2)} KB`);
  } catch (error) {
    console.error(import_chalk.default.red("Failed to export:"), error.message);
  }
});
memoryCommand.command("import").description("Import memory from file").arguments("<file>").action(async (file, options) => {
  try {
    const memory = new SimpleMemoryManager();
    await memory.importData(file);
    const stats = await memory.getStats();
    console.log(import_chalk.default.green("\u2705 Memory imported successfully"));
    console.log(`\u{1F4C1} File: ${file}`);
    console.log(`\u{1F4CA} Entries: ${stats.totalEntries}`);
    console.log(`\u{1F5C2}\uFE0F  Namespaces: ${stats.namespaces}`);
  } catch (error) {
    console.error(import_chalk.default.red("Failed to import:"), error.message);
  }
});
memoryCommand.command("stats").description("Show memory statistics").action(async () => {
  try {
    const memory = new SimpleMemoryManager();
    const stats = await memory.getStats();
    console.log(import_chalk.default.green("\u{1F4CA} Memory Bank Statistics:"));
    console.log(`   Total Entries: ${stats.totalEntries}`);
    console.log(`   Namespaces: ${stats.namespaces}`);
    console.log(`   Size: ${(stats.sizeBytes / 1024).toFixed(2)} KB`);
    if (stats.namespaces > 0) {
      console.log(import_chalk.default.blue("\n\u{1F4C1} Namespace Breakdown:"));
      for (const [namespace, count] of Object.entries(stats.namespaceStats)) {
        console.log(`   ${namespace}: ${count} entries`);
      }
    }
  } catch (error) {
    console.error(import_chalk.default.red("Failed to get stats:"), error.message);
  }
});
memoryCommand.command("cleanup").description("Clean up old entries").option("-d, --days <days>", "Entries older than n days", "30").action(async (options) => {
  try {
    const memory = new SimpleMemoryManager();
    const removed = await memory.cleanup(parseInt(options.days));
    console.log(import_chalk.default.green("\u2705 Cleanup completed"));
    console.log(`\u{1F5D1}\uFE0F  Removed: ${removed} entries older than ${options.days} days`);
  } catch (error) {
    console.error(import_chalk.default.red("Failed to cleanup:"), error.message);
  }
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SimpleMemoryManager,
  memoryCommand
});
//# sourceMappingURL=memory.js.map
