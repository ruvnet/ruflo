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
var cache_exports = {};
__export(cache_exports, {
  MemoryCache: () => MemoryCache
});
module.exports = __toCommonJS(cache_exports);
class MemoryCache {
  constructor(maxSize, logger) {
    this.maxSize = maxSize;
    this.logger = logger;
  }
  static {
    __name(this, "MemoryCache");
  }
  cache = /* @__PURE__ */ new Map();
  currentSize = 0;
  hits = 0;
  misses = 0;
  /**
   * Gets an entry from the cache
   */
  get(id) {
    const entry = this.cache.get(id);
    if (!entry) {
      this.misses++;
      return void 0;
    }
    entry.lastAccessed = Date.now();
    this.hits++;
    return entry.data;
  }
  /**
   * Sets an entry in the cache
   */
  set(id, data, dirty = true) {
    const size = this.calculateSize(data);
    if (this.currentSize + size > this.maxSize) {
      this.evict(size);
    }
    const entry = {
      data,
      size,
      lastAccessed: Date.now(),
      dirty
    };
    const existing = this.cache.get(id);
    if (existing) {
      this.currentSize -= existing.size;
    }
    this.cache.set(id, entry);
    this.currentSize += size;
  }
  /**
   * Deletes an entry from the cache
   */
  delete(id) {
    const entry = this.cache.get(id);
    if (entry) {
      this.currentSize -= entry.size;
      this.cache.delete(id);
    }
  }
  /**
   * Gets entries by prefix
   */
  getByPrefix(prefix) {
    const results = [];
    for (const [id, entry] of this.cache) {
      if (id.startsWith(prefix)) {
        entry.lastAccessed = Date.now();
        results.push(entry.data);
      }
    }
    return results;
  }
  /**
   * Gets all dirty entries
   */
  getDirtyEntries() {
    const dirtyEntries = [];
    for (const entry of this.cache.values()) {
      if (entry.dirty) {
        dirtyEntries.push(entry.data);
      }
    }
    return dirtyEntries;
  }
  /**
   * Marks entries as clean
   */
  markClean(ids) {
    for (const id of ids) {
      const entry = this.cache.get(id);
      if (entry) {
        entry.dirty = false;
      }
    }
  }
  /**
   * Gets all entries
   */
  getAllEntries() {
    return Array.from(this.cache.values()).map((entry) => entry.data);
  }
  /**
   * Gets cache metrics
   */
  getMetrics() {
    const totalRequests = this.hits + this.misses;
    const hitRate = totalRequests > 0 ? this.hits / totalRequests : 0;
    return {
      size: this.currentSize,
      entries: this.cache.size,
      hitRate,
      maxSize: this.maxSize
    };
  }
  /**
   * Clears the cache
   */
  clear() {
    this.cache.clear();
    this.currentSize = 0;
    this.hits = 0;
    this.misses = 0;
  }
  /**
   * Performs cache maintenance
   */
  performMaintenance() {
    const metrics = this.getMetrics();
    this.logger.debug("Cache maintenance", metrics);
  }
  calculateSize(entry) {
    let size = 0;
    size += entry.id.length * 2;
    size += entry.agentId.length * 2;
    size += entry.sessionId.length * 2;
    size += entry.type.length * 2;
    size += entry.content.length * 2;
    size += entry.tags.reduce((sum, tag) => sum + tag.length * 2, 0);
    size += JSON.stringify(entry.context).length * 2;
    if (entry.metadata) {
      size += JSON.stringify(entry.metadata).length * 2;
    }
    size += 8;
    size += 4;
    size += 100;
    return size;
  }
  evict(requiredSpace) {
    this.logger.debug("Cache eviction triggered", {
      requiredSpace,
      currentSize: this.currentSize
    });
    const entries = Array.from(this.cache.entries()).sort(
      (a, b) => a[1].lastAccessed - b[1].lastAccessed
    );
    let freedSpace = 0;
    const evicted = [];
    for (const [id, entry] of entries) {
      if (freedSpace >= requiredSpace) {
        break;
      }
      if (entry.dirty && evicted.length > 0) {
        continue;
      }
      this.cache.delete(id);
      this.currentSize -= entry.size;
      freedSpace += entry.size;
      evicted.push(id);
    }
    this.logger.debug("Cache entries evicted", {
      count: evicted.length,
      freedSpace
    });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MemoryCache
});
//# sourceMappingURL=cache.js.map
