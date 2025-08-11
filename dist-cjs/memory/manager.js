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
var manager_exports = {};
__export(manager_exports, {
  MemoryManager: () => MemoryManager
});
module.exports = __toCommonJS(manager_exports);
var import_errors = require("../utils/errors.js");
var import_sqlite = require("./backends/sqlite.js");
var import_markdown = require("./backends/markdown.js");
var import_cache = require("./cache.js");
var import_indexer = require("./indexer.js");
class MemoryManager {
  constructor(config, eventBus, logger) {
    this.config = config;
    this.eventBus = eventBus;
    this.logger = logger;
    this.backend = this.createBackend();
    this.cache = new import_cache.MemoryCache(
      this.config.cacheSizeMB * 1024 * 1024,
      // Convert MB to bytes
      this.logger
    );
    this.indexer = new import_indexer.MemoryIndexer(this.logger);
  }
  static {
    __name(this, "MemoryManager");
  }
  backend;
  cache;
  indexer;
  banks = /* @__PURE__ */ new Map();
  initialized = false;
  syncInterval;
  async initialize() {
    if (this.initialized) {
      return;
    }
    this.logger.info("Initializing memory manager...");
    try {
      await this.backend.initialize();
      const allEntries = await this.backend.getAllEntries();
      await this.indexer.buildIndex(allEntries);
      this.startSyncInterval();
      this.initialized = true;
      this.logger.info("Memory manager initialized");
    } catch (error) {
      this.logger.error("Failed to initialize memory manager", error);
      throw new import_errors.MemoryError("Memory manager initialization failed", { error });
    }
  }
  async shutdown() {
    if (!this.initialized) {
      return;
    }
    this.logger.info("Shutting down memory manager...");
    try {
      if (this.syncInterval) {
        clearInterval(this.syncInterval);
      }
      await this.flushCache();
      const bankIds = Array.from(this.banks.keys());
      await Promise.all(bankIds.map((id) => this.closeBank(id)));
      await this.backend.shutdown();
      this.initialized = false;
      this.logger.info("Memory manager shutdown complete");
    } catch (error) {
      this.logger.error("Error during memory manager shutdown", error);
      throw error;
    }
  }
  async createBank(agentId) {
    if (!this.initialized) {
      throw new import_errors.MemoryError("Memory manager not initialized");
    }
    const bank = {
      id: `bank_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      agentId,
      createdAt: /* @__PURE__ */ new Date(),
      lastAccessed: /* @__PURE__ */ new Date(),
      entryCount: 0
    };
    this.banks.set(bank.id, bank);
    this.logger.info("Memory bank created", { bankId: bank.id, agentId });
    return bank.id;
  }
  async closeBank(bankId) {
    const bank = this.banks.get(bankId);
    if (!bank) {
      throw new import_errors.MemoryError(`Memory bank not found: ${bankId}`);
    }
    const bankEntries = this.cache.getByPrefix(`${bank.agentId}:`);
    for (const entry of bankEntries) {
      await this.backend.store(entry);
    }
    this.banks.delete(bankId);
    this.logger.info("Memory bank closed", { bankId });
  }
  async store(entry) {
    if (!this.initialized) {
      throw new import_errors.MemoryError("Memory manager not initialized");
    }
    this.logger.debug("Storing memory entry", {
      id: entry.id,
      type: entry.type,
      agentId: entry.agentId
    });
    try {
      this.cache.set(entry.id, entry);
      this.indexer.addEntry(entry);
      this.backend.store(entry).catch((error) => {
        this.logger.error("Failed to store entry in backend", {
          id: entry.id,
          error
        });
      });
      const bank = Array.from(this.banks.values()).find((b) => b.agentId === entry.agentId);
      if (bank) {
        bank.entryCount++;
        bank.lastAccessed = /* @__PURE__ */ new Date();
      }
      this.eventBus.emit("memory:created", { entry });
    } catch (error) {
      this.logger.error("Failed to store memory entry", error);
      throw new import_errors.MemoryError("Failed to store memory entry", { error });
    }
  }
  async retrieve(id) {
    if (!this.initialized) {
      throw new import_errors.MemoryError("Memory manager not initialized");
    }
    const cached = this.cache.get(id);
    if (cached) {
      return cached;
    }
    const entry = await this.backend.retrieve(id);
    if (entry) {
      this.cache.set(id, entry);
    }
    return entry;
  }
  async query(query) {
    if (!this.initialized) {
      throw new import_errors.MemoryError("Memory manager not initialized");
    }
    this.logger.debug("Querying memory", query);
    try {
      let results = this.indexer.search(query);
      if (query.search) {
        results = results.filter(
          (entry) => entry.content.toLowerCase().includes(query.search.toLowerCase()) || entry.tags.some((tag) => tag.toLowerCase().includes(query.search.toLowerCase()))
        );
      }
      if (query.startTime || query.endTime) {
        results = results.filter((entry) => {
          const timestamp = entry.timestamp.getTime();
          if (query.startTime && timestamp < query.startTime.getTime()) {
            return false;
          }
          if (query.endTime && timestamp > query.endTime.getTime()) {
            return false;
          }
          return true;
        });
      }
      const start = query.offset || 0;
      const limit = query.limit || 100;
      results = results.slice(start, start + limit);
      return results;
    } catch (error) {
      this.logger.error("Failed to query memory", error);
      throw new import_errors.MemoryError("Failed to query memory", { error });
    }
  }
  async update(id, updates) {
    if (!this.initialized) {
      throw new import_errors.MemoryError("Memory manager not initialized");
    }
    const existing = await this.retrieve(id);
    if (!existing) {
      throw new import_errors.MemoryError(`Memory entry not found: ${id}`);
    }
    const updated = {
      ...existing,
      ...updates,
      id: existing.id,
      // Ensure ID doesn't change
      version: existing.version + 1,
      timestamp: /* @__PURE__ */ new Date()
    };
    this.cache.set(id, updated);
    this.indexer.updateEntry(updated);
    await this.backend.update(id, updated);
    this.eventBus.emit("memory:updated", {
      entry: updated,
      previousVersion: existing.version
    });
  }
  async delete(id) {
    if (!this.initialized) {
      throw new import_errors.MemoryError("Memory manager not initialized");
    }
    this.cache.delete(id);
    this.indexer.removeEntry(id);
    await this.backend.delete(id);
    this.eventBus.emit("memory:deleted", { entryId: id });
  }
  async getHealthStatus() {
    try {
      const backendHealth = await this.backend.getHealthStatus();
      const cacheMetrics = this.cache.getMetrics();
      const indexMetrics = this.indexer.getMetrics();
      const metrics = {
        totalEntries: indexMetrics.totalEntries,
        cacheSize: cacheMetrics.size,
        cacheHitRate: cacheMetrics.hitRate,
        activeBanks: this.banks.size,
        ...backendHealth.metrics
      };
      return {
        healthy: backendHealth.healthy,
        metrics,
        ...backendHealth.error && { error: backendHealth.error }
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }
  async performMaintenance() {
    if (!this.initialized) {
      return;
    }
    this.logger.debug("Performing memory manager maintenance");
    try {
      if (this.config.retentionDays > 0) {
        const cutoffDate = /* @__PURE__ */ new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);
        const oldEntries = await this.query({
          endTime: cutoffDate
        });
        for (const entry of oldEntries) {
          await this.delete(entry.id);
        }
        this.logger.info(`Cleaned up ${oldEntries.length} old memory entries`);
      }
      this.cache.performMaintenance();
      if (this.backend.performMaintenance) {
        await this.backend.performMaintenance();
      }
      for (const bank of this.banks.values()) {
        const entries = await this.query({ agentId: bank.agentId });
        bank.entryCount = entries.length;
        bank.lastAccessed = /* @__PURE__ */ new Date();
      }
      this.logger.debug("Memory manager maintenance completed");
    } catch (error) {
      this.logger.error("Error during memory manager maintenance", error);
    }
  }
  createBackend() {
    switch (this.config.backend) {
      case "sqlite":
        return new import_sqlite.SQLiteBackend(this.config.sqlitePath || "./claude-flow.db", this.logger);
      case "markdown":
        return new import_markdown.MarkdownBackend(this.config.markdownDir || "./memory", this.logger);
      case "hybrid":
        return new HybridBackend(
          new import_sqlite.SQLiteBackend(this.config.sqlitePath || "./claude-flow.db", this.logger),
          new import_markdown.MarkdownBackend(this.config.markdownDir || "./memory", this.logger),
          this.logger
        );
      default:
        throw new import_errors.MemoryError(`Unknown memory backend: ${this.config.backend}`);
    }
  }
  startSyncInterval() {
    this.syncInterval = setInterval(async () => {
      try {
        await this.syncCache();
      } catch (error) {
        this.logger.error("Cache sync error", error);
      }
    }, this.config.syncInterval);
  }
  async syncCache() {
    const dirtyEntries = this.cache.getDirtyEntries();
    if (dirtyEntries.length === 0) {
      return;
    }
    this.logger.debug("Syncing cache to backend", { count: dirtyEntries.length });
    const promises = dirtyEntries.map(
      (entry) => this.backend.store(entry).catch((error) => {
        this.logger.error("Failed to sync entry", { id: entry.id, error });
      })
    );
    await Promise.all(promises);
    this.cache.markClean(dirtyEntries.map((e) => e.id));
    this.eventBus.emit("memory:synced", { entries: dirtyEntries });
  }
  async flushCache() {
    const allEntries = this.cache.getAllEntries();
    if (allEntries.length === 0) {
      return;
    }
    this.logger.info("Flushing cache to backend", { count: allEntries.length });
    const promises = allEntries.map(
      (entry) => this.backend.store(entry).catch((error) => {
        this.logger.error("Failed to flush entry", { id: entry.id, error });
      })
    );
    await Promise.all(promises);
  }
}
class HybridBackend {
  constructor(primary, secondary, logger) {
    this.primary = primary;
    this.secondary = secondary;
    this.logger = logger;
  }
  static {
    __name(this, "HybridBackend");
  }
  async initialize() {
    await Promise.all([this.primary.initialize(), this.secondary.initialize()]);
  }
  async shutdown() {
    await Promise.all([this.primary.shutdown(), this.secondary.shutdown()]);
  }
  async store(entry) {
    await Promise.all([
      this.primary.store(entry),
      this.secondary.store(entry).catch((error) => {
        this.logger.warn("Failed to store in secondary backend", { error });
      })
    ]);
  }
  async retrieve(id) {
    const entry = await this.primary.retrieve(id);
    if (entry) {
      return entry;
    }
    return await this.secondary.retrieve(id);
  }
  async update(id, entry) {
    await Promise.all([
      this.primary.update(id, entry),
      this.secondary.update(id, entry).catch((error) => {
        this.logger.warn("Failed to update in secondary backend", { error });
      })
    ]);
  }
  async delete(id) {
    await Promise.all([
      this.primary.delete(id),
      this.secondary.delete(id).catch((error) => {
        this.logger.warn("Failed to delete from secondary backend", { error });
      })
    ]);
  }
  async query(query) {
    return await this.primary.query(query);
  }
  async getAllEntries() {
    return await this.primary.getAllEntries();
  }
  async getHealthStatus() {
    const [primaryHealth, secondaryHealth] = await Promise.all([
      this.primary.getHealthStatus(),
      this.secondary.getHealthStatus()
    ]);
    const error = primaryHealth.error || secondaryHealth.error;
    return {
      healthy: primaryHealth.healthy && secondaryHealth.healthy,
      ...error && { error },
      metrics: {
        ...primaryHealth.metrics,
        ...secondaryHealth.metrics
      }
    };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MemoryManager
});
//# sourceMappingURL=manager.js.map
