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
var swarm_memory_exports = {};
__export(swarm_memory_exports, {
  SwarmMemoryManager: () => SwarmMemoryManager
});
module.exports = __toCommonJS(swarm_memory_exports);
var import_node_events = require("node:events");
var import_logger = require("../core/logger.js");
var import_manager = require("./manager.js");
var import_event_bus = require("../core/event-bus.js");
var import_helpers = require("../utils/helpers.js");
var fs = __toESM(require("node:fs/promises"), 1);
var path = __toESM(require("node:path"), 1);
class SwarmMemoryManager extends import_node_events.EventEmitter {
  static {
    __name(this, "SwarmMemoryManager");
  }
  logger;
  config;
  baseMemory;
  entries;
  knowledgeBases;
  agentMemories;
  // agentId -> set of entry IDs
  syncTimer;
  isInitialized = false;
  constructor(config = {}) {
    super();
    this.logger = new import_logger.Logger("SwarmMemoryManager");
    this.config = {
      namespace: "swarm",
      enableDistribution: true,
      enableReplication: true,
      syncInterval: 1e4,
      // 10 seconds
      maxEntries: 1e4,
      compressionThreshold: 1e3,
      enableKnowledgeBase: true,
      enableCrossAgentSharing: true,
      persistencePath: "./swarm-memory",
      ...config
    };
    this.entries = /* @__PURE__ */ new Map();
    this.knowledgeBases = /* @__PURE__ */ new Map();
    this.agentMemories = /* @__PURE__ */ new Map();
    const eventBus = import_event_bus.EventBus.getInstance();
    this.baseMemory = new import_manager.MemoryManager(
      {
        backend: "sqlite",
        namespace: this.config.namespace,
        cacheSizeMB: 50,
        syncOnExit: true,
        maxEntries: this.config.maxEntries,
        ttlMinutes: 60
      },
      eventBus,
      this.logger
    );
  }
  async initialize() {
    if (this.isInitialized)
      return;
    this.logger.info("Initializing swarm memory manager...");
    await this.baseMemory.initialize();
    await fs.mkdir(this.config.persistencePath, { recursive: true });
    await this.loadMemoryState();
    if (this.config.syncInterval > 0) {
      this.syncTimer = setInterval(() => {
        this.syncMemoryState();
      }, this.config.syncInterval);
    }
    this.isInitialized = true;
    this.emit("memory:initialized");
  }
  async shutdown() {
    if (!this.isInitialized)
      return;
    this.logger.info("Shutting down swarm memory manager...");
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = void 0;
    }
    await this.saveMemoryState();
    this.isInitialized = false;
    this.emit("memory:shutdown");
  }
  async remember(agentId, type, content, metadata = {}) {
    const entryId = (0, import_helpers.generateId)("mem");
    const entry = {
      id: entryId,
      agentId,
      type,
      content,
      timestamp: /* @__PURE__ */ new Date(),
      metadata: {
        shareLevel: "team",
        priority: 1,
        ...metadata
      }
    };
    this.entries.set(entryId, entry);
    if (!this.agentMemories.has(agentId)) {
      this.agentMemories.set(agentId, /* @__PURE__ */ new Set());
    }
    this.agentMemories.get(agentId).add(entryId);
    await this.baseMemory.remember({
      namespace: this.config.namespace,
      key: `entry:${entryId}`,
      content: JSON.stringify(entry),
      metadata: {
        type: "swarm-memory",
        agentId,
        entryType: type,
        shareLevel: entry.metadata.shareLevel
      }
    });
    this.logger.debug(`Agent ${agentId} remembered: ${type} - ${entryId}`);
    this.emit("memory:added", entry);
    if (type === "knowledge" && this.config.enableKnowledgeBase) {
      await this.updateKnowledgeBase(entry);
    }
    await this.enforceMemoryLimits();
    return entryId;
  }
  async recall(query) {
    let results = Array.from(this.entries.values());
    if (query.agentId) {
      results = results.filter((e) => e.agentId === query.agentId);
    }
    if (query.type) {
      results = results.filter((e) => e.type === query.type);
    }
    if (query.taskId) {
      results = results.filter((e) => e.metadata.taskId === query.taskId);
    }
    if (query.objectiveId) {
      results = results.filter((e) => e.metadata.objectiveId === query.objectiveId);
    }
    if (query.tags && query.tags.length > 0) {
      results = results.filter(
        (e) => e.metadata.tags && query.tags.some((tag) => e.metadata.tags.includes(tag))
      );
    }
    if (query.since) {
      results = results.filter((e) => e.timestamp >= query.since);
    }
    if (query.before) {
      results = results.filter((e) => e.timestamp <= query.before);
    }
    if (query.shareLevel) {
      results = results.filter((e) => e.metadata.shareLevel === query.shareLevel);
    }
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    if (query.limit) {
      results = results.slice(0, query.limit);
    }
    this.logger.debug(`Recalled ${results.length} memories for query`);
    return results;
  }
  async shareMemory(entryId, targetAgentId) {
    const entry = this.entries.get(entryId);
    if (!entry) {
      throw new Error("Memory entry not found");
    }
    if (!this.config.enableCrossAgentSharing) {
      throw new Error("Cross-agent sharing is disabled");
    }
    if (entry.metadata.shareLevel === "private") {
      throw new Error("Memory entry is private and cannot be shared");
    }
    const sharedEntry = {
      ...entry,
      id: (0, import_helpers.generateId)("mem"),
      metadata: {
        ...entry.metadata,
        originalId: entryId,
        sharedFrom: entry.agentId,
        sharedTo: targetAgentId,
        sharedAt: /* @__PURE__ */ new Date()
      }
    };
    this.entries.set(sharedEntry.id, sharedEntry);
    if (!this.agentMemories.has(targetAgentId)) {
      this.agentMemories.set(targetAgentId, /* @__PURE__ */ new Set());
    }
    this.agentMemories.get(targetAgentId).add(sharedEntry.id);
    this.logger.info(`Shared memory ${entryId} from ${entry.agentId} to ${targetAgentId}`);
    this.emit("memory:shared", { original: entry, shared: sharedEntry });
  }
  async broadcastMemory(entryId, agentIds) {
    const entry = this.entries.get(entryId);
    if (!entry) {
      throw new Error("Memory entry not found");
    }
    if (entry.metadata.shareLevel === "private") {
      throw new Error("Cannot broadcast private memory");
    }
    const targets = agentIds || Array.from(this.agentMemories.keys()).filter((id) => id !== entry.agentId);
    for (const targetId of targets) {
      try {
        await this.shareMemory(entryId, targetId);
      } catch (error) {
        this.logger.warn(`Failed to share memory to ${targetId}:`, error);
      }
    }
    this.logger.info(`Broadcasted memory ${entryId} to ${targets.length} agents`);
  }
  async createKnowledgeBase(name, description, domain, expertise) {
    const kbId = (0, import_helpers.generateId)("kb");
    const knowledgeBase = {
      id: kbId,
      name,
      description,
      entries: [],
      metadata: {
        domain,
        expertise,
        contributors: [],
        lastUpdated: /* @__PURE__ */ new Date()
      }
    };
    this.knowledgeBases.set(kbId, knowledgeBase);
    this.logger.info(`Created knowledge base: ${name} (${kbId})`);
    this.emit("knowledgebase:created", knowledgeBase);
    return kbId;
  }
  async updateKnowledgeBase(entry) {
    if (!this.config.enableKnowledgeBase)
      return;
    const relevantKBs = Array.from(this.knowledgeBases.values()).filter((kb) => {
      const tags = entry.metadata.tags || [];
      return tags.some(
        (tag) => kb.metadata.expertise.some(
          (exp) => exp.toLowerCase().includes(tag.toLowerCase()) || tag.toLowerCase().includes(exp.toLowerCase())
        )
      );
    });
    for (const kb of relevantKBs) {
      kb.entries.push(entry);
      kb.metadata.lastUpdated = /* @__PURE__ */ new Date();
      if (!kb.metadata.contributors.includes(entry.agentId)) {
        kb.metadata.contributors.push(entry.agentId);
      }
      this.logger.debug(`Updated knowledge base ${kb.id} with entry ${entry.id}`);
    }
  }
  async searchKnowledge(query, domain, expertise) {
    const allEntries = [];
    for (const kb of this.knowledgeBases.values()) {
      if (domain && kb.metadata.domain !== domain)
        continue;
      if (expertise && !expertise.some((exp) => kb.metadata.expertise.includes(exp))) {
        continue;
      }
      allEntries.push(...kb.entries);
    }
    const queryLower = query.toLowerCase();
    const results = allEntries.filter((entry) => {
      const contentStr = JSON.stringify(entry.content).toLowerCase();
      return contentStr.includes(queryLower);
    });
    return results.slice(0, 50);
  }
  async getAgentMemorySnapshot(agentId) {
    const agentEntryIds = this.agentMemories.get(agentId) || /* @__PURE__ */ new Set();
    const agentEntries = Array.from(agentEntryIds).map((id) => this.entries.get(id)).filter(Boolean);
    const recentEntries = agentEntries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, 10);
    const knowledgeContributions = agentEntries.filter((e) => e.type === "knowledge").length;
    const sharedEntries = agentEntries.filter(
      (e) => e.metadata.shareLevel === "public" || e.metadata.shareLevel === "team"
    ).length;
    return {
      totalEntries: agentEntries.length,
      recentEntries,
      knowledgeContributions,
      sharedEntries
    };
  }
  async loadMemoryState() {
    try {
      const entriesFile = path.join(this.config.persistencePath, "entries.json");
      try {
        const entriesData = await fs.readFile(entriesFile, "utf-8");
        const entriesArray = JSON.parse(entriesData);
        for (const entry of entriesArray) {
          this.entries.set(entry.id, {
            ...entry,
            timestamp: new Date(entry.timestamp)
          });
          if (!this.agentMemories.has(entry.agentId)) {
            this.agentMemories.set(entry.agentId, /* @__PURE__ */ new Set());
          }
          this.agentMemories.get(entry.agentId).add(entry.id);
        }
        this.logger.info(`Loaded ${entriesArray.length} memory entries`);
      } catch (error) {
        this.logger.warn("No existing memory entries found");
      }
      const kbFile = path.join(this.config.persistencePath, "knowledge-bases.json");
      try {
        const kbData = await fs.readFile(kbFile, "utf-8");
        const kbArray = JSON.parse(kbData);
        for (const kb of kbArray) {
          this.knowledgeBases.set(kb.id, {
            ...kb,
            metadata: {
              ...kb.metadata,
              lastUpdated: new Date(kb.metadata.lastUpdated)
            },
            entries: kb.entries.map((e) => ({
              ...e,
              timestamp: new Date(e.timestamp)
            }))
          });
        }
        this.logger.info(`Loaded ${kbArray.length} knowledge bases`);
      } catch (error) {
        this.logger.warn("No existing knowledge bases found");
      }
    } catch (error) {
      this.logger.error("Error loading memory state:", error);
    }
  }
  async saveMemoryState() {
    try {
      const entriesArray = Array.from(this.entries.values());
      const entriesFile = path.join(this.config.persistencePath, "entries.json");
      await fs.writeFile(entriesFile, JSON.stringify(entriesArray, null, 2));
      const kbArray = Array.from(this.knowledgeBases.values());
      const kbFile = path.join(this.config.persistencePath, "knowledge-bases.json");
      await fs.writeFile(kbFile, JSON.stringify(kbArray, null, 2));
      this.logger.debug("Saved memory state to disk");
    } catch (error) {
      this.logger.error("Error saving memory state:", error);
    }
  }
  async syncMemoryState() {
    try {
      await this.saveMemoryState();
      this.emit("memory:synced");
    } catch (error) {
      this.logger.error("Error syncing memory state:", error);
    }
  }
  async enforceMemoryLimits() {
    if (this.entries.size <= this.config.maxEntries)
      return;
    this.logger.info("Enforcing memory limits...");
    const entries = Array.from(this.entries.values()).filter((e) => (e.metadata.priority || 1) <= 1).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const toRemove = entries.slice(0, this.entries.size - this.config.maxEntries);
    for (const entry of toRemove) {
      this.entries.delete(entry.id);
      const agentEntries = this.agentMemories.get(entry.agentId);
      if (agentEntries) {
        agentEntries.delete(entry.id);
      }
      this.logger.debug(`Removed old memory entry: ${entry.id}`);
    }
    this.emit("memory:cleaned", toRemove.length);
  }
  // Public API methods
  getMemoryStats() {
    const entries = Array.from(this.entries.values());
    const entriesByType = {};
    const entriesByAgent = {};
    for (const entry of entries) {
      entriesByType[entry.type] = (entriesByType[entry.type] || 0) + 1;
      entriesByAgent[entry.agentId] = (entriesByAgent[entry.agentId] || 0) + 1;
    }
    const memoryUsage = JSON.stringify(entries).length;
    return {
      totalEntries: entries.length,
      entriesByType,
      entriesByAgent,
      knowledgeBases: this.knowledgeBases.size,
      memoryUsage
    };
  }
  async exportMemory(agentId) {
    const entries = agentId ? await this.recall({ agentId }) : Array.from(this.entries.values());
    return {
      entries,
      knowledgeBases: agentId ? Array.from(this.knowledgeBases.values()).filter(
        (kb) => kb.metadata.contributors.includes(agentId)
      ) : Array.from(this.knowledgeBases.values()),
      exportedAt: /* @__PURE__ */ new Date(),
      stats: this.getMemoryStats()
    };
  }
  async clearMemory(agentId) {
    if (agentId) {
      const entryIds = this.agentMemories.get(agentId) || /* @__PURE__ */ new Set();
      for (const entryId of entryIds) {
        this.entries.delete(entryId);
      }
      this.agentMemories.delete(agentId);
      this.logger.info(`Cleared memory for agent ${agentId}`);
    } else {
      this.entries.clear();
      this.agentMemories.clear();
      this.knowledgeBases.clear();
      this.logger.info("Cleared all swarm memory");
    }
    this.emit("memory:cleared", { agentId });
  }
  // Compatibility methods for hive.ts
  async store(key, value) {
    const parts = key.split("/");
    const type = parts[0] || "state";
    const agentId = parts[1] || "system";
    await this.remember(agentId, type, value, {
      tags: [parts[0], parts[1]].filter(Boolean),
      shareLevel: "team"
    });
  }
  async search(pattern, limit = 10) {
    const results = [];
    for (const entry of this.entries.values()) {
      const entryString = JSON.stringify(entry);
      if (entryString.includes(pattern.replace("*", ""))) {
        results.push(entry.content);
        if (results.length >= limit)
          break;
      }
    }
    return results;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SwarmMemoryManager
});
//# sourceMappingURL=swarm-memory.js.map
