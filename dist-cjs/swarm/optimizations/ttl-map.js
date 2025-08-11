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
var ttl_map_exports = {};
__export(ttl_map_exports, {
  TTLMap: () => TTLMap
});
module.exports = __toCommonJS(ttl_map_exports);
class TTLMap {
  static {
    __name(this, "TTLMap");
  }
  items = /* @__PURE__ */ new Map();
  cleanupTimer;
  defaultTTL;
  cleanupInterval;
  maxSize;
  onExpire;
  stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    expirations: 0
  };
  constructor(options = {}) {
    this.defaultTTL = options.defaultTTL || 36e5;
    this.cleanupInterval = options.cleanupInterval || 6e4;
    this.maxSize = options.maxSize;
    this.onExpire = options.onExpire;
    this.startCleanup();
  }
  set(key, value, ttl) {
    const now = Date.now();
    const expiry = now + (ttl || this.defaultTTL);
    if (this.maxSize && this.items.size >= this.maxSize && !this.items.has(key)) {
      this.evictLRU();
    }
    this.items.set(key, {
      value,
      expiry,
      createdAt: now,
      accessCount: 0,
      lastAccessedAt: now
    });
  }
  get(key) {
    const item = this.items.get(key);
    if (!item) {
      this.stats.misses++;
      return void 0;
    }
    const now = Date.now();
    if (now > item.expiry) {
      this.items.delete(key);
      this.stats.expirations++;
      this.stats.misses++;
      if (this.onExpire) {
        this.onExpire(key, item.value);
      }
      return void 0;
    }
    item.accessCount++;
    item.lastAccessedAt = now;
    this.stats.hits++;
    return item.value;
  }
  has(key) {
    const item = this.items.get(key);
    if (!item) {
      return false;
    }
    if (Date.now() > item.expiry) {
      this.items.delete(key);
      this.stats.expirations++;
      if (this.onExpire) {
        this.onExpire(key, item.value);
      }
      return false;
    }
    return true;
  }
  delete(key) {
    return this.items.delete(key);
  }
  clear() {
    this.items.clear();
  }
  /**
   * Update TTL for an existing key
   */
  touch(key, ttl) {
    const item = this.items.get(key);
    if (!item || Date.now() > item.expiry) {
      return false;
    }
    item.expiry = Date.now() + (ttl || this.defaultTTL);
    item.lastAccessedAt = Date.now();
    return true;
  }
  /**
   * Get remaining TTL for a key
   */
  getTTL(key) {
    const item = this.items.get(key);
    if (!item) {
      return -1;
    }
    const remaining = item.expiry - Date.now();
    return remaining > 0 ? remaining : -1;
  }
  /**
   * Get all keys (excluding expired ones)
   */
  keys() {
    const now = Date.now();
    const validKeys = [];
    for (const [key, item] of this.items) {
      if (now <= item.expiry) {
        validKeys.push(key);
      }
    }
    return validKeys;
  }
  /**
   * Get all values (excluding expired ones)
   */
  values() {
    const now = Date.now();
    const validValues = [];
    for (const item of this.items.values()) {
      if (now <= item.expiry) {
        validValues.push(item.value);
      }
    }
    return validValues;
  }
  /**
   * Get all entries (excluding expired ones)
   */
  entries() {
    const now = Date.now();
    const validEntries = [];
    for (const [key, item] of this.items) {
      if (now <= item.expiry) {
        validEntries.push([key, item.value]);
      }
    }
    return validEntries;
  }
  /**
   * Get size (excluding expired items)
   */
  get size() {
    this.cleanup();
    return this.items.size;
  }
  startCleanup() {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);
  }
  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, item] of this.items) {
      if (now > item.expiry) {
        this.items.delete(key);
        cleaned++;
        this.stats.expirations++;
        if (this.onExpire) {
          this.onExpire(key, item.value);
        }
      }
    }
    if (cleaned > 0) {
    }
  }
  evictLRU() {
    let lruKey;
    let lruTime = Infinity;
    for (const [key, item] of this.items) {
      if (item.lastAccessedAt < lruTime) {
        lruTime = item.lastAccessedAt;
        lruKey = key;
      }
    }
    if (lruKey !== void 0) {
      this.items.delete(lruKey);
      this.stats.evictions++;
    }
  }
  /**
   * Stop the cleanup timer
   */
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = void 0;
    }
    this.items.clear();
  }
  /**
   * Get statistics about the map
   */
  getStats() {
    return {
      ...this.stats,
      size: this.items.size,
      hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0
    };
  }
  /**
   * Get detailed information about all items
   */
  inspect() {
    const now = Date.now();
    const result = /* @__PURE__ */ new Map();
    for (const [key, item] of this.items) {
      if (now <= item.expiry) {
        result.set(key, {
          value: item.value,
          ttl: item.expiry - now,
          age: now - item.createdAt,
          accessCount: item.accessCount,
          lastAccessed: now - item.lastAccessedAt
        });
      }
    }
    return result;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TTLMap
});
//# sourceMappingURL=ttl-map.js.map
